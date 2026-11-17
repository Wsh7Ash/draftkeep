/**
 * draftkeep service worker.
 *
 * The content script only reads and writes DOM fields. All capture decisions,
 * storage, pruning and restore planning happen here with the pure helpers from
 * core/drafts.js.
 */

import {
  buildDraft,
  draftKey,
  listDrafts,
  mergeFields,
  pruneDrafts,
  restorePlan,
} from "./core/drafts.js";

const STORAGE_KEY = "drafts";
const BADGE_COLOR = "#2f6f4e";

async function readDrafts() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return pruneDrafts(stored[STORAGE_KEY] || {});
}

async function updateBadge(drafts) {
  const count = Object.keys(drafts).length;
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: count === 0 ? "" : count > 9 ? "9+" : String(count) });
}

async function writeDrafts(drafts) {
  const pruned = pruneDrafts(drafts);
  await chrome.storage.local.set({ [STORAGE_KEY]: pruned });
  await updateBadge(pruned);
  return pruned;
}

async function handle(message) {
  switch (message && message.type) {
    case "draft:update": {
      const draft = buildDraft({
        url: message.url,
        title: message.title,
        fields: message.fields,
      });
      if (!draft) {
        const drafts = await readDrafts();
        return { ok: true, stored: false, count: Object.keys(drafts).length };
      }
      const drafts = await readDrafts();
      const existing = drafts[draft.key];
      if (existing) {
        draft.fields = mergeFields(existing.fields, draft.fields);
        draft.updatedAt = Math.max(draft.updatedAt, existing.updatedAt + 1);
      }
      drafts[draft.key] = draft;
      const written = await writeDrafts(drafts);
      return { ok: true, stored: true, count: Object.keys(written).length };
    }

    case "draft:plan": {
      const drafts = await readDrafts();
      const draft = drafts[draftKey(message.url || "")];
      return { ok: true, plan: draft ? restorePlan(draft, message.fields || []) : [] };
    }

    case "draft:list": {
      const drafts = await readDrafts();
      return { ok: true, drafts: listDrafts(drafts) };
    }

    case "draft:get": {
      const drafts = await readDrafts();
      return { ok: true, draft: drafts[message.key] || null };
    }

    case "draft:delete": {
      const drafts = await readDrafts();
      delete drafts[message.key];
      const written = await writeDrafts(drafts);
      return { ok: true, count: Object.keys(written).length };
    }

    case "draft:clear": {
      await writeDrafts({});
      return { ok: true, count: 0 };
    }

    default:
      return { ok: false, error: "unknown message" };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((error) => {
      console.error("draftkeep:", error);
      sendResponse({ ok: false, error: String(error) });
    });
  return true; // keep the channel open for the async response
});

chrome.runtime.onInstalled.addListener(() => {
  readDrafts()
    .then(writeDrafts)
    .catch((error) => console.error("draftkeep install:", error));
});

chrome.runtime.onStartup.addListener(() => {
  readDrafts()
    .then(writeDrafts)
    .catch((error) => console.error("draftkeep startup:", error));
});
