/**
 * COBERTURA DEL FORMULARIO VIVO — el candado que faltaba (Fase 3.5).
 *
 * El 2026-07-26 una compra real de $1 (Puppy Patch) destapó que el worker tiraba
 * 11 de 17 campos EN SILENCIO: los alias mapean por TÍTULO de pregunta y el
 * formulario mandaba el NOMBRE ESTABLE. Los tests seguían verdes porque ninguno
 * comparaba el formulario VIVO contra lo que el worker lee.
 *
 * Esta prueba lo compara. Para CADA pregunta viva de los DOS formularios de HMU
 * (EN yPkN5X · ES MeyDpk) arma un webhook de Tally con un valor centinela y
 * afirma que el centinela sale del otro lado, en algún campo del payload público
 * que se despacha al generador. Una pregunta que no llega y no está en la lista
 * NO_VIAJAN (cada entrada con su razón escrita) es un campo perdido.
 *
 * ⚠️ SE MIDE CONTRA EL FORMULARIO VIVO, por la API de Tally — nunca contra
 * `tally_form.yaml` del repo, que es un BORRADOR que jamás creó estos
 * formularios (lo dice su propio encabezado). Medir la estructura del repo y
 * creerle es el error que trajo el plan de cero regresiones: da falsos positivos
 * a montones.
 *
 * Cada pregunta se mide SOLA, no todas a la vez. El formulario tiene pares de
 * preguntas condicionales que alimentan el MISMO campo (ver COLISIONES); si se
 * contestan todas de golpe, la primera se queda con el alias y la segunda
 * aparece como "perdida" sin serlo. Medirlas de una en una separa el problema
 * real (nadie lee esta pregunta) del artefacto de medición.
 *
 * Corre offline: el inventario del formulario está commiteado en
 * fixtures/tally_forms_questions.json. Cuando el formulario de Tally cambie hay
 * que volver a tomarlo — ver worker/test/README.md.
 *
 *   node worker/test/form-field-coverage.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// El worker REAL, por sus exports reales: la prueba vale solo si corre contra el
// código que se despliega.
import { normalizeTallyPayload, buildPublicPayload } from '../worker.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT = join(AQUI, 'fixtures', 'tally_forms_questions.json')
const WRANGLER = join(AQUI, '..', 'wrangler.toml')

// ─────────────────────────────────────────────────────────────────────────────
// Las preguntas que a propósito NO viajan al payload público, con su razón.
// Una pregunta que no llega y no está aquí es un campo perdido, no una excepción.
// ─────────────────────────────────────────────────────────────────────────────
const NO_VIAJAN = new Map([
  // — Datos internos: se guardan en el registro de KV (worker.js guarda
  //   `answers` completo) para que Vero pueda escribirle al cliente. Nunca se
  //   despachan: publicarlos sería poner el contacto privado en una página web.
  ['Contact email for your HMU Link preview', 'dato interno de contacto: vive en el registro de KV, no se publica'],
  ['Correo de contacto para la vista previa de tu HMU Link', 'dato interno de contacto: vive en el registro de KV, no se publica'],
  ['Your name', 'dato interno de contacto: vive en el registro de KV, no se publica'],
  ['Tu nombre', 'dato interno de contacto: vive en el registro de KV, no se publica'],
  ['Phone or WhatsApp if we have questions about your HMU Link', 'teléfono PRIVADO (el público se pregunta aparte): vive en KV, no se publica'],
  ['Teléfono o WhatsApp por si tenemos preguntas sobre tu HMU Link', 'teléfono PRIVADO (el público se pregunta aparte): vive en KV, no se publica'],

  // — Control de lógica del formulario: su respuesta decide QUÉ preguntas ve el
  //   cliente, no qué sale en la página. Verificado en la lógica condicional del
  //   formulario vivo: gatea "Where do you offer your services?" y los bloques
  //   de Ubicación 1/2/3.
  ['How many public locations should appear on your HMU Link?', 'control de lógica condicional del formulario: gatea los bloques de ubicación'],
  ['¿Cuántas ubicaciones públicas deben aparecer en tu HMU Link?', 'control de lógica condicional del formulario: gatea los bloques de ubicación'],

  // — Consentimientos legales: son un SÍ obligatorio, no contenido. Quedan como
  //   prueba de aceptación en el registro de KV; publicarlos no significaría nada.
  ['Please confirm all of the following', 'consentimiento legal (derechos de imagen, traducción, aviso de página pública): queda en KV como prueba, no se publica'],
  ['Por favor confirma todo lo siguiente', 'consentimiento legal (derechos de imagen, traducción, aviso de página pública): queda en KV como prueba, no se publica'],
  // OJO con estos dos títulos: son el ID del formulario, no un descuido. Es la
  // pregunta de Términos y Condiciones, la ÚNICA del formulario que declara un
  // `name` — y cuando una pregunta tiene `name`, Tally reporta el NOMBRE en vez
  // del título. Ese es exactamente el mecanismo que rompió el intake de
  // PawContact el 07-26, visible aquí en pequeño y sin consecuencias.
  ['yPkN5X', 'consentimiento legal de Términos y Privacidad (su título es el id del form porque declara `name`): queda en KV, no se publica'],
  ['MeyDpk', 'consentimiento legal de Términos y Privacidad (su título es el id del form porque declara `name`): queda en KV, no se publica'],

  // — Reportada a Vero el 2026-07-26 como candidata a QUITAR. No la lee ni el
  //   worker ni el generador: el cliente escribe sus preferencias de marca y no
  //   pasa nada con ellas. Se deja aquí, no en las perdidas, porque quitar una
  //   pregunta del formulario vivo con 4 clientes reales es decisión de Vero.
  ['Brand notes', 'PENDIENTE DE DECISIÓN (2026-07-26): nadie la lee — ni worker ni generador. Reportada a Vero como pregunta muerta'],
  ['Notas de marca', 'PENDIENTE DE DECISIÓN (2026-07-26): nadie la lee — ni worker ni generador. Reportada a Vero como pregunta muerta'],
])

// ─────────────────────────────────────────────────────────────────────────────
// Preguntas de lista cerrada cuya respuesta el worker TRANSFORMA: el texto de la
// opción no aparece tal cual en el payload, así que un centinela no sirve. Se
// prueba lo que de verdad importa: que CADA opción viva produzca un valor válido
// y no un fallback silencioso. Es el bug de 'sunny-paws' cortado en 'sunny' que
// hizo que las 4 opciones de PawContact entregaran la misma página.
// ─────────────────────────────────────────────────────────────────────────────
const TRANSFORMADAS = new Map([
  ['Pick your style', 'estilo'],
  ['Elige tu estilo', 'estilo'],
  ['Which language should your HMU Link show first?', 'idioma'],
  ['¿En qué idioma debe aparecer primero tu HMU Link?', 'idioma'],
  ['Which one should be the main button?', 'cta'],
  ['¿Cuál debe ser el botón principal?', 'cta'],
])

// ─────────────────────────────────────────────────────────────────────────────
// Dos preguntas VIVAS que alimentan el MISMO campo del payload. `answerAny` se
// queda con la primera no vacía, así que si el cliente contesta las dos, la
// segunda se pierde en silencio. Cada colisión va aquí con su razón; una
// colisión nueva es una falla.
// ─────────────────────────────────────────────────────────────────────────────
const COLISIONES = new Map([
  ['service_area_text',
   'REPORTADO A VERO 2026-07-26, arreglo en el MOTOR: "¿Dónde ofreces tus servicios?" ' +
   '(se muestra si eligió "sin ubicación física") y "¿Qué zonas cubres?" (se muestra si es ' +
   '"servicios a domicilio") pueden aparecer JUNTAS — un negocio a domicilio sin local es el ' +
   'caso normal. answerAny se queda con la primera y la otra se pierde.'],
  ['client_care_text',
   'REPORTADO A VERO 2026-07-26, arreglo en el MOTOR: "¿Cómo atiendes a tus clientes?" y ' +
   '"¿Trabajas con clientes en línea, en persona o ambas?" se muestran AMBAS al giro ' +
   '"Terapeuta / Profesional del bienestar". answerAny se queda con la primera.'],
])

// ─────────────────────────────────────────────────────────────────────────────
// Campos que el worker construye y que NINGUNA pregunta viva alimenta. No es un
// error por sí mismo (hay derivados y campos de otras plantillas), pero se lista
// para que no crezca sin que nadie lo note.
// ─────────────────────────────────────────────────────────────────────────────
const SIN_PREGUNTA = new Map([
  ['public_slug', 'derivado: nombre del negocio + submission_id'],
  ['style_unmapped', 'bandera derivada: avisa que el estilo elegido no está en el catálogo'],
  ['portfolio_link',
   'REPORTADO A VERO 2026-07-26, decisión suya: el motor SÍ sabe pintar el botón de ' +
   'Portafolio (blocks.portfolio, habilitado para creative/beauty/wellness/professional/' +
   'fitness — casi todos los giros de HMU) pero NINGUNO de los 2 formularios vivos lo ' +
   'pregunta, así que ese bloque nunca se pinta para un cliente de HMU. Es el espejo de ' +
   'una pregunta muerta: un bloque muerto.'],
])

// ─────────────────────────────────────────────────────────────────────────────

let fallos = 0
function check(nombre, ok, detalle = '') {
  console.log(`  ${ok ? 'ok  ' : 'FALLA'}  ${nombre}${ok || !detalle ? '' : `\n         ${detalle}`}`)
  if (!ok) fallos++
}

// El env de PRODUCCIÓN, leído de wrangler.toml: si la prueba inventara el suyo,
// mediría un worker que no existe (el catálogo de estilos y el idioma por
// defecto salen de ahí).
function envDeWrangler() {
  const toml = readFileSync(WRANGLER, 'utf8')
  const leer = (clave) => (toml.match(new RegExp(`^${clave}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || ''
  return {
    BRAND_NAME: leer('BRAND_NAME') || 'HMU Link',
    VALID_BRAND_STYLES: leer('VALID_BRAND_STYLES'),
    TALLY_FORM_URL_EN: leer('TALLY_FORM_URL_EN'),
    TALLY_FORM_URL_ES: leer('TALLY_FORM_URL_ES'),
  }
}
const ENV = envDeWrangler()
const ESTILOS_VALIDOS = ENV.VALID_BRAND_STYLES.split(',').map((s) => s.trim()).filter(Boolean)

const CENTINELA = 'CENTINELAxyz'

function payloadDeUna(form, pregunta, valor) {
  const value = pregunta.type === 'FILE_UPLOAD'
    ? [{ url: `https://storage.tally.so/${valor}.jpg`, name: `${valor}.jpg`, mimeType: 'image/jpeg' }]
    : valor
  const webhook = {
    eventType: 'FORM_RESPONSE',
    data: {
      responseId: 'COBERTURA01',
      formId: form.form_id,
      fields: [{ key: `question_${pregunta.id}`, label: pregunta.title, type: pregunta.type, value }],
      hiddenFields: {},
    },
  }
  return buildPublicPayload(normalizeTallyPayload(webhook), 'pi_cobertura', ENV)
}

function hojas(obj, out = []) {
  if (typeof obj === 'string') out.push(obj)
  else if (Array.isArray(obj)) obj.forEach((v) => hojas(v, out))
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((v) => hojas(v, out))
  return out
}

function campoQueRecibe(payload, marca) {
  for (const [campo, valor] of Object.entries(payload)) {
    if (hojas(valor).some((t) => t.includes(marca))) return campo
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))

console.log('\nCOBERTURA DEL FORMULARIO VIVO DE HMU LINK')
console.log(`  inventario del ${snapshot.snapshot_date}\n`)

check('el inventario trae los 2 formularios vivos (EN y ES)', snapshot.forms.length === 2)
const [enForm, esForm] = snapshot.forms
check('los formularios EN y ES preguntan lo mismo',
  enForm.questions.length === esForm.questions.length,
  `EN ${enForm.questions.length} vs ES ${esForm.questions.length} preguntas`)

const camposPorForm = {}

for (const form of snapshot.forms) {
  console.log(`\n─── ${form.form_name} (${form.form_id}) · ${form.questions.length} preguntas vivas`)

  check(`[${form.lang}] inventario sospechosamente corto`, form.questions.length > 40,
    `${form.questions.length} preguntas`)

  const perdidas = []
  const sinRazon = []
  const destino = {}

  for (const q of form.questions) {
    const transformada = TRANSFORMADAS.get(q.title)

    if (transformada) {
      // No se busca el centinela: se afirma que TODA opción viva mapea.
      const malas = []
      for (const opcion of q.options || []) {
        const p = payloadDeUna(form, q, opcion)
        if (transformada === 'estilo') {
          if (p.style_unmapped || !ESTILOS_VALIDOS.includes(p.brand_style)) {
            malas.push(`${opcion} -> ${p.brand_style}${p.style_unmapped ? ' (FALLBACK)' : ''}`)
          } else {
            destino.brand_style = [...(destino.brand_style || []), q.title].filter((v, i, a) => a.indexOf(v) === i)
          }
        } else if (transformada === 'idioma') {
          if (!['en', 'es'].includes(p.default_language)) malas.push(`${opcion} -> ${p.default_language}`)
          else destino.default_language = [q.title]
        } else if (transformada === 'cta') {
          if (!p.primary_cta) malas.push(`${opcion} -> (vacío)`)
          else destino.primary_cta = [q.title]
        }
      }
      check(`[${form.lang}] «${q.title}»: sus ${q.options?.length || 0} opciones mapean`,
        malas.length === 0, malas.join('\n         '))
      continue
    }

    const p = payloadDeUna(form, q, CENTINELA)
    const campo = campoQueRecibe(p, CENTINELA)
    if (campo) {
      destino[campo] = [...(destino[campo] || []), q.title]
      if (NO_VIAJAN.has(q.title)) {
        sinRazon.push(`«${q.title}» está en NO_VIAJAN pero SÍ llega a ${campo} — quita la excepción`)
      }
    } else if (!NO_VIAJAN.has(q.title)) {
      perdidas.push(`«${q.title}»  <${q.type}>  id=${q.id}`)
    }
  }

  check(`[${form.lang}] toda pregunta viva llega a un payload o tiene su razón escrita`,
    perdidas.length === 0,
    'preguntas cuya respuesta NO llega a ningún campo del payload — el título dejó de\n' +
    '         casar con la clave que lee el worker, o la pregunta está muerta:\n         ' +
    perdidas.join('\n         '))

  check(`[${form.lang}] ninguna excepción de NO_VIAJAN sobra`, sinRazon.length === 0,
    sinRazon.join('\n         '))

  // Colisiones: 2+ preguntas vivas al mismo campo.
  const colisiones = Object.entries(destino).filter(([, qs]) => qs.length > 1)
  const nuevas = colisiones.filter(([campo]) => !COLISIONES.has(campo))
  check(`[${form.lang}] sin colisiones nuevas (2 preguntas al mismo campo)`, nuevas.length === 0,
    nuevas.map(([c, qs]) => `${c} <- ${qs.join('  |  ')}`).join('\n         '))

  camposPorForm[form.lang] = Object.keys(destino).sort()
}

// Las dos versiones del formulario tienen que alimentar EXACTAMENTE los mismos
// campos: si una divergencia se cuela, un cliente recibe menos página por haber
// llenado el formulario en su idioma.
const soloEN = camposPorForm.en.filter((c) => !camposPorForm.es.includes(c))
const soloES = camposPorForm.es.filter((c) => !camposPorForm.en.includes(c))
console.log('')
check('EN y ES alimentan los mismos campos del payload',
  soloEN.length === 0 && soloES.length === 0,
  `solo EN: ${soloEN.join(', ') || '—'}\n         solo ES: ${soloES.join(', ') || '—'}`)

// El espejo: campos que el worker construye y ninguna pregunta alimenta.
const plantilla = payloadDeUna(enForm, enForm.questions[0], CENTINELA)
const huerfanos = Object.keys(plantilla)
  .filter((c) => !camposPorForm.en.includes(c))
  .filter((c) => !SIN_PREGUNTA.has(c))
check('sin campos del payload que ninguna pregunta viva alimente', huerfanos.length === 0,
  'el worker construye estos campos y el formulario vivo ya no los pregunta:\n         ' +
  huerfanos.join(', '))

console.log(fallos === 0 ? '\n  TODO VERDE\n' : `\n  ${fallos} FALLAS\n`)
process.exit(fallos === 0 ? 0 : 1)
