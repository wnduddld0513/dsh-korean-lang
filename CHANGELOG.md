# Changelog

## 1.2.0

Base application only. The pack now translates what DSH itself ships and stays
out of everything else.

- **Removed: third-party plugin dictionaries.** The `lib/locales/plugins/`
  directory (8 namespaces / 2,069 strings for `dsh-market`, `dsh-automation`,
  `agency`, `archive-manager-workspace`, `michengai.btw`, `michengai.codexUi`,
  `im-connect`, `skills-manager`) is gone, along with the
  `/api/dsh-korean-lang/dict/plugins` route that served it. Those namespaces
  belong to plugins that register their own dictionaries, so filling them in from
  here changed another plugin's rendering. Installing this pack now leaves every
  plugin's UI exactly as that plugin draws it.
- **Removed: the DOM translation layer.** `lib/locales/dom/` (the
  `@michengai/dsh-pua` phrase map), the `MutationObserver` walker, the skip lists,
  and the translatable-attribute list are gone, along with the
  `/api/dsh-korean-lang/dom` route and `scripts/extract-plugin-locales.mjs`.
  Reading another plugin's rendered nodes and rewriting their text was the other
  way this pack could reach outside the base app.
- The host half now registers **one** read-only route, `dict/core`, which serves
  `lib/locales/core.json` — the pack's only dictionary file, covering the 61
  namespaces of the DSH client packages.
- The client bundle drops from 11.2 KiB to **4.8 KiB**, and the package has no
  dependencies at all (jsdom is no longer a devDependency).
- **Untranslated content is English.** `fallback: 'en'` was already declared;
  with the removal of the DOM layer that declaration is now the only path for
  anything this pack does not translate, so it is verified explicitly: a key the
  pack does not carry resolves to the namespace's English text, a namespace the
  pack does not own resolves to that plugin's own English text, and only a key
  nobody translates falls through to the key itself.
- `scripts/check.mjs` and `scripts/smoke.mjs` were rewritten to enforce the
  scope rather than to cover the removed layers: the check fails if a plugin or
  DOM directory reappears, if a third-party namespace is ever extracted into
  `core.json`, or if either half still contains DOM-layer code; the smoke test
  runs the bundle with only `window`, `fetch` and `console` in scope and replays
  the locale runtime's `ko -> en -> key` chain.

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
