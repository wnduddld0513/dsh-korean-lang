/**
 * End-to-end smoke test for the plugin without a running harness.
 *
 * Loads the built client bundle the way the page does, drives it with stub
 * `locale`/`effect` and `fetch` implementations, and asserts the observable
 * result: 한국어 is published, every core namespace is registered as a Korean
 * dictionary, teardown removes them again, and an unreachable host degrades to
 * "language available, English text" instead of breaking the page.
 *
 * Usage: node scripts/smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const core = JSON.parse(readFileSync(join(ROOT, 'lib', 'locales', 'core.json'), 'utf8'))

let failures = 0
const check = (condition, message) => {
  if (condition) return
  failures++
  console.error(`  FAIL  ${message}`)
}
const flush = () => new Promise(resolve => setTimeout(resolve, 20))

/** Load lib/client.js exactly as the page does and return its module-loader entry. */
function loadBundle() {
  let loaded
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) { loaded = entry },
    },
  }
  const source = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  // The bundle is a classic script; run it with the globals the page provides.
  new Function('window', 'fetch', 'console', source)(globalThis.window, globalThis.fetch, console)
  return loaded
}

/** Stub client context recording every locale interaction. */
function makeContext() {
  const added = []
  const registered = new Map()
  const effects = []
  const ctx = {
    added,
    registered,
    effects,
    effect: (fn) => { effects.push(fn()) },
    locale: {
      getLocale: () => ({ active: 'en', locales: [{ id: 'zh' }, { id: 'en' }], revision: 0 }),
      addLanguage: (definition) => {
        added.push(definition)
        return () => { added.length = 0 }
      },
      register: (namespace, locale, dictionary) => {
        if (registered.has(namespace)) throw new Error(`locale namespace "${namespace}" already has locale "${locale}"`)
        registered.set(namespace, { locale, dictionary })
        return () => { registered.delete(namespace) }
      },
    },
  }
  return ctx
}

/** @param body - served payload, or null to simulate an unreachable host. */
function stubFetch(body) {
  globalThis.fetch = async (url) => {
    if (body === null) throw new Error('network down')
    const path = String(url)
    if (path.endsWith('/dict/core')) return { ok: true, json: async () => ({ core: body }) }
    if (path.endsWith('/dict/plugins')) return { ok: true, json: async () => ({ plugins: {} }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

// --- 1. the happy path: host reachable -------------------------------------
{
  stubFetch(core)
  const entry = loadBundle()
  check(entry?.id === 'dsh-korean-lang', `bundle id is ${entry?.id}`)

  const bundle = entry.factory(() => { throw new Error('the bundle must not require anything') })
  check(typeof bundle.apply === 'function', 'apply is exported')
  check(Array.isArray(bundle.inject) && bundle.inject.includes('locale'), 'inject lists locale')

  const ctx = makeContext()
  bundle.apply(ctx)
  await flush()

  check(ctx.added.length === 1, `한국어 is published once (got ${ctx.added.length})`)
  check(ctx.added[0]?.id === 'ko', 'the locale id is ko')
  check(ctx.added[0]?.label === '한국어', `the label is 한국어 (got ${ctx.added[0]?.label})`)
  check(ctx.added[0]?.fallback === 'en', 'the fallback is en')

  const expected = Object.keys(core)
  const missing = expected.filter(ns => !ctx.registered.has(ns))
  check(missing.length === 0, `every core namespace is registered (missing: ${missing.join(', ')})`)
  check(ctx.registered.size === expected.length, `no extra namespaces (${ctx.registered.size} vs ${expected.length})`)
  let keyMismatch = 0
  for (const [ns, entry_] of ctx.registered) {
    if (entry_.locale !== 'ko') check(false, `${ns} is registered under ${entry_.locale}`)
    if (Object.keys(entry_.dictionary).length !== Object.keys(core[ns]).length) keyMismatch++
  }
  check(keyMismatch === 0, `${keyMismatch} namespace(s) lost keys`)

  // --- 2. teardown ----------------------------------------------------------
  const dispose = ctx.effects.at(-1)
  check(typeof dispose === 'function', 'apply installs a disposer through ctx.effect')
  dispose()
  check(ctx.registered.size === 0, 'teardown unregisters every namespace')
  check(ctx.added.length === 0, 'teardown withdraws the language')
}

// --- 3. the host is unreachable --------------------------------------------
{
  stubFetch(null)
  const entry = loadBundle()
  const ctx = makeContext()
  entry.factory(() => {}).apply(ctx)
  await flush()
  check(ctx.added.length === 1, '한국어 is still published when the dictionaries fail')
  check(ctx.registered.size === 0, 'no namespace is registered when the dictionaries fail')
}

// --- 4. another definition already owns ko ---------------------------------
{
  stubFetch(core)
  const entry = loadBundle()
  const ctx = makeContext()
  ctx.locale.getLocale = () => ({ active: 'ko', locales: [{ id: 'zh' }, { id: 'en' }, { id: 'ko' }], revision: 0 })
  entry.factory(() => {}).apply(ctx)
  await flush()
  check(ctx.added.length === 0, 'an existing ko definition is not claimed twice')
  check(ctx.registered.size === Object.keys(core).length, 'dictionaries still register')
}

if (failures > 0) {
  console.error(`\nsmoke: ${failures} failure(s)`)
  process.exit(1)
}
console.log(`smoke: ok (${Object.keys(core).length} namespaces registered, teardown clean)`)
