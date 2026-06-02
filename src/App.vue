<script setup>
import { ref, computed, onMounted, onBeforeUnmount, reactive } from 'vue'
import { useFeed } from './feed/feedStore'
import iconUrl from '/icon.svg'

const feed = useFeed()
const lang = (navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es'

const T = {
  es: {
    tagline: 'tu voz · tu radio · 24 h',
    placeholder: '¿Qué resuena cerca tuyo? (texto + enlaces)',
    composerHint: 'Los enlaces y #hashtags se detectan solos.',
    publish: 'Publicar eco', radius: 'Radio', global: 'Global',
    sort: 'Orden', interests: 'Tus intereses', save: 'Guardar',
    inbox: (n) => `${n} en tu bandeja (avalados por tu red)`, accept: 'Ver', dismiss: 'Descartar',
    reply: 'Responder', repost: 'Eco', mute: 'Silenciar', you: 'vos',
    repostOf: 'eco de', expires: 'expira en', empty: 'Todavía no hay ecos en tu radio. Publicá el primero o ampliá el radio.',
    standalone: 'Vault no disponible: modo archivo local (solo lectura).',
    needLoc: 'Activá la ubicación para publicar y descubrir ecos.',
    replyPrompt: 'Tu respuesta:'
  },
  en: {
    tagline: 'your voice · your radius · 24 h',
    placeholder: "What's echoing near you? (text + links)",
    composerHint: 'Links and #hashtags are detected automatically.',
    publish: 'Post eco', radius: 'Radius', global: 'Global',
    sort: 'Sort', interests: 'Your interests', save: 'Save',
    inbox: (n) => `${n} in your inbox (endorsed by your network)`, accept: 'View', dismiss: 'Dismiss',
    reply: 'Reply', repost: 'Echo', mute: 'Mute', you: 'you',
    repostOf: 'eco by', expires: 'expires in', empty: 'No ecos in your radius yet. Post the first or widen the radius.',
    standalone: 'Vault unavailable: local-archive mode (read only).',
    needLoc: 'Enable location to post and discover ecos.',
    replyPrompt: 'Your reply:'
  }
}
const t = T[lang]

const text = ref('')
const interests = ref('')
const now = ref(Date.now())
let tick

onMounted(async () => {
  await feed.init()
  interests.value = feed.myTags.join(', ')
  tick = setInterval(() => { now.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => { clearInterval(tick); feed.dispose() })

const canPublish = computed(() => !feed.standalone && feed.pos && text.value.trim().length > 0 && !feed.busy)
const radiusLabel = (m) => m === 0 ? t.global : (m >= 1000 ? `${m / 1000}km` : `${m}m`)

async function doPublish () {
  if (!canPublish.value) return
  const eco = await feed.publish({ text: text.value })
  if (eco) { text.value = '' }
}
function saveInterests () { feed.setTags(interests.value.split(',').map((s) => s.trim()).filter(Boolean)) }

async function doReply (eco) {
  const r = window.prompt(t.replyPrompt)
  if (r && r.trim()) await feed.reply(eco, r.trim())
}

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
    <select class="top-select" :value="feed.radiusMeters"
            @change="feed.setRadius(Number($event.target.value))" :title="t.radius">
      <option v-for="r in feed.radii" :key="r" :value="r">◎ {{ radiusLabel(r) }}</option>
    </select>
    <select class="top-select" :value="feed.preset"
            @change="feed.setPreset($event.target.value)" :title="t.sort">
      <option v-for="(p, k) in feed.presets" :key="k" :value="k">↕ {{ p.label[lang] }}</option>
    </select>
    <closer-click-support
      class="topbar-coin"
      href="https://ko-fi.com/closerclick"
      repo="closerclick/eco"
      discord="https://discord.gg/D648uq7cth"></closer-click-support>
  </div>

  <div class="wrap">
    <p v-if="feed.standalone" class="err">{{ t.standalone }}</p>
    <p v-else-if="feed.geoError" class="err">{{ t.needLoc }} <small>({{ feed.geoError }})</small></p>

    <!-- Composer -->
    <div class="composer" v-if="!feed.standalone">
      <textarea v-model="text" :maxlength="280" :placeholder="t.placeholder"></textarea>
      <div class="composer-row">
        <span class="count">{{ text.length }}/280 · {{ t.composerHint }}</span>
        <div class="spacer"></div>
        <button class="btn" :disabled="!canPublish" @click="doPublish">{{ t.publish }}</button>
      </div>
    </div>

    <!-- Intereses -->
    <div class="bar">
      <input class="chip" style="flex:1;min-width:160px" v-model="interests" :placeholder="t.interests" @keyup.enter="saveInterests" />
      <button class="chip" @click="saveInterests">{{ t.save }}</button>
    </div>

    <!-- Bandeja efímera -->
    <div class="inbox-banner" v-if="feed.inbox.length">
      <span>{{ t.inbox(feed.inbox.length) }}</span>
      <div class="spacer"></div>
      <button class="btn ghost" @click="feed.acceptInbox()">{{ t.accept }}</button>
      <button class="btn ghost" @click="feed.dismissInbox()">{{ t.dismiss }}</button>
    </div>

    <!-- Feed -->
    <div v-if="!feed.feed.length" class="empty">{{ t.empty }}</div>

    <article v-for="item in feed.feed" :key="item.eco.id" class="eco" :class="{ mine: item.ctx.mine }">
      <div class="repost-of" v-if="item.eco.repostOf">↻ {{ t.repostOf }} <span class="pk">@{{ shortPk(item.eco.repostOf.author) }}</span></div>
      <div class="eco-head">
        <span class="pk">@{{ item.ctx.mine ? t.you : shortPk(item.eco.author) }}</span>
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
        <button @click="doReply(item.eco)">↳ {{ t.reply }}</button>
        <button @click="feed.repost(item.eco)">↻ {{ t.repost }}</button>
        <button @click="feed.mute(item.eco.author)">⊘ {{ t.mute }}</button>
      </div>
    </article>
  </div>
</template>
