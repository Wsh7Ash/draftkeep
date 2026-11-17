/**
 * Content script: reads and writes form fields on the page.
 *
 * This file deliberately has no storage logic. It sends raw fields to the
 * service worker, which applies the privacy filters and decides what to keep.
 * It is a classic script because MV3 content scripts cannot be ES modules
 * without extra plumbing.
 */

(() => {
  "use strict";

  const DEBOUNCE_MS = 500;
  const MAX_COLLECTED = 60;
  const TEXT_INPUT_TYPES = new Set([
    "text",
    "email",
    "url",
    "tel",
    "search",
    "number",
    "date",
    "datetime-local",
    "month",
    "week",
    "time",
  ]);
  const SELECTOR =
    "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']";

  let timer = null;

  function isSkipped(element) {
    if (element.disabled || element.readOnly) {
      return true;
    }
    if (element.closest("[data-draftkeep='off']")) {
      return true;
    }
    if (element instanceof HTMLInputElement) {
      const type = (element.type || "text").toLowerCase();
      return !TEXT_INPUT_TYPES.has(type);
    }
    return !(element instanceof HTMLTextAreaElement || element.isContentEditable);
  }

  function readValue(element) {
    if (element.isContentEditable) {
      return element.innerText || "";
    }
    return element.value || "";
  }

  function describe(element) {
    return {
      name: element.getAttribute("name") || "",
      id: element.id || "",
      type: element.isContentEditable
        ? "contenteditable"
        : (element.type || element.tagName.toLowerCase()).toLowerCase(),
      autocomplete: element.getAttribute("autocomplete") || "",
    };
  }

  function collect() {
    const fields = [];
    for (const element of document.querySelectorAll(SELECTOR)) {
      if (isSkipped(element)) {
        continue;
      }
      const value = readValue(element).replace(/[ \t]+$/g, "");
      if (!value.trim()) {
        continue;
      }
      fields.push({ ...describe(element), value });
      if (fields.length >= MAX_COLLECTED) {
        break;
      }
    }
    return fields;
  }

  function currentFields() {
    const fields = [];
    for (const element of document.querySelectorAll(SELECTOR)) {
      if (isSkipped(element)) {
        continue;
      }
      const name = element.getAttribute("name") || "";
      const id = element.id || "";
      if (!name && !id) {
        continue;
      }
      fields.push({ name, id, empty: !readValue(element).trim() });
      if (fields.length >= MAX_COLLECTED) {
        break;
      }
    }
    return fields;
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const fields = collect();
    if (fields.length === 0) {
      return;
    }
    try {
      const pending = chrome.runtime.sendMessage({
        type: "draft:update",
        url: location.href,
        title: document.title,
        fields,
      });
      if (pending && typeof pending.catch === "function") {
        pending.catch(() => {});
      }
    } catch {
      // The extension was reloaded or the context was invalidated; nothing to do.
    }
  }

  function schedule() {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  function findField(key) {
    for (const element of document.querySelectorAll(SELECTOR)) {
      if (
        (element.getAttribute("name") || "") === key ||
        (element.id || "") === key
      ) {
        return element;
      }
    }
    return null;
  }

  function fill(element, value) {
    if (element.isContentEditable) {
      element.focus();
      element.innerText = value;
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }),
      );
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    );
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function restore() {
    const response = await chrome.runtime.sendMessage({
      type: "draft:plan",
      url: location.href,
      fields: currentFields(),
    });
    const plan = (response && response.plan) || [];
    let filled = 0;
    for (const item of plan) {
      const element = findField(item.key);
      if (element && !readValue(element).trim()) {
        fill(element, item.value);
        filled += 1;
      }
    }
    return filled;
  }

  document.addEventListener("input", schedule, true);
  document.addEventListener("change", schedule, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  });
  window.addEventListener("pagehide", flush);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "draft:restore") {
      return undefined;
    }
    restore()
      .then((filled) => sendResponse({ ok: true, filled }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  });
})();
