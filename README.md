# draftkeep

## Rescues text you typed into a form when the tab is lost

Closing a tab, hitting reload by accident or navigating away from a long form throws away everything you typed. **draftkeep** is a Manifest V3 browser extension that saves the text you enter, per page, in local storage, and lets you put it back with one click — without ever storing passwords, one-time codes or payment details.

- **Problem:** long forms (support tickets, checkout notes, job applications) lose their content on close, reload or crash.
- **Solution:** debounced capture of text fields, a popup list of drafts, and a "fill only empty fields" restore.
- **Audience:** anyone who fills long forms; no developer tools needed after installing the extension.

## Quick start

1. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Choose **Load unpacked** and select this folder.
3. Open the test page over http, type into it and close the tab:

   ```shell
   cd examples
   python -m http.server 8080
   # then visit http://localhost:8080/test-form.html
   ```

4. Click the draftkeep icon in the toolbar to see the saved draft; **Restore** fills the empty fields on the current page.

The badge shows how many drafts are stored.

## Features

- **Captures as you type** — 500 ms debounce on `input`/`change`, plus an immediate flush when the page is hidden or unloaded.
- **Never stores secrets** — password, hidden, file and button inputs, one-time codes, CVV and card-number/autocomplete `cc-*` fields, and fields whose name/id looks like a password or OTP are dropped before anything is written.
- **Per-page drafts** — keyed by origin + path, so query strings and fragments from multi-step forms do not create duplicates.
- **Restore only into empty fields** — nothing already typed is overwritten; matching is by field `name`, then `id`.
- **Local only** — `chrome.storage.local`, no network, no account, no telemetry.
- **Automatic cleanup** — drafts expire after 7 days and at most 40 are kept, newest first.
- **No remote code** — no CDN scripts, no `eval`, no `new Function`; the manifest test enforces it.
- **Optional escape hatch** — wrap any part of a form in `data-draftkeep="off"` and it is ignored.

## What a stored draft looks like

Captured from a checkout form that also contained card and password fields (`results/sample-draft.json`):

```json
{
  "key": "https://shop.example/checkout",
  "url": "https://shop.example/checkout?step=2",
  "origin": "https://shop.example",
  "host": "shop.example",
  "path": "/checkout",
  "title": "Checkout — shop.example",
  "updatedAt": 1750000000000,
  "fields": [
    { "key": "email", "name": "email", "type": "email", "value": "person@example.com" },
    { "key": "address_line1", "name": "address_line1", "type": "text", "value": "12 Market Street" },
    { "key": "delivery_notes", "name": "delivery_notes", "type": "textarea", "value": "Leave with the neighbour" }
  ]
}
```

The `card_number` field (autocomplete `cc-number`) and the password field are absent — that is the privacy filter, not a test omission.

## Architecture

```text
page DOM
  │  src/content/collector.js   collect / fill fields, debounce, flush on hide
  ▼
service worker  src/background.js
  │  imports src/core/drafts.js
  │  sanitize → merge → prune → chrome.storage.local
  ▼
src/popup/*  list, Restore, Copy, Open, Delete, Clear all
```

`src/core/drafts.js` is DOM-free and chrome-free, so it is unit tested directly with `node --test`. The content script has no storage access at all: it sends raw fields and asks the worker for a restore plan.

- `draftKey(url)` — origin + path, ignoring query and hash.
- `isSensitiveField(field)` — the privacy filter.
- `sanitizeFields` / `mergeFields` — normalization, caps, last value wins, older values kept for absent fields.
- `buildDraft` / `pruneDrafts` — storage shape, 7-day TTL, 40-draft cap.
- `restorePlan(draft, currentFields)` — only empty fields, matched by name or id.

See `docs/ARCHITECTURE.md`.

## Requirements

- Chrome/Chromium 102+ or Edge (Manifest V3, module service worker)
- Node 20+ for the tests only

## Installation

```shell
git clone https://github.com/Wsh7Ash/draftkeep
```

Then load the folder as an unpacked extension as described in Quick start. There is no build step: the files in the repository are exactly what the browser loads.

## Usage

- Type in any form on an `http`/`https` page; the draft is saved shortly after you stop typing.
- Click the toolbar icon to see drafts, with page, field count and age.
- **Restore** fills empty matching fields on the active tab.
- **Copy** puts `field: value` lines on the clipboard.
- **Open** navigates to the saved page; **Delete** removes one draft; **Delete all** clears storage after confirmation.
- To exclude a field or a whole form, add `data-draftkeep="off"` to a container.

## Configuration

Constants live at the top of `src/core/drafts.js`:

| Constant | Default | Meaning |
|---|---|---|
| `DEFAULT_TTL_MS` | 7 days | how long a draft is kept |
| `MAX_DRAFTS` | 40 | stored drafts, newest kept |
| `MAX_FIELDS` | 60 | fields captured per page |
| `MAX_VALUE_LENGTH` | 20 000 | characters per field |

Change a value, reload the extension, and the new limits apply. The debounce interval is `DEBOUNCE_MS` in `src/content/collector.js`.

## Testing

```shell
npm test        # node --test
```

29 tests: 20 for the pure draft logic (keys, privacy filters, merging, TTL/caps, restore planning, age formatting) and 9 for the extension's structure (Manifest V3, referenced files exist, minimal permissions, no remote code or `eval`, content script never touches storage, popup has no inline script). `results/validation.log` holds the captured run.

The DOM and `chrome.*` layers are not unit tested; they are exercised manually with `examples/test-form.html`.

## Project structure

```text
draftkeep/
├─ manifest.json
├─ src/
│  ├─ background.js          service worker (module)
│  ├─ core/drafts.js         pure, tested logic
│  ├─ content/collector.js   DOM capture and fill
│  └─ popup/{popup.html,popup.css,popup.js}
├─ tests/{drafts.test.js,manifest.test.js}
├─ examples/test-form.html
├─ docs/{ARCHITECTURE,USAGE,PROJECT_SPEC}.md
├─ results/{validation.log,sample-draft.json}
├─ RESULTS.md
└─ .github/workflows/ci.yml
```

## Limitations

- Only text-like inputs, textareas and contenteditable elements are captured. Selects, checkboxes, radios and file uploads are not restored.
- Fields without a `name` or `id` cannot be captured or restored reliably.
- A field that a framework re-renders with a new identity may not be matched on restore.
- Content scripts do not run on `chrome://`, extension pages, the Chrome Web Store, or `file://` URLs unless the user grants file access.
- SPA route changes that keep the same path share one draft; query-string steps are merged deliberately.
- Storage is unencrypted `chrome.storage.local`, readable by anyone with access to the browser profile. The privacy filter removes secrets, but treat it as "not for sensitive text".
- No icons are shipped; the browser shows its default placeholder.
- No Firefox/Safari packaging.

## Roadmap

- Optional per-site allowlist instead of all-sites capture.
- Encrypt stored values with a passphrase-derived key.
- Icons and a store-ready package.
- A `beforeunload` warning on pages where a draft exists and the form is still dirty.

## Privacy and security

- Everything stays in `chrome.storage.local`; there are no network requests.
- Passwords, one-time codes and payment fields are filtered before storage — see `isSensitiveField` and `tests/drafts.test.js`.
- Drafts are removed after 7 days and capped at 40.
- Reading the extension's storage requires access to the browser profile, so do not use it for content you would not keep in the browser profile.

See `SECURITY.md` for the full data-handling note.

## License

MIT — see `LICENSE`.
