// Orquestador de Eco. Compone identidad + geo + proxy + store + reputación.
// No reimplementa protocolo: cada servicio usa su paquete del ecosistema.
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import {
  initIdentity, getMyPubkey, isReady, isContact, affinityOf, signData
} from '../services/identity'
import { publishEco, removeEco, discover } from '../services/geo'
import { connect as proxyConnect, onMessage, sendEcoEvent } from '../services/proxy'
import {
  saveEco, saveMine, loadAllEcos, pushInbox, loadInbox, clearInbox, muteAuthor
} from '../services/store'
import { repOf, isEndorsed, warmRep } from '../services/reputation'
import { rankFeed, isAlive, PRESETS } from './ranking'

const TTL_24H = 24 * 60 * 60 * 1000
const POLL_MS = 60_000
const RADII = [5000, 20000, 100000, 0] // 5km, 20km, 100km, global(0)

export const useFeed = defineStore('feed', {
  state: () => ({
    ready: false,
    standalone: false,        // vault inalcanzable: modo solo-lectura local
    myPubkey: null,
    pos: null,                // { lat, lng }
    geoError: null,
    radiusMeters: 20000,
    preset: 'balanced',
    myTags: [],               // intereses para tags/discover
    posts: new Map(),         // id → eco (cache en memoria)
    feed: [],                 // [{ eco, ctx, score }]
    inbox: [],
    interactions: new Map(),  // authorPk → nº interacciones (afinidad)
    busy: false,
    _poll: null,
    _off: null
  }),

  getters: {
    presets: () => PRESETS,
    radii: () => RADII,
    aliveCount: (s) => s.feed.length
  },

  actions: {
    async init () {
      await initIdentity()
      this.myPubkey = getMyPubkey()
      this.standalone = !isReady()
      // cargar archivo local primero (funciona aunque no haya red)
      for (const eco of await loadAllEcos()) this.posts.set(eco.id, eco)
      this.inbox = await loadInbox()
      if (!this.standalone) {
        await proxyConnect()
        this._off = onMessage((m) => this._onProxy(m))
      }
      await this._locate()
      await this.rebuild()
      this.ready = true
      this.startPolling()
    },

    async _locate () {
      if (!('geolocation' in navigator)) { this.geoError = 'sin geolocalización'; return }
      try {
        const p = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }))
        this.pos = { lat: p.coords.latitude, lng: p.coords.longitude }
        this.geoError = null
      } catch (e) { this.geoError = e.message || 'ubicación denegada' }
    },

    setRadius (m) { this.radiusMeters = m; this.discoverNow() },
    setPreset (p) { this.preset = p; this.rebuild() },
    setTags (tags) {
      this.myTags = (tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
      this.rebuild()
    },

    startPolling () {
      if (this._poll || this.standalone) return
      this.discoverNow()
      this._poll = setInterval(() => this.discoverNow(), POLL_MS)
    },
    stopPolling () { if (this._poll) { clearInterval(this._poll); this._poll = null } },

    // --- Publicar ---
    async publish ({ text, links = [], tags = [] }) {
      if (this.standalone || !this.pos) { this.geoError = 'necesitás vault y ubicación para publicar'; return null }
      this.busy = true
      try {
        const now = Date.now()
        const eco = {
          id: uuidv4(),
          author: this.myPubkey,
          text: String(text || '').slice(0, 280),
          links: links.filter(Boolean).slice(0, 4),
          tags: normTags(tags),
          lat: this.pos.lat, lng: this.pos.lng,
          createdAt: now,
          expiresAt: now + TTL_24H,
          repostOf: null, replyTo: null
        }
        eco.sig = (await signData(canonical(eco))) || null
        await saveMine(eco)
        this.posts.set(eco.id, eco)
        await publishEco(eco, this.pos.lat, this.pos.lng, TTL_24H)
        await this.rebuild()
        return eco
      } finally { this.busy = false }
    },

    // --- Descubrir (poll geo) ---
    async discoverNow () {
      if (this.standalone || !this.pos) return
      try {
        const pins = await discover(this.pos.lat, this.pos.lng, this.radiusMeters, this.myTags)
        let changed = false
        const seenAuthors = []
        for (const pin of pins) {
          const eco = pinToEco(pin)
          if (!eco) continue
          seenAuthors.push(eco.author)
          if (this.posts.has(eco.id)) continue
          this.posts.set(eco.id, eco)
          await saveEco(eco)
          changed = true
        }
        await warmRep(seenAuthors)
        if (changed) await this.rebuild()
      } catch (e) { console.warn('[feed] discover falló', e.message) }
    },

    // --- Reconstruir el feed rankeado (capa 2) ---
    async rebuild () {
      const now = Date.now()
      const alive = [...this.posts.values()].filter((e) => isAlive(e, now) && e.author !== this.myPubkey)
      const mine = [...this.posts.values()].filter((e) => e.author === this.myPubkey && isAlive(e, now))
      // enriquecer con señales de ctx
      const items = await Promise.all(alive.map(async (eco) => ({
        eco,
        ctx: {
          affinity: await affinityOf(eco.author, this.interactions.get(eco.author) || 0),
          reputation: await repOf(eco.author),
          myTags: this.myTags,
          radiusMeters: this.radiusMeters
        }
      })))
      const ranked = rankFeed(items, this.preset, now)
      // mis ecos vivos van arriba como "tuyos", fuera del ranking
      this.feed = [
        ...mine.sort((a, b) => b.createdAt - a.createdAt).map((eco) => ({ eco, ctx: { mine: true }, score: Infinity })),
        ...ranked
      ]
    },

    // --- Reply / Repost (rehidratan el TTL del original) ---
    async reply (target, text) {
      this._bumpAffinity(target.author)
      await sendEcoEvent(target.author, { type: 'eco-reply', refId: target.id, text: String(text).slice(0, 280) })
    },

    async repost (target) {
      if (this.standalone || !this.pos) return
      this._bumpAffinity(target.author)
      const now = Date.now()
      const eco = {
        id: uuidv4(), author: this.myPubkey, text: target.text, links: target.links || [],
        tags: target.tags || [], lat: this.pos.lat, lng: this.pos.lng,
        createdAt: now, expiresAt: now + TTL_24H,
        repostOf: { author: target.author, id: target.id }, replyTo: null
      }
      eco.sig = (await signData(canonical(eco))) || null
      await saveMine(eco)
      this.posts.set(eco.id, eco)
      await publishEco(eco, this.pos.lat, this.pos.lng, TTL_24H)
      // notificar al original → su cliente rehidrata su beacon
      await sendEcoEvent(target.author, { type: 'eco-repost', refId: target.id })
      await this.rebuild()
    },

    _bumpAffinity (pk) { this.interactions.set(pk, (this.interactions.get(pk) || 0) + 1) },

    // --- Entrada por proxy (eventos dirigidos de otros) ---
    async _onProxy (msg) {
      const p = msg?.payload
      if (!p || p.app !== 'eco') return
      const from = msg.fromPubkey || p.author
      const type = p.type

      // ¿alguien tocó un eco mío? → rehidrato mi beacon (resetea TTL)
      if ((type === 'eco-reply' || type === 'eco-repost') && p.refId) {
        const mineEco = this.posts.get(p.refId)
        if (mineEco && mineEco.author === this.myPubkey) {
          mineEco.expiresAt = Date.now() + TTL_24H
          if (this.pos) await publishEco(mineEco, this.pos.lat, this.pos.lng, TTL_24H)
        }
      }

      // gate de capa 1 para el remitente
      if (from && from !== this.myPubkey) {
        if (await isContact(from)) {
          // contacto → directo
        } else if (await isEndorsed(from)) {
          await pushInbox({ from, type, text: p.text || '', refId: p.refId, ts: Date.now() })
          this.inbox = await loadInbox()
          return
        } else {
          return // desconocido sin aval → descartar
        }
      }
      await this.rebuild()
    },

    async acceptInbox () {
      // aceptar la bandeja entera: ya están guardados; sólo limpiamos el flag
      await clearInbox(); this.inbox = []
      await this.rebuild()
    },
    async dismissInbox () { await clearInbox(); this.inbox = [] },

    async mute (pk) {
      await muteAuthor(pk)
      for (const [id, eco] of this.posts) if (eco.author === pk) this.posts.delete(id)
      await this.rebuild()
    },

    async unpublishMine () { try { await removeEco() } catch (_) {} },

    dispose () { this.stopPolling(); if (this._off) this._off() }
  }
})

// --- helpers ---
function normTags (tags) {
  return [...new Set((tags || []).map((t) => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 6)
}

// Serialización canónica mínima para firmar (orden estable de claves de contenido).
function canonical (eco) {
  return JSON.stringify({
    id: eco.id, author: eco.author, text: eco.text, links: eco.links,
    tags: eco.tags, createdAt: eco.createdAt, repostOf: eco.repostOf, replyTo: eco.replyTo
  })
}

// El payload del pin geo ES el eco; el server ya verificó la firma del sobre,
// así que el author autoritativo es el pubkey del pin.
function pinToEco (pin) {
  const e = pin.payload
  if (!e || !e.id || !e.text) return null
  return {
    ...e,
    author: pin.publickey || e.author,
    lat: pin.lat ?? e.lat, lng: pin.lng ?? e.lng,
    distanceMeters: pin.distanceMeters,
    expiresAt: e.expiresAt || (pin.expiresAt ? new Date(pin.expiresAt).getTime() : (e.createdAt + TTL_24H))
  }
}
