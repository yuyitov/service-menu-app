/**
 * Los correos de HMU caen en la pestaña "Promociones" de Gmail (visto el
 * 2026-10-16): en la bandeja, pero fuera de "Principal". Los dos que el cliente
 * necesita encontrar —el post-pago (su formulario) y la entrega (su página y su
 * enlace de cambios)— le dicen dónde buscar, en su idioma y en HTML y texto plano.
 *
 *   node worker/test/inbox-tip.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPostPaymentEmail, buildPostPaymentText, buildDeliveryEmail, buildDeliveryText } from '../worker.js'

const env = { PRODUCT_ID: 'hmu', BRAND_NAME: 'HMU Link', BRAND_TAGLINE: 'Service Menus for Small Businesses' }
const forms = { formUrlEN: 'https://tally.so/r/yPkN5X?order_id=o1', formUrlES: 'https://tally.so/r/MeyDpk?order_id=o1' }
const entrega = { pageUrl: 'https://www.hmulink.com/links/x/', slug: 'x', correctionUrl: 'https://tally.so/r/MeyDpk?order_id=o1', hasQr: false, env }
const ES = /Promociones o Spam/
const EN = /Promotions or Spam tab/

test('correo post-pago: avisa dónde buscar, en el idioma del comprador', () => {
  assert.match(buildPostPaymentEmail({ ...forms, lang: 'es', env }), ES)
  assert.match(buildPostPaymentText({ ...forms, lang: 'es', env }), ES)
  assert.match(buildPostPaymentEmail({ ...forms, lang: 'en', env }), EN)
  assert.match(buildPostPaymentText({ ...forms, lang: 'en', env }), EN)
  assert.doesNotMatch(buildPostPaymentEmail({ ...forms, lang: 'en', env }), ES)
})

test('correo post-pago bilingüe (moneda desconocida): aparece en los dos idiomas', () => {
  const html = buildPostPaymentEmail({ ...forms, lang: null, env })
  assert.match(html, ES)
  assert.match(html, EN)
})

test('correo de entrega: avisa dónde buscar, en HTML y en texto', () => {
  assert.match(buildDeliveryEmail({ ...entrega, lang: 'es' }), ES)
  assert.match(buildDeliveryText({ ...entrega, lang: 'es' }), ES)
  assert.match(buildDeliveryEmail({ ...entrega, lang: 'en' }), EN)
  assert.match(buildDeliveryText({ ...entrega, lang: 'en' }), EN)
})
