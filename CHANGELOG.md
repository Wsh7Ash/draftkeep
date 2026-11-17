# Changelog

## 0.1.0 — 2026-11-17
- Initial release
- Manifest V3 extension with a module service worker
- Debounced capture of text inputs, textareas and contenteditable fields
- Flush on `visibilitychange`/`pagehide`
- Privacy filter for passwords, OTPs, payment fields and `data-draftkeep="off"` containers
- Drafts keyed by origin + path, merged across captures
- 7-day TTL and 40-draft cap with pruning
- Restore plan that fills only empty fields, matched by name or id
- Popup: list, Restore, Copy, Open, Delete, Delete all, badge count
- 29 `node --test` tests over the core logic and extension structure
