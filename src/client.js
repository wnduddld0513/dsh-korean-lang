/**
 * dsh-korean-lang — browser half.
 *
 * Wrapped into `lib/client.js` by `scripts/build-client.mjs`; the wrapper adds
 * the module-loader registration and the exports, so this file stays plain
 * JavaScript that can be read and reviewed on its own.
 *
 * Scope: the base application, and nothing else. Only the namespaces the shipped
 * DSH client packages declare are registered here (`lib/locales/core.json`), so a
 * plugin this pack ships no text for keeps rendering from its own dictionaries;
 * one with no Korean dictionary of its own resolves through the declared
 * fallback chain and shows English. Nothing here walks the DOM, matches rendered
 * text, or rewrites a node — another plugin's UI is never touched.
 *
 * Two jobs, in order:
 *
 *   1. Publish 한국어 through the locale service, so
 *      Settings → General → Language lists it even when the dictionaries are
 *      still in flight (or unavailable).
 *   2. Fetch the base-application dictionaries from the host half and register
 *      one Korean dictionary per namespace. `fallback: 'en'` is what makes a key
 *      this pack does not carry — and every namespace it does not own — resolve
 *      to English instead of to the raw key.
 */

/** The locale id this plugin owns; it becomes the stored `locale.preference`. */
const LOCALE_ID = 'ko'

/** The name shown in the language selector, written in Korean. */
const LOCALE_LABEL = '한국어'

/** The language every key this pack does not translate resolves through. */
const LOCALE_FALLBACK = 'en'

/** Route prefix registered by the host half. */
const API = '/api/dsh-korean-lang'

/** Reporter for conditions that degrade the plugin without breaking the page. */
function warn(message, error) {
  console.warn(`[dsh-korean-lang] ${message}`, error ?? '')
}

/** GET one endpoint as JSON. */
async function fetchJson(path) {
  const response = await fetch(path, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/**
 * Publish the Korean language and register the base application's dictionaries.
 * @param ctx - the client context; `locale` is injected before apply runs.
 */
function apply(ctx) {
  const disposers = []
  let disposed = false

  const addDisposer = (dispose) => {
    if (typeof dispose === 'function') disposers.push(dispose)
  }

  // Step 1 — the language itself. Skipped when another definition already owns
  // the id, which would throw on the duplicate. The declared fallback is what
  // keeps everything this pack does not translate in English.
  try {
    const locales = ctx.locale.getLocale().locales
    if (!locales.some(locale => locale.id === LOCALE_ID) && typeof ctx.locale.addLanguage === 'function') {
      addDisposer(ctx.locale.addLanguage({ id: LOCALE_ID, label: LOCALE_LABEL, fallback: LOCALE_FALLBACK }))
    }
  } catch (error) {
    warn('the language could not be registered', error)
  }

  /**
   * Register one namespace's Korean dictionary.
   * Only namespaces of the base application are ever passed here. One that
   * already carries a Korean dictionary keeps its first owner; the duplicate
   * registration throws and is dropped.
   */
  const register = (namespace, dictionary) => {
    if (!dictionary || typeof dictionary !== 'object') return
    try {
      addDisposer(ctx.locale.register(namespace, LOCALE_ID, dictionary))
    } catch (error) {
      warn(`namespace "${namespace}" was not registered`, error)
    }
  }

  ctx.effect(() => () => {
    disposed = true
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // One stale registration must not strand the rest of the teardown.
      }
    }
  }, 'dsh-korean-lang: language and dictionaries')

  // Step 2 — the translations. The host serves the base application's namespace
  // map and nothing else; a namespace outside it is never registered, so the
  // plugin that owns it resolves its own text, in English when it has no Korean.
  void (async () => {
    try {
      const payload = await fetchJson(`${API}/dict/core`)
      if (disposed) return
      const dictionaries = payload?.core
      if (!dictionaries || typeof dictionaries !== 'object') return
      for (const [namespace, dictionary] of Object.entries(dictionaries)) register(namespace, dictionary)
    } catch (error) {
      warn('the dictionaries are unavailable; the interface falls back to English', error)
    }
  })()
}

/** Required service: the locale registry this plugin extends. */
const inject = ['locale']
