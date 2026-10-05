/**
 * Extract the Korean locale dictionaries from a deepseek-harness checkout.
 *
 * Walks every client registration site `<ctx>.locale.register(NS, { zh, en, ko })`,
 * resolves the namespace expression and the `ko` dictionary (following imports and
 * spreads), and emits `{ "<namespace>": { "<key>": "<korean text>" } }`.
 *
 * Usage: node scripts/extract-locales.mjs <harness-root> <out.json>
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HARNESS = process.argv[2]
const OUT = process.argv[3]
if (!HARNESS || !OUT) throw new Error('usage: extract-locales.mjs <harness-root> <out.json>')

const ts = require(join(HARNESS, 'node_modules', 'typescript', 'lib', 'typescript.js'))

/** Every .ts/.tsx file under the packages tree, excluding tests and build output.
 *  Test fixtures register English stand-ins for `ko`, so they must not be extracted. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'lib' || entry === 'dist' || entry === 'tests') continue
    const full = join(dir, entry)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const files = walk(join(HARNESS, 'packages'))
const sourceCache = new Map()
function parse(file) {
  if (!sourceCache.has(file)) {
    let text
    try { text = readFileSync(file, 'utf8') } catch { text = null }
    sourceCache.set(file, text === null ? null : ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true))
  }
  return sourceCache.get(file)
}

/** Look through satisfies/as/parenthesized wrappers. */
function unwrap(node) {
  let cur = node
  while (cur && (ts.isSatisfiesExpression(cur) || ts.isAsExpression(cur) || ts.isParenthesizedExpression(cur))) {
    cur = cur.expression
  }
  return cur
}

/** Module-scope `const <name> = <initializer>` map for one source file.
 *  `NS` is often declared without `export`, so exported declarations are not enough. */
const exportCache = new Map()
function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file)
  const source = parse(file)
  const map = new Map()
  if (source) {
    for (const stmt of source.statements) {
      if (!ts.isVariableStatement(stmt)) continue
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) map.set(decl.name.text, decl.initializer)
      }
    }
  }
  exportCache.set(file, map)
  return map
}

/** `export { alias as name } from './mod'` bindings, including local re-exports. */
const reexportCache = new Map()
function reexportsOf(file) {
  if (reexportCache.has(file)) return reexportCache.get(file)
  const source = parse(file)
  const map = new Map()
  if (source) {
    for (const stmt of source.statements) {
      if (!ts.isExportDeclaration(stmt) || !stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue
      const spec = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : undefined
      for (const el of stmt.exportClause.elements) {
        map.set(el.name.text, { spec, exported: (el.propertyName ?? el.name).text })
      }
    }
  }
  reexportCache.set(file, map)
  return map
}

/** Resolve a relative module specifier to an existing .ts/.tsx source file. */
function resolveModule(fromFile, spec) {
  if (!spec.startsWith('.')) return undefined
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

/** Import bindings of one source file: local name -> resolved absolute module path. */
const importCache = new Map()
function importsOf(file) {
  if (importCache.has(file)) return importCache.get(file)
  const source = parse(file)
  const map = new Map()
  if (source) {
    for (const stmt of source.statements) {
      if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue
      if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
      const target = resolveModule(file, stmt.moduleSpecifier.text)
      if (!target) continue
      const bindings = stmt.importClause.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          map.set(el.name.text, { file: target, exported: (el.propertyName ?? el.name).text })
        }
      }
    }
  }
  importCache.set(file, map)
  return map
}

/** Resolve an identifier to the object literal that defines it, following imports and re-exports. */
function resolveInitializer(name, file, depth = 0) {
  if (depth > 8) return undefined
  const own = exportsOf(file).get(name)
  if (own !== undefined) {
    const target = unwrap(own)
    if (target && ts.isIdentifier(target)) return resolveInitializer(target.text, file, depth + 1)
    return target
  }
  const reexport = reexportsOf(file).get(name)
  if (reexport) {
    // Local re-export (`export { x }`) has no specifier: stay in this module.
    if (reexport.spec === undefined) return resolveInitializer(reexport.exported, file, depth + 1)
    const target = resolveModule(file, reexport.spec)
    if (target) return resolveInitializer(reexport.exported, target, depth + 1)
  }
  const imported = importsOf(file).get(name)
  if (imported) return resolveInitializer(imported.exported, imported.file, depth + 1)
  return undefined
}

/** Declared keys and string values of an object literal, following spreads. */
function keysOfLiteral(literal, file, depth = 0) {
  const out = {}
  if (!literal || !ts.isObjectLiteralExpression(literal) || depth > 8) return out
  for (const prop of literal.properties) {
    if (ts.isSpreadAssignment(prop) && ts.isIdentifier(prop.expression)) {
      const spread = unwrap(resolveInitializer(prop.expression.text, file, depth))
      Object.assign(out, keysOfLiteral(spread, file, depth + 1))
      continue
    }
    if (!ts.isPropertyAssignment(prop)) continue
    const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : undefined
    if (name === undefined) continue
    const value = unwrap(prop.initializer)
    if (value && ts.isStringLiteral(value)) out[name] = value.text
    else if (value && ts.isNoSubstitutionTemplateLiteral(value)) out[name] = value.text
  }
  return out
}

/** Property name and initializer for both `key: value` and shorthand `key` forms. */
function propertyOf(prop) {
  if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
    return { name: prop.name.text, initializer: prop.initializer }
  }
  // `{ zh, en, ko }` shorthand: the value is the identifier itself.
  if (ts.isShorthandPropertyAssignment(prop)) {
    return { name: prop.name.text, initializer: prop.name }
  }
  return undefined
}

/**
 * Fallback for namespace identifiers declared inside a function body
 * (`apply()` often holds `const namespace = 'sidebarBrowser'`).
 */
const localConstCache = new Map()
function literalConstAnywhere(file, name) {
  if (!localConstCache.has(file)) {
    const source = parse(file)
    const found = new Map()
    if (source) {
      const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          const init = unwrap(node.initializer)
          if (init && ts.isStringLiteral(init) && !found.has(node.name.text)) found.set(node.name.text, init.text)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    localConstCache.set(file, found)
  }
  return localConstCache.get(file).get(name)
}

/**
 * `[['zh', {...}], ['ko', {...}]]` pair lists registered in a loop
 * (`for (const [locale, dict] of dictionaries) register(NS, locale, dict)`).
 */
function inlinePairDict(file, tag) {
  const source = parse(file)
  if (!source) return undefined
  let hit
  const visit = (node) => {
    if (hit) return
    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) {
        if (!ts.isArrayLiteralExpression(el) || el.elements.length !== 2) continue
        const [tagNode, dictNode] = el.elements
        if (!tagNode || !ts.isStringLiteral(tagNode) || tagNode.text !== tag) continue
        const literal = unwrap(dictNode)
        if (literal && ts.isObjectLiteralExpression(literal)) { hit = literal; return }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hit
}

/** Namespace text for a register() first argument. */
function namespaceOf(node, file) {
  const value = unwrap(node)
  if (!value) return undefined
  if (ts.isStringLiteral(value)) return value.text
  if (ts.isIdentifier(value)) {
    const init = unwrap(resolveInitializer(value.text, file))
    if (init && ts.isStringLiteral(init)) return init.text
    const local = literalConstAnywhere(file, value.text)
    if (local !== undefined) return local
  }
  return undefined
}

const result = {}
const report = []

for (const file of files) {
  const source = parse(file)
  if (!source) continue
  const text = source.getFullText()
  if (!text.includes('locale.register')) continue

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isIdentifier(callee) ? callee.text : undefined
      if (method === 'register' && node.arguments.length >= 2) {
        const [nsArg, second, third] = node.arguments
        const ns = namespaceOf(nsArg, file)
        if (ns) {
          // Typed form: register(NS, { zh, en, ko })
          if (second && ts.isObjectLiteralExpression(unwrap(second))) {
            const literal = unwrap(second)
            const koProp = literal.properties.map(propertyOf).find(p => p?.name === 'ko')
            if (koProp) {
              const koInit = unwrap(koProp.initializer)
              const dict = ts.isIdentifier(koInit)
                ? keysOfLiteral(unwrap(resolveInitializer(koInit.text, file)), file)
                : keysOfLiteral(koInit, file)
              if (Object.keys(dict).length > 0) {
                result[ns] = Object.assign(result[ns] ?? {}, dict)
                report.push([ns, Object.keys(dict).length, file.slice(HARNESS.length + 1)])
              }
            }
          }
          // Single-locale form: register(NS, 'ko', dict)
          if (second && ts.isStringLiteral(second) && second.text === 'ko' && third) {
            const dictInit = unwrap(third)
            const dict = ts.isIdentifier(dictInit)
              ? keysOfLiteral(unwrap(resolveInitializer(dictInit.text, file)), file)
              : keysOfLiteral(dictInit, file)
            if (Object.keys(dict).length > 0) {
              result[ns] = Object.assign(result[ns] ?? {}, dict)
              report.push([ns, Object.keys(dict).length, `${file.slice(HARNESS.length + 1)} (inline)`])
            }
          }
          // Loop form over an inline pair list: register(NS, locale, dict) where the
          // locale tag is a loop variable resolved from `[['zh',{...}],['ko',{...}]]`.
          if (second && ts.isIdentifier(unwrap(second)) && ts.isIdentifier(unwrap(third ?? second))) {
            const literal = inlinePairDict(file, 'ko')
            if (literal) {
              const dict = keysOfLiteral(literal, file)
              if (Object.keys(dict).length > 0) {
                result[ns] = Object.assign(result[ns] ?? {}, dict)
                report.push([ns, Object.keys(dict).length, `${file.slice(HARNESS.length + 1)} (pair list)`])
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const namespaces = Object.keys(result).sort()
const sorted = {}
let total = 0
for (const ns of namespaces) {
  const entries = result[ns]
  const keys = Object.keys(entries).sort()
  sorted[ns] = Object.fromEntries(keys.map(k => [k, entries[k]]))
  total += keys.length
}

writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`)

console.log(`namespaces: ${namespaces.length}`)
console.log(`total keys: ${total}`)
console.log('---')
for (const [ns, count, file] of report.sort()) console.log(`${String(count).padStart(4)}  ${ns.padEnd(28)} ${file}`)
