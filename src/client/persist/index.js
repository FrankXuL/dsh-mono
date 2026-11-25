// ---- persistence -----------------------------------------------------------
// The read/write layer of state/workspace.js — never a second copy of the
// layout. One JSON document holds exactly the store's shape:
//
//   { version: 1,
//     tree:    { type: "split" | "leaf", ... , sizes: [...] },
//     panes:   { [paneId]: { tabs: [{ sessionId, preview }], activeIndex } },
//     active:  paneId }
//
// ponytail: whole-document rewrite, not per-pane keys. One localStorage key is
// ~1KB; a diff format buys nothing and has to be migrated forever.
//
// Restoring is all-or-nothing: a tree node that is not a well-formed leaf or
// split discards the document and the caller falls back to one empty pane. A
// half-restored tree is worse than no tree. Dead session ids are the one
// exception: they are dropped per tab (see pruneWorkspaceSessions), because the
// pane itself is still meaningful and keeps its width.

const PERSIST_KEY = "dsh-mono:workspace:v1";
const PERSIST_VERSION = 1;
// Drag and sash drag notify on every pointermove. 200ms coalescing turns a
// gesture into a handful of writes; pagehide/visibilitychange flush the tail.
const PERSIST_SAVE_DELAY = 200;

const persistIsObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const persistClampIndex = (index, length) => {
  if (length <= 0) return 0;
  const value = Number.isFinite(index) ? Math.floor(index) : 0;
  return value < 0 ? 0 : value > length - 1 ? length - 1 : value;
};

let persistSplitSeq = 0;
const persistNextSplitId = () => "r" + (++persistSplitSeq).toString(36);

/** Store state -> the JSON document (plain data, safe to stringify). */
function captureWorkspace(state) {
  const panes = {};
  for (const paneId of Object.keys(state.panes)) {
    const pane = state.panes[paneId];
    panes[paneId] = {
      tabs: pane.tabs.map((tab) => ({ sessionId: tab.sessionId, preview: tab.preview === true })),
      activeIndex: persistClampIndex(pane.activeIndex, pane.tabs.length),
    };
  }
  return { version: PERSIST_VERSION, tree: state.tree, panes, active: state.active };
}

/**
 * Validate one stored node and rebuild it. paneIds is the seen-leaf set:
 * duplicate pane ids are as invalid as an unknown node type.
 */
function restoreTree(node, paneIds) {
  if (!persistIsObject(node)) return null;
  if (node.type === "leaf") {
    if (typeof node.paneId !== "string" || node.paneId === "" || paneIds.has(node.paneId)) return null;
    paneIds.add(node.paneId);
    return { type: "leaf", paneId: node.paneId };
  }
  if (node.type !== "split" || (node.dir !== "row" && node.dir !== "column")) return null;
  if (!Array.isArray(node.children) || node.children.length < 2) return null;
  const children = [];
  for (const child of node.children) {
    const restored = restoreTree(child, paneIds);
    if (restored === null) return null;
    children.push(restored);
  }
  const sizes = node.sizes;
  if (!Array.isArray(sizes) || sizes.length !== children.length) return null;
  if (!sizes.every((size) => Number.isFinite(size) && size > 0)) return null;
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!(total > 0)) return null;
  return {
    type: "split",
    // Split ids only feed sash drag (T07); a stored one is reused so the page
    // that restores it addresses the same split it saved.
    id: typeof node.id === "string" && node.id !== "" ? node.id : persistNextSplitId(),
    dir: node.dir,
    children,
    sizes: sizes.map((size) => size / total),
  };
}

/** Every leaf must have a coherent pane; a pane with no entry is half a tree. */
function restorePanes(raw, paneIds) {
  if (!persistIsObject(raw)) return null;
  const panes = {};
  for (const paneId of paneIds) {
    const pane = raw[paneId];
    if (!persistIsObject(pane) || !Array.isArray(pane.tabs)) return null;
    const tabs = [];
    const seen = new Set();
    for (const tab of pane.tabs) {
      if (!persistIsObject(tab) || typeof tab.sessionId !== "string" || tab.sessionId === "") return null;
      // Two tabs for one session would fight over one React key and one retain.
      if (seen.has(tab.sessionId)) return null;
      seen.add(tab.sessionId);
      tabs.push({ sessionId: tab.sessionId, preview: tab.preview === true });
    }
    panes[paneId] = { tabs, activeIndex: persistClampIndex(pane.activeIndex, tabs.length) };
  }
  return panes;
}

/** Parsed document -> store state, or null when any part is not ours. */
function restoreWorkspaceData(data) {
  if (!persistIsObject(data) || data.version !== PERSIST_VERSION) return null;
  const paneIds = new Set();
  const tree = restoreTree(data.tree, paneIds);
  if (tree === null || paneIds.size === 0) return null;
  const panes = restorePanes(data.panes, paneIds);
  if (panes === null) return null;
  const firstPaneId = paneIds.values().next().value;
  const active = typeof data.active === "string" && paneIds.has(data.active) ? data.active : firstPaneId;
  return { tree, panes, active };
}

function persistStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/**
 * Read + validate the stored layout. Unknown versions, garbage JSON and illegal
 * nodes all yield null (single-pane fallback) and clear the bad key; nothing
 * here throws at the caller.
 */
function restoreWorkspaceState(storage = persistStorage()) {
  if (storage === null) return null;
  let raw;
  try { raw = storage.getItem(PERSIST_KEY); } catch { return null; }
  if (typeof raw !== "string" || raw === "") return null;
  let data = null;
  try { data = JSON.parse(raw); } catch { data = null; }
  const state = restoreWorkspaceData(data);
  if (state === null) {
    try { storage.removeItem(PERSIST_KEY); } catch {}
  }
  return state;
}

/**
 * Drop tabs whose session the host no longer lists. The pane survives even when
 * every tab in it dies — its leaf and split sizes are untouched — so the empty
 * state keeps the width the user gave it. Returns null when nothing changed, so
 * workspaceUpdate can keep the identity and skip a notify/write.
 */
function pruneWorkspaceSessions(state, aliveIds) {
  if (!persistIsObject(state) || !persistIsObject(state.panes) || !(aliveIds instanceof Set)) return null;
  let changed = false;
  const panes = {};
  for (const paneId of Object.keys(state.panes)) {
    const pane = state.panes[paneId];
    const tabs = Array.isArray(pane?.tabs) ? pane.tabs : [];
    const kept = tabs.filter((tab) => aliveIds.has(tab.sessionId));
    if (kept.length === tabs.length) { panes[paneId] = pane; continue; }
    changed = true;
    const activeSession = tabs[pane.activeIndex]?.sessionId;
    const keptActive = activeSession !== undefined && aliveIds.has(activeSession)
      ? kept.findIndex((tab) => tab.sessionId === activeSession)
      : persistClampIndex(pane.activeIndex, kept.length);
    panes[paneId] = { tabs: kept, activeIndex: keptActive < 0 ? 0 : keptActive };
  }
  return changed ? { ...state, panes } : null;
}

/**
 * Trailing-edge coalescer over a write callback. schedule() is idempotent until
 * the timer fires; flush() writes the pending change immediately (pagehide,
 * visibilitychange) and is a no-op when nothing is dirty.
 */
function createPersistWriter(write, delay = PERSIST_SAVE_DELAY) {
  let timer = null;
  let dirty = false;
  const run = () => {
    timer = null;
    if (!dirty) return;
    dirty = false;
    try { write(); } catch (error) { log("persist write failed", String(error)); }
  };
  return {
    schedule() {
      dirty = true;
      if (timer === null) timer = setTimeout(run, delay);
    },
    flush() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (!dirty) return;
      dirty = false;
      try { write(); } catch (error) { log("persist write failed", String(error)); }
    },
    pending() { return dirty; },
    cancel() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      dirty = false;
    },
  };
}

/**
 * Page-lifetime persistence. Subscribes to the one store; writes are coalesced.
 * Returns the disposer cordis effects expect.
 */
function startWorkspacePersistence() {
  const storage = persistStorage();
  if (storage === null) return undefined;
  const writer = createPersistWriter(() => {
    const state = workspaceGet();
    if (state === null) return;
    storage.setItem(PERSIST_KEY, JSON.stringify(captureWorkspace(state)));
  });
  const unsubscribe = workspaceSubscribe(() => writer.schedule());
  const flush = () => writer.flush();
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") writer.flush();
  };
  if (typeof window !== "undefined") window.addEventListener("pagehide", flush);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  return () => {
    writer.cancel();
    unsubscribe();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", flush);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };
}

// ---- self-check: node src/client/persist/index.js ---------------------------
function persistSelfCheck(assert) {
  const splitTree = {
    type: "split",
    id: "s-test",
    dir: "row",
    sizes: [0.6, 0.4],
    children: [
      { type: "leaf", paneId: "pane-1" },
      { type: "leaf", paneId: "pane-2" },
    ],
  };
  const state = {
    tree: splitTree,
    panes: {
      "pane-1": { tabs: [{ sessionId: "s1", preview: false }, { sessionId: "s2", preview: true }], activeIndex: 1 },
      "pane-2": { tabs: [], activeIndex: 0 },
    },
    active: "pane-2",
  };

  // Round trip: tree (with sizes), tabs, preview flag, activeIndex, active pane.
  const data = captureWorkspace(state);
  assert.equal(data.version, 1);
  assert.deepEqual(restoreWorkspaceData(JSON.parse(JSON.stringify(data))), state);

  // Unknown version and garbage are discarded, never thrown.
  assert.equal(restoreWorkspaceData({ ...data, version: 99 }), null);
  assert.equal(restoreWorkspaceData(null), null);
  assert.equal(restoreWorkspaceData({ version: 1, tree: { type: "wat" }, panes: {} }), null);
  // A split needs two children and one size each.
  assert.equal(restoreWorkspaceData({
    ...data,
    tree: { type: "split", id: "x", dir: "row", sizes: [1], children: [{ type: "leaf", paneId: "pane-1" }] },
  }), null);
  // Duplicate pane ids and missing pane entries are not a half tree to render.
  assert.equal(restoreWorkspaceData({
    ...data,
    tree: { type: "split", id: "x", dir: "row", sizes: [0.5, 0.5], children: [{ type: "leaf", paneId: "pane-1" }, { type: "leaf", paneId: "pane-1" }] },
  }), null);
  assert.equal(restoreWorkspaceData({ ...data, panes: { "pane-1": state.panes["pane-1"] } }), null);
  // Sizes must be positive finite numbers; they renormalize to 1.
  assert.equal(restoreWorkspaceData({ ...data, tree: { ...splitTree, sizes: [0, 1] } }), null);
  assert.deepEqual(restoreWorkspaceData({ ...data, tree: { ...splitTree, sizes: [3, 1] } }).tree.sizes, [0.75, 0.25]);

  // A single leaf is a valid layout (the one-pane case), not a broken tree.
  const single = restoreWorkspaceData({
    version: 1,
    tree: { type: "leaf", paneId: "solo" },
    panes: { solo: { tabs: [{ sessionId: "s1", preview: false }], activeIndex: 0 } },
    active: "solo",
  });
  assert.equal(single.tree.paneId, "solo");
  assert.equal(single.active, "solo");

  // Dead sessions: dropped per tab, active follows the surviving tab, an
  // all-dead pane stays (empty) with its width owned by the tree.
  const pruned = pruneWorkspaceSessions({
    tree: splitTree,
    panes: {
      "pane-1": { tabs: [{ sessionId: "s1", preview: false }, { sessionId: "dead", preview: false }, { sessionId: "s3", preview: false }], activeIndex: 1 },
      "pane-2": { tabs: [{ sessionId: "gone", preview: false }], activeIndex: 0 },
    },
    active: "pane-1",
  }, new Set(["s1", "s3"]));
  assert.deepEqual(pruned.panes["pane-1"], { tabs: [{ sessionId: "s1", preview: false }, { sessionId: "s3", preview: false }], activeIndex: 1 });
  assert.deepEqual(pruned.panes["pane-2"], { tabs: [], activeIndex: 0 });
  assert.equal(pruned.tree, splitTree);
  // Nothing dead -> null, so the store identity (and a write) is skipped.
  assert.equal(pruneWorkspaceSessions(state, new Set(["s1", "s2"])), null);

  // Throttle: N schedules -> one write at the trailing edge; flush is immediate
  // and clears the timer; a flushed writer is not dirty any more.
  let writes = 0;
  const writer = createPersistWriter(() => { writes += 1; }, 10_000);
  writer.schedule();
  writer.schedule();
  writer.schedule();
  assert.equal(writes, 0);
  assert.equal(writer.pending(), true);
  writer.flush();
  assert.equal(writes, 1);
  assert.equal(writer.pending(), false);
  writer.flush();
  assert.equal(writes, 1);
  writer.schedule();
  writer.flush();
  assert.equal(writes, 2);
  writer.cancel();

  console.log("  ok workspace persistence checks");
}

const isDirectPersistRun = typeof process !== "undefined"
  && typeof window === "undefined"
  && typeof document === "undefined"
  && /(^|[\\/])persist[\\/]index\.js$/.test(process.argv?.[1] ?? "");

if (isDirectPersistRun) {
  import("node:assert/strict")
    .then(({ default: assert }) => persistSelfCheck(assert))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
