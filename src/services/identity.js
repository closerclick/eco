// Integración con el vault id.closer.click (única fuente de identidad).
// Expone adaptadores para el cliente geo (espera signData(data)->string y
// getPublicKeyJwk()->string) y el grafo de afinidad/ratings para el ranking.
// Patrón tomado de trueque/ y gridgame/: no reimplementa nada del vault.

import { Identity } from '@closerclick/closer-click-identity'

let identity = null
let myPubkey = null

export async function initIdentity () {
  if (identity) return identity
  try {
    identity = await Identity.connect()
    myPubkey = identity.me?.publickey || null
  } catch (e) {
    console.warn('[identity] vault inalcanzable, modo standalone:', e.message)
    identity = null
  }
  return identity
}

export async function getIdentity () {
  if (!identity) await initIdentity()
  return identity
}

export function getMyPubkey () { return myPubkey }
export function isReady () { return identity !== null && !!myPubkey }

// --- adaptadores para createGeoClient ---
// El geo-client arma `data` y la firma entera; el vault devuelve
// { signature, publickey } — tomamos sólo la firma.
export async function signData (data) {
  const id = await getIdentity()
  if (!id) return null
  const res = await id.signData(data)
  return res.signature
}

export async function getPublicKeyJwk () {
  if (!myPubkey) await initIdentity()
  return myPubkey
}

// --- afinidad (señal de ranking, capa 2) ---
// afinidad(pk) ∈ [0,1]: cuánto interactuaste con el autor. Se calcula SÓLO en el
// cliente (el server nunca ve tu grafo). Combina: es contacto, rating que vos le
// diste, y un contador de interacciones que lleva el feedStore (reps/replies).
const contactsCache = { v: null, exp: 0 }
const CONTACTS_MS = 60_000

async function getContactPubkeys () {
  const now = Date.now()
  if (contactsCache.v && contactsCache.exp > now) return contactsCache.v
  const id = await getIdentity()
  let set = new Set()
  try {
    const list = (await id?.listContacts?.()) || []
    set = new Set(list.map((c) => c.publickey || c.pubkey || c).filter(Boolean))
  } catch (_) { /* sin contactos accesibles */ }
  contactsCache.v = set
  contactsCache.exp = now + CONTACTS_MS
  return set
}

export async function isContact (pk) {
  if (!pk) return false
  return (await getContactPubkeys()).has(pk)
}

/**
 * Afinidad subjetiva con un autor.
 * @param {string} pk pubkey
 * @param {number} interactions nº de interacciones locales (reps/replies dados)
 */
export async function affinityOf (pk, interactions = 0) {
  if (!pk) return 0
  if (pk === myPubkey) return 1
  let a = 0
  if (await isContact(pk)) a += 0.5
  try {
    const id = await getIdentity()
    const r = await id?.getRatingsForSubject?.(pk)
    if (r?.mine && typeof r.mine.rating === 'number') a += (r.mine.rating / 5) * 0.3
  } catch (_) { /* best-effort */ }
  // saturación suave por interacciones: 0..0.2
  a += 0.2 * (1 - Math.exp(-interactions / 3))
  return Math.max(0, Math.min(1, a))
}
