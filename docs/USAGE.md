# Usage — draftkeep

## Install the extension

1. Open `chrome://extensions` (Chrome/Chromium) or `edge://extensions` (Edge).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository's root folder (the one containing `manifest.json`).
4. Pin the draftkeep icon if it is hidden behind the puzzle-piece menu.

After editing any file, click the reload button on the extension card. Reloading invalidates the content script in already-open tabs; refresh those tabs.

## Try it

```shell
cd examples
python -m http.server 8080
```

Visit `http://localhost:8080/test-form.html`, type into the email, address and notes fields, and also into the card, password and OTP fields. Then:

1. Close the tab.
2. Open `http://localhost:8080/test-form.html` again.
3. Click the draftkeep icon. The draft shows three fields, not six.
4. Click **Restore**. Only the empty text fields are filled.

To simulate a lost session instead of a fresh page, reload the form after typing: the fields come back empty, then Restore fills them.

## Popup controls

| Control | Effect |
|---|---|
| Restore | asks the active tab to fill empty matching fields |
| Copy | writes `field: value` lines to the clipboard |
| Open | opens the saved page in a new tab |
| Delete | removes one draft |
| Delete all | clears storage after a confirmation |

The toolbar badge shows the number of stored drafts (`9+` above nine).

## Capture rules

Captured: `input` types text, email, url, tel, search, number, date, datetime-local, month, week, time; `textarea`; `contenteditable` elements.

Ignored: all other input types (password, hidden, file, submit, button, reset, image, checkbox, radio), disabled and readonly fields, fields without a `name` or `id`, fields inside `[data-draftkeep="off"]`, fields whose name/id/autocomplete looks sensitive.

The content script runs on `http` and `https` pages only, in the top frame.

## Restore behaviour

- Only fields that are currently empty are touched.
- Matching is by `name`, then `id`.
- Values are set through the native value setter and `input`/`change` events are dispatched, so most React/Vue controlled inputs pick them up. If a framework rejects the value, click Restore again after focusing the field.
- A successful restore reports how many fields were filled; zero means there were no empty matching fields.

## Excluding a form

```html
<form data-draftkeep="off">
  ...
</form>
```

or on a single field's container:

```html
<div data-draftkeep="off">
  <input name="internal_note" />
</div>
```

## Storage

- Location: `chrome.storage.local`, key `drafts`.
- Shape: object keyed by `origin + path`; see `results/sample-draft.json`.
- Limits: 7-day TTL, 40 drafts, 60 fields per draft, 20 000 characters per value.
- To inspect: DevTools → Application → Extension storage (or the service worker console), or use the popup list.
- To wipe: **Delete all** in the popup, or remove the extension.

Change the limits in `src/core/drafts.js` and reload the extension.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Badge stays empty | No `name`/`id` on the fields, or the page is `chrome://`, the Web Store, or a PDF viewer |
| Restore says "this page is not supported" | The content script is not running on that tab (not http/https, or the tab predates the extension reload) |
| Card or password field not restored | Intentional: sensitive fields are never stored |
| Draft not updated after navigating within a SPA | The extension keys by path; a route change with the same path keeps the first draft |
| Restore reports 0 fields | The current fields are already filled, or their names differ from when the draft was captured |
