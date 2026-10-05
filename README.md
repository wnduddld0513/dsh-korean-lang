# dsh-korean-lang

**DeepSeek Harness(DSH) 웹 UI 한국어 언어팩 플러그인.**

DSH 코어 UI와 서드파티 플러그인 UI에 한국어를 적용하고, **설정 → 일반 → 언어** 목록에 `한국어`를 추가합니다. 하네스를 수정하거나 포크를 유지할 필요 없이 플러그인 하나만 설치하면 됩니다.

[English](#english) · MIT License

---

## 무엇을 하나요

| | |
|---|---|
| 🌐 **코어 UI 전체 번역** | 61개 네임스페이스 / **2,487개 문자열** |
| 🧩 **설치된 플러그인 번역** | 로케일 서비스를 쓰는 플러그인 8종 / **2,069개 문자열** |
| 🪟 **하드코딩 UI 번역** | 로케일 서비스를 쓰지 않는 플러그인을 위한 DOM 번역층 |
| 🈳 **네이티브 언어 항목** | 설정 → 일반 → 언어에 `한국어`가 항목으로 표시 |
| 🪶 **가벼운 클라이언트 번들** | 11.2 KiB — 사전은 호스트가 HTTP로 제공하고 브라우저가 필요할 때 받아옵니다 |
| 🔁 **우아한 성능 저하** | 번역이 없는 네임스페이스는 영어로 폴백하며, 빈 키가 화면에 노출되지 않습니다 |

### 번역 범위

**코어** — `conversation`, `chat`, `workspace`, `settings` 계열, `sidebar` 계열, `trajectory`, `pluginManager`, `schedule`, `session-inspector`, `permission.access`, `plan`, `goal`, `job`, `subagent` 등 61개 네임스페이스. 전체 목록은 [`lib/locales/core.json`](lib/locales/core.json).

**플러그인** — DSH 로케일 서비스(`ctx.locale.register`)를 사용하는 플러그인은 사전으로 번역합니다. 현재 포함된 네임스페이스는 [`lib/locales/plugins/`](lib/locales/plugins/README.md) 참고.

**하드코딩 UI** — 문자열을 번들에 직접 박아 넣은 플러그인은 사전이 닿지 않습니다. 이 경우에만 DOM 번역층이 동작하며, 규칙은 아래와 같습니다.

---

## 설치

DSH 프로필에 플러그인을 추가합니다. 데스크톱 앱은 **한 번 실행해 프로필을 초기화한 뒤 완전히 종료**하고 진행하세요.

```bash
# npm에 배포된 경우
dsh plugin --profile desktop add dsh-korean-lang

# 이 저장소에서 직접 설치
dsh plugin --profile desktop add github:wnduddld0513/dsh-korean-lang

# 릴리스 타르볼로 설치
dsh plugin --profile desktop add https://github.com/wnduddld0513/dsh-korean-lang/releases/latest/download/dsh-korean-lang-1.1.0.tgz
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

DSH는 클라이언트 플러그인이 언어를 추가할 수 있도록 공식 확장점을 제공합니다. 이 플러그인은 그 확장점을 먼저 사용하고, 확장점이 닿지 않는 플러그인에만 DOM 층을 적용합니다.

```
┌─ 호스트 (Node) ─────────────────────────────┐
│ lib/index.js                                │
│  · webServer 라우트 3개 등록 (읽기 전용)     │
│    /api/dsh-korean-lang/dict/core           │
│    /api/dsh-korean-lang/dict/plugins        │
│    /api/dsh-korean-lang/dom                 │
│  · ETag + 304 재검증                        │
└─────────────────────────────────────────────┘
                     │  JSON
┌─ 브라우저 ──────────────────────────────────┐
│ lib/client.js (11.2 KiB)                    │
│  1. ctx.locale.addLanguage({ id: 'ko',      │
│       label: '한국어', fallback: 'en' })     │
│  2. 네임스페이스마다                        │
│     ctx.locale.register(ns, 'ko', dict)     │
│  3. (한국어가 활성일 때만) DOM 번역층        │
└─────────────────────────────────────────────┘
```

- 사전은 클라이언트 번들에 포함되지 않습니다. 호스트가 제공하고 브라우저가 받아오므로 번들이 작고, 번역을 고쳐도 번들을 다시 만들 필요가 없습니다.
- `fallback: 'en'`이므로 등록되지 않은 키는 영어로 해석됩니다. 키가 그대로 노출되는 일은 없습니다.
- `<html lang>`은 로케일 서비스가 활성 언어에 맞춰 자동으로 갱신합니다.

### DOM 번역층이 건드리지 않는 것

문자열을 번들에 하드코딩한 플러그인만 대상으로 하며, 안전을 위해 다음을 **절대 수정하지 않습니다**.

- 대화 내용 — `[role="log"]`, `[class*="markdown"]`, `[class*="message"]`, `[class*="transcript"]` 하위 전체
- 코드 — `code`, `pre`, `kbd`, `samp`
- 입력·편집 — `input`, `textarea`, `select`, `[contenteditable]`

또한 **텍스트 전체가 문구 사전의 키와 정확히 일치할 때만** 치환합니다. 부분 일치나 유사 일치는 하지 않으므로, 문장 중간의 단어가 바뀌는 일이 없습니다. 나중에 렌더링된 요소도 `MutationObserver`가 따라갑니다.

---

## 플러그인 번역 추가

### 로케일 서비스를 쓰는 플러그인

`lib/locales/plugins/`에 JSON 파일 하나를 넣으면 됩니다.

```json
{
  "dsh-goal": {
    "budgetLabel": "토큰 한도(0 = 무제한):"
  }
}
```

파일 형식과 규칙은 [`lib/locales/plugins/README.md`](lib/locales/plugins/README.md)를 참고하세요.

### 하드코딩된 플러그인

`lib/locales/dom/`에 원문 → 한국어 평면 객체를 넣습니다.

```json
{
  "Close settings panel": "설정 패널 닫기"
}
```

키는 플러그인이 렌더링하는 **영어 원문 그대로**여야 합니다(공백·말줄임표 포함). 한 글자라도 다르면 매칭되지 않습니다.

---

## 개발

```bash
npm install     # jsdom (DOM 층 테스트용 개발 의존성)
npm run build   # src/client.js → lib/client.js 번들 생성
npm test        # 매니페스트·사전·DOM 사전·번들 구조 검증 + 스모크 테스트
```

| 경로 | 역할 |
|---|---|
| `src/client.js` | 브라우저 절반의 읽기 쉬운 소스 (직접 수정하는 파일) |
| `lib/client.js` | `npm run build`가 생성하는 번들 (커밋됨) |
| `lib/index.js` | 호스트 절반 — 사전 제공 라우트 |
| `lib/locales/core.json` | 코어 네임스페이스 한국어 사전 |
| `lib/locales/plugins/*.json` | 로케일 서비스를 쓰는 플러그인 사전 |
| `lib/locales/dom/*.json` | 하드코딩된 플러그인 UI 문구 사전 |
| `scripts/extract-locales.mjs` | 하네스 소스에서 코어 사전을 추출하는 유지보수 도구 |
| `scripts/extract-plugin-locales.mjs` | 설치된 플러그인 번들에서 사전을 추출하는 유지보수 도구 |

`scripts/extract-locales.mjs`는 deepseek-harness 체크아웃에서 `ctx.locale.register(ns, { zh, en, ko })` 호출을 TypeScript AST로 분석해 한국어 사전을 뽑아냅니다. `scripts/extract-plugin-locales.mjs`는 설치된 플러그인의 미니파이된 브라우저 번들에서 같은 호출을 찾아 `en`/`zh` 사전을 복원합니다. 둘 다 하네스나 플러그인이 업데이트됐을 때 사전을 갱신하는 데 사용합니다.

---

## English

A Korean language pack for the DeepSeek Harness web UI. It uses the documented
client extension point first: it publishes `한국어` through
`ctx.locale.addLanguage` and registers one Korean dictionary per namespace with
`ctx.locale.register`. No harness patching, no fork.

- **61 core namespaces / 2,487 strings**, plus **8 third-party plugin namespaces /
  2,069 strings** for the plugins installed alongside it.
- Plugins that hardcode their UI text instead of using the locale service are
  covered by a **DOM translation layer** that matches whole text values against a
  fixed phrase map. It never touches conversation content, code blocks, code
  editors, or form controls.
- Dictionaries are served by the host half over three read-only, ETag-validated
  routes, so the client bundle stays at **11.2 KiB**.
- Untranslated namespaces fall back to English through the declared fallback
  chain rather than surfacing raw keys.

Install with `dsh plugin --profile <profile> add dsh-korean-lang`, restart, then
pick **설정 → 일반 → 언어 → 한국어**.

---

## 라이선스

MIT © [wnduddld0513](https://github.com/wnduddld0513)
