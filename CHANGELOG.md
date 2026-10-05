# Changelog

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
