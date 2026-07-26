/**
 * La suite del worker de HMU. Corre todo y falla si algo falla.
 *
 *   node worker/test/run_all.mjs
 *
 * Cada prueba es un archivo independiente que sale con código 0 o 1; aquí solo
 * se encadenan para que no haya que acordarse de la lista.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const pruebas = readdirSync(AQUI).filter((f) => f.endsWith('.test.mjs')).sort()

let fallaron = []
for (const prueba of pruebas) {
  console.log(`\n${'='.repeat(70)}\n${prueba}\n${'='.repeat(70)}`)
  const r = spawnSync(process.execPath, [join(AQUI, prueba)], { stdio: 'inherit' })
  if (r.status !== 0) fallaron.push(prueba)
}

console.log(`\n${'='.repeat(70)}`)
if (fallaron.length) {
  console.log(`${fallaron.length} de ${pruebas.length} pruebas FALLARON: ${fallaron.join(', ')}\n`)
  process.exit(1)
}
console.log(`${pruebas.length} pruebas, TODO VERDE\n`)
