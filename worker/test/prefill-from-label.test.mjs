/**
 * El prellenado de la modificación sale de lo que el cliente escribió, por el
 * nombre estable de cada pregunta. El webhook de Tally ya no manda `name`: lo
 * manda en `label`. Sin esta prueba el mapa sale vacío y el cliente cae en
 * silencio a la página vieja de texto libre (visto en producción, 2026-10-09).
 *
 *   node worker/test/prefill-from-label.test.mjs
 */
import assert from 'node:assert/strict'
import { normalizeTallyPayload } from '../worker.js'

const webhook = (fields) => ({ eventType: 'FORM_RESPONSE', data: { responseId: 'PREFILL01', formId: 'MeyDpk', fields } })

const opcion = { id: 'opt-1', text: 'Charcoal Clean — limpio y moderno' }

const conNombresEnLabel = normalizeTallyPayload(webhook([
  { key: 'question_a', label: 'business_name', type: 'INPUT_TEXT', value: 'Mi Negocio' },
  { key: 'question_b', label: 'pick_your_style', type: 'MULTIPLE_CHOICE', value: ['opt-1'], options: [opcion] },
  { key: 'question_c', label: 'q_tu_nombre', type: 'INPUT_TEXT', value: 'Ana' },
  { key: 'question_d', label: 'logo_url', type: 'FILE_UPLOAD', value: [{ url: 'https://storage.tally.so/x.jpg', name: 'x.jpg' }] },
  { key: 'question_e', label: 'photo_rights_confirmed', type: 'CHECKBOXES', value: ['a', 'b'] },
  { key: 'question_f', label: 'tagline', type: 'INPUT_TEXT', value: '' },
  { key: 'hidden_business_name', label: 'business_name', type: 'HIDDEN_FIELDS', value: 'valor viejo del enlace' },
]))

assert.deepEqual(conNombresEnLabel.prefill, {
  business_name: 'Mi Negocio',
  pick_your_style: 'Charcoal Clean — limpio y moderno',
  q_tu_nombre: 'Ana',
}, 'el label con forma de nombre estable alimenta el prellenado; hidden, archivos, casillas y vacíos no')

assert.equal(conNombresEnLabel.answers.business_name, 'Mi Negocio', 'el visible manda sobre el hidden con su mismo nombre')

const conTitulosHumanos = normalizeTallyPayload(webhook([
  { key: 'question_a', label: 'Nombre del negocio', type: 'INPUT_TEXT', value: 'Mi Negocio' },
  { key: 'question_b', label: 'Instagram', type: 'INPUT_TEXT', value: '@mi' },
  { key: 'question_c', label: 'How do you group your services?', type: 'INPUT_TEXT', value: 'x' },
]))
assert.deepEqual(conTitulosHumanos.prefill, {}, 'un título humano no es un nombre: sin nombres el flujo cae al camino viejo, no a un prellenado inventado')

const conNameDeclarado = normalizeTallyPayload(webhook([
  { key: 'question_a', name: 'business_name', label: 'Nombre del negocio', type: 'INPUT_TEXT', value: 'Mi Negocio' },
]))
assert.deepEqual(conNameDeclarado.prefill, { business_name: 'Mi Negocio' }, 'si Tally vuelve a mandar `name`, sigue ganando')

console.log('OK: prellenado de modificación — nombre estable en label, name declarado, títulos humanos sin prellenado')
