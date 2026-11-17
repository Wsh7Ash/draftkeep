import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function read(relative) {
  return readFileSync(join(root, relative), "utf8");
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

test("manifest is Manifest V3 with a module service worker", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.equal(manifest.background.type, "module");
});

test("every referenced manifest file exists", () => {
  assert.ok(existsSync(join(root, manifest.background.service_worker)));
  assert.ok(existsSync(join(root, manifest.action.default_popup)));
  for (const script of manifest.content_scripts) {
    for (const file of script.js) {
      assert.ok(existsSync(join(root, file)), `${file} is missing`);
    }
  }
});

test("permissions stay minimal", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});

test("content script only runs on http and https pages", () => {
  assert.deepEqual(manifest.content_scripts[0].matches, ["http://*/*", "https://*/*"]);
  assert.equal(manifest.content_scripts[0].all_frames, false);
});

test("version matches package.json", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(manifest.version, pkg.version);
});

test("service worker imports the shared core and handles every message", () => {
  const worker = read("src/background.js");
  assert.match(worker, /from "\.\/core\/drafts\.js"/);
  for (const type of [
    "draft:update",
    "draft:plan",
    "draft:list",
    "draft:get",
    "draft:delete",
    "draft:clear",
  ]) {
    assert.ok(worker.includes(type), `${type} is not handled`);
  }
});

test("content script talks to the worker and never touches storage", () => {
  const collector = read("src/content/collector.js");
  assert.ok(collector.includes("draft:update"));
  assert.ok(collector.includes("draft:plan"));
  assert.ok(collector.includes("draft:restore"));
  assert.ok(!collector.includes("chrome.storage"));
  assert.ok(!collector.includes("innerHTML"));
});

test("popup has no inline script and uses its module file", () => {
  const html = read("src/popup/popup.html");
  assert.ok(html.includes('type="module" src="popup.js"'));
  assert.ok(!/<script(?![^>]*src=)/i.test(html));
  assert.ok(existsSync(join(root, "src/popup/popup.css")));
});

test("no remote code or eval in extension sources", () => {
  const files = walk(join(root, "src")).filter((path) => path.endsWith(".js"));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.ok(!/https?:\/\//.test(text), `${file} contains a remote URL`);
    assert.ok(!/\beval\s*\(/.test(text), `${file} uses eval`);
    assert.ok(!/new Function\s*\(/.test(text), `${file} uses new Function`);
  }
});
