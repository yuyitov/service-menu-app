/**
 * La modificación funciona en cualquier idioma, sin importar la moneda de la
 * compra ni el idioma en que se llenó el original: el formulario se abre con las
 * respuestas YA CARGADAS, traducidas (nombres de pregunta y opciones) al idioma
 * del formulario que se abre.
 *
 * Visto en producción el 2026-10-16: compra en USD (correo en inglés), formulario
 * llenado en español, enlace al formulario en inglés → tipo de negocio, ubicaciones,
 * correo, nombre y teléfono llegaron vacíos, y re-elegir mal el tipo rediseñó la página.
 *
 *   node worker/test/modification-form-language.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bestModificationUrl, modificationLinks, handleModifyRedirect, buildDeliveryEmail, buildDeliveryText,
} from '../worker.js'

class MemoryKV {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)) }
  async get(key, options = {}) {
    const v = this.values.get(key)
    if (v === undefined) return null
    return options?.type === 'json' ? JSON.parse(v) : v
  }
}

// Lo que guarda el worker al recibir el formulario EN ESPAÑOL (nombres y opciones en español).
const prefillEs = {
  business_name: 'Mi Negocio',
  business_type: 'Profesional independiente (mi perfil personal)',
  short_description: 'Una descripción en español',
  q_tu_nombre: 'Ana',
  q_correo_de_contacto_para_la_vista_previa_de_tu_hmu_link: 'ana@example.com',
  q_telefono_o_whatsapp_por_si_tenemos_preguntas_sobre_tu_hmu: '+523221234567',
  q_cuantas_ubicaciones_publicas_deben_aparecer_en_tu_hmu_link: 'Sin ubicación física (en línea o a domicilio)',
  default_language: 'Español primero',
}

const entorno = (submission) => ({
  PRODUCT_ID: 'hmu',
  BRAND_NAME: 'HMU Link',
  MODIFICATION_FORM_PREFILL: '1',
  TALLY_FORM_URL_EN: 'https://tally.so/r/yPkN5X?order_id=',
  TALLY_FORM_URL_ES: 'https://tally.so/r/MeyDpk?order_id=',
  WORKER_PUBLIC_URL: 'https://worker.example',
  SERVICE_MENU_KV: new MemoryKV({
    'hmu_order:ord1': JSON.stringify({ order_id: 'ord1', submission_id: 's1', customer_email: 'a@example.com' }),
    'hmu_submission:s1': JSON.stringify({ submission_id: 's1', prefill: prefillEs, ...submission }),
    'hmu_correction:tok123': JSON.stringify({ slug: 'mi-negocio-x1', order_id: 'ord1', used_at: null }),
    'hmu_correction:usado': JSON.stringify({ slug: 'mi-negocio-x1', order_id: 'ord1', used_at: '2026-10-16' }),
  }),
})

const pedir = (env, lang, extra = {}) =>
  modificationLinks(env, { token: 'tok123', slug: 'mi-negocio-x1', lang, orderId: 'ord1', ...extra })
const consulta = (url) => Object.fromEntries(new URL(url).searchParams)

test('compra en inglés, formulario llenado en español: abre el de español y ofrece el de inglés', async () => {
  const l = await pedir(entorno({ form_id: 'MeyDpk' }), 'en')
  assert.equal(l.lang, 'es')
  assert.match(l.url, /^https:\/\/tally\.so\/r\/MeyDpk\?order_id=ord1/)
  assert.equal(consulta(l.url).business_type, 'Profesional independiente (mi perfil personal)')
  assert.equal(consulta(l.url).q_tu_nombre, 'Ana')
  assert.equal(l.alt.lang, 'en')
  assert.match(l.alt.url, /^https:\/\/tally\.so\/r\/yPkN5X\?order_id=ord1/)
})

test('el otro idioma lleva las MISMAS respuestas traducidas, no vacías', async () => {
  const l = await pedir(entorno({ form_id: 'MeyDpk' }), 'en')
  const q = consulta(l.alt.url)
  assert.equal(q.business_type, 'Independent professional (my own profile)')
  assert.equal(q.q_your_name, 'Ana')
  assert.equal(q.q_contact_email_for_your_hmu_link_preview, 'ana@example.com')
  assert.equal(q.q_phone_or_whatsapp_if_we_have_questions_about_your_hmu_link, '+523221234567')
  assert.equal(q.default_language, 'Spanish first')
  assert.match(q.q_how_many_public_locations_should_appear_on_your_hmu_link, /^No physical location/)
  assert.equal(q.short_description, 'Una descripción en español')
  assert.equal(q.client_slug, 'mi-negocio-x1')
  assert.equal(q.correction_token, 'tok123')
})

test('forceLang pide un idioma concreto', async () => {
  const l = await pedir(entorno({ form_id: 'MeyDpk' }), 'en', { forceLang: 'en' })
  assert.equal(l.lang, 'en')
  assert.equal(consulta(l.url).business_type, 'Independent professional (my own profile)')
})

test('envío viejo sin form_id: el idioma se deduce de los nombres del prellenado', async () => {
  const l = await pedir(entorno({}), 'en')
  assert.equal(l.lang, 'es')
  assert.equal(l.alt.lang, 'en')
  assert.equal(consulta(l.alt.url).business_type, 'Independent professional (my own profile)')
})

test('sin pistas del idioma de origen: no se traduce, un solo enlace y en el idioma del correo', async () => {
  const l = await pedir(entorno({ prefill: { business_name: 'X', phone: '+1', address: 'Y' } }), 'en')
  assert.equal(l.lang, 'en')
  assert.equal(l.alt, null)
  assert.match(l.url, /^https:\/\/tally\.so\/r\/yPkN5X\?/)
})

test('un tipo de negocio que no es opción de ningún formulario no se prellena', async () => {
  const sub = { prefill: { ...prefillEs, business_type: 'Tarjetas de presentación digitales' } }
  const l = await pedir(entorno(sub), 'en')
  assert.equal('business_type' in consulta(l.url), false)
  assert.equal('business_type' in consulta(l.alt.url), false)
})

test('bestModificationUrl sigue devolviendo el enlace principal', async () => {
  const url = await bestModificationUrl(entorno({ form_id: 'MeyDpk' }), { token: 'tok123', slug: 'mi-negocio-x1', lang: 'en', orderId: 'ord1' })
  assert.match(url, /^https:\/\/tally\.so\/r\/MeyDpk\?/)
})

test('/modify lleva al formulario en el idioma pedido, con las respuestas traducidas', async () => {
  const env = entorno({ form_id: 'MeyDpk' })
  const r = await handleModifyRedirect(new URL('https://worker.example/modify?t=tok123&lang=en'), env)
  assert.equal(r.status, 302)
  const destino = r.headers.get('Location')
  assert.match(destino, /^https:\/\/tally\.so\/r\/yPkN5X\?/)
  assert.equal(consulta(destino).business_type, 'Independent professional (my own profile)')
  assert.equal(r.headers.get('Cache-Control'), 'no-store')
  const es = await handleModifyRedirect(new URL('https://worker.example/modify?t=tok123&lang=es'), env)
  assert.match(es.headers.get('Location'), /^https:\/\/tally\.so\/r\/MeyDpk\?/)
})

test('/modify rechaza lo que no es un enlace válido', async () => {
  const env = entorno({ form_id: 'MeyDpk' })
  const go = (q) => handleModifyRedirect(new URL(`https://worker.example/modify?${q}`), env)
  assert.equal((await go('t=tok123&lang=fr')).status, 400)
  assert.equal((await go('lang=en')).status, 400)
  assert.equal((await go('t=nope&lang=en')).status, 404)
  assert.equal((await go('t=usado&lang=en')).status, 410)
})

test('los correos ofrecen el otro idioma (y solo cuando se puede)', async () => {
  const env = entorno({ form_id: 'MeyDpk' })
  const l = await pedir(env, 'en')
  const alt = { url: 'https://worker.example/modify?t=tok123&lang=en', lang: 'en' }
  assert.equal(l.alt.lang, 'en')
  const base = { pageUrl: 'https://www.hmulink.com/links/x/', slug: 'x', correctionUrl: l.url, hasQr: false, env }
  const html = buildDeliveryEmail({ ...base, lang: 'en', alt })
  assert.match(html, /Prefer English\?/)
  assert.ok(html.includes('https://worker.example/modify?t=tok123&amp;lang=en') || html.includes(alt.url))
  assert.doesNotMatch(buildDeliveryEmail({ ...base, lang: 'en', alt: null }), /Prefer English\?/)
  assert.match(buildDeliveryText({ ...base, lang: 'en', alt }), /Open the English form: https:\/\/worker\.example\/modify\?t=tok123&lang=en/)
  const altEs = { url: 'https://worker.example/modify?t=tok123&lang=es', lang: 'es' }
  assert.match(buildDeliveryEmail({ ...base, lang: 'es', alt: altEs }), /¿Prefieres español\?/)
  assert.match(buildDeliveryText({ ...base, lang: 'es', alt: altEs }), /Abre el formulario en español: /)
})
