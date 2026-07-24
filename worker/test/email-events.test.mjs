// Arnés: prueba el worker REAL por su entrada `fetch`, con firmas ECDSA de
// verdad y KV/correo simulados. Nada sale a la red ni se manda un correo.
// Se importa el worker REAL por ruta relativa: la prueba vale solo si corre
// contra el codigo que se despliega, no contra una copia.
import worker from '../worker.js'

const enc = new TextEncoder()
const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString('base64')

// --- Par de llaves ECDSA P-256, como el que usa SendGrid ---
const par = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
)
const pubB64 = b64(await crypto.subtle.exportKey('spki', par.publicKey))

async function firmar(ts, body) {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, par.privateKey, enc.encode(ts + body),
  )
  return b64(sig)
}

// --- env simulado: KV en memoria, correo interceptado ---
function hacerEnv({ conLlave = true } = {}) {
  const kv = new Map()
  const correos = []
  return {
    correos,
    env: {
      SENDGRID_WEBHOOK_PUBLIC_KEY: conLlave ? pubB64 : undefined,
      ALERT_EMAIL: 'vero@example.com',
      REPLY_TO_EMAIL: 'vero@example.com',
      SENDGRID_API_KEY: 'SG.fake-para-pruebas',
      SERVICE_MENU_KV: {
        get: async (k) => kv.get(k) ?? null,
        put: async (k, v) => void kv.set(k, v),
        delete: async (k) => void kv.delete(k),
        list: async () => ({ keys: [] }),
      },
    },
    // intercepta el envío real de correo
    instalarFetch() {
      globalThis.fetch = async (url, init) => {
        correos.push({ url: String(url), body: init?.body })
        return new Response('{}', { status: 202 })
      }
    },
  }
}

async function pedir(env, { body, ts, sig }) {
  const h = new Headers({ 'Content-Type': 'application/json' })
  if (sig) h.set('X-Twilio-Email-Event-Webhook-Signature', sig)
  if (ts) h.set('X-Twilio-Email-Event-Webhook-Timestamp', ts)
  return worker.fetch(new Request('https://w.dev/email-events', { method: 'POST', body, headers: h }), env)
}

const ahora = String(Math.floor(Date.now() / 1000))
const rebote = JSON.stringify([
  { event: 'bounce', email: 'cliente@ejemplo.com', reason: '550 mailbox full' },
])
let fallos = 0
const check = (nombre, ok, extra = '') => {
  if (!ok) fallos++
  console.log(`  ${ok ? 'OK  ' : 'FALLA'} ${nombre}${extra ? ' — ' + extra : ''}`)
}

// 1) sin llave configurada -> 503 (fail-closed, no acepta sin verificar)
{
  const { env, instalarFetch } = hacerEnv({ conLlave: false }); instalarFetch()
  const r = await pedir(env, { body: rebote, ts: ahora, sig: await firmar(ahora, rebote) })
  check('sin llave configurada -> 503', r.status === 503, `dio ${r.status}`)
}

// 2) firma inválida -> 401
{
  const { env, instalarFetch } = hacerEnv(); instalarFetch()
  const r = await pedir(env, { body: rebote, ts: ahora, sig: b64(new Uint8Array(64)) })
  check('firma invalida -> 401', r.status === 401, `dio ${r.status}`)
}

// 3) cuerpo alterado tras firmar -> 401
{
  const { env, instalarFetch } = hacerEnv(); instalarFetch()
  const sig = await firmar(ahora, rebote)
  const alterado = JSON.stringify([{ event: 'bounce', email: 'otro@malo.com' }])
  const r = await pedir(env, { body: alterado, ts: ahora, sig })
  check('cuerpo alterado -> 401', r.status === 401, `dio ${r.status}`)
}

// 4) timestamp viejo (replay) -> 401
{
  const { env, instalarFetch } = hacerEnv(); instalarFetch()
  const viejo = String(Math.floor(Date.now() / 1000) - 4000)
  const r = await pedir(env, { body: rebote, ts: viejo, sig: await firmar(viejo, rebote) })
  check('replay (ts viejo) -> 401', r.status === 401, `dio ${r.status}`)
}

// 5) firma válida -> 200 y ALERTA enviada
{
  const { env, correos, instalarFetch } = hacerEnv(); instalarFetch()
  const r = await pedir(env, { body: rebote, ts: ahora, sig: await firmar(ahora, rebote) })
  const j = await r.json()
  check('firma valida -> 200', r.status === 200, `dio ${r.status}`)
  check('detecta 1 rebote', j.alerted === 1, JSON.stringify(j))
  check('manda la alerta por correo', correos.length === 1, `${correos.length} correos`)
  const cuerpo = correos[0]?.body ?? ''
  check('la alerta nombra al cliente', String(cuerpo).includes('cliente@ejemplo.com'))
  check('la alerta trae el motivo', String(cuerpo).includes('mailbox full'))
}

// 6) evento que NO es fallo (delivered) -> no alerta
{
  const { env, correos, instalarFetch } = hacerEnv(); instalarFetch()
  const ok = JSON.stringify([{ event: 'delivered', email: 'cliente@ejemplo.com' }])
  const r = await pedir(env, { body: ok, ts: ahora, sig: await firmar(ahora, ok) })
  const j = await r.json()
  check('un "delivered" no alerta', j.alerted === 0 && correos.length === 0)
}

// 7) el mismo rebote dos veces -> una sola alerta (dedup)
{
  const { env, correos, instalarFetch } = hacerEnv(); instalarFetch()
  const sig = await firmar(ahora, rebote)
  await pedir(env, { body: rebote, ts: ahora, sig })
  await pedir(env, { body: rebote, ts: ahora, sig })
  check('rebote repetido -> 1 sola alerta', correos.length === 1, `${correos.length} correos`)
}

console.log(fallos === 0 ? '\n  TODO VERDE' : `\n  ${fallos} FALLAS`)
process.exit(fallos === 0 ? 0 : 1)
