#!/usr/bin/env node
/**
 * Structural self-check. Runs without a harness or any dependency, so CI and
 * `pnpm check` can call it on a bare checkout.
 *
 * Beyond the manifest it enforces the pack's scope, which is the whole point of
 * this plugin:
 *
 *   1. exactly one dictionary file exists (`lib/locales/core.json`), and it
 *      carries no namespace owned by a third-party plugin — installing this pack
 *      must not change what another plugin renders;
 *   2. neither half of the plugin contains a DOM translation layer, which is the
 *      other way the pack used to reach into plugin UI;
 *   3. the host exposes one read-only route and the client half registers only
 *      namespaces the dictionary file carries.
 *
 * Usage: node scripts/check.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

/** Namespaces that belong to third-party plugins rather than the base app. */
const THIRD_PARTY_NAMESPACE = /^(dsh-market|dsh-automation|agency|archive-manager|michengai\.|im-connect|skills-manager)/

function fail(message) {
  failures.push(message)
}

/** Read a file relative to the repository root, or undefined when it is absent. */
function read(relativePath) {
  const file = join(ROOT, relativePath)
  if (!existsSync(file)) return undefined
  return readFileSync(file, 'utf8')
}

/** Parse a JSON file relative to the repository root, or undefined when absent. */
function readJson(relativePath) {
  const raw = read(relativePath)
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`)
    return undefined
  }
}

/** Report every `{placeholder}` defect in one dictionary value. */
function placeholderProblems(value) {
  const found = []
  for (const match of value.matchAll(/\{([^{}]*)\}/g)) {
    if (!/^[A-Za-z0-9_.]+$/.test(match[1])) found.push(match[0])
  }
  const withoutPlaceholders = value.replace(/\{[^{}]*\}/g, '')
  if (/[{}]/.test(withoutPlaceholders)) found.push(withoutPlaceholders)
  return found
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------
const pkg = readJson('package.json')
if (!pkg) fail('package.json is missing or unreadable')
else {
  if (pkg.type !== 'module') fail(`package.json type must be "module", found ${JSON.stringify(pkg.type)}`)
  if (!String(pkg.main ?? '').startsWith('lib/')) fail(`package.json main must point into lib/, found ${JSON.stringify(pkg.main)}`)
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') fail('package.json dsh.bundle.patch must be "./cordis.patch.yml"')
  if (pkg.dsh?.client?.platform !== 'web') fail('package.json dsh.client.platform must be "web"')
  const injected = pkg.dsh?.client?.inject
  if (!Array.isArray(injected) || !injected.includes('@deepseek-ai/dsh-client-locale')) {
    fail('package.json dsh.client.inject must include "@deepseek-ai/dsh-client-locale"')
  }
  for (const key of ['./client', './cordis.patch.yml', './package.json']) {
    if (!pkg.exports?.[key]) fail(`package.json exports is missing "${key}"`)
  }
  if (!Array.isArray(pkg.files) || !pkg.files.includes('lib')) fail('package.json files must include "lib"')
  for (const entry of pkg.files ?? []) {
    if (entry.startsWith('lib/locales/plugins') || entry.startsWith('lib/locales/dom')) {
      fail(`package.json files still ships the retired path "${entry}"`)
    }
  }
}

// ---------------------------------------------------------------------------
// cordis.patch.yml — the row that installs the plugin
// ---------------------------------------------------------------------------
const patch = read('cordis.patch.yml')
if (patch === undefined) fail('cordis.patch.yml is missing')
else if (!/insert:/.test(patch) || !patch.includes(String(pkg?.name ?? ''))) {
  fail('cordis.patch.yml must insert a row naming this package')
}

// ---------------------------------------------------------------------------
// Retired material must not come back
// ---------------------------------------------------------------------------
for (const retired of ['lib/locales/plugins', 'lib/locales/dom', 'scripts/extract-plugin-locales.mjs']) {
  if (existsSync(join(ROOT, retired))) fail(`${retired} was retired with the base-app-only scope but exists again`)
}

const localesDir = join(ROOT, 'lib', 'locales')
const localeFiles = existsSync(localesDir) ? readdirSync(localesDir, { withFileTypes: true }) : []
for (const entry of localeFiles) {
  if (entry.isDirectory()) fail(`lib/locales/${entry.name} is not expected: this pack ships one flat dictionary file`)
}
const shippedDictionaries = localeFiles.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name)
if (shippedDictionaries.length !== 1 || shippedDictionaries[0] !== 'core.json') {
  fail(`lib/locales must contain exactly core.json, found [${shippedDictionaries.join(', ')}]`)
}

// ---------------------------------------------------------------------------
// lib/locales/core.json — the base application's dictionaries
// ---------------------------------------------------------------------------
const core = readJson('lib/locales/core.json')
let namespaceCount = 0
let keyCount = 0
let blankCount = 0
let thirdParty = []
if (!core || typeof core !== 'object' || Array.isArray(core)) {
  fail('lib/locales/core.json must be an object of namespace -> { key: string }')
} else {
  for (const [namespace, dictionary] of Object.entries(core)) {
    namespaceCount += 1
    if (THIRD_PARTY_NAMESPACE.test(namespace)) thirdParty.push(namespace)
    if (!namespace || /\s/.test(namespace)) fail(`core.json namespace ${JSON.stringify(namespace)} is malformed`)
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
      fail(`core.json namespace "${namespace}" is not an object`)
      continue
    }
    const keys = Object.keys(dictionary)
    if (keys.length === 0) fail(`core.json namespace "${namespace}" is empty`)
    for (const [key, value] of Object.entries(dictionary)) {
      keyCount += 1
      if (typeof value !== 'string') {
        fail(`core.json ${namespace}/${key} is ${typeof value}, expected a string`)
        continue
      }
      if (value.trim() === '') blankCount += 1
      const defects = placeholderProblems(value)
      if (defects.length > 0) fail(`core.json ${namespace}/${key} has a malformed placeholder: ${defects.join(', ')}`)
    }
  }
}
if (thirdParty.length > 0) {
  fail(`core.json carries third-party namespace(s) [${thirdParty.join(', ')}]; this pack translates the base app only`)
}

// ---------------------------------------------------------------------------
// Host half — one route, and it serves only the core dictionary
// ---------------------------------------------------------------------------
const host = read('lib/index.js')
if (host === undefined) fail('lib/index.js is missing')
else {
  const relativeHost = 'lib/index.js'
  for (const token of ['export const name', 'export function apply', 'webServer']) {
    if (!host.includes(token)) fail(`${relativeHost} must contain ${JSON.stringify(token)}`)
  }
  const routes = [...host.matchAll(/path:\s*`([^`]*)`/g)].map((match) => match[1])
  if (routes.length !== 1) fail(`${relativeHost} must register exactly one route, found [${routes.join(', ')}]`)
  for (const retired of ['/dict/plugins', '/dom']) {
    if (host.includes(retired)) fail(`${relativeHost} still references the retired route ${retired}`)
  }
  if (host.includes('./locales/plugins') || host.includes('./locales/dom')) {
    fail(`${relativeHost} still reads a retired dictionary directory`)
  }
}

// ---------------------------------------------------------------------------
// Client half — no DOM layer, no plugin namespaces
// ---------------------------------------------------------------------------
const clientSource = read('src/client.js')
const clientBundle = read('lib/client.js')
for (const [relativePath, source] of [['src/client.js', clientSource], ['lib/client.js', clientBundle]]) {
  if (source === undefined) {
    fail(`${relativePath} is missing`)
    continue
  }
  for (const token of ['MutationObserver', 'createTreeWalker', 'TRANSLATABLE_ATTRIBUTES']) {
    if (source.includes(token)) fail(`${relativePath} still contains the retired DOM layer (${token})`)
  }
  for (const token of ['/dict/plugins', '`${API}/dom`', "API}/dom"]) {
    if (source.includes(token)) fail(`${relativePath} still fetches the retired endpoint ${token}`)
  }
}
if (clientBundle !== undefined) {
  for (const token of ['window.__ModuleLoader__.load(', `id: '${String(pkg?.name ?? '')}'`, 'module.exports = { apply, inject }']) {
    if (!clientBundle.includes(token)) fail(`lib/client.js must contain ${JSON.stringify(token)}`)
  }
}
if (clientSource !== undefined && clientBundle !== undefined && !clientBundle.includes(clientSource.trim())) {
  fail('lib/client.js is out of date: run `node scripts/build-client.mjs`')
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const bytes = (relativePath) => {
  try {
    return statSync(join(ROOT, relativePath)).size
  } catch {
    return 0
  }
}

if (failures.length > 0) {
  console.error(`dsh-korean-lang check failed (${failures.length} problem(s)):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('dsh-korean-lang check passed')
console.log(`  scope          base application only (no plugin namespaces, no DOM layer)`)
console.log(`  namespaces     ${namespaceCount}`)
console.log(`  strings        ${keyCount} (${blankCount} intentionally blank)`)
console.log(`  host bundle    ${relative(ROOT, join(ROOT, 'lib', 'index.js')).split(sep).join('/')} — ${bytes('lib/index.js')} bytes`)
console.log(`  client bundle  lib/client.js — ${bytes('lib/client.js')} bytes`)
console.log(`  dictionary     lib/locales/core.json — ${bytes('lib/locales/core.json')} bytes`)
