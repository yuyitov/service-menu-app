/**
 * Vuelve a tomar el inventario de los formularios VIVOS de Tally y reescribe
 * fixtures/tally_forms_questions.json.
 *
 *   TALLY_API_KEY=tly-... node worker/test/tomar_snapshot.mjs
 *
 * Es lo ÚNICO de esta carpeta que sale a la red, y se corre a mano: la prueba de
 * cobertura trabaja siempre sobre el archivo commiteado, para que la suite no
 * dependa de Tally ni de una key.
 *
 * Mezcla los dos endpoints porque ninguno solo alcanza:
 *   GET /forms/<id>/submissions -> questions[]  id, tipo y TÍTULO tal como lo
 *                                               manda el webhook (la autoridad)
 *   GET /forms/<id>             -> blocks[]     el texto de cada OPCIÓN, que el
 *                                               otro endpoint devuelve en null
 *
 * Se emparejan POR ORDEN, no por título: la pregunta de Términos declara un
 * `name` y entonces Tally reporta el NOMBRE como título — el mismo mecanismo que
 * rompió el intake de PawContact el 2026-07-26.
 *
 * Los ids de formulario salen de wrangler.toml (TALLY_FORM_URL_EN/ES), que es lo
 * que el worker desplegado usa de verdad; escribirlos aquí sería una segunda
 * fuente de verdad que se queda atrás.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SALIDA = join(AQUI, 'fixtures', 'tally_forms_questions.json')
const WRANGLER = join(AQUI, '..', 'wrangler.toml')

const KEY = process.env.TALLY_API_KEY
if (!KEY) {
  console.error('Falta TALLY_API_KEY en el entorno.')
  process.exit(1)
}

const toml = readFileSync(WRANGLER, 'utf8')
const formId = (clave) => {
  const url = (toml.match(new RegExp(`^${clave}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || ''
  const id = (url.match(/tally\.so\/r\/([A-Za-z0-9]+)/) || [])[1]
  if (!id) throw new Error(`no pude leer el id del formulario de ${clave} en wrangler.toml`)
  return id
}

async function tally(ruta) {
  const r = await fetch(`https://api.tally.so${ruta}`, { headers: { Authorization: `Bearer ${KEY}` } })
  if (!r.ok) throw new Error(`GET ${ruta} -> ${r.status}`)
  return r.json()
}

const TIPOS_OPCION = new Set([
  'MULTIPLE_CHOICE_OPTION', 'DROPDOWN_OPTION', 'CHECKBOX', 'MULTI_SELECT_OPTION', 'RANKING_OPTION',
])
const NO_SON_PREGUNTA = new Set([
  'TITLE', 'TEXT', 'LABEL', 'HEADING_1', 'HEADING_2', 'HEADING_3', 'FORM_TITLE',
  'PAGE_BREAK', 'CONDITIONAL_LOGIC', 'HIDDEN_FIELDS', 'THANK_YOU_PAGE', 'IMAGE', 'EMBED', 'DIVIDER',
])

function textoDeBloque(payload) {
  const s = payload?.safeHTMLSchema
  if (!Array.isArray(s)) return ''
  return s.map((x) => (Array.isArray(x) ? String(x[0] ?? '') : '')).join(' ').trim()
}

function gruposDelForm(form) {
  const grupos = []
  const porUuid = new Map()
  let titulo = ''
  for (const b of form.blocks) {
    const p = b.payload || {}
    if (b.type === 'TITLE') { titulo = textoDeBloque(p); continue }
    if (NO_SON_PREGUNTA.has(b.type)) continue
    let g = porUuid.get(b.groupUuid)
    if (!g) {
      g = { titulo_editor: titulo, opciones: [] }
      porUuid.set(b.groupUuid, g)
      grupos.push(g)
    }
    if (TIPOS_OPCION.has(b.type) && typeof p.text === 'string') g.opciones.push(p.text)
  }
  return grupos
}

function hiddenFields(form) {
  const b = form.blocks.find((x) => x.type === 'HIDDEN_FIELDS')
  return (b?.payload?.hiddenFields || []).map((h) => h.name)
}

async function arma(lang, id) {
  const [subs, form] = await Promise.all([
    tally(`/forms/${id}/submissions?limit=1`),
    tally(`/forms/${id}`),
  ])
  const vivas = subs.questions.filter((q) => !q.isDeleted && q.type !== 'HIDDEN_FIELDS')
  const grupos = gruposDelForm(form)
  if (vivas.length !== grupos.length) {
    throw new Error(
      `${lang}: ${vivas.length} preguntas en submissions vs ${grupos.length} en el form — ` +
      'el emparejamiento por orden no cuadra; revisa a mano antes de commitear',
    )
  }
  const questions = vivas.map((q, i) => {
    const g = grupos[i]
    const item = { id: q.id, type: q.type, title: q.title }
    if (g.titulo_editor && g.titulo_editor !== q.title) item.title_editor = g.titulo_editor
    if (g.opciones.length) item.options = g.opciones
    return item
  })
  return { lang, form_id: id, form_name: form.name, hidden_fields: hiddenFields(form), questions }
}

const hoy = new Date().toISOString().slice(0, 10)
const salida = {
  _comment:
    'Inventario de los DOS formularios Tally VIVOS de HMU Link (EN y ES). Solo ids, tipos, ' +
    'titulos y el texto de las opciones: cero respuestas, cero datos de clientes. Lo genera ' +
    'worker/test/tomar_snapshot.mjs desde la API de Tally. NO sale de tally_form.yaml del repo: ' +
    'ese archivo es un BORRADOR que nunca creo estos formularios y su propio encabezado lo dice. ' +
    'Medir contra el yaml da falsos positivos.',
  snapshot_date: hoy,
  forms: [
    await arma('en', formId('TALLY_FORM_URL_EN')),
    await arma('es', formId('TALLY_FORM_URL_ES')),
  ],
}

writeFileSync(SALIDA, `${JSON.stringify(salida, null, 2)}\n`, 'utf8')
for (const f of salida.forms) {
  console.log(`${f.lang} ${f.form_id}: ${f.questions.length} preguntas vivas, ` +
    `${f.questions.filter((q) => q.options).length} con opciones`)
}
console.log(`escrito ${SALIDA}`)
