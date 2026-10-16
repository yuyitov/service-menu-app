/**
 * El enlace de modificación y el tope de largo (B2, 2026-10-16).
 *
 *  - Tally acepta ~15000 caracteres de URL (medido); el tope del worker era 6000 y
 *    lo que no cabía se descartaba EN SILENCIO (campo vacío en el formulario).
 *  - Ahora el tope es 9000, el correo lleva un enlace CORTO (/modify) y, si algo
 *    aun así no cupiera, Vero recibe una alerta con los nombres de los campos.
 *
 *   node worker/test/prefill-length.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrefillQuery } from '../product-config.mjs'
import { modificationLinks, modificationEmailLinks } from '../worker.js'

class MemoryKV {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)) }
  async get(key, options = {}) {
    const v = this.values.get(key)
    if (v === undefined) return null
    return options?.type === 'json' ? JSON.parse(v) : v
  }
  async put(key, value) { this.values.set(key, String(value)) }
}

const entorno = (prefill) => ({
  PRODUCT_ID: 'hmu', BRAND_NAME: 'HMU Link', MODIFICATION_FORM_PREFILL: '1',
  TALLY_FORM_URL_EN: 'https://tally.so/r/yPkN5X?order_id=', TALLY_FORM_URL_ES: 'https://tally.so/r/MeyDpk?order_id=',
  WORKER_PUBLIC_URL: 'https://worker.example', ALERT_EMAIL: 'alertas@example.com', SENDGRID_API_KEY: 'sg-test',
  FROM_EMAIL: 'HMU Link <hello@hmulink.com>',
  SERVICE_MENU_KV: new MemoryKV({
    'hmu_order:o1': JSON.stringify({ order_id: 'o1', submission_id: 's1', customer_email: 'a@example.com' }),
    'hmu_submission:s1': JSON.stringify({ form_id: 'MeyDpk', prefill }),
  }),
})

const largo = (n, c = 'a') => c.repeat(n)
const pedir = (env) => modificationLinks(env, { token: 'tok123', slug: 'mi-negocio-x1', lang: 'es', orderId: 'o1' })

test('buildPrefillQuery anota los campos que no cupieron', () => {
  const dropped = []
  const q = buildPrefillQuery({ corto: 'x', enorme: largo(500), otro: 'y' }, 100, dropped)
  assert.deepEqual(dropped, ['enorme'])
  assert.match(q, /corto=x/)
  assert.match(q, /otro=y/)
  assert.equal(buildPrefillQuery({ a: 'b' }, 100), '&a=b') // sin el 3er parámetro sigue igual
})

test('un intake largo (8000 caracteres) cabe entero y la URL queda dentro de lo que Tally acepta', async () => {
  const prefill = { business_name: 'N', services_text: largo(3500), faq_text: largo(2500), policies_text: largo(2000) }
  const l = await pedir(entorno(prefill))
  assert.ok(l.url.length < 9600, `URL de ${l.url.length} caracteres`)
  for (const campo of Object.keys(prefill)) assert.ok(new URL(l.url).searchParams.has(campo), `falta ${campo}`)
})

test('un intake gigante NO deja campos vacíos en silencio: avisa a Vero con los nombres', async (t) => {
  const correos = []
  t.mock.method(globalThis, 'fetch', async (url, init) => { correos.push(JSON.parse(init.body)); return new Response(null, { status: 202 }) })
  const env = entorno({ business_name: 'N', services_text: largo(5000), faq_text: largo(4500), policies_text: largo(3000), instagram: '@x' })
  const l = await pedir(env)
  assert.ok(l.url.length < 9600)
  assert.equal(correos.length, 1, 'debe salir UNA alerta')
  const texto = correos[0].content.map((c) => c.value).join('\n')
  assert.match(texto, /mi-negocio-x1/)
  assert.match(texto, /faq_text/)
  assert.equal(correos[0].personalizations[0].to[0].email, 'alertas@example.com')
  // la misma alerta no se repite en el día
  await pedir(env)
  assert.equal(correos.length, 1, 'no debe repetirse')
})

test('el enlace del correo es CORTO y no lleva el prellenado', async () => {
  const env = entorno({ business_name: 'N', services_text: largo(4000), phone: '+5255' })
  const e = await modificationEmailLinks(env, { token: 'tok123', slug: 'mi-negocio-x1', lang: 'en', orderId: 'o1' })
  assert.equal(e.url, 'https://worker.example/modify?t=tok123&lang=es') // idioma en que se llenó
  assert.ok(e.url.length < 120)
  assert.equal(e.alt.url, 'https://worker.example/modify?t=tok123&lang=en')
  assert.doesNotMatch(e.url, /services_text/)
})
