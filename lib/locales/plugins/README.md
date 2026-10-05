# Plugin dictionaries

Third-party DSH plugins register their own locale namespaces. Drop one JSON file
per plugin into this directory and `dsh-korean-lang` publishes it alongside the
core dictionaries, so those plugin screens render in Korean too.

## File format

The file is a plain object keyed by namespace, exactly like `../core.json`:

```json
{
  "dsh-goal": {
    "budgetLabel": "토큰 한도(0 = 무제한):",
    "artifactSaved": "✅ 산출물을 저장했습니다 (.dsh/goals/)"
  }
}
```

- **Namespace** — the name the plugin passes to `ctx.locale.register(ns, ...)`.
  Find it in the plugin's client bundle (`ctx.locale.register(`) or in its
  `locale/` directory. It is often the plugin's own package name.
- **Keys** — copy them verbatim from the plugin's English or Chinese dictionary;
  a key that is not in the plugin's own dictionary is simply never requested.
- **Values** — Korean text. Keep every `{placeholder}` byte-identical, and keep
  leading/trailing spaces when the value is a composed fragment.

## Rules

- One file per plugin, named `NN-plugin-name.json`; files are merged in filename
  order, so a later file overrides an earlier one for the same key.
- A namespace must not appear both here and in `../core.json`, and not twice
  across these files; `npm test` rejects both.
- A namespace this plugin does not translate is not registered at all — the
  locale runtime falls back to English for it, which is the intended behaviour
  for partial coverage.

After adding a file, run `npm test` to validate it.
