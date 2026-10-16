/**
 * El enlace de modificación debe abrir el MISMO formulario (ES/EN) en que el
 * cliente llenó el original. El prellenado guarda nombres `q_...` y texto de
 * opciones en el idioma de ese formulario; si el enlace abre el otro, casi nada
 * carga y un desplegable vacío puede cambiar el diseño de toda la página.
 * Visto en producción el 2026-10-16: compra en USD (correo en inglés), formulario
 * llenado en español, enlace de modificación al formulario en inglés.
 *
 *   node worker/test/modification-form-language.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { bestModificationUrl } from '../worker.js'

class MemoryKV {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)) }
  async get(key, options = {}) {
    const v = this.values.get(key)
    if (v === undefined) return null
    return options?.type === 'json' ? JSON.parse(v) : v
  }
}

const prefill = {
  business_name: 'Mi Negocio',
  business_type: 'Profesional independiente (mi perfil personal)',
  q_tu_nombre: 'Ana',
  q_telefono_o_whatsapp_por_si_tenemos_preguntas_sobre_tu_hmu: '+523221234567',
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
    'hmu_submission:s1': JSON.stringify({ submission_id: 's1', prefill, ...submission }),
  }),
})

const pedir = (env, lang) => bestModificationUrl(env, { token: 'tok123', slug: 'mi-negocio-x1', lang, orderId: 'ord1' })

test('compra en inglés pero formulario llenado en español: el enlace abre el formulario en español', async () => {
  const url = await pedir(entorno({ form_id: 'MeyDpk' }), 'en')
  assert.match(url, /^https:\/\/tally\.so\/r\/MeyDpk\?order_id=ord1/)
  assert.match(url, /business_type=Profesional%20independiente/)
  assert.match(url, /client_slug=mi-negocio-x1/)
})

test('compra en español pero formulario llenado en inglés: el enlace abre el formulario en inglés', async () => {
  const url = await pedir(entorno({ form_id: 'yPkN5X' }), 'es')
  assert.match(url, /^https:\/\/tally\.so\/r\/yPkN5X\?order_id=ord1/)
})

test('envío viejo sin form_id: conserva el idioma que ya traía el correo', async () => {
  assert.match(await pedir(entorno({}), 'en'), /^https:\/\/tally\.so\/r\/yPkN5X\?/)
  assert.match(await pedir(entorno({}), 'es'), /^https:\/\/tally\.so\/r\/MeyDpk\?/)
})

test('form_id desconocido: no rompe, cae al idioma del correo', async () => {
  assert.match(await pedir(entorno({ form_id: 'otroForm' }), 'es'), /^https:\/\/tally\.so\/r\/MeyDpk\?/)
})
