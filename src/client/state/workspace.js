// ---- workspace state (page level) ------------------------------------------
// The host mounts exactly one main-panel entry at a time, and every session
// open from its sidebar reveals the Conversation (layout.selectPanel(null)).
// Switching panels unmounts MonoRoot, so tab state cannot live in component
// state: it lives here, outside React, and survives leaving the panel.
//
// Shape:
//   { tree, active,
//     panes: { [paneId]: { tabs: [{ sessionId, preview }], activeIndex } } }
// T03 wrote panes[paneId] = sessionId | null. paneOf() upgrades that on read,
// so an old in-memory object (or, from T06, a stored one) keeps working.
//
// preview: a transient tab — opening another session in the same pane replaces
// it instead of appending. Double-click or the first message promotes it.

let workspaceState = null;
let hostSelection = null;
const workspaceListeners = new Set();

const emptyPane = () => ({ tabs: [], activeIndex: 0 });

const clampIndex = (index, length) => {
  if (length <= 0) return 0;
  const value = Number.isFinite(index) ? Math.floor(index) : 0;
  return value < 0 ? 0 : value > length - 1 ? length - 1 : value;
};

/** One pane, upgraded from the T03 shape when needed. */
function paneOf(panes, paneId) {
  const pane = panes?.[paneId];
  if (pane !== null && typeof pane === "object" && Array.isArray(pane.tabs)) {
    return { tabs: pane.tabs, activeIndex: clampIndex(pane.activeIndex, pane.tabs.length) };
  }
  const sessionId = typeof pane === "string" && pane !== "" ? pane : null;
  return sessionId === null
    ? emptyPane()
    : { tabs: [{ sessionId, preview: false }], activeIndex: 0 };
}

/** All sessions the layout shows, in pane order (the retain set). */
function paneSessionIds(panes) {
  const ids = [];
  for (const paneId of Object.keys(panes ?? {})) {
    for (const tab of paneOf(panes, paneId).tabs) ids.push(tab.sessionId);
  }
  return ids;
}

// ---- pane edits (pure: pane in, pane out, null when nothing changed) --------
function openTabInPane(pane, sessionId, preview) {
  const index = pane.tabs.findIndex((tab) => tab.sessionId === sessionId);
  // Already open here: focus it. Switching tabs must not touch preview state.
  if (index >= 0) return index === pane.activeIndex ? null : { ...pane, activeIndex: index };
  const tab = { sessionId, preview: preview === true };
  if (tab.preview) {
    // One preview slot per pane: the next open takes the existing slot over.
    const slot = pane.tabs.findIndex((candidate) => candidate.preview);
    if (slot >= 0) {
      const tabs = pane.tabs.slice();
      tabs[slot] = tab;
      return { tabs, activeIndex: slot };
    }
  }
  const tabs = pane.tabs.concat([tab]);
  return { tabs, activeIndex: tabs.length - 1 };
}

function closeTabAt(pane, index) {
  if (index < 0 || index >= pane.tabs.length) return null;
  const tabs = pane.tabs.slice(0, index).concat(pane.tabs.slice(index + 1));
  if (tabs.length === 0) return emptyPane();
  const activeIndex = index < pane.activeIndex ? pane.activeIndex - 1
    : index === pane.activeIndex ? Math.min(index, tabs.length - 1) : pane.activeIndex;
  return { tabs, activeIndex };
}

function promoteTabAt(pane, index) {
  const tab = pane.tabs[index];
  if (tab === undefined || tab.preview !== true) return null;
  const tabs = pane.tabs.slice();
  tabs[index] = { ...tab, preview: false };
  return { tabs, activeIndex: pane.activeIndex };
}

// ---- store -----------------------------------------------------------------
function workspaceGet() { return workspaceState; }

function workspaceSubscribe(listener) {
  workspaceListeners.add(listener);
  return () => { workspaceListeners.delete(listener); };
}

function workspaceUpdate(updater) {
  const previous = workspaceState;
  if (previous === null) return;
  const next = updater(previous);
  if (next === null || next === undefined || next === previous) return;
  workspaceState = next;
  for (const listener of Array.from(workspaceListeners)) {
    try { listener(); } catch (error) { log("workspace listener failed", String(error)); }
  }
}

/** The one pane every layout starts with. Called during render; no notify. */
function workspaceStart(paneId, sessionId) {
  if (workspaceState !== null) return workspaceState;
  workspaceState = {
    tree: leaf(paneId),
    panes: { [paneId]: sessionId ? { tabs: [{ sessionId, preview: false }], activeIndex: 0 } : emptyPane() },
    active: paneId,
  };
  return workspaceState;
}

/** Last Session the host showed (retained as mainView), if seen. */
function workspaceHostSelection() { return hostSelection; }

function workspaceNoteHostSelection(sessionId) {
  if (typeof sessionId === "string" && sessionId !== "") hostSelection = sessionId;
}

function workspaceActivePane() { return workspaceState?.active ?? null; }

function workspaceUpdatePane(paneId, change) {
  workspaceUpdate((previous) => {
    if (typeof paneId !== "string") return previous;
    const pane = paneOf(previous.panes, paneId);
    const next = change(pane);
    if (next === null) return previous;
    return { ...previous, panes: { ...previous.panes, [paneId]: next } };
  });
}

function workspaceOpenTab(paneId, sessionId, options) {
  if (typeof sessionId !== "string" || sessionId === "") return;
  const target = typeof paneId === "string" ? paneId : workspaceActivePane();
  if (target === null) return;
  workspaceUpdate((previous) => {
    const pane = paneOf(previous.panes, target);
    const next = openTabInPane(pane, sessionId, options?.preview === true);
    // Focus the pane even when the tab itself was already showing: an open
    // request names the pane it lands in.
    return { ...previous, active: target, panes: { ...previous.panes, [target]: next ?? pane } };
  });
}

function workspaceCloseTab(paneId, index) {
  workspaceUpdatePane(paneId, (pane) => closeTabAt(pane, index));
}

function workspaceActivateTab(paneId, index) {
  workspaceUpdatePane(paneId, (pane) => (
    index === pane.activeIndex || index < 0 || index >= pane.tabs.length
      ? null
      : { tabs: pane.tabs, activeIndex: index }
  ));
}

function workspacePromoteTab(paneId, index) {
  workspaceUpdatePane(paneId, (pane) => promoteTabAt(pane, index));
}

/** Promote every preview tab showing this session (a message was sent). */
function workspacePromoteSession(sessionId) {
  workspaceUpdate((previous) => {
    let changed = false;
    const panes = { ...previous.panes };
    for (const paneId of Object.keys(previous.panes)) {
      const pane = paneOf(previous.panes, paneId);
      const index = pane.tabs.findIndex((tab) => tab.sessionId === sessionId && tab.preview);
      if (index < 0) continue;
      panes[paneId] = promoteTabAt(pane, index) ?? pane;
      changed = true;
    }
    return changed ? { ...previous, panes } : previous;
  });
}

function workspaceSetActivePane(paneId) {
  workspaceUpdate((previous) => (previous.active === paneId ? previous : { ...previous, active: paneId }));
}

/** Split: the new pane opens empty — it must not copy the neighbour's tabs. */
function workspaceSplit(paneId, newPaneId) {
  workspaceUpdate((previous) => ({
    tree: splitPane(previous.tree, paneId, "row", newPaneId),
    panes: { ...previous.panes, [newPaneId]: emptyPane() },
    active: newPaneId,
  }));
}

// ---- self-check: node src/client/state/workspace.js -------------------------
function workspaceSelfCheck(assert) {
  const tab = (sessionId, preview) => ({ sessionId, preview });

  // T03 shape (one id per pane) upgrades to a tab list.
  assert.deepEqual(paneOf({ a: "s1" }, "a"), { tabs: [tab("s1", false)], activeIndex: 0 });
  assert.deepEqual(paneOf({ a: null }, "a"), emptyPane());
  assert.deepEqual(paneOf({}, "a"), emptyPane());

  // A second session in the same pane replaces the preview instead of appending.
  const one = openTabInPane(emptyPane(), "s1", true);
  assert.deepEqual(one, { tabs: [tab("s1", true)], activeIndex: 0 });
  const two = openTabInPane(one, "s2", true);
  assert.deepEqual(two, { tabs: [tab("s2", true)], activeIndex: 0 });
  // ...but a permanent tab is appended next to it.
  const both = openTabInPane(two, "s3", false);
  assert.deepEqual(both, { tabs: [tab("s2", true), tab("s3", false)], activeIndex: 1 });
  // Switching back to an open session only moves the cursor.
  assert.deepEqual(openTabInPane(both, "s2", true), { tabs: both.tabs, activeIndex: 0 });
  assert.equal(openTabInPane(both, "s3", true), null);

  // Promotion clears the flag once.
  const promoted = promoteTabAt(both, 0);
  assert.deepEqual(promoted, { tabs: [tab("s2", false), tab("s3", false)], activeIndex: 1 });
  assert.equal(promoteTabAt(promoted, 0), null);

  // Closing the active tab picks a neighbour; closing the last keeps the pane.
  assert.deepEqual(closeTabAt(both, 1), { tabs: [tab("s2", true)], activeIndex: 0 });
  assert.deepEqual(closeTabAt(both, 0), { tabs: [tab("s3", false)], activeIndex: 0 });
  assert.deepEqual(closeTabAt(one, 0), emptyPane());

  // activeIndex survives an out-of-range value from a stored layout.
  assert.equal(paneOf({ a: { tabs: [tab("s1", false)], activeIndex: 7 } }, "a").activeIndex, 0);
  assert.equal(paneOf({ a: { tabs: [], activeIndex: 3 } }, "a").activeIndex, 0);

  // The retain set follows every tab of every pane, not just the active ones.
  assert.deepEqual(
    paneSessionIds({ a: { tabs: [tab("s1", false), tab("s2", true)], activeIndex: 0 }, b: "s3" }),
    ["s1", "s2", "s3"],
  );
  console.log("  ok workspace state checks");
}

const isDirectWorkspaceRun = typeof process !== "undefined"
  && typeof window === "undefined"
  && typeof document === "undefined"
  && /(^|[\\/])workspace\.js$/.test(process.argv?.[1] ?? "");

if (isDirectWorkspaceRun) {
  import("node:assert/strict")
    .then(({ default: assert }) => workspaceSelfCheck(assert))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
