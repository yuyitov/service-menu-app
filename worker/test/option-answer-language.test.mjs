/**
 * Las respuestas de OPCIÓN que se publican tal cual (cómo atiendes, reservaciones)
 * se llevan al idioma de la PÁGINA, no al del formulario en que el cliente las
 * contestó. Vero llenó el formulario en inglés con página en español y su página
 * decía "Forma de trabajo: Both" (2026-10-16).
 *
 *   node worker/test/option-answer-language.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeTallyPayload, buildPublicPayload } from '../worker.js'
import { localizeOptionAnswer } from '../product-config.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const crosswalk = JSON.parse(readFileSync(join(AQUI, '..', 'form-crosswalk.json'), 'utf8'))

const ENV = {
  PRODUCT_ID: 'hmu', BRAND_NAME: 'HMU Link', VALID_BRAND_STYLES: 'clarity-editorial,black-gold,warm-sand',
  TALLY_FORM_URL_EN: 'https://tally.so/r/yPkN5X?order_id=', TALLY_FORM_URL_ES: 'https://tally.so/r/MeyDpk?order_id=',
}

const opcion = (label, textos, elegida) => ({
  key: `q_${label}`, label, type: 'MULTIPLE_CHOICE',
  value: [`id_${elegida}`], options: textos.map((t, i) => ({ id: `id_${i}`, text: t })),
})

// Formulario EN, con el idioma principal que se pida
function payload({ idioma, atiendes, reservas }) {
  const fields = [
    opcion('default_language', ['English first', 'Spanish first'], idioma === 'es' ? 1 : 0),
  ]
  if (atiendes !== undefined) fields.push(opcion('q_do_you_work_with_clients_online_in_person_or_both', ['Online', 'In person', 'Both'], atiendes))
  if (reservas !== undefined) fields.push(opcion('reservations_text', ['Yes — by phone or WhatsApp', 'Yes — through a booking link', 'No — walk-in only'], reservas))
  return buildPublicPayload(normalizeTallyPayload({
    eventType: 'FORM_RESPONSE', data: { responseId: 'OPC01', formId: 'yPkN5X', fields, hiddenFields: {} },
  }), 'pi_opcion', ENV)
}

test('formulario EN con página en español: "Both" sale "Ambas" (el caso de Vero)', () => {
  const p = payload({ idioma: 'es', atiendes: 2 })
  assert.equal(p.default_language, 'es')
  assert.equal(p.client_care_text, 'Ambas')
})

test('formulario EN con página en inglés: se queda en inglés', () => {
  assert.equal(payload({ idioma: 'en', atiendes: 2 }).client_care_text, 'Both')
})

test('reservaciones también se llevan al idioma de la página', () => {
  assert.equal(payload({ idioma: 'es', reservas: 0 }).reservations_text, 'Sí — por teléfono o WhatsApp')
  assert.equal(payload({ idioma: 'en', reservas: 2 }).reservations_text, 'No — walk-in only')
})

test('las tres opciones de "en línea / en persona / ambas" en español', () => {
  assert.equal(payload({ idioma: 'es', atiendes: 0 }).client_care_text, 'En línea')
  assert.equal(payload({ idioma: 'es', atiendes: 1 }).client_care_text, 'En persona')
})

test('función pura: opción en cualquier idioma → idioma pedido; texto libre intacto', () => {
  assert.equal(localizeOptionAnswer('Solo con cita', 'en', crosswalk), 'By appointment only')
  assert.equal(localizeOptionAnswer('By appointment only', 'es', crosswalk), 'Solo con cita')
  assert.equal(localizeOptionAnswer('Ambas', 'en', crosswalk), 'Both')
  assert.equal(localizeOptionAnswer('Atiendo a domicilio los sábados', 'en', crosswalk), 'Atiendo a domicilio los sábados')
  assert.equal(localizeOptionAnswer('', 'en', crosswalk), '')
  assert.equal(localizeOptionAnswer('Both', 'fr', crosswalk), 'Both')
})

test('no toca opciones de otras preguntas (el botón principal "Website" sigue igual)', () => {
  assert.equal(localizeOptionAnswer('Website', 'es', crosswalk), 'Website')
})
