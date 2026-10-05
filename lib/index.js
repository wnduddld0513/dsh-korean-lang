/**
 * dsh-korean-lang — host half.
 *
 * The browser half owns the language switch and every dictionary registration
 * (`lib/client.js`); this half only publishes the dictionaries over HTTP. Keeping
 * the dictionaries out of the client bundle keeps that bundle small and lets the
 * translations change without rebuilding it.
 *
 * Two read-only endpoints, both keyed by the package id so they cannot collide
 * with another plugin's routes:
 *
 *   GET /api/dsh-korean-lang/dict/core     — the core UI namespaces
 *   GET /api/dsh-korean-lang/dict/plugins  — dictionaries for third-party plugins
 *
 * The host deliberately imports nothing from the harness: the plugin must load
 * on any profile whose loader accepts this row.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE_FILE = join(HERE, 'locales', 'core.json')
const PLUGINS_DIR = join(HERE, 'locales', 'plugins')

/** Route prefix owned by this plugin. */
const API = '/api/dsh-korean-lang'

/** This plugin's loader row id and package name. */
export const name = 'dsh-korean-lang'

/** Read and parse one JSON file, or undefined when it is absent or malformed. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Merge every `locales/plugins/*.json` file into one namespace map.
 * A namespace contributed by two files keeps the later file's keys.
 * @returns the merged plugin dictionaries, empty when no file contributes.
 */
function readPluginDictionaries() {
  const merged = {}
  if (!existsSync(PLUGINS_DIR)) return merged
  for (const entry of readdirSync(PLUGINS_DIR).sort()) {
    if (!entry.endsWith('.json')) continue
    const file = readJson(join(PLUGINS_DIR, entry))
    if (file === undefined || typeof file !== 'object' || file === null) continue
    for (const [ns, dict] of Object.entries(file)) {
      if (typeof dict !== 'object' || dict === null) continue
      merged[ns] = Object.assign(merged[ns] ?? {}, dict)
    }
  }
  return merged
}

/**
 * Answer with JSON, revalidating through an ETag so a reload costs one 304.
 * @param request - the incoming request (only method and if-none-match are read).
 * @param response - the response to write.
 * @param value - the JSON-serializable payload.
 */
function sendJson(request, response, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const etag = `"${createHash('sha1').update(body).digest('hex')}"`
  const cacheControl = 'public, max-age=300, must-revalidate'
  const ifNoneMatch = request?.headers?.['if-none-match']
  if (ifNoneMatch === etag || ifNoneMatch === '*' || ifNoneMatch === `W/${etag}`) {
    response.writeHead(304, { etag, 'cache-control': cacheControl })
    response.end()
    return
  }
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': cacheControl,
    etag,
  })
  response.end(request?.method === 'HEAD' ? undefined : body)
}

/**
 * Serve one dictionary endpoint, rejecting every method but GET and HEAD.
 * @param load - produces the payload for an accepted request.
 * @param label - the endpoint name used in the failure log line.
 * @returns a request handler.
 */
function dictionaryHandler(load, label) {
  return (request, response) => {
    if (request?.method !== 'GET' && request?.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: 'method not allowed' }))
      return
    }
    try {
      sendJson(request, response, load())
    } catch (error) {
      console.error(`[dsh-korean-lang] could not serve ${label}:`, error)
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: 'internal error' }))
    }
  }
}

/**
 * Publish the Korean dictionaries over the profile's web server.
 * @param ctx - the plugin context; activation waits for the web server service.
 */
export function apply(ctx) {
  // Read once: the dictionaries ship with the package and never change while it runs.
  let core
  let plugins
  const coreDictionaries = () => (core ??= readJson(CORE_FILE) ?? {})
  const pluginDictionaries = () => (plugins ??= readPluginDictionaries())

  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx?.webServer
    if (!server || typeof server.register !== 'function') {
      webCtx?.logger?.warn?.('[dsh-korean-lang] no web server available; Korean falls back to English')
      return
    }
    webCtx.effect(() => {
      const disposers = [
        server.register({
          kind: 'exact',
          path: `${API}/dict/core`,
          handler: dictionaryHandler(() => ({ core: coreDictionaries() }), 'core dictionaries'),
        }),
        server.register({
          kind: 'prefix',
          path: `${API}/dict/plugins`,
          handler: dictionaryHandler(() => ({ plugins: pluginDictionaries() }), 'plugin dictionaries'),
        }),
      ]
      return () => {
        for (const dispose of disposers) {
          try {
            if (typeof dispose === 'function') dispose()
          } catch {
            // A route that already went away must not strand the other one.
          }
        }
      }
    }, 'dsh-korean-lang: dictionary routes')
  })
}
