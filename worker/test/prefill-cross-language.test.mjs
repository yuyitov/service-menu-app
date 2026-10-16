/**
 * El prellenado de una modificación se traduce entre los formularios ES y EN:
 * el cliente pide su modificación en el idioma que quiera, llenara el original
 * en el que llenara y pagara en la moneda que pagara (2026-10-16: pagó en USD,
 * llenó en español, y el enlace abría el formulario en inglés con todo vacío).
 *
 *   node worker/test/prefill-cross-language.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { translatePrefill, inferPrefillLang } from '../product-config.mjs'
import { construirCrosswalk } from './generar_crosswalk.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const leer = (ruta) => JSON.parse(readFileSync(join(AQUI, ruta), 'utf8'))
const inventario = leer('fixtures/tally_forms_questions.json')
const crosswalk = leer('../form-crosswalk.json')

test('la tabla del worker coincide con el inventario de los formularios vivos', () => {
  assert.deepEqual(crosswalk, construirCrosswalk(inventario),
    'form-crosswalk.json está desactualizado: node worker/test/generar_crosswalk.mjs')
})

test('el idioma principal se empareja por significado, no por posición', () => {
  const par = crosswalk.questions.find((p) => p.en === 'default_language')
  const de = (en) => par.options.find((o) => o.en === en).es
  assert.equal(de('English first'), 'Inglés primero')
  assert.equal(de('Spanish first'), 'Español primero')
})

test('parejas clave por significado (fijadas a mano para que un reordenamiento no las invierta)', () => {
  const op = (nombre, en) => crosswalk.questions.find((p) => p.en === nombre).options.find((o) => o.en === en).es
  assert.equal(op('business_type', 'Independent professional (my own profile)'), 'Profesional independiente (mi perfil personal)')
  assert.equal(op('business_type', 'Other local service business'), 'Otro negocio local de servicios')
  assert.equal(op('q_do_you_work_with_clients_online_in_person_or_both', 'Both'), 'Ambas')
  assert.equal(op('q_do_you_work_with_clients_online_in_person_or_both', 'Online'), 'En línea')
  assert.equal(op('client_care_text', 'By appointment only'), 'Solo con cita')
  assert.equal(op('primary_cta', 'Website'), 'Sitio web')
})

test('cada pregunta de cada formulario tiene su pareja en el otro idioma', () => {
  for (const f of inventario.forms) {
    const otro = f.lang === 'en' ? 'es' : 'en'
    for (const q of f.questions) {
      const par = crosswalk.questions.find((p) => p[f.lang] === q.title)
      assert.ok(par, `${f.lang}: "${q.title}" no está en la tabla`)
      assert.ok(par[otro], `${f.lang}: "${q.title}" no tiene pareja en ${otro}`)
    }
  }
})

test('TODAS las opciones de TODAS las preguntas hacen ida y vuelta sin perderse', () => {
  let probadas = 0
  for (const par of crosswalk.questions.filter((p) => p.options)) {
    for (const op of par.options) {
      const aEs = translatePrefill({ [par.en]: op.en }, 'en', 'es', crosswalk)
      assert.deepEqual(aEs, { [par.es]: op.es }, `en→es: ${par.en} / ${op.en}`)
      const aEn = translatePrefill({ [par.es]: op.es }, 'es', 'en', crosswalk)
      assert.deepEqual(aEn, { [par.en]: op.en }, `es→en: ${par.es} / ${op.es}`)
      probadas += 1
    }
  }
  assert.ok(probadas >= 50, `solo se probaron ${probadas} opciones`)
})

test('un envío en español se vuelve el prellenado del formulario en inglés (el caso de Vero)', () => {
  const enEspanol = {
    business_name: 'Mi Negocio',
    business_type: 'Profesional independiente (mi perfil personal)',
    short_description: 'Una descripción en español',
    q_correo_de_contacto_para_la_vista_previa_de_tu_hmu_link: 'ana@example.com',
    q_tu_nombre: 'Ana',
    q_telefono_o_whatsapp_por_si_tenemos_preguntas_sobre_tu_hmu: '+523221234567',
    q_cuantas_ubicaciones_publicas_deben_aparecer_en_tu_hmu_link: 'Sin ubicación física (en línea o a domicilio)',
    default_language: 'Español primero',
    primary_cta: 'Sitio web',
  }
  const enIngles = translatePrefill(enEspanol, 'es', 'en', crosswalk)
  assert.equal(enIngles.business_type, 'Independent professional (my own profile)')
  assert.equal(enIngles.q_your_name, 'Ana')
  assert.equal(enIngles.q_contact_email_for_your_hmu_link_preview, 'ana@example.com')
  assert.equal(enIngles.q_phone_or_whatsapp_if_we_have_questions_about_your_hmu_link, '+523221234567')
  assert.equal(enIngles.default_language, 'Spanish first')
  assert.equal(enIngles.primary_cta, 'Website')
  assert.match(enIngles.q_how_many_public_locations_should_appear_on_your_hmu_link, /^No physical location/)
  // los textos libres quedan como el cliente los escribió
  assert.equal(enIngles.short_description, 'Una descripción en español')
  assert.equal(enIngles.business_name, 'Mi Negocio')
  assert.equal(Object.keys(enIngles).length, Object.keys(enEspanol).length)
})

test('una opción que no existe en el formulario se omite en vez de prellenar basura', () => {
  const r = translatePrefill({ business_type: 'Tarjetas de presentación digitales', business_name: 'X' }, 'es', 'en', crosswalk)
  assert.equal('business_type' in r, false)
  assert.equal(r.business_name, 'X')
})

test('mismo idioma: no cambia nada; claves desconocidas pasan tal cual', () => {
  const p = { business_type: 'Barbershop', rara: 'x' }
  assert.deepEqual(translatePrefill(p, 'en', 'en', crosswalk), p)
  // también en el mismo idioma, lo que no es opción no se prellena
  assert.deepEqual(translatePrefill({ business_type: 'Algo inventado', business_name: 'X' }, 'en', 'en', crosswalk), { business_name: 'X' })
  assert.deepEqual(translatePrefill({ rara: 'x' }, 'es', 'en', crosswalk), { rara: 'x' })
  assert.deepEqual(translatePrefill(null, 'es', 'en', crosswalk), {})
})

test('el idioma de un prellenado sin form_id se deduce de sus nombres', () => {
  assert.equal(inferPrefillLang({ q_tu_nombre: 'A', business_name: 'B' }, crosswalk), 'es')
  assert.equal(inferPrefillLang({ q_your_name: 'A', business_name: 'B' }, crosswalk), 'en')
  assert.equal(inferPrefillLang({ business_name: 'B' }, crosswalk), null)
  assert.equal(inferPrefillLang(null, crosswalk), null)
})
