/**
 * End-to-end smoke test for the plugin without a running harness.
 *
 * Loads the built client bundle the way the page does and drives it with stub
 * `locale` and `fetch` implementations — and, where jsdom is installed, a real
 * DOM. Covers the observable contract: 한국어 is published, every core namespace
 * is registered as a Korean dictionary, teardown removes them again, an
 * unreachable host degrades gracefully, and the DOM layer translates hardcoded
 * plugin copy while leaving conversation content, code, and form controls alone.
 *
 * Usage: node scripts/smoke.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const core = JSON.parse(readFileSync(join(ROOT, 'lib', 'locales', 'core.json'), 'utf8'))

/**
 * jsdom is a devDependency. A harness checkout nearby is used as a fallback so
 * this check also runs in a source tree that has not installed the package.
 */
function loadJsdom() {
  const candidates = [
    process.env.DSH_JSDOM,
    join(ROOT, 'node_modules', 'jsdom'),
    join(ROOT, '..', 'deepseek-harness-kr', 'node_modules', 'jsdom'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      return require(candidate)
    } catch {
      // Try the next candidate.
    }
  }
  return undefined
}

let failures = 0
const check = (condition, message) => {
  if (condition) return
  failures++
  console.error(`  FAIL  ${message}`)
}
const flush = () => new Promise(resolve => setTimeout(resolve, 30))

/**
 * Load lib/client.js exactly as the page does.
 * @param environment - extra globals the bundle may reach for (`document` etc.).
 * @returns the captured module-loader entry.
 */
function loadBundle(environment = {}) {
  let loaded
  globalThis.window = {
    __ModuleLoader__: { load(entry) { loaded = entry } },
  }
  const source = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  const names = ['window', 'fetch', 'console', 'document', 'MutationObserver', 'NodeFilter', 'requestAnimationFrame']
  const values = [
    globalThis.window, globalThis.fetch, console,
    environment.document, environment.MutationObserver, environment.NodeFilter, environment.requestAnimationFrame,
  ]
  // The bundle is a classic script; run it with the globals the page provides.
  new Function(...names, source)(...values)
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
    on: () => {},
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

/** @param bodies - per-endpoint payloads, or null to simulate an unreachable host. */
function stubFetch(bodies) {
  globalThis.fetch = async (url) => {
    if (bodies === null) throw new Error('network down')
    const path = String(url)
    if (path.endsWith('/dict/core')) return { ok: true, json: async () => ({ core: bodies.core }) }
    if (path.endsWith('/dict/plugins')) return { ok: true, json: async () => ({ plugins: bodies.plugins ?? {} }) }
    if (path.endsWith('/dom')) return { ok: true, json: async () => ({ dom: bodies.dom ?? {} }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

// --- 1. the happy path: host reachable -------------------------------------
{
  stubFetch({ core })
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
  for (const [ns, registered] of ctx.registered) {
    if (registered.locale !== 'ko') check(false, `${ns} is registered under ${registered.locale}`)
    if (Object.keys(registered.dictionary).length !== Object.keys(core[ns]).length) keyMismatch++
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
  stubFetch({ core })
  const entry = loadBundle()
  const ctx = makeContext()
  ctx.locale.getLocale = () => ({ active: 'ko', locales: [{ id: 'zh' }, { id: 'en' }, { id: 'ko' }], revision: 0 })
  entry.factory(() => {}).apply(ctx)
  await flush()
  check(ctx.added.length === 0, 'an existing ko definition is not claimed twice')
  check(ctx.registered.size === Object.keys(core).length, 'dictionaries still register')
}

// --- 5. the DOM layer ------------------------------------------------------
const jsdom = loadJsdom()
if (jsdom === undefined) {
  console.warn('  NOTE  jsdom is absent, so the DOM-layer cases were SKIPPED. Run `npm install` for full coverage.')
} else {
  const dom = new jsdom.JSDOM(`<!doctype html><html><body>
    <button id="plain">Close</button>
    <button id="aria" aria-label="Close settings panel">x</button>
    <input id="field" placeholder="Close" />
    <span id="spaced">  Close  </span>
    <pre id="code"><code>Close</code></pre>
    <div class="markdown" id="chat"><p id="chatText">Close</p></div>
    <div id="host"></div>
  </body></html>`)
  const { document } = dom.window

  const environment = {
    document,
    MutationObserver: dom.window.MutationObserver,
    NodeFilter: dom.window.NodeFilter,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
  }

  stubFetch({ core, plugins: {}, dom: { Close: '닫기', 'Close settings panel': '설정 패널 닫기' } })
  const entry = loadBundle(environment)
  const ctx = makeContext()
  ctx.locale.getLocale = () => ({ active: 'ko', locales: [{ id: 'zh' }, { id: 'en' }, { id: 'ko' }], revision: 0 })
  entry.factory(() => {}).apply(ctx)
  await flush()
  await flush()

  const text = (id) => document.getElementById(id).textContent
  check(text('plain') === '닫기', `a button label is translated (got ${JSON.stringify(text('plain'))})`)
  check(document.getElementById('aria').getAttribute('aria-label') === '설정 패널 닫기',
    `an aria-label is translated (got ${JSON.stringify(document.getElementById('aria').getAttribute('aria-label'))})`)
  check(text('spaced') === '  닫기  ', `surrounding whitespace is kept (got ${JSON.stringify(text('spaced'))})`)
  check(document.getElementById('field').getAttribute('placeholder') === 'Close',
    'a form control placeholder is left alone')
  check(text('code') === 'Close', 'a code block is left alone')
  check(text('chatText') === 'Close', 'conversation content is left alone')

  // Content appended after start must be picked up by the observer.
  const late = document.createElement('button')
  late.textContent = 'Close'
  document.getElementById('host').appendChild(late)
  await flush()
  await flush()
  check(late.textContent === '닫기', `dynamically added copy is translated (got ${JSON.stringify(late.textContent)})`)
}

if (failures > 0) {
  console.error(`\nsmoke: ${failures} failure(s)`)
  process.exit(1)
}
const domNote = jsdom === undefined ? 'DOM cases skipped' : 'DOM layer verified'
console.log(`smoke: ok (${Object.keys(core).length} namespaces registered, teardown clean, ${domNote})`)
