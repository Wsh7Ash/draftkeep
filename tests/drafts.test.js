import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TTL_MS,
  MAX_DRAFTS,
  buildDraft,
  draftKey,
  fieldKey,
  formatAge,
  isSensitiveField,
  isValidDraft,
  listDrafts,
  mergeFields,
  pruneDrafts,
  restorePlan,
  sanitizeFields,
  sanitizeValue,
  summarizeDraft,
} from "../src/core/drafts.js";

const NOW = 1_750_000_000_000;

test("draftKey keeps origin and path, drops query and fragment", () => {
  assert.equal(draftKey("https://shop.example/checkout?step=2#pay"), "https://shop.example/checkout");
  assert.equal(draftKey("http://localhost:3000/form"), "http://localhost:3000/form");
});

test("draftKey rejects non-http and malformed urls", () => {
  assert.equal(draftKey("chrome://extensions"), "");
  assert.equal(draftKey("not a url"), "");
  assert.equal(draftKey(""), "");
});

test("isSensitiveField blocks passwords, payment fields and named secrets", () => {
  assert.equal(isSensitiveField({ type: "password", name: "password" }), true);
  assert.equal(isSensitiveField({ type: "hidden", name: "token" }), true);
  assert.equal(isSensitiveField({ type: "text", autocomplete: "cc-number" }), true);
  assert.equal(isSensitiveField({ type: "text", autocomplete: "cc-exp" }), true);
  assert.equal(isSensitiveField({ type: "text", name: "cardNumber" }), true);
  assert.equal(isSensitiveField({ type: "text", name: "otpCode" }), true);
  assert.equal(isSensitiveField({ type: "text", name: "cvv" }), true);
  assert.equal(isSensitiveField({ type: "text", name: "email" }), false);
  assert.equal(isSensitiveField({ type: "textarea", name: "delivery_notes" }), false);
});

test("fieldKey prefers name and falls back to id", () => {
  assert.equal(fieldKey({ name: "email", id: "email-input" }), "email");
  assert.equal(fieldKey({ name: "", id: "comment" }), "comment");
  assert.equal(fieldKey({}), "");
});

test("sanitizeValue trims trailing whitespace and rejects blank values", () => {
  assert.equal(sanitizeValue("  hello  "), "  hello");
  assert.equal(sanitizeValue("   \n\t "), "");
  assert.equal(sanitizeValue(undefined), "");
  assert.equal(sanitizeValue("x".repeat(30_000)).length, 20_000);
});

test("sanitizeFields drops sensitive, empty and unnamed fields", () => {
  const fields = sanitizeFields([
    { name: "email", value: "person@example.com", type: "email" },
    { name: "password", value: "hunter2", type: "password" },
    { name: "otp", value: "123456", type: "text" },
    { name: "empty", value: "   ", type: "text" },
    { name: "", id: "", value: "anonymous", type: "text" },
    { id: "comment", value: "hello", type: "textarea" },
  ]);
  assert.deepEqual(
    fields.map((field) => field.key),
    ["email", "comment"],
  );
});

test("sanitizeFields keeps the last value for duplicate keys and caps the count", () => {
  const duplicate = sanitizeFields([
    { name: "email", value: "first" },
    { name: "email", value: "second" },
  ]);
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].value, "second");

  const many = Array.from({ length: 100 }, (_, index) => ({
    name: `field_${index}`,
    value: `value_${index}`,
  }));
  assert.equal(sanitizeFields(many).length, 60);
});

test("mergeFields keeps old values for absent fields and replaces touched ones", () => {
  const merged = mergeFields(
    [
      { name: "email", value: "old@example.com" },
      { name: "notes", value: "keep me" },
    ],
    [{ name: "email", value: "new@example.com" }],
  );
  const byKey = Object.fromEntries(merged.map((field) => [field.key, field.value]));
  assert.deepEqual(byKey, { email: "new@example.com", notes: "keep me" });
});

test("mergeFields does not erase a field when the incoming value is empty", () => {
  const merged = mergeFields(
    [{ name: "notes", value: "typed earlier" }],
    [{ name: "notes", value: "" }],
  );
  assert.equal(merged[0].value, "typed earlier");
});

test("buildDraft returns null when there is nothing to keep", () => {
  assert.equal(buildDraft({ url: "https://example.com/form", fields: [] }), null);
  assert.equal(
    buildDraft({ url: "https://example.com/form", fields: [{ name: "password", value: "x" }] }),
    null,
  );
  assert.equal(buildDraft({ url: "chrome://extensions", fields: [{ name: "a", value: "b" }] }), null);
});

test("buildDraft stores page metadata and sanitized fields", () => {
  const draft = buildDraft({
    url: "https://shop.example/checkout?step=2",
    title: "Checkout",
    now: NOW,
    fields: [
      { name: "email", value: "person@example.com", type: "email" },
      { name: "cardNumber", value: "4111111111111111", type: "text" },
    ],
  });
  assert.equal(draft.key, "https://shop.example/checkout");
  assert.equal(draft.host, "shop.example");
  assert.equal(draft.path, "/checkout");
  assert.equal(draft.updatedAt, NOW);
  assert.deepEqual(draft.fields.map((field) => field.key), ["email"]);
});

test("isValidDraft rejects malformed stored values", () => {
  assert.equal(isValidDraft(null), false);
  assert.equal(isValidDraft({ key: "", updatedAt: NOW, fields: [{ value: "x" }] }), false);
  assert.equal(isValidDraft({ key: "k", updatedAt: "yesterday", fields: [{}] }), false);
  assert.equal(isValidDraft({ key: "k", updatedAt: NOW, fields: [] }), false);
  assert.equal(isValidDraft({ key: "k", updatedAt: NOW, fields: [{ value: "x" }] }), true);
});

test("pruneDrafts drops expired and malformed drafts", () => {
  const drafts = {
    fresh: { key: "fresh", updatedAt: NOW - 1000, fields: [{ value: "x" }] },
    old: { key: "old", updatedAt: NOW - DEFAULT_TTL_MS - 1, fields: [{ value: "x" }] },
    broken: { key: "broken", updatedAt: NOW, fields: [] },
  };
  const kept = pruneDrafts(drafts, { now: NOW });
  assert.deepEqual(Object.keys(kept), ["fresh"]);
});

test("pruneDrafts keeps the newest drafts up to the cap", () => {
  const drafts = {};
  for (let index = 0; index < MAX_DRAFTS + 5; index += 1) {
    const key = `key-${index}`;
    drafts[key] = { key, updatedAt: NOW - index * 1000, fields: [{ value: "x" }] };
  }
  const kept = pruneDrafts(drafts, { now: NOW });
  assert.equal(Object.keys(kept).length, MAX_DRAFTS);
  assert.ok(kept["key-0"]);
  assert.equal(kept[`key-${MAX_DRAFTS}`], undefined);
});

test("restorePlan fills only empty fields matched by name", () => {
  const draft = {
    fields: [
      { name: "email", value: "person@example.com" },
      { name: "notes", value: "remember this" },
    ],
  };
  const plan = restorePlan(draft, [
    { name: "email", empty: false },
    { name: "notes", empty: true },
    { name: "unknown", empty: true },
  ]);
  assert.deepEqual(plan, [{ key: "notes", value: "remember this" }]);
});

test("restorePlan matches by id and plans each key once", () => {
  const draft = { fields: [{ id: "comment", value: "saved text" }] };
  const plan = restorePlan(draft, [
    { id: "comment", empty: true },
    { id: "comment", empty: true },
  ]);
  assert.deepEqual(plan, [{ key: "comment", value: "saved text" }]);
});

test("restorePlan ignores malformed drafts", () => {
  assert.deepEqual(restorePlan(null, [{ name: "x", empty: true }]), []);
  assert.deepEqual(restorePlan({}, [{ name: "x", empty: true }]), []);
});

test("formatAge describes recent timestamps", () => {
  assert.equal(formatAge(NOW - 5_000, NOW), "just now");
  assert.equal(formatAge(NOW - 5 * 60_000, NOW), "5 min ago");
  assert.equal(formatAge(NOW - 3 * 60 * 60_000, NOW), "3 h ago");
  assert.equal(formatAge(NOW - 2 * 24 * 60 * 60_000, NOW), "2 d ago");
  assert.equal(formatAge(NOW + 10_000, NOW), "just now");
});

test("listDrafts sorts newest first and does not expose values", () => {
  const drafts = {
    older: {
      key: "older",
      host: "a.example",
      path: "/one",
      title: "",
      updatedAt: NOW - 60_000,
      fields: [{ name: "x", value: "secret-ish text" }],
    },
    newer: {
      key: "newer",
      host: "b.example",
      path: "/two",
      title: "Two",
      updatedAt: NOW,
      fields: [{ name: "y", value: "another" }],
    },
    broken: { key: "broken", updatedAt: NOW, fields: [] },
  };
  const listed = listDrafts(drafts);
  assert.deepEqual(listed.map((item) => item.key), ["newer", "older"]);
  assert.equal(listed[0].fieldCount, 1);
  assert.ok(!JSON.stringify(listed).includes("another"));
});

test("summarizeDraft includes age and field count", () => {
  const summary = summarizeDraft(
    {
      key: "https://example.com/form",
      host: "example.com",
      path: "/form",
      title: "Contact",
      updatedAt: NOW - 120_000,
      fields: [{}, {}],
    },
    NOW,
  );
  assert.deepEqual(summary, {
    key: "https://example.com/form",
    host: "example.com",
    path: "/form",
    title: "Contact",
    fieldCount: 2,
    age: "2 min ago",
    updatedAt: NOW - 120_000,
  });
});
