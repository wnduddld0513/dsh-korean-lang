#!/usr/bin/env node
/**
 * End-to-end smoke test with no harness and no dependency: the built client
 * bundle is driven with stub `window`, `fetch` and `locale` implementations, and
 * the host half with a stub web server.
 *
 * What it pins down is the plugin's contract, not its internals:
 *
 *   - 한국어 is published with `fallback: 'en'`;
 *   - exactly the namespaces in `lib/locales/core.json` get a Korean dictionary,
 *     and nothing else does — that is the "no influence on other plugins" rule;
 *   - the bundle runs with `window`, `fetch` and `console` alone, so no DOM layer
 *     can be hiding in it;
 *   - the host registers one read-only route and serves the base app's dictionary;
 *   - a key the pack does not carry resolves to the namespace's English text, and
 *     a namespace the pack does not own resolves to English too.
 *
 * Usage: node scripts/smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORE_PATH = '/api/dsh-korean-lang/dict/core'
const failures = []
let checks = 0

function check(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}

function equal(actual, expected, message) {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  )
}

const core = JSON.parse(readFileSync(join(ROOT, 'lib', 'locales', 'core.json'), 'utf8'))
const coreNamespaces = Object.keys(core)

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** The locale registry, mirroring the runtime's observable behaviour. */
function makeLocale(options = {}) {
  const catalog = [
    { id: 'zh', label: '中文', fallback: 'en' },
    { id: 'en', label: 'English' },
    ...(options.koAlreadyDefined ? [{ id: 'ko', label: '한국어', fallback: 'en' }] : []),
  ]
  const added = []
  const registered = new Map()
  return {
    added,
    registered,
    catalog,
    getLocale: () => ({ active: 'ko', locales: catalog.map((entry) => ({ ...entry })) }),
    addLanguage: (definition) => {
      added.push(definition)
      catalog.push(definition)
      return () => {
        const index = catalog.indexOf(definition)
        if (index >= 0) catalog.splice(index, 1)
      }
    },
    register: (namespace, definitions, dictionary) => {
      // Two shapes exist: (ns, dictionaries) for built-ins and (ns, 'ko', dict).
      const locale = typeof definitions === 'string' ? definitions : 'ko'
      const dict = typeof definitions === 'string' ? dictionary : definitions
      const key = `${namespace}/${locale}`
      if (registered.has(key)) throw new Error(`already registered: ${key}`)
      registered.set(key, dict)
      return () => registered.delete(key)
    },
  }
}

/** A plugin context with just enough surface for `apply`. */
function makeContext(options = {}) {
  const effects = []
  const listeners = []
  const locale = makeLocale(options)
  const ctx = {
    locale,
    effect: (callback, label) => {
      const dispose = callback()
      effects.push({ label, dispose })
      return () => dispose()
    },
    on: (event, handler) => {
      listeners.push({ event, handler })
      return () => {}
    },
  }
  return { ctx, effects, listeners, locale }
}

/** A `fetch` that answers the endpoints in `bodies` and fails for the rest. */
function makeFetch(bodies) {
  const calls = []
  const impl = async (path) => {
    calls.push(path)
    if (!(path in bodies)) throw new Error(`unreachable: ${path}`)
    return { ok: true, status: 200, json: async () => bodies[path] }
  }
  return { impl, calls }
}

/**
 * Load the built bundle with the given fetch and console implementations and
 * return its exports. The bundle is evaluated with exactly `window`, `fetch` and
 * `console` in scope: had it kept a DOM layer, referencing `document` or
 * `MutationObserver` would throw right here.
 */
function loadBundle(options = {}) {
  const source = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  let entry
  const window = { __ModuleLoader__: { load: (value) => (entry = value) } }
  const warnings = []
  const consoleStub = {
    warn: (...args) => warnings.push(args.join(' ')),
    log: () => {},
    error: () => {},
  }
  new Function('window', 'fetch', 'console', source)(window, options.fetch ?? globalThis.fetch, consoleStub)
  const factory = entry?.factory
  const exports = typeof factory === 'function' ? factory(() => { throw new Error('unexpected require') }) : undefined
  return { entry, exports, warnings, window }
}

/** Let the plugin's pending dictionary request settle. */
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0))

// ---------------------------------------------------------------------------
// The client bundle
// ---------------------------------------------------------------------------

// --- 1. the happy path -----------------------------------------------------
{
  const { ctx, effects, locale } = makeContext()
  const { impl, calls } = makeFetch({ [CORE_PATH]: { core } })
  const { entry, exports, warnings } = loadBundle({ fetch: impl })
  check(entry?.id === 'dsh-korean-lang', 'the bundle registers itself as dsh-korean-lang')
  check(typeof exports?.apply === 'function', 'the bundle exports apply')
  equal(exports?.inject, ['locale'], 'the bundle injects only the locale service')

  exports.apply(ctx)
  await sleep()

  equal(
    locale.added,
    [{ id: 'ko', label: '한국어', fallback: 'en' }],
    '한국어 is published once with an English fallback',
  )
  equal(
    effects.map((effect) => effect.label),
    ['dsh-korean-lang: language and dictionaries'],
    'the plugin registers one effect',
  )
  equal(calls, [CORE_PATH], 'exactly one endpoint is requested')

  const registeredNamespaces = [...locale.registered.keys()].map((key) => key.split('/')[0]).sort()
  equal(registeredNamespaces, [...coreNamespaces].sort(), 'exactly the base application namespaces are registered')
  equal(locale.registered.get('settings/ko'), core.settings, 'a namespace carries the dictionary the host served')
  equal(warnings, [], 'the happy path logs nothing')

  // Teardown must leave nothing behind.
  for (const effect of effects) effect.dispose()
  check(locale.registered.size === 0, 'teardown removes every registered dictionary')
  check(!locale.catalog.some((entry) => entry.id === 'ko'), 'teardown removes the published language')
}

// --- 2. the host is unreachable -------------------------------------------
{
  const { ctx, locale } = makeContext()
  const { impl } = makeFetch({})
  const { exports, warnings } = loadBundle({ fetch: impl })
  exports.apply(ctx)
  await sleep()

  equal(locale.added, [{ id: 'ko', label: '한국어', fallback: 'en' }], '한국어 is still published when the host is down')
  check(locale.registered.size === 0, 'no dictionary is registered when the host is down')
  check(
    warnings.some((line) => line.includes('falls back to English')),
    'the failure is reported as an English fallback',
  )
}

// --- 3. another definition already owns ko ---------------------------------
{
  const { ctx, locale } = makeContext({ koAlreadyDefined: true })
  const { impl } = makeFetch({ [CORE_PATH]: { core } })
  loadBundle({ fetch: impl }).exports.apply(ctx)
  await sleep()

  equal(locale.added, [], 'an existing ko definition is not replaced')
  check(locale.registered.size === coreNamespaces.length, 'the dictionaries are registered anyway')
}

// ---------------------------------------------------------------------------
// The host half
// ---------------------------------------------------------------------------
{
  const host = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)
  check(host.name === 'dsh-korean-lang', 'the host exports its plugin name')
  check(typeof host.apply === 'function', 'the host exports apply')

  const routes = []
  const effects = []
  host.apply({
    inject: (services, callback) => {
      equal(services, ['webServer'], 'the host waits for the web server')
      callback({
        webServer: {
          register: (route) => {
            routes.push(route)
            return () => routes.splice(routes.indexOf(route), 1)
          },
        },
        logger: { warn: () => {} },
        effect: (callback2, label) => effects.push({ label, dispose: callback2() }),
      })
    },
  })

  equal(routes.length, 1, 'the host registers exactly one route')
  equal(routes[0].kind, 'exact', 'the route is exact, not a prefix')
  equal(routes[0].path, CORE_PATH, 'the route serves the core dictionary')

  const call = (options = {}) => {
    const response = {
      statusCode: 0,
      headers: undefined,
      body: undefined,
      writeHead(code, headers) {
        this.statusCode = code
        this.headers = headers
      },
      end(body) {
        this.body = body
      },
    }
    routes[0].handler({ method: 'GET', headers: {}, ...options }, response)
    return response
  }

  const get = call()
  check(get.statusCode === 200, 'GET answers 200')
  const payload = JSON.parse(String(get.body))
  equal(Object.keys(payload), ['core'], 'the payload carries the core map and nothing else')
  equal(Object.keys(payload.core).sort(), [...coreNamespaces].sort(), 'the payload carries every base namespace')
  check(typeof get.headers.etag === 'string' && get.headers.etag.length > 0, 'the answer carries an ETag')

  const cached = call({ headers: { 'if-none-match': get.headers.etag } })
  check(cached.statusCode === 304, 'a matching ETag answers 304')
  check(call({ method: 'HEAD' }).body === undefined, 'HEAD answers without a body')
  check(call({ method: 'POST' }).statusCode === 405, 'a write method answers 405')

  for (const effect of effects) effect.dispose()
  check(routes.length === 0, 'teardown unregisters the route')
}

// ---------------------------------------------------------------------------
// Resolution — the runtime's algorithm, replayed
// ---------------------------------------------------------------------------
{
  /**
   * `fallbackChain` from `packages/client/locale/src/client/index.ts`: walk each
   * definition's declared fallback, then make sure English is in the chain.
   */
  const fallbackChain = (definitions, active) => {
    const byId = new Map(definitions.map((definition) => [definition.id, definition]))
    const chain = []
    let current = byId.get(active)
    while (current !== undefined && !chain.includes(current.id)) {
      chain.push(current.id)
      current = current.fallback === undefined ? undefined : byId.get(current.fallback)
    }
    if (!chain.includes('en')) chain.push('en')
    return chain
  }

  /** `translate` + `lookup` from the same file, over one flat dictionary map. */
  const makeRuntime = (definitions, dictionaries) => {
    const dicts = new Map()
    const put = (namespace, locale, dict) => {
      if (!dicts.has(namespace)) dicts.set(namespace, new Map())
      dicts.get(namespace).set(locale, { ...(dicts.get(namespace).get(locale) ?? {}), ...dict })
    }
    for (const [namespace, perLocale] of Object.entries(dictionaries)) {
      for (const [locale, dict] of Object.entries(perLocale)) put(namespace, locale, dict)
    }
    const chain = fallbackChain(definitions, 'ko')
    const lookup = (namespace, key) => {
      const locales = dicts.get(namespace)
      for (const locale of chain) {
        const value = locales?.get(locale)?.[key]
        if (value !== undefined) return value
      }
      return undefined
    }
    return {
      chain,
      translate: (namespace, key) =>
        lookup(namespace, key) ?? (namespace !== 'common' ? lookup('common', key) : undefined) ?? key,
    }
  }

  // What the base application registers for itself, and what the pack added.
  const appDictionaries = {
    settings: { zh: { 'probe.untranslated': '设置' }, en: { 'probe.untranslated': 'Untouched, in English' } },
    'dsh-market': { zh: { 'probe.install': '安装' }, en: { 'probe.install': 'Install, in English' } },
  }
  const packRegistrations = {}
  {
    const { ctx, locale } = makeContext()
    const { impl } = makeFetch({ [CORE_PATH]: { core } })
    loadBundle({ fetch: impl }).exports.apply(ctx)
    await sleep()
    for (const [key, dict] of locale.registered) {
      const [namespace, localeId] = key.split('/')
      packRegistrations[namespace] ??= {}
      packRegistrations[namespace][localeId] = dict
    }
  }

  const definitions = [
    { id: 'zh', label: '中文', fallback: 'en' },
    { id: 'en', label: 'English' },
    { id: 'ko', label: '한국어', fallback: 'en' },
  ]
  // Merge per namespace and locale: the app registers zh+en per namespace, the
  // pack adds the ko dictionary for the namespaces it owns.
  const dictionaries = {}
  for (const source of [appDictionaries, packRegistrations]) {
    for (const [namespace, perLocale] of Object.entries(source)) {
      dictionaries[namespace] ??= {}
      for (const [locale, dict] of Object.entries(perLocale)) {
        dictionaries[namespace][locale] = { ...(dictionaries[namespace][locale] ?? {}), ...dict }
      }
    }
  }
  const runtime = makeRuntime(definitions, dictionaries)
  equal(runtime.chain, ['ko', 'en'], 'the Korean chain reaches English')

  const settingsKeys = Object.keys(core.settings)
  check(settingsKeys.length > 0, 'the settings namespace carries at least one translation')
  const sampleKey = settingsKeys[0]
  equal(runtime.translate('settings', sampleKey), core.settings[sampleKey], 'a translated key shows Korean')
  equal(
    runtime.translate('settings', 'probe.untranslated'),
    'Untouched, in English',
    'a key the pack does not carry falls through to the namespace English dictionary',
  )
  check(!('dsh-market' in packRegistrations), 'the pack registers nothing for a third-party namespace')
  equal(
    runtime.translate('dsh-market', 'probe.install'),
    'Install, in English',
    'a third-party namespace renders its own English text',
  )
  equal(
    runtime.translate('dsh-market', 'probe.absent'),
    'probe.absent',
    'a key nobody translates shows the key, which is the runtime behaviour and not something this pack can change',
  )
  check('common' in packRegistrations, 'the shared vocabulary namespace ships with the pack')
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`dsh-korean-lang smoke test failed (${failures.length} of ${checks} checks):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`dsh-korean-lang smoke test passed (${checks} checks)`)
console.log(`  scope        ${coreNamespaces.length} base-application namespaces, no third-party namespace`)
console.log('  fallback     ko -> en -> key')
