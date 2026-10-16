/**
 * Genera worker/form-crosswalk.json a partir del inventario de los dos
 * formularios vivos (test/fixtures/tally_forms_questions.json).
 *
 *   node worker/test/generar_crosswalk.mjs          # reescribe el JSON
 *   node worker/test/generar_crosswalk.mjs --check  # falla si el JSON no coincide
 *
 * POR QUE EXISTE: el prellenado de una modificación guarda cada respuesta con el
 * nombre de la pregunta y, en las de opciones, con el TEXTO de la opción — los
 * dos dependen del idioma del formulario donde se llenó ("Profesional
 * independiente…" ≠ "Independent professional…", `q_tu_nombre` ≠ `q_your_name`).
 * El cliente debe poder pedir su modificación en el idioma que quiera, sin
 * importar en cuál llenó el original ni en qué moneda pagó. Los dos formularios
 * tienen las mismas preguntas en el mismo orden, así que se emparejan por
 * posición; la prueba de la tabla revisa que siga siendo cierto.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(AQUI, 'fixtures', 'tally_forms_questions.json')
const SALIDA = join(AQUI, '..', 'form-crosswalk.json')

function emparejarIdiomas(opcionesEn, opcionesEs) {
  const pares = opcionesEn.map((en) => {
    const raiz = /^english/i.test(en) ? /^ingl/i : /^spanish/i.test(en) ? /^espa/i : null
    const es = raiz && opcionesEs.find((o) => raiz.test(o))
    if (!es) throw new Error(`no sé emparejar la opción de idioma "${en}" con ${JSON.stringify(opcionesEs)}`)
    return { en, es }
  })
  if (new Set(pares.map((p) => p.es)).size !== pares.length) throw new Error('opciones de idioma repetidas al emparejar')
  return pares
}

export function construirCrosswalk(inventario) {
  const en = inventario.forms.find((f) => f.lang === 'en')
  const es = inventario.forms.find((f) => f.lang === 'es')
  if (!en || !es) throw new Error('el inventario necesita los formularios en y es')
  if (en.questions.length !== es.questions.length) {
    throw new Error(`los formularios ya no tienen las mismas preguntas: ${en.questions.length} vs ${es.questions.length}`)
  }
  const preguntas = en.questions.map((q, i) => {
    const r = es.questions[i]
    if (q.type !== r.type) throw new Error(`la pregunta ${i} cambió de tipo entre idiomas: ${q.type} vs ${r.type}`)
    const oq = q.options || []
    const or = r.options || []
    if (oq.length !== or.length) throw new Error(`"${q.title}" tiene ${oq.length} opciones en inglés y ${or.length} en español`)
    const par = { en: q.title, es: r.title }
    if (oq.length) {
      // Las opciones se emparejan por posición, SALVO el idioma principal: ahí el
      // orden es distinto en cada formulario ("English first" ocupa el lugar 1 en
      // inglés y "Inglés primero" el lugar 2 en español) y emparejar por posición
      // invertiría el idioma de la página. Se empareja por significado.
      par.options = q.title === 'default_language' ? emparejarIdiomas(oq, or) : oq.map((texto, j) => ({ en: texto, es: or[j] }))
    }
    return par
  })
  return {
    _comment: 'GENERADO por test/generar_crosswalk.mjs desde el inventario de los formularios vivos. No editar a mano.',
    snapshot_date: inventario.snapshot_date,
    forms: { en: en.form_id, es: es.form_id },
    questions: preguntas,
  }
}

if (process.argv[1]?.endsWith("generar_crosswalk.mjs")) {
  const nuevo = construirCrosswalk(JSON.parse(readFileSync(FIXTURE, 'utf8')))
  const texto = JSON.stringify(nuevo, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    const actual = readFileSync(SALIDA, 'utf8').replace(/\r\n/g, '\n')
    if (actual !== texto) { console.error('form-crosswalk.json está desactualizado: corre node worker/test/generar_crosswalk.mjs'); process.exit(1) }
    console.log('form-crosswalk.json al día')
  } else {
    writeFileSync(SALIDA, texto)
    console.log(`escrito form-crosswalk.json (${nuevo.questions.length} preguntas)`)
  }
}
