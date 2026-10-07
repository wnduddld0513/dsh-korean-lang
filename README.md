# dsh-korean-lang

**DeepSeek Harness(DSH) 웹 UI 한국어 언어팩 플러그인.**

DSH **기본 앱**에 한국어를 적용하고, **설정 → 일반 → 언어** 목록에 `한국어`를 추가합니다. 하네스를 수정하거나 포크를 유지할 필요 없이 플러그인 하나만 설치하면 됩니다.

**다른 플러그인은 건드리지 않습니다.** 이 팩은 기본 앱의 네임스페이스 외에는 어떤 사전도 싣지 않으므로, 설치해도 서드파티 플러그인이 그리는 화면은 달라지지 않습니다.

[English](#english) · MIT License

---

## 무엇을 하나요

| | |
|---|---|
| 🌐 **기본 앱 번역** | 61개 네임스페이스 / **2,487개 문자열** |
| 🧩 **다른 플러그인 영향 없음** | 서드파티 플러그인 네임스페이스 사전 0개, DOM 번역층 없음 |
| 🈳 **네이티브 언어 항목** | 설정 → 일반 → 언어에 `한국어`가 항목으로 표시 |
| 🪶 **가벼운 클라이언트 번들** | 4.8 KiB — 사전은 호스트가 HTTP로 제공하고 브라우저가 필요할 때 받아옵니다 |
| 🇬🇧 **영어 폴백** | 번역이 없는 키와 네임스페이스는 영어로 해석됩니다 |

### 번역 범위

**포함** — DSH 클라이언트 패키지가 스스로 선언하는 네임스페이스 61개: `conversation`, `chat`, `workspace`, `settings` 계열, `sidebar` 계열, `trajectory`, `pluginManager`, `schedule`, `permission.access`, `plan`, `goal`, `job`, `subagent` 등. 전체 목록은 [`lib/locales/core.json`](lib/locales/core.json) 한 파일입니다.

**제외** — 이 팩은 다음을 하지 않습니다.

- **서드파티 플러그인 사전을 싣지 않습니다.** 1.1.0까지는 로케일 서비스를 쓰는 플러그인 8종의 사전을 함께 배포했지만, 그 사전은 남의 네임스페이스를 대신 채우는 것이었습니다. 1.2.0에서 제거했습니다.
- **DOM 번역층이 없습니다.** 1.1.0까지는 문자열을 번들에 하드코딩한 플러그인을 위해 렌더링된 텍스트를 문구 사전과 맞춰 치환했습니다. 다른 플러그인의 화면을 읽고 고치는 방식이라 1.2.0에서 제거했습니다.

그래서 서드파티 플러그인의 UI는 **그 플러그인이 스스로 등록한 사전**으로만 그려집니다. 한국어 사전이 없는 플러그인은 아래 폴백 체인을 타고 영어로 표시됩니다.

---

## 설치

DSH 프로필에 플러그인을 추가합니다. 데스크톱 앱은 **한 번 실행해 프로필을 초기화한 뒤 완전히 종료**하고 진행하세요.

```bash
# npm에 배포된 경우
dsh plugin --profile desktop add dsh-korean-lang

# 이 저장소에서 직접 설치
dsh plugin --profile desktop add github:wnduddld0513/dsh-korean-lang

# 릴리스 타르볼로 설치
dsh plugin --profile desktop add https://github.com/wnduddld0513/dsh-korean-lang/releases/latest/download/dsh-korean-lang-1.2.0.tgz
```

설치 후 앱을 다시 실행하고 **설정 → 일반 → 언어 → 한국어**를 선택하세요.

> 프로필 이름은 `desktop` 대신 실제 사용 중인 프로필로 바꾸세요 (`~/.dsh/profiles/` 아래 디렉터리 이름).

### 선택 항목 미리 지정

`cordis.patch.yml`에 언어 기본값을 미리 넣어 두면 첫 실행부터 한국어로 시작합니다.

```yaml
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: ko
```

---

## 동작 방식

DSH는 클라이언트 플러그인이 언어를 추가할 수 있도록 공식 확장점을 제공합니다. 이 플러그인은 그 확장점만 사용합니다 — 렌더링된 화면을 읽거나 고치는 코드는 없습니다.

```
┌─ 호스트 (Node) ─────────────────────────────┐
│ lib/index.js                                │
│  · webServer 라우트 1개 등록 (읽기 전용)     │
│    /api/dsh-korean-lang/dict/core           │
│  · ETag + 304 재검증                        │
└─────────────────────────────────────────────┘
                     │  JSON
┌─ 브라우저 ──────────────────────────────────┐
│ lib/client.js (4.8 KiB)                     │
│  1. ctx.locale.addLanguage({ id: 'ko',      │
│       label: '한국어', fallback: 'en' })     │
│  2. core.json의 네임스페이스마다             │
│     ctx.locale.register(ns, 'ko', dict)     │
└─────────────────────────────────────────────┘
```

- 사전은 클라이언트 번들에 포함되지 않습니다. 호스트가 제공하고 브라우저가 받아오므로 번들이 작고, 번역을 고쳐도 번들을 다시 만들 필요가 없습니다.
- 호스트가 제공하는 것은 `dict/core` 하나뿐이며, 그 응답은 `core.json`의 네임스페이스 맵 그대로입니다. 다른 플러그인이 쓰는 경로는 등록하지 않습니다.
- `<html lang>`은 로케일 서비스가 활성 언어에 맞춰 자동으로 갱신합니다.

### 영어 폴백

`addLanguage`에 선언한 `fallback: 'en'`이 이 팩의 두 번째 요구사항을 담당합니다.

| 상황 | 표시 |
|---|---|
| 이 팩이 번역한 키 | 한국어 |
| 기본 앱 네임스페이스에 있지만 이 팩이 번역하지 않은 키 | 그 네임스페이스의 **영어** 문자열 |
| 이 팩이 사전을 싣지 않은 네임스페이스 (서드파티 플러그인) | 그 플러그인이 등록한 **영어** 문자열 |
| 아무도 번역하지 않은 키 | 키 문자열 그대로 (DSH 런타임의 마지막 단계이며, 이 팩이 바꿀 수 있는 범위가 아닙니다) |

`common` 네임스페이스(공용 버튼·상태 문구 41개)는 기본 앱의 어휘라서 함께 번역합니다. 로케일 런타임은 자기 네임스페이스에서 못 찾은 키를 `common`에서 한 번 더 찾으므로, 로케일 서비스를 쓰는 플러그인이 `common`의 공용 어휘를 끌어다 쓰면 그 단어는 한국어로 보입니다. 실제로 설치된 서드파티 플러그인 5종(`dshmarket`, `billion-context`, `dsh-model-visibility`, `dsh-plugin-subscriptions`, `@michengai/dsh-pua`)을 확인한 결과 `common`을 참조하는 곳은 없었습니다.

---

## 개발

의존성이 없습니다. `npm install` 없이 바로 실행됩니다.

```bash
npm run build   # src/client.js → lib/client.js 번들 생성
npm test        # 구조 검증(check) + 스모크 테스트(smoke)
```

| 경로 | 역할 |
|---|---|
| `src/client.js` | 브라우저 절반의 읽기 쉬운 소스 (직접 수정하는 파일) |
| `lib/client.js` | `npm run build`가 생성하는 번들 (커밋됨) |
| `lib/index.js` | 호스트 절반 — 사전 제공 라우트 |
| `lib/locales/core.json` | 기본 앱 네임스페이스 한국어 사전 (이 팩의 유일한 사전) |
| `scripts/extract-locales.mjs` | 하네스 소스에서 기본 앱 사전을 추출하는 유지보수 도구 |

`scripts/check.mjs`는 매니페스트와 사전 형식을 검사할 뿐 아니라 **이 팩의 범위를 강제**합니다: `lib/locales/`에 `core.json` 외의 파일이 생기면, `lib/locales/plugins/`나 `lib/locales/dom/`이 되살아나면, 사전에 서드파티 네임스페이스가 섞이면, 어느 한쪽 절반에라도 DOM 번역층 흔적(`MutationObserver`, `createTreeWalker`, `TRANSLATABLE_ATTRIBUTES`)이 남으면 실패합니다.

`scripts/smoke.mjs`는 번들을 `window`·`fetch`·`console` 세 개만 주고 실행합니다. DOM 층이 있었다면 그 자리에서 실패합니다. 이어서 호스트 절반을 스텁 웹 서버에 물려 라우트가 하나뿐인지 확인하고, 로케일 런타임의 `translate`/`lookup`/`fallbackChain`을 그대로 옮겨 `ko → en → 키` 순서를 검증합니다.

`scripts/extract-locales.mjs`는 deepseek-harness 체크아웃의 `packages/` 아래에서 `ctx.locale.register(ns, { zh, en, ko })` 호출을 TypeScript AST로 분석해 사전을 뽑아냅니다. 하네스 자체 패키지만 보므로, 이 도구로 다시 생성해도 서드파티 네임스페이스는 들어오지 않습니다.

---

## English

A Korean language pack for the DeepSeek Harness web UI, scoped to the **base
application**. It uses the documented client extension point and nothing else: it
publishes `한국어` through `ctx.locale.addLanguage` and registers one Korean
dictionary per namespace with `ctx.locale.register`. No harness patching, no fork.

**It does not touch other plugins.** The pack ships no dictionary for a
third-party namespace and contains no DOM translation layer, so installing it
cannot change what another plugin renders.

- **61 base-application namespaces / 2,487 strings.**
- **Zero** third-party plugin namespaces, and **no DOM layer** — both were removed
  in 1.2.0. Plugin text is rendered by that plugin's own dictionaries.
- Dictionaries come from one read-only, ETag-validated host route, so the client
  bundle stays at **4.8 KiB**.
- `fallback: 'en'` is declared on the language, so a key this pack does not carry —
  and every namespace it does not own — resolves to English rather than to the raw
  key. A key nobody translates still shows as the key: that is the runtime's last
  step, outside this pack's reach.
- `scripts/check.mjs` enforces the scope in CI and `npm test` proves it end to end.

Install with `dsh plugin --profile <profile> add dsh-korean-lang`, restart, then
pick **설정 → 일반 → 언어 → 한국어**.

---

## 라이선스

MIT © [wnduddld0513](https://github.com/wnduddld0513)
