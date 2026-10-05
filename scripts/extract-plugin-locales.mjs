/**
 * Extract the locale dictionaries a third-party DSH plugin registers.
 *
 * Installed plugins ship a prebuilt browser bundle that calls
 * `ctx.locale.register(namespace, { zh, en })` (or the three-argument
 * `register(namespace, tag, dict)` form). This script parses that bundle with
 * the TypeScript parser and resolves the namespace and both dictionaries into
 * `{ "<namespace>": { zh: {...}, en: {...} } }`, which is the source material
 * for the Korean files under `lib/locales/plugins/`.
 *
 * Usage: node scripts/extract-plugin-locales.mjs <out.json> <plugin-dir>...
 *   <plugin-dir> may be an installed package directory (e.g. a path under
 *   ~/.dsh/profiles/<profile>/node_modules). The package's `exports["./client"]`
 *   selects the bundle when the manifest declares one.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * The TypeScript compiler is not a dependency of this package; borrow the one in
 * a deepseek-harness checkout when this script runs inside one.
 */
function loadTypeScript() {
  const candidates = [
    process.env.DSH_TYPESCRIPT,
    join(ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js'),
    join(ROOT, '..', 'deepseek-harness-kr', 'node_modules', 'typescript', 'lib', 'typescript.js'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return require(candidate)
  }
  throw new Error('TypeScript is required for extraction; set DSH_TYPESCRIPT to typescript.js')
}

const ts = loadTypeScript()

const [outFile, ...pluginDirs] = process.argv.slice(2)
if (!outFile || pluginDirs.length === 0) {
  throw new Error('usage: extract-plugin-locales.mjs <out.json> <plugin-dir>...')
}

/** Resolve the browser half the way the client module system does. */
function clientEntry(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const exported = manifest.exports?.['./client']
  const candidates = []
  if (typeof exported === 'string') candidates.push(exported)
  else if (exported && typeof exported === 'object') {
    for (const key of ['default', 'import', 'require', 'browser', 'node']) {
      if (typeof exported[key] === 'string') candidates.push(exported[key])
    }
    for (const value of Object.values(exported)) if (typeof value === 'string') candidates.push(value)
  }
  candidates.push('./lib/client.js', './client/client.js', './dist/client.js')
  for (const candidate of candidates) {
    if (candidate.endsWith('.d.ts')) continue
    const full = join(root, candidate.replace(/^\.\//, ''))
    if (existsSync(full) && !full.endsWith('.d.ts')) return full
  }
  return undefined
}

function unwrap(node) {
  let cur = node
  while (cur && (ts.isSatisfiesExpression(cur) || ts.isAsExpression(cur) || ts.isParenthesizedExpression(cur))) {
    cur = cur.expression
  }
  return cur
}

/**
 * The text of a static string node, or undefined.
 * Bundlers emit backtick strings for ordinary literals, so a template with no
 * substitution is the same thing as a quoted string here.
 */
function literalText(node) {
  const value = unwrap(node)
  if (value === undefined) return undefined
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
  return undefined
}

/** The static name of an object-literal property, including `` {`key`: ...} ``. */
function propertyName(node) {
  const name = node.name
  if (name === undefined) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) return literalText(name.expression)
  return undefined
}

/** Declared initializers by name, anywhere in the file (bundles are minified). */
function declarations(source) {
  const map = new Map()
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (!map.has(node.name.text)) map.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return map
}

/**
 * Every name bound directly to a string literal, from declarations and later
 * assignments. Minified bundles reuse short names across scopes, so the
 * first-wins declaration map alone can resolve a name to the wrong initializer;
 * this map answers "which literal string is this name ever bound to".
 */
function stringConstants(source) {
  const map = new Map()
  const record = (name, initializer) => {
    if (!ts.isIdentifier(name) || map.has(name.text)) return
    const text = literalText(initializer)
    if (text !== undefined) map.set(name.text, text)
  }
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) record(node.name, node.initializer)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      record(node.left, node.right)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return map
}

/** Follow an identifier chain to the expression that defines it. */
function resolveValue(value, decls, depth = 0) {
  if (depth > 12) return undefined
  const node = unwrap(value)
  if (node === undefined) return undefined
  if (ts.isIdentifier(node)) {
    const next = decls.get(node.text)
    return next === undefined ? undefined : resolveValue(next, decls, depth + 1)
  }
  return node
}

/** Key -> string value of an object literal; spreads resolve through declarations. */
function dictionary(literal, decls, depth = 0) {
  const out = {}
  const node = literal && ts.isObjectLiteralExpression(literal) ? literal : undefined
  if (!node || depth > 12) return out
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      Object.assign(out, dictionary(resolveValue(prop.expression, decls, depth + 1), decls, depth + 1))
      continue
    }
    const entry = propertyOf(prop)
    if (!entry) continue
    const text = literalText(resolveValue(entry.initializer, decls))
    if (text !== undefined) out[entry.name] = text
  }
  return out
}

/** Property name and initializer of either object-literal property form. */
function propertyOf(prop) {
  if (ts.isPropertyAssignment(prop)) {
    const name = propertyName(prop)
    return name === undefined ? undefined : { name, initializer: prop.initializer }
  }
  if (ts.isShorthandPropertyAssignment(prop)) return { name: prop.name.text, initializer: prop.name }
  return undefined
}

/** One plugin's namespaces, keyed by namespace. */
function extractPlugin(dir) {
  const entry = clientEntry(dir)
  const label = dir.split(/[\\/]/).slice(-2).join('/')
  if (!entry) return { label, namespaces: {}, note: 'no browser half' }

  const source = ts.createSourceFile(entry, readFileSync(entry, 'utf8'), ts.ScriptTarget.ESNext, true)
  const decls = declarations(source)
  const strings = stringConstants(source)
  const namespaces = {}
  const unresolved = []

  /** Namespace text for a register() first argument. */
  const namespaceOf = (argument) => {
    const text = literalText(resolveValue(argument, decls))
    if (text !== undefined) return text
    const node = unwrap(argument)
    if (node && ts.isIdentifier(node)) return strings.get(node.text)
    return undefined
  }

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined
      if (method === 'register' && node.arguments.length >= 2) {
        const namespace = namespaceOf(node.arguments[0])
        if (namespace === undefined) {
          unresolved.push(`${label}: register(${node.arguments[0].getText(source).slice(0, 40)}, ...)`)
        } else {
          const second = node.arguments[1]
          const third = node.arguments[2]
          const slot = namespaces[namespace] ?? (namespaces[namespace] = {})

          // register(NS, { zh, en }) — the map may be an identifier.
          const secondResolved = resolveValue(second, decls)
          if (secondResolved && ts.isObjectLiteralExpression(secondResolved)) {
            for (const prop of secondResolved.properties.map(propertyOf)) {
              if (!prop || (prop.name !== 'zh' && prop.name !== 'en')) continue
              const dict = dictionary(resolveValue(prop.initializer, decls), decls)
              if (Object.keys(dict).length > 0) slot[prop.name] = Object.assign(slot[prop.name] ?? {}, dict)
            }
          }

          // register(NS, 'zh' | 'en', dict)
          const tag = second === undefined ? undefined : literalText(second)
          if ((tag === 'zh' || tag === 'en') && third) {
            const dict = dictionary(resolveValue(third, decls), decls)
            if (Object.keys(dict).length > 0) slot[tag] = Object.assign(slot[tag] ?? {}, dict)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  return { label, namespaces, unresolved, entry: relative(ROOT, entry) }
}

const result = {}
const report = []
for (const dir of pluginDirs) {
  const { label, namespaces, unresolved, note } = extractPlugin(resolvePath(dir))
  const found = Object.entries(namespaces)
  if (found.length === 0) {
    report.push(`${label}: ${note ?? 'no dictionaries found'}`)
  }
  for (const [namespace, dicts] of found) {
    const counts = Object.entries(dicts).map(([tag, d]) => `${tag}=${Object.keys(d).length}`).join(' ')
    report.push(`${label}: ${namespace} (${counts})`)
    result[namespace] = Object.assign(result[namespace] ?? {}, dicts)
  }
  for (const line of unresolved ?? []) report.push(`  ! unresolved namespace: ${line}`)
}

writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`)

const namespaces = Object.keys(result)
let enKeys = 0
let zhKeys = 0
for (const dicts of Object.values(result)) {
  enKeys += Object.keys(dicts.en ?? {}).length
  zhKeys += Object.keys(dicts.zh ?? {}).length
}

console.log(`namespaces: ${namespaces.length}`)
console.log(`en keys: ${enKeys}   zh keys: ${zhKeys}`)
console.log('---')
for (const line of report) console.log(`  ${line}`)
