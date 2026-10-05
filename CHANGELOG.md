# Changelog

## 1.1.0

Third-party plugin coverage.

- **Plugin dictionaries** — Korean for the plugins that use the DSH locale
  service: **8 namespaces / 2,069 strings** (`dsh-market`, `dsh-automation`,
  `agency`, `archive-manager-workspace`, `michengai.btw`, `michengai.codexUi`,
  `im-connect`, `skills-manager`). New files go in `lib/locales/plugins/`.
- **DOM translation layer** — plugins that hardcode their UI text never reach the
  locale service, so a phrase map now translates them in place. It matches whole
  text values only, follows the active locale, tracks content added later, and
  never touches conversation content, code blocks, code editors, or form
  controls. Shipped for `@michengai/dsh-pua` (97 phrases) in `lib/locales/dom/`.
- `scripts/extract-plugin-locales.mjs` recovers `en`/`zh` dictionaries from an
  installed plugin's minified browser bundle, so plugin coverage can be extended
  as plugins update.
- The client bundle grows from 4.3 KiB to 11.2 KiB; dictionaries are still served
  by the host over three read-only, ETag-validated routes.
- `npm test` now also validates the DOM phrase maps and drives the DOM layer
  against a real jsdom document (jsdom is a devDependency).

## 1.0.0

First release.

- Adds **한국어** to Settings → General → Language through the documented client
  extension point (`ctx.locale.addLanguage` + `ctx.locale.register`), with no
  harness patch or fork.
- Korean dictionaries for **61 core namespaces / 2,487 strings**, covering
  conversation, chat, workspace, the settings family, the sidebar family,
  trajectory, plugin manager, scheduling, session inspector, permissions, plans,
  goals, jobs, subagents, and more.
- Dictionaries are served by the host half over two read-only, ETag-validated
  routes, so the client bundle stays at 4.3 KiB and translations can change
  without a rebuild.
- Untranslated namespaces resolve through the declared `en` fallback instead of
  surfacing raw keys; a missing host degrades to "한국어 selectable, English text".
- `lib/locales/plugins/` accepts one JSON file per third-party plugin so those
  namespaces can be translated without touching this package's code.
