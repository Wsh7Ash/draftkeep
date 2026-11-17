/** Popup UI. Renders the summarized draft list and asks the worker to act. */

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const statusEl = document.getElementById("status");
const clearButton = document.getElementById("clear");

function setStatus(text) {
  statusEl.textContent = text || "";
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.ok === false) {
    throw new Error((response && response.error) || "the worker did not answer");
  }
  return response;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function actionButton(label, className, handler) {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

function renderDraft(draft) {
  const card = element("article", "draft");
  const title = draft.title || `${draft.host}${draft.path}`;
  card.append(element("div", "draft-title", title));
  const fields = `${draft.fieldCount} field${draft.fieldCount === 1 ? "" : "s"}`;
  card.append(element("div", "draft-meta", `${draft.host}${draft.path} · ${fields} · ${draft.age}`));

  const actions = element("div", "actions");

  actions.append(
    actionButton("Restore", "primary", async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || tab.id === undefined) {
          throw new Error("no active tab");
        }
        const response = await chrome.tabs.sendMessage(tab.id, { type: "draft:restore" });
        if (!response || !response.ok) {
          throw new Error((response && response.error) || "this page is not supported");
        }
        setStatus(
          response.filled > 0
            ? `Filled ${response.filled} field${response.filled === 1 ? "" : "s"}.`
            : "No empty matching fields on this page.",
        );
      } catch (error) {
        setStatus(String((error && error.message) || error));
      }
    }),
  );

  actions.append(
    actionButton("Copy", "", async () => {
      try {
        const { draft: full } = await send({ type: "draft:get", key: draft.key });
        if (!full) {
          throw new Error("draft is no longer stored");
        }
        const text = full.fields.map((field) => `${field.key}: ${field.value}`).join("\n");
        await navigator.clipboard.writeText(text);
        setStatus("Copied to clipboard.");
      } catch (error) {
        setStatus(String((error && error.message) || error));
      }
    }),
  );

  actions.append(
    actionButton("Open", "", () => {
      chrome.tabs.create({ url: draft.key });
      window.close();
    }),
  );

  actions.append(
    actionButton("Delete", "danger", async () => {
      try {
        await send({ type: "draft:delete", key: draft.key });
        setStatus("Draft deleted.");
        await refresh();
      } catch (error) {
        setStatus(String((error && error.message) || error));
      }
    }),
  );

  card.append(actions);
  return card;
}

function render(drafts) {
  listEl.replaceChildren();
  emptyEl.hidden = drafts.length > 0;
  clearButton.disabled = drafts.length === 0;
  for (const draft of drafts) {
    listEl.append(renderDraft(draft));
  }
}

async function refresh() {
  const response = await send({ type: "draft:list" });
  render(response.drafts || []);
}

clearButton.addEventListener("click", async () => {
  if (!window.confirm("Delete every saved draft?")) {
    return;
  }
  try {
    await send({ type: "draft:clear" });
    setStatus("All drafts deleted.");
    await refresh();
  } catch (error) {
    setStatus(String((error && error.message) || error));
  }
});

refresh().catch((error) => {
  setStatus(`Could not load drafts: ${(error && error.message) || error}`);
});
