# Contributing

## Setup

```shell
npm test
```

There is no build step and no dependencies. Load the repository folder as an unpacked extension and click reload after edits.

## Layout rules

- `src/core/drafts.js` must stay DOM-free and chrome-free so it stays unit testable. No `document`, no `window`, no `chrome`.
- The content script must not touch `chrome.storage`; capture decisions belong to the worker.
- The popup builds DOM with `textContent`, never `innerHTML` with draft data.

## Adding a privacy filter

1. Add the case to `isSensitiveField` in `src/core/drafts.js`.
2. Add a positive and a near-miss negative test in `tests/drafts.test.js`.
3. Document it in `docs/USAGE.md` and `SECURITY.md`.

Prefer over-filtering: a lost draft is annoying, a stored card number is a breach.

## Adding a message

1. Handle the type in `handle()` in `src/background.js` and return `{ ok, ... }`.
2. Add the type to the assertion list in `tests/manifest.test.js`.
3. Document the payload in `docs/ARCHITECTURE.md`.

## Manual browser check

```shell
cd examples && python -m http.server 8080
```

Type into `http://localhost:8080/test-form.html`, close the tab, reopen it, then Restore. Confirm the card, password and OTP fields are still empty and that the stored draft (service worker console) contains only the three text fields.

## Design rules

- No remote code, no `eval`, no `new Function`, no telemetry.
- Keep permissions minimal: `storage` and `activeTab` only.
- Restore only empty fields; never overwrite what the user typed.
