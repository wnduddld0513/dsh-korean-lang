/**
 * Repository self-check: the plugin must be structurally valid before it is
 * published or installed. Runs without any harness dependency.
 *
 * Usage: node scripts/check.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []
const fail = (message) => problems.push(message)

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const rel = (abs) => relative(ROOT, abs).replaceAll('\\', '/')

// --- package manifest -------------------------------------------------------
const pkg = JSON.parse(read('package.json'))
if (pkg.type !== 'module') fail('package.json: "type" must be "module"')
if (pkg.dsh?.client?.platform !== 'web') fail('package.json: dsh.client.platform must be "web"')
if (pkg.exports?.['./client'] === undefined) fail('package.json: exports must declare "./client"')
if (pkg.exports?.['./cordis.patch.yml'] === undefined) fail('package.json: exports must declare "./cordis.patch.yml"')
if (!Array.isArray(pkg.files) || !pkg.files.includes('lib')) fail('package.json: "files" must publish lib')
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('package.json: dsh.bundle.patch must point at cordis.patch.yml')

// --- loader patch -----------------------------------------------------------
const patch = read('cordis.patch.yml')
if (!patch.includes('insert:')) fail('cordis.patch.yml: expected an insert entry')
if (!patch.includes(pkg.name)) fail(`cordis.patch.yml: expected the row name ${pkg.name}`)

// --- host half --------------------------------------------------------------
const host = read('lib/index.js')
for (const token of ['export const name', 'export function apply', 'webServer']) {
  if (!host.includes(token)) fail(`lib/index.js: missing ${token}`)
}

// --- dictionaries -----------------------------------------------------------
const CORE = join(ROOT, 'lib', 'locales', 'core.json')
if (!existsSync(CORE)) fail('lib/locales/core.json: missing')
const core = existsSync(CORE) ? JSON.parse(readFileSync(CORE, 'utf8')) : {}

let keys = 0
let emptyValues = 0
const namespaces = new Set()
for (const [namespace, dictionary] of Object.entries(core)) {
  if (typeof dictionary !== 'object' || dictionary === null) { fail(`core.json: namespace "${namespace}" is not an object`); continue }
  const entries = Object.entries(dictionary)
  if (entries.length === 0) { fail(`core.json: namespace "${namespace}" is empty`); continue }
  namespaces.add(namespace)
  for (const [key, value] of entries) {
    keys++
    if (typeof value !== 'string') fail(`core.json: ${namespace}.${key} is not a string`)
    else {
      // A blank value is legitimate: some keys are composable separators or
      // language-specific prefixes that are empty in English and Korean alike.
      if (value.trim() === '') emptyValues++
      // Every placeholder must be a well-formed {name}; a stray brace breaks substitution.
      const stripped = value.replace(/\{\w+\}/g, '')
      if (/[{}]/.test(stripped)) fail(`core.json: ${namespace}.${key} has a malformed placeholder`)
    }
  }
}

const PLUGINS = join(ROOT, 'lib', 'locales', 'plugins')
const pluginNamespaces = new Set()
if (existsSync(PLUGINS)) {
  for (const entry of readdirSync(PLUGINS).sort()) {
    if (!entry.endsWith('.json')) continue
    let file
    try { file = JSON.parse(readFileSync(join(PLUGINS, entry), 'utf8')) } catch (error) {
      fail(`lib/locales/plugins/${entry}: ${error.message}`); continue
    }
    for (const [namespace, dictionary] of Object.entries(file)) {
      if (typeof dictionary !== 'object' || dictionary === null) { fail(`plugins/${entry}: namespace "${namespace}" is not an object`); continue }
      if (namespaces.has(namespace)) fail(`plugins/${entry}: namespace "${namespace}" is already a core namespace`)
      if (pluginNamespaces.has(namespace)) fail(`plugins/${entry}: namespace "${namespace}" is defined twice`)
      pluginNamespaces.add(namespace)
      keys += Object.keys(dictionary).length
    }
  }
}

// --- DOM phrase maps --------------------------------------------------------
// These translate plugins that hardcode their copy: the key is the source text
// itself, so a key that drifts by one character silently stops matching.
const DOM = join(ROOT, 'lib', 'locales', 'dom')
let domPhrases = 0
if (existsSync(DOM)) {
  const seen = new Map()
  for (const entry of readdirSync(DOM).sort()) {
    if (!entry.endsWith('.json')) continue
    let file
    try { file = JSON.parse(readFileSync(join(DOM, entry), 'utf8')) } catch (error) {
      fail(`lib/locales/dom/${entry}: ${error.message}`); continue
    }
    if (typeof file !== 'object' || file === null || Array.isArray(file)) {
      fail(`lib/locales/dom/${entry}: expected a flat object of phrase -> translation`)
      continue
    }
    for (const [source, target] of Object.entries(file)) {
      if (source.trim() === '') fail(`lib/locales/dom/${entry}: an empty source phrase`)
      if (typeof target !== 'string' || target.trim() === '') fail(`lib/locales/dom/${entry}: ${JSON.stringify(source)} has no translation`)
      const previous = seen.get(source)
      if (previous !== undefined) fail(`lib/locales/dom/${entry}: ${JSON.stringify(source)} is already translated in ${previous}`)
      else seen.set(source, entry)
      domPhrases++
    }
  }
}

// --- built bundle -----------------------------------------------------------
const CLIENT = join(ROOT, 'lib', 'client.js')
if (!existsSync(CLIENT)) fail('lib/client.js: missing — run `npm run build`')
else {
  const client = readFileSync(CLIENT, 'utf8')
  if (!client.includes('window.__ModuleLoader__.load(')) fail('lib/client.js: does not register on the module loader')
  if (!client.includes(`id: '${pkg.name}'`)) fail(`lib/client.js: module id must be ${pkg.name}`)
  if (!client.includes('module.exports = { apply, inject }')) fail('lib/client.js: does not export apply and inject')
}

// --- report -----------------------------------------------------------------
if (problems.length > 0) {
  console.error(`${pkg.name}: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`${pkg.name} v${pkg.version}: ok`)
console.log(`  core namespaces:   ${namespaces.size}`)
console.log(`  plugin namespaces: ${pluginNamespaces.size}`)
console.log(`  keys:              ${keys} (${emptyValues} intentionally blank)`)
console.log(`  DOM phrases:       ${domPhrases}`)
console.log(`  bundle:            ${(readFileSync(CLIENT).length / 1024).toFixed(1)} KiB`)
