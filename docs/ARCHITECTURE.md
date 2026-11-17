# Architecture — draftkeep

## Component map

```text
manifest.json
├─ content_scripts → src/content/collector.js   (classic script, DOM only)
├─ background      → src/background.js          (module service worker)
└─ action.popup    → src/popup/popup.{html,css,js} (module)

src/core/drafts.js  ← pure functions, no DOM, no chrome.*, unit tested
```

The split is deliberate: storage and privacy decisions live in one pure module that can be tested without a browser, while the content script only knows how to read and write DOM fields.

## Message protocol

All messages are `{ type, ... }` objects answered with `{ ok, ... }`. The worker keeps the response channel open (`return true`) and always answers, including on failure.

| Message | Payload | Response |
|---|---|---|
| `draft:update` | `url`, `title`, `fields[]` | `{ ok, stored, count }` |
| `draft:plan` | `url`, `fields[{name,id,empty}]` | `{ ok, plan[{key,value}] }` |
| `draft:list` | — | `{ ok, drafts[summary] }` |
| `draft:get` | `key` | `{ ok, draft }` |
| `draft:delete` | `key` | `{ ok, count }` |
| `draft:clear` | — | `{ ok, count }` |

`draft:restore` is sent by the popup directly to the tab; the content script handles it, asks the worker for a `draft:plan`, and fills the DOM.

## Capture path

1. `input`/`change` (capture phase) schedule a 500 ms debounce.
2. On timeout, on `visibilitychange → hidden` or on `pagehide`, the content script collects fields: text-like inputs, textareas, contenteditable elements, skipping disabled/readonly, `data-draftkeep="off"` containers and password/hidden/file/button types.
3. Raw fields go to the worker. `buildDraft` keys them by origin + path, `sanitizeFields` drops sensitive/empty/unnamed fields, caps counts and value length, and `mergeFields` merges with the previous draft so a field that vanished from the DOM keeps its last value.
4. `pruneDrafts` drops malformed and expired drafts, sorts by `updatedAt` and keeps the newest 40. The result is written to `chrome.storage.local` under `drafts`.
5. The action badge shows the stored count (`9+` above nine).

## Restore path

1. The popup asks the active tab to `draft:restore`.
2. The content script sends the page's fields with an `empty` flag.
3. The worker loads the draft for the key and runs `restorePlan`: each stored field whose key matches a currently empty field becomes `{ key, value }`, once per key.
4. The content script finds the element by `name` then `id`, sets the value through the prototype's value setter (so React-style wrappers observe it) and dispatches `input` and `change`. For contenteditable it sets `innerText` and dispatches `input`.

## Privacy filter

`sanitizeFields` drops a field when any of these hold:

- `type` is password, hidden, file, submit, button, reset, image, checkbox or radio;
- `autocomplete` is `current-password`, `new-password`, `one-time-code`, `cc-*`;
- the `name`/`id` matches `password|passwd|passphrase|secret|otp|one-time|cvv|cvc|card-number|cardnumber|ssn|social-security|security-code`.

The filter runs in the worker, not the content script, so a modified page cannot bypass it by crafting a message.

## Design decisions

- **Pure core.** Every storage and matching rule is in `drafts.js`; the untestable layers only translate DOM ↔ messages.
- **Content script has no storage permission path.** It cannot read drafts, only request a plan.
- **Key by origin + path.** Multi-step query-string forms share one draft instead of fragmenting.
- **Restore only empties.** Overwriting user input is worse than leaving a field blank.
- **No remote code.** The manifest test rejects `http(s)://` URLs, `eval` and `new Function` in sources, which keeps the extension store-reviewable.
- **Conservative caps.** TTL, draft count, field count and value length bound both storage growth and accidental capture.
