<script setup>
import { ref, computed, onMounted, onBeforeUnmount, reactive } from 'vue'
import { useFeed } from './feed/feedStore'
import iconUrl from '/icon.svg'

const feed = useFeed()
function initialLang () {
  try { const s = localStorage.getItem('eco:lang'); if (s === 'es' || s === 'en') return s } catch (_) {}
  return (navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es'
}
const lang = ref(initialLang())
function toggleLang () {
  lang.value = lang.value === 'en' ? 'es' : 'en'
  try { localStorage.setItem('eco:lang', lang.value) } catch (_) {}
}

const T = {
  es: {
    tagline: 'tu voz · tu zona · 24 h',
    placeholder: '¿Qué resuena cerca tuyo?',
    composerHint: 'Los enlaces y #hashtags se detectan solos.',
    publish: 'Publicar eco', radius: 'Radio', global: 'Global',
    sort: 'Orden',
    searchPh: 'Buscar ecos…  (Enter lo guarda como tema)',
    themes: 'Temas', themesTitle: 'Tus temas',
    themesIntro: 'Eco los aprende solo de lo que publicás y respondés; los temas suben en tu orden (preset “Temas”). Acá los agregás o quitás.',
    addPh: 'Agregar un tema', noThemes: 'Todavía no hay temas. Publicá con #hashtags, buscá algo, o agregá uno acá.', close: 'Cerrar',
    inbox: (n) => `${n} en tu bandeja (avalados por tu red)`, accept: 'Ver', dismiss: 'Descartar',
    reply: 'Responder', repost: 'Re-eco', mute: 'Silenciar', del: 'Borrar',
    like: 'Me gusta', dislike: 'No me gusta', share: 'Compartir', kept: 'guardado',
    you: 'vos', install: 'Instalar',
    repostOf: 're-eco de', expires: 'expira en', empty: 'Todavía no hay ecos en tu zona. Publicá el primero o ampliá el alcance.',
    standalone: 'Vault no disponible: modo archivo local (solo lectura).',
    needLoc: 'Activá la ubicación para publicar y descubrir ecos.',
    locating: 'Obteniendo tu ubicación…', retryLoc: 'Activar ubicación',
    nickTitle: 'Elegí tu nombre', nickIntro: 'Tus ecos y acciones se firman con este nombre. Hace falta para participar.',
    nickPh: 'Tu nombre visible', nickSave: 'Guardar', setNick: 'Definir nombre',
    replyPrompt: 'Tu respuesta:'
  },
  en: {
    tagline: 'your voice · your radius · 24 h',
    placeholder: "What's echoing near you?",
    composerHint: 'Links and #hashtags are detected automatically.',
    publish: 'Post eco', radius: 'Radius', global: 'Global',
    sort: 'Sort',
    searchPh: 'Search ecos…  (Enter saves it as a topic)',
    themes: 'Topics', themesTitle: 'Your topics',
    themesIntro: 'Eco learns them automatically from what you post and reply to; topics rank higher (the “Topics” sort). Add or remove them here.',
    addPh: 'Add a topic', noThemes: 'No topics yet. Post with #hashtags, search something, or add one here.', close: 'Close',
    inbox: (n) => `${n} in your inbox (endorsed by your network)`, accept: 'View', dismiss: 'Dismiss',
    reply: 'Reply', repost: 'Re-echo', mute: 'Mute', del: 'Delete',
    like: 'Like', dislike: 'Dislike', share: 'Share', kept: 'saved',
    you: 'you', install: 'Install',
    repostOf: 're-echo of', expires: 'expires in', empty: 'No ecos in your radius yet. Post the first or widen the radius.',
    standalone: 'Vault unavailable: local-archive mode (read only).',
    needLoc: 'Enable location to post and discover ecos.',
    locating: 'Getting your location…', retryLoc: 'Enable location',
    nickTitle: 'Choose your name', nickIntro: 'Your ecos and actions are signed with this name. Required to take part.',
    nickPh: 'Your visible name', nickSave: 'Save', setNick: 'Set name',
    replyPrompt: 'Your reply:'
  }
}
const t = computed(() => T[lang.value])

const text = ref('')
const search = ref('')
const newInterest = ref('')
const showThemes = ref(false)
const now = ref(Date.now())
const installEvt = ref(null)
const nickPrompt = ref(false)
const nickDraft = ref('')
let pendingAction = null
let tick

// Guard central: ninguna acción sin nick. Abre el prompt y reanuda la acción.
function withNick (fn) {
  if (feed.hasNick) return fn()
  pendingAction = fn
  nickPrompt.value = true
}
async function saveNick () {
  if (!nickDraft.value.trim()) return
  const ok = await feed.setMyName(nickDraft.value)
  if (!ok) return
  nickPrompt.value = false
  nickDraft.value = ''
  const a = pendingAction; pendingAction = null
  if (a) await a()
}

// Feed visible = filtrado por el buscador (texto / tags / autor). No persiste:
// el buscador es para encontrar ahora; al Enter se guarda como tema.
const visibleFeed = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return feed.feed
  return feed.feed.filter(({ eco, ctx }) =>
    (eco.text || '').toLowerCase().includes(q) ||
    (eco.tags || []).some((t) => t.includes(q)) ||
    (ctx.name || '').toLowerCase().includes(q))
})
function commitSearch () {
  const q = search.value.trim()
  if (q) { feed.addInterest(q); search.value = '' }
}
function addInterest () {
  const v = newInterest.value.trim()
  if (v) { feed.addInterest(v); newInterest.value = '' }
}

function onBIP (e) { e.preventDefault(); installEvt.value = e }
function onInstalled () { installEvt.value = null }
async function doInstall () {
  if (!installEvt.value) return
  installEvt.value.prompt()
  await installEvt.value.userChoice
  installEvt.value = null
}

onMounted(async () => {
  window.addEventListener('beforeinstallprompt', onBIP)
  window.addEventListener('appinstalled', onInstalled)
  await feed.init()
  tick = setInterval(() => { now.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => {
  clearInterval(tick); feed.dispose()
  window.removeEventListener('beforeinstallprompt', onBIP)
  window.removeEventListener('appinstalled', onInstalled)
})

const canPublish = computed(() => !feed.standalone && feed.pos && text.value.trim().length > 0 && !feed.busy)
const radiusLabel = (m) => m === 0 ? t.global : (m >= 1000 ? `${m / 1000}km` : `${m}m`)

async function doPublish () {
  if (!canPublish.value) return
  const eco = await feed.publish({ text: text.value })
  if (eco) { text.value = '' }
}
async function doReply (eco) {
  const r = window.prompt(t.value.replyPrompt)
  if (r && r.trim()) await feed.reply(eco, r.trim())
}

function doShare (eco) {
  const data = { title: 'Eco', text: eco.text, url: 'https://eco.closer.click/' }
  if (navigator.share) navigator.share(data).catch(() => {})
  else window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(eco.text), '_blank', 'noopener')
}
function isExpired (eco) { return (eco.expiresAt || (eco.createdAt + 86400000)) <= now.value }

const shortPk = (pk) => pk ? pk.replace(/[^a-zA-Z0-9]/g, '').slice(-6) : '??????'
function ttlText (eco) {
  const exp = eco.expiresAt || (eco.createdAt + 86400000)
  const ms = exp - now.value
  if (ms <= 0) return '·'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h >= 1 ? `${h}h` : `${m}m`
}
</script>

<template>
  <div class="topbar">
    <div class="brand">
      <img :src="iconUrl" alt="Eco" />
      <span>Eco <small>{{ t.tagline }}</small></span>
    </div>
    <div class="spacer"></div>
    <div class="topbar-controls">
    <button v-if="installEvt" class="install-btn" @click="doInstall">⤓ {{ t.install }}</button>
    <select class="top-select" :value="feed.radiusMeters"
            @change="feed.setRadius(Number($event.target.value))" :title="t.radius">
      <option v-for="r in feed.radii" :key="r" :value="r">◎ {{ radiusLabel(r) }}</option>
    </select>
    <select class="top-select" :value="feed.preset"
            @change="feed.setPreset($event.target.value)" :title="t.sort">
      <option v-for="(p, k) in feed.presets" :key="k" :value="k">↕ {{ p.label[lang] }}</option>
    </select>
    <button class="chip" @click="showThemes = true" :title="t.themes">🏷<span v-if="feed.myTags.length"> {{ feed.myTags.length }}</span></button>
    <button class="chip" @click="toggleLang" title="es / en">{{ lang === 'es' ? 'EN' : 'ES' }}</button>
    <closer-click-support
      class="topbar-coin"
      href="https://ko-fi.com/closerclick"
      repo="closerclick/eco"
      discord="https://discord.gg/D648uq7cth"></closer-click-support>
    </div>
  </div>

  <div class="wrap">
    <p v-if="feed.standalone" class="err">{{ t.standalone }}</p>
    <div v-else-if="feed.ready && !feed.hasNick" class="inbox-banner">
      <span>{{ t.nickIntro }}</span>
      <div class="spacer"></div>
      <button class="btn ghost" @click="nickPrompt = true">{{ t.setNick }}</button>
    </div>
    <p v-else-if="feed.locating && !feed.pos" class="muted">{{ t.locating }}</p>
    <p v-else-if="feed.geoError" class="err">{{ t.needLoc }} <small>({{ feed.geoError }})</small>
      <button class="chip" style="margin-left:8px" @click="feed.locate()">{{ t.retryLoc }}</button></p>

    <!-- Buscador (filtra ahora; Enter lo guarda como tema) -->
    <input class="search-box" v-model="search" :placeholder="t.searchPh" @keyup.enter="commitSearch" />

    <!-- Composer -->
    <div class="composer" v-if="!feed.standalone">
      <textarea v-model="text" :maxlength="280" :placeholder="t.placeholder"></textarea>
      <div class="composer-row">
        <span class="count">{{ text.length }}/280 · {{ t.composerHint }}</span>
        <div class="spacer"></div>
        <button class="btn" :disabled="!canPublish" @click="withNick(doPublish)">{{ t.publish }}</button>
      </div>
    </div>

    <!-- Bandeja efímera -->
    <div class="inbox-banner" v-if="feed.inbox.length">
      <span>{{ t.inbox(feed.inbox.length) }}</span>
      <div class="spacer"></div>
      <button class="btn ghost" @click="feed.acceptInbox()">{{ t.accept }}</button>
      <button class="btn ghost" @click="feed.dismissInbox()">{{ t.dismiss }}</button>
    </div>

    <!-- Feed -->
    <div v-if="!visibleFeed.length" class="empty">{{ t.empty }}</div>

    <article v-for="item in visibleFeed" :key="item.eco.id" class="eco" :class="{ mine: item.ctx.mine }">
      <div class="repost-of" v-if="item.eco.repostOf">↻ {{ t.repostOf }} <span class="pk">@{{ shortPk(item.eco.repostOf.author) }}</span></div>
      <div class="eco-head">
        <span class="pk">{{ item.ctx.name ? '@' + item.ctx.name : '@' + shortPk(item.eco.author) }}<small v-if="item.ctx.mine"> · {{ t.you }}</small></span>
        <span class="ttl">{{ t.expires }} {{ ttlText(item.eco) }}</span>
      </div>
      <div class="eco-body">{{ item.eco.text }}</div>
      <div class="eco-links" v-if="item.eco.links && item.eco.links.length">
        <a v-for="(l, i) in item.eco.links" :key="i" :href="l" target="_blank" rel="noopener nofollow">{{ l }}</a>
      </div>
      <div class="eco-tags" v-if="item.eco.tags && item.eco.tags.length">
        <span class="tag" v-for="tg in item.eco.tags" :key="tg">#{{ tg }}</span>
      </div>
      <div class="eco-foot" v-if="!item.ctx.mine">
        <button :title="t.reply" @click="withNick(() => doReply(item.eco))">💬</button>
        <button :title="t.repost" @click="withNick(() => feed.repost(item.eco))">🔁</button>
        <button :title="t.like" :class="{ liked: item.ctx.reaction === 'like' }" @click="withNick(() => feed.react(item.eco, 'like'))">👍</button>
        <button :title="t.dislike" :class="{ disliked: item.ctx.reaction === 'dislike' }" @click="withNick(() => feed.react(item.eco, 'dislike'))">👎</button>
        <button :title="t.share" @click="withNick(() => doShare(item.eco))">🔗</button>
        <button :title="t.mute" @click="withNick(() => feed.mute(item.eco.author))">🔕</button>
        <span v-if="item.ctx.keep && isExpired(item.eco)" class="kept-tag" :title="t.kept">📌</span>
      </div>
      <div class="eco-foot" v-else>
        <button :title="t.share" @click="withNick(() => doShare(item.eco))">🔗</button>
        <button :title="t.del" @click="withNick(() => feed.deleteMine(item.eco))">🗑</button>
      </div>
    </article>
  </div>

  <!-- Prompt de nick: ninguna acción sin nombre -->
  <div v-if="nickPrompt" class="modal-back" @click.self="nickPrompt = false">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ t.nickTitle }}</h3>
        <button class="btn ghost" @click="nickPrompt = false">{{ t.close }}</button>
      </div>
      <p class="muted">{{ t.nickIntro }}</p>
      <input class="search-box" v-model="nickDraft" :placeholder="t.nickPh" :maxlength="40" @keyup.enter="saveNick" />
      <div class="composer-row">
        <div class="spacer"></div>
        <button class="btn" :disabled="!nickDraft.trim()" @click="saveNick">{{ t.nickSave }}</button>
      </div>
    </div>
  </div>

  <!-- Panel de temas (fuera del home) -->
  <div v-if="showThemes" class="modal-back" @click.self="showThemes = false">
    <div class="modal">
      <div class="modal-head">
        <h3>{{ t.themesTitle }}</h3>
        <button class="btn ghost" @click="showThemes = false">{{ t.close }}</button>
      </div>
      <p class="muted">{{ t.themesIntro }}</p>
      <div class="bar">
        <input class="chip" style="flex:1;min-width:160px" v-model="newInterest" :placeholder="t.addPh" @keyup.enter="addInterest" />
        <button class="chip" @click="addInterest">＋</button>
      </div>
      <p v-if="!feed.myTags.length" class="muted">{{ t.noThemes }}</p>
      <div class="theme-list">
        <span v-for="tg in feed.myTags" :key="tg" class="theme-pill">
          #{{ tg }}<button @click="feed.removeInterest(tg)">×</button>
        </span>
      </div>
    </div>
  </div>
</template>
