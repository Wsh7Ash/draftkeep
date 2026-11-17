/**
 * Pure draft logic for draftkeep.
 *
 * Everything here is DOM-free so it can be unit tested with `node --test` and
 * reused by the service worker and the popup. The content script only collects
 * and fills DOM fields; all storage decisions live in this module.
 */

export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DRAFTS = 40;
export const MAX_FIELDS = 60;
export const MAX_VALUE_LENGTH = 20_000;
export const MAX_TITLE_LENGTH = 200;

const SKIPPED_TYPES = new Set([
  "password",
  "hidden",
  "file",
  "submit",
  "button",
  "reset",
  "image",
  "checkbox",
  "radio",
]);

const SENSITIVE_AUTOCOMPLETE = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-name",
  "cc-given-name",
  "cc-family-name",
]);

const SENSITIVE_NAME = /(password|passwd|passphrase|secret|otp|one[-_]?time|cvv|cvc|card[-_]?number|cardnumber|ssn|social[-_]?security|security[-_]?code)/i;

/**
 * Key a draft by origin and path. Query strings and fragments are ignored so
 * a multi-step form does not create one draft per step.
 */
export function draftKey(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith("http")) {
      return "";
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "";
  }
}

/** True for fields that must never be stored, whatever else they look like. */
export function isSensitiveField(field = {}) {
  const type = String(field.type || "").toLowerCase();
  if (SKIPPED_TYPES.has(type)) {
    return true;
  }
  const autocomplete = String(field.autocomplete || "").toLowerCase();
  if (SENSITIVE_AUTOCOMPLETE.has(autocomplete) || autocomplete.startsWith("cc-")) {
    return true;
  }
  const identity = `${field.name || ""} ${field.id || ""}`;
  return SENSITIVE_NAME.test(identity);
}

export function fieldKey(field = {}) {
  const name = String(field.name || "").trim();
  if (name) {
    return name;
  }
  return String(field.id || "").trim();
}

export function sanitizeValue(value) {
  const text = String(value ?? "");
  const trimmedEnd = text.replace(/[ \t]+$/g, "");
  if (!trimmedEnd.trim()) {
    return "";
  }
  return trimmedEnd.slice(0, MAX_VALUE_LENGTH);
}

/**
 * Normalize raw fields collected from the page:
 * drop empty, sensitive and unnamed fields, cap count, last value wins.
 */
export function sanitizeFields(fields = []) {
  const byKey = new Map();
  for (const field of fields) {
    const key = fieldKey(field);
    if (!key || isSensitiveField(field)) {
      continue;
    }
    const value = sanitizeValue(field.value);
    if (!value) {
      byKey.delete(key);
      continue;
    }
    byKey.set(key, {
      key,
      name: String(field.name || ""),
      id: String(field.id || ""),
      type: String(field.type || "text").toLowerCase(),
      value,
    });
  }
  return Array.from(byKey.values()).slice(0, MAX_FIELDS);
}

/** Merge newly collected fields into an existing list, keeping older values for absent keys. */
export function mergeFields(existing = [], incoming = []) {
  const byKey = new Map();
  for (const field of sanitizeFields(existing)) {
    byKey.set(field.key, field);
  }
  for (const field of sanitizeFields(incoming)) {
    byKey.set(field.key, field);
  }
  return Array.from(byKey.values()).slice(0, MAX_FIELDS);
}

/** Build the stored draft for one page, or null when there is nothing to keep. */
export function buildDraft({ url, title = "", fields = [], now = Date.now() } = {}) {
  const key = draftKey(url);
  const sanitized = sanitizeFields(fields);
  if (!key || sanitized.length === 0) {
    return null;
  }
  const parsed = new URL(url);
  return {
    key,
    url,
    origin: parsed.origin,
    host: parsed.host,
    path: parsed.pathname || "/",
    title: String(title || "").slice(0, MAX_TITLE_LENGTH),
    updatedAt: now,
    fields: sanitized,
  };
}

export function isValidDraft(draft) {
  return Boolean(
    draft &&
      typeof draft.key === "string" &&
      draft.key &&
      Number.isFinite(draft.updatedAt) &&
      Array.isArray(draft.fields) &&
      draft.fields.length > 0,
  );
}

/**
 * Drop expired and malformed drafts, keep the newest `maxDrafts`.
 * Input and output are plain objects keyed by draft key.
 */
export function pruneDrafts(
  drafts = {},
  { now = Date.now(), ttlMs = DEFAULT_TTL_MS, maxDrafts = MAX_DRAFTS } = {},
) {
  const kept = Object.values(drafts)
    .filter((draft) => isValidDraft(draft) && now - draft.updatedAt <= ttlMs)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, maxDrafts);

  const result = {};
  for (const draft of kept) {
    result[draft.key] = draft;
  }
  return result;
}

/**
 * Which fields to fill on the current page.
 * Only empty fields are touched, matched by name (or id) against the draft.
 */
export function restorePlan(draft, currentFields = []) {
  if (!draft || !Array.isArray(draft.fields)) {
    return [];
  }
  const stored = new Map();
  for (const field of draft.fields) {
    const key = fieldKey(field);
    if (key) {
      stored.set(key, field.value);
    }
  }

  const plan = [];
  const planned = new Set();
  for (const field of currentFields) {
    if (!field || !field.empty) {
      continue;
    }
    const key = fieldKey(field);
    if (!key || !stored.has(key) || planned.has(key)) {
      continue;
    }
    planned.add(key);
    plan.push({ key, value: stored.get(key) });
  }
  return plan;
}

export function formatAge(updatedAt, now = Date.now()) {
  const delta = Math.max(0, now - Number(updatedAt || 0));
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) {
    return "just now";
  }
  if (delta < hour) {
    return `${Math.floor(delta / minute)} min ago`;
  }
  if (delta < day) {
    return `${Math.floor(delta / hour)} h ago`;
  }
  return `${Math.floor(delta / day)} d ago`;
}

/** Shape used by the popup list, without exposing full field values. */
export function summarizeDraft(draft, now = Date.now()) {
  return {
    key: draft.key,
    host: draft.host || "",
    path: draft.path || "/",
    title: draft.title || "",
    fieldCount: Array.isArray(draft.fields) ? draft.fields.length : 0,
    age: formatAge(draft.updatedAt, now),
    updatedAt: draft.updatedAt,
  };
}

/** Sort stored drafts newest first for display. */
export function listDrafts(drafts = {}) {
  return Object.values(drafts)
    .filter(isValidDraft)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((draft) => summarizeDraft(draft));
}
