import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const landingEn = readFileSync(join(repo, 'public', 'index.html'), 'utf8')
const landingEs = readFileSync(join(repo, 'public', 'es', 'index.html'), 'utf8')
const wrangler = readFileSync(join(repo, 'worker', 'wrangler.toml'), 'utf8')

const freeChanges = (wrangler.match(/^FREE_CHANGES\s*=\s*"(\d+)"/m) || [])[1]

assert.equal(freeChanges, '2', 'El Worker debe conceder exactamente 2 cambios incluidos')
assert.match(landingEn, /2 changes included free/i, 'La landing EN debe prometer los mismos 2 cambios')
assert.doesNotMatch(landingEn, /\b1 change included free\b/i, 'La promesa vieja de 1 cambio no puede reaparecer')
assert.match(landingEs, /2 modificaciones incluidas gratis/i, 'La landing ES debe prometer los mismos 2 cambios')

console.log('OK: contrato comercial HMU — Worker y landings prometen exactamente 2 cambios incluidos')
