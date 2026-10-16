/**
 * La corrección PAGADA manda al cuestionario prellenado, igual que las incluidas.
 *
 * Visto el 2026-10-16 en la primera compra real de una corrección ($6 USD): el correo
 * llevaba la página de TEXTO LIBRE (/correct/) en vez del cuestionario con las
 * respuestas del cliente ya cargadas. Un token de pago se acuña distinto al de una
 * incluida, y esa ruta se había quedado con el enlace viejo.
 *
 *   node worker/test/paid-correction-link.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleCorrectionPurchase, handleModifyRedirect } from '../worker.js'

class MemoryKV {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)) }
  async get(key, options = {}) {
    const v = this.values.get(key)
    if (v === undefined) return null
    return options?.type === 'json' ? JSON.parse(v) : v
  }
  async put(key, value) { this.values.set(key, String(value)) }
  async delete(key) { this.values.delete(key) }
}

const prefill = {
  business_name: 'Mi Negocio', business_type: 'Independent professional (my own profile)',
  q_your_name: 'Ana', q_contact_email_for_your_hmu_link_preview: 'ana@example.com',
}

const entorno = ({ prefillOn = true, formId = 'yPkN5X' } = {}) => ({
  PRODUCT_ID: 'hmu', BRAND_NAME: 'HMU Link', WORKER_PUBLIC_URL: 'https://worker.example',
  MODIFICATION_FORM_PREFILL: prefillOn ? '1' : '0',
  TALLY_FORM_URL_EN: 'https://tally.so/r/yPkN5X?order_id=', TALLY_FORM_URL_ES: 'https://tally.so/r/MeyDpk?order_id=',
  PUBLIC_BOOK_BASE_URL: 'https://www.hmulink.com', SENDGRID_API_KEY: 'sg-test', FROM_EMAIL: 'HMU Link <hello@hmulink.com>',
  SERVICE_MENU_KV: new MemoryKV({
    'hmu_delivery:mi-negocio-x1': JSON.stringify({ order_id: 'o1', slug: 'mi-negocio-x1', customer_email: 'ana@example.com' }),
    'hmu_order:o1': JSON.stringify({ order_id: 'o1', submission_id: 's1', customer_email: 'ana@example.com', currency: 'usd' }),
    'hmu_submission:s1': JSON.stringify({ submission_id: 's1', form_id: formId, prefill }),
  }),
})

const pagar = (env, currency = 'usd') => handleCorrectionPurchase(
  { payment_intent: 'pi_test', currency, customer_email: 'ana@example.com', metadata: { slug: 'mi-negocio-x1' } }, env)

async function correoDe(t, env, currency) {
  const enviados = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { enviados.push(JSON.parse(init.body)); return new Response(null, { status: 202 }) })
  const r = await pagar(env, currency)
  assert.equal(r.status, 200)
  assert.equal(enviados.length, 1, 'debe salir UN correo')
  const cuerpo = enviados[0]
  return { texto: cuerpo.content.find((c) => c.type === 'text/plain').value, html: cuerpo.content.find((c) => c.type === 'text/html').value, a: cuerpo.personalizations[0].to[0].email }
}

test('el correo de la compra lleva el enlace CORTO al cuestionario prellenado, no /correct/', async (t) => {
  const { texto, html, a } = await correoDe(t, entorno(), 'usd')
  assert.equal(a, 'ana@example.com')
  assert.match(texto, /https:\/\/worker\.example\/modify\?t=[A-Za-z0-9_-]+&lang=en/)
  assert.doesNotMatch(texto, /\/correct\//)
  assert.doesNotMatch(html, /\/correct\//)
  assert.match(texto, /you will see your current information/)
})

test('ofrece también el formulario en el otro idioma', async (t) => {
  const { texto } = await correoDe(t, entorno(), 'usd')
  assert.match(texto, /Prefer English\?|¿Prefieres español\?/)
  assert.match(texto, /modify\?t=[A-Za-z0-9_-]+&lang=es/)
})

test('compra en pesos: el correo va en español y también con el cuestionario', async (t) => {
  const { texto } = await correoDe(t, entorno({ formId: 'MeyDpk' }), 'mxn')
  assert.match(texto, /verás tu información actual/)
  assert.match(texto, /modify\?t=[A-Za-z0-9_-]+&lang=es/)
  assert.doesNotMatch(texto, /\/correct\//)
})

test('el token de pago queda marcado como pagado (no gasta una incluida)', async (t) => {
  const env = entorno()
  await correoDe(t, env, 'usd')
  const claves = [...env.SERVICE_MENU_KV.values.keys()].filter((k) => k.startsWith('hmu_correction:'))
  assert.equal(claves.length, 1)
  const rec = JSON.parse(env.SERVICE_MENU_KV.values.get(claves[0]))
  assert.equal(rec.paid, true)
  assert.equal(rec.used_at, null)
})

test('sin prellenado en la vertical, el enlace corto redirige a la página de texto libre como antes', async (t) => {
  const env = entorno({ prefillOn: false })
  const { texto } = await correoDe(t, env, 'usd')
  assert.match(texto, /describe the changes you want/)
  const token = (texto.match(/modify\?t=([A-Za-z0-9_-]+)&lang=en/) || [])[1]
  assert.ok(token, 'el correo debe traer el enlace corto')
  const r = await handleModifyRedirect(new URL(`https://worker.example/modify?t=${token}&lang=en`), env)
  assert.equal(r.status, 302)
  assert.match(r.headers.get('Location'), /\/correct\/\?t=/)
})
