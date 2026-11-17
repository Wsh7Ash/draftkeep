# Security and privacy

## Data handled

draftkeep stores text typed into web forms in `chrome.storage.local`:

- key: origin + path of the page;
- values: the text of text-like inputs, textareas and contenteditable elements;
- metadata: page title, host, path, timestamp.

Nothing leaves the browser. The extension makes no network requests, has no analytics, no accounts and no remote configuration. It requests only `storage` and `activeTab`, and no host permissions.

## What is never stored

- password, hidden, file, submit, button, reset, image, checkbox and radio inputs;
- one-time codes (`autocomplete="one-time-code"`, names/ids containing `otp` or `one-time`);
- payment fields (`cc-*` autocomplete, names/ids containing card number, CVV/CVC, security code);
- fields whose name/id contains password, passphrase, secret, SSN or social security;
- anything inside a `[data-draftkeep="off"]` container;
- fields without a `name` or `id` (they cannot be restored reliably).

This filter runs in the service worker (`isSensitiveField` in `src/core/drafts.js`), so a page cannot bypass it by sending crafted messages; the worker ignores whatever it is sent that fails the filter.

## Storage limits

Drafts expire after 7 days and at most 40 are kept. Values are capped at 20 000 characters, 60 fields per page.

## Residual risk

`chrome.storage.local` is not encrypted. Anyone with access to the browser profile directory (another process running as your user, a backup, a synced profile) can read drafts. Do not use the extension for content you would not keep in the browser profile. If that matters for your use, wait for the passphrase-encryption item in the roadmap or disable the extension for those sites.

The extension cannot prevent a page from observing values while they are in the DOM; it only removes them from the data it stores.

## Reporting

Open a private GitHub security advisory or email the maintainer listed on the GitHub profile. Include the browser version, the page (or a minimal copy), and the observed stored draft.

## Scope

This is a personal-productivity extension, not a secrets manager or a password manager. It has no server component to attack; the relevant threats are local-profile access and accidental capture, both addressed above as far as a local-storage design can.
