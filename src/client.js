/**
 * dsh-korean-lang — browser half.
 *
 * Wrapped into `lib/client.js` by `scripts/build-client.mjs`; the wrapper adds
 * the module-loader registration and the exports, so this file stays plain
 * JavaScript that can be read and reviewed on its own.
 *
 * Three jobs, in order:
 *
 *   1. Publish 한국어 through the locale service, so
 *      Settings → General → Language lists it even when the dictionaries are
 *      still in flight (or unavailable).
 *   2. Fetch the namespace dictionaries from the host half and register one
 *      Korean dictionary per namespace. A namespace this pack does not
 *      translate is left unregistered, so the locale runtime resolves it
 *      through the declared fallback chain to English.
 *   3. Translate the plugins that hardcode their UI text instead of using the
 *      locale service. That layer matches whole text values against a fixed
 *      phrase map and never touches anything that could be conversation content,
 *      code, or an editing surface.
 */

/** The locale id this plugin owns; it becomes the stored `locale.preference`. */
const LOCALE_ID = 'ko'

/** The name shown in the language selector, written in Korean. */
const LOCALE_LABEL = '한국어'

/** Route prefix registered by the host half. */
const API = '/api/dsh-korean-lang'

/** Elements whose text is markup, code, or an editing surface, never UI copy. */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
  'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'OPTGROUP', 'SVG', 'MATH', 'CANVAS',
])

/**
 * An ancestor matching any of these owns user or model content, or an editing
 * surface. Rewriting a node inside one would corrupt a conversation, a code
 * sample, or text the reader is typing, so the whole subtree is left alone.
 */
const SKIP_ANCESTOR = [
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="log"]',
  '[role="textbox"]',
  'code',
  'pre',
  'kbd',
  'samp',
  'textarea',
  'input',
  'select',
  '[class*="markdown"]',
  '[class*="message"]',
  '[class*="transcript"]',
  '[class*="code-block"]',
  '[class*="codeblock"]',
].join(',')

/** Attributes that carry user-visible copy and are safe to translate. */
const TRANSLATABLE_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'aria-description']

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

/** True when the node sits inside markup, a form control, or conversation content. */
function isSkipped(node) {
  const element = node.nodeType === 1 ? node : node.parentElement
  if (element === null || element === undefined) return true
  if (SKIP_TAGS.has(element.tagName)) return true
  try {
    return element.closest(SKIP_ANCESTOR) !== null
  } catch {
    return true
  }
}

/**
 * Build the DOM layer for plugins that hardcode their copy.
 *
 * Matching is deliberately strict: a text node is replaced only when its whole
 * trimmed value is a known English phrase. Partial or fuzzy matching would
 * rewrite prose, and a conversation message that happens to read like a button
 * label is exactly what the ancestor rules exclude.
 *
 * @param phrases - English source text mapped to Korean text.
 * @returns start/stop controls and a running replacement count.
 */
function createDomTranslator(phrases) {
  const entries = Object.entries(phrases).filter(([source, target]) =>
    typeof source === 'string' && source.trim() !== '' && typeof target === 'string' && target !== '')
  const bySource = new Map(entries)
  // Track Korean values so an already-translated node is never matched again.
  const translated = new Set(entries.map(([, target]) => target))

  let observer = null
  let scheduled = false
  const pending = new Set()
  let applied = 0

  /** Replace one text node when its whole value is a known phrase. */
  const translateTextNode = (node) => {
    const value = node.nodeValue
    if (value === null || value === undefined) return
    const trimmed = value.trim()
    if (trimmed === '' || translated.has(trimmed)) return
    const target = bySource.get(trimmed)
    if (target === undefined) return
    if (isSkipped(node)) return
    // Keep the original surrounding whitespace: it is layout, not copy.
    node.nodeValue = value.replace(trimmed, target)
    applied++
  }

  /** Replace the translated attributes of one element. */
  const translateAttributes = (element) => {
    if (typeof element.getAttribute !== 'function' || isSkipped(element)) return
    for (const name of TRANSLATABLE_ATTRIBUTES) {
      const value = element.getAttribute(name)
      if (value === null || value === undefined) continue
      const target = bySource.get(value.trim())
      if (target === undefined) continue
      element.setAttribute(name, target)
      applied++
    }
  }

  /** Walk one subtree, translating text nodes and attributes. */
  const translateTree = (root) => {
    if (root.nodeType === 3) {
      translateTextNode(root)
      return
    }
    if (root.nodeType !== 1) return
    if (isSkipped(root)) return
    translateAttributes(root)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    let node = walker.nextNode()
    while (node !== null) {
      if (node.nodeType === 3) translateTextNode(node)
      else translateAttributes(node)
      node = walker.nextNode()
    }
  }

  /** Drain the queued mutations once per frame. */
  const flush = () => {
    scheduled = false
    const roots = [...pending]
    pending.clear()
    for (const root of roots) {
      try {
        if (root.isConnected !== false) translateTree(root)
      } catch (error) {
        warn('a DOM translation pass failed', error)
      }
    }
  }

  const enqueue = (node) => {
    pending.add(node.nodeType === 3 ? (node.parentElement ?? node) : node)
    if (scheduled) return
    scheduled = true
    // requestAnimationFrame is absent in non-visual contexts; fall back to a task.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
    else setTimeout(flush, 16)
  }

  return {
    /** Replacements applied so far; used by the smoke test. */
    get applied() { return applied },
    /** Translate the current document, then keep watching for new content. */
    start() {
      if (observer !== null) return
      translateTree(document.body)
      observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') {
            const value = record.target.nodeValue
            if (value !== null && bySource.has(value.trim())) enqueue(record.target)
            continue
          }
          for (const added of record.addedNodes) enqueue(added)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    },
    /** Stop watching. Replacements already applied stay in place. */
    stop() {
      if (observer === null) return
      observer.disconnect()
      observer = null
      pending.clear()
    },
  }
}

/**
 * Publish the Korean language, register its dictionaries, and start the DOM
 * layer for plugins that hardcode their copy.
 * @param ctx - the client context; `locale` is injected before apply runs.
 */
function apply(ctx) {
  const disposers = []
  let disposed = false

  const addDisposer = (dispose) => {
    if (typeof dispose === 'function') disposers.push(dispose)
  }

  const activeIsKorean = () => {
    try {
      return ctx.locale.getLocale().active === LOCALE_ID
    } catch {
      return false
    }
  }

  // Step 1 — the language itself. Skipped when another definition already owns
  // the id, which would throw on the duplicate.
  try {
    const locales = ctx.locale.getLocale().locales
    if (!locales.some(locale => locale.id === LOCALE_ID) && typeof ctx.locale.addLanguage === 'function') {
      addDisposer(ctx.locale.addLanguage({ id: LOCALE_ID, label: LOCALE_LABEL, fallback: 'en' }))
    }
  } catch (error) {
    warn('the language could not be registered', error)
  }

  /**
   * Register one namespace's Korean dictionary.
   * A namespace that already carries a Korean dictionary keeps its first owner;
   * the duplicate registration throws and is dropped.
   */
  const register = (namespace, dictionary) => {
    if (!dictionary || typeof dictionary !== 'object') return
    try {
      addDisposer(ctx.locale.register(namespace, LOCALE_ID, dictionary))
    } catch (error) {
      warn(`namespace "${namespace}" was not registered`, error)
    }
  }

  /** Fetch one endpoint and register every namespace it carries. */
  const load = async (path, pick, label) => {
    try {
      const payload = await fetchJson(path)
      if (disposed) return undefined
      const dictionaries = pick(payload)
      if (!dictionaries || typeof dictionaries !== 'object') return undefined
      for (const [namespace, dictionary] of Object.entries(dictionaries)) register(namespace, dictionary)
      return dictionaries
    } catch (error) {
      warn(`${label} are unavailable, those screens fall back to English`, error)
      return undefined
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

  // Step 2 — the translations. Core UI first, then the third-party namespaces,
  // then the DOM layer.
  void (async () => {
    await load(`${API}/dict/core`, payload => payload.core, 'core dictionaries')
    if (disposed) return
    await load(`${API}/dict/plugins`, payload => payload.plugins, 'plugin dictionaries')
    if (disposed) return

    // Step 3 — only for plugins whose text never reaches the locale service. It
    // follows the active locale rather than starting eagerly.
    let translator
    try {
      const payload = await fetchJson(`${API}/dom`)
      if (disposed) return
      const phrases = payload?.dom
      if (!phrases || Object.keys(phrases).length === 0) return
      translator = createDomTranslator(phrases)
    } catch (error) {
      warn('the DOM phrase map is unavailable; hardcoded plugin copy stays in English', error)
      return
    }

    const sync = () => {
      if (translator === undefined) return
      if (activeIsKorean()) translator.start()
      else translator.stop()
    }
    try {
      ctx.on('locale/change', sync)
    } catch {
      // A composition without locale events still gets the initial pass.
    }
    ctx.effect(() => () => { translator.stop() }, 'dsh-korean-lang: DOM translation')
    sync()
  })()
}

/** Required service: the locale registry this plugin extends. */
const inject = ['locale']
