// ---- plugin root -----------------------------------------------------------
/** Services resolve lazily: cordis may materialise them after apply() ran. */
let CTX = null;
const service = (name) => {
  try { return CTX?.get(name) ?? undefined; } catch { return undefined; }
};

/** One <style> per page; the CSS text is inlined by scripts/build.mjs. */
function ensureStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const element = document.createElement("style");
  element.id = STYLE_ID;
  element.textContent = MONO_STYLE_TEXT;
  document.head.appendChild(element);
}

/** Sidebar entry icon. Selecting it is the host's job (layout.selectPanel). */
function PanelIcon() {
  return h("svg", {
    viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": true,
    style: { display: "block", pointerEvents: "none" },
  },
    h("rect", { x: 2, y: 4, width: 8, height: 16, rx: 2, fill: "currentColor" }),
    h("rect", { x: 14, y: 4, width: 8, height: 16, rx: 2, fill: "currentColor", opacity: 0.55 }),
  );
}

/** Pane ids only have to be unique within this page. */
let paneSeq = 0;
const nextPaneId = () => "pane-" + ++paneSeq;

/**
 * The host's own session open is not ours to observe: uiWorkspace.openSession
 * reveals the Conversation main panel (layout.selectPanel(null)), which unmounts
 * this one. Its side effects stay visible, and they are what the tab strip
 * mirrors:
 *  - the opened Session is retained with source "mainView" for as long as it is
 *    the host's selection, and the list republishes retainedBy on every retain,
 *    so a new mainView id means "the user just opened a session";
 *  - the prompt sent inside it moves that session's own snapshot, which Pane
 *    reports as a use (see watchPreviewUse below).
 * It never calls layout.selectPanel("mono") to yank the user back: Mono is an
 * addition to the host UI, not a replacement (plan.md decision 1).
 */
// Preview tabs promote when the session is actually used. A session opened from
// the sidebar is prompted in the host's own Conversation panel (opening it
// reveals Conversation and unmounts this one), so the signal cannot live in a
// mounted Pane: it is the session list's updatedAt — the durable message
// timestamp manager.handleSessionActivity publishes on every message. Baselines
// are taken the moment the preview tab exists, so opening a session that already
// has history does not promote it.
const previewBaselines = new Map();
function watchPreviewUse(snapshot) {
  const state = workspaceGet();
  if (state === null) return;
  const previews = new Set();
  for (const paneId of Object.keys(state.panes)) {
    for (const tab of paneOf(state.panes, paneId).tabs) {
      if (tab.preview) previews.add(tab.sessionId);
    }
  }
  for (const sessionId of previews) {
    const updatedAt = snapshot?.byId?.[sessionId]?.updatedAt;
    if (typeof updatedAt !== "number") continue;
    const baseline = previewBaselines.get(sessionId);
    // The first row after an open can be a stale re-projection (updatedAt from
    // the local index, then the live one). Anchoring the baseline at the open
    // moment keeps that delta from reading as a message; only a timestamp newer
    // than the moment the tab opened is one.
    if (baseline === undefined) { previewBaselines.set(sessionId, Math.max(updatedAt, Date.now())); continue; }
    if (updatedAt > baseline) {
      previewBaselines.set(sessionId, updatedAt);
      workspacePromoteSession(sessionId);
    }
  }
  for (const sessionId of Array.from(previewBaselines.keys())) {
    if (!previews.has(sessionId)) previewBaselines.delete(sessionId);
  }
}

let watching = false;
function watchSessions(sessions, attempts = 0) {
  if (watching) return;
  const list = sessions?.list;
  if (list === undefined || typeof list.subscribe !== "function") {
    if (attempts < 40) setTimeout(() => watchSessions(sessions, attempts + 1), 250);
    return;
  }
  watching = true;
  let host = null;
  const scan = () => {
    let snapshot;
    try { snapshot = list.getSnapshot(); } catch { return; }
    const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : [];
    const byId = snapshot?.byId ?? {};
    // ponytail: first positive mainView in list order covers the instant the
    // host holds two (retain new, then release old); the next scan settles it.
    const opened = ids.find((id) => (byId[id]?.retainedBy?.mainView ?? 0) > 0);
    if (opened === undefined) return;
    if (host !== null && opened !== host) {
      workspaceOpenTab(workspaceActivePane(), opened, { preview: true });
    }
    host = opened;
    workspaceNoteHostSelection(opened);
    // After the open request, so a tab created by this scan has its baseline.
    watchPreviewUse(snapshot);
  };
  try { list.subscribe(scan); } catch (error) {
    log("session watch failed", String(error));
    watching = false;
    return;
  }
  scan(); // baseline: the current selection is not a new open
}

/** Session the first pane starts with: the host's last pick, else the newest. */
function initialSessionId(listState) {
  const remembered = workspaceHostSelection();
  if (typeof remembered === "string" && listState?.byId?.[remembered] !== undefined) return remembered;
  const ids = Array.isArray(listState?.ids) ? listState.ids : [];
  return ids[0] ?? null;
}

/** The main-slot panel body: a layout tree whose leaves are tab strips. */
function MonoRoot(props) {
  const sessions = service("sessions");
  const listState = useSessionList(props.sessions ?? sessions?.list);
  // Page-level store: the host unmounts this panel whenever it reveals one of
  // its own, and the tabs have to survive that (state/workspace.js).
  const layout = react.useSyncExternalStore(workspaceSubscribe, workspaceGet, workspaceGet)
    ?? workspaceStart(nextPaneId(), initialSessionId(listState));

  react.useEffect(() => { watchSessions(service("sessions")); }, []);

  // Hold every session the layout shows — every tab of every pane, not just the
  // active one — so switching tabs or splitting never resolves no binding.
  // Splitting moves a pane into a new parent, so React remounts it: without a
  // root-level hold the pane's own retain is released before the remounted one
  // acquires, the native conversation briefly resolves no binding, and its input
  // shell throws. Ref-counting in session/reference.js makes this free.
  const heldKey = Array.from(new Set(paneSessionIds(layout.panes))).sort().join(",");
  const heldRef = react.useRef(new Set());
  react.useEffect(() => {
    if (sessions === undefined || heldKey === "") return;
    for (const id of heldKey.split(",")) {
      if (heldRef.current.has(id)) continue;
      heldRef.current.add(id);
      try { retainSession(sessions, id); } catch (error) { log("retain failed", String(error)); }
    }
    // ponytail: page-lifetime hold, never released. Releasing during a split
    // re-commit lets binding(id) go undefined for one tick and the native
    // conversation.input shell throws; the cost is one extra scope per session
    // per page load. Add release bookkeeping if session churn ever matters.
  }, [sessions, heldKey]);

  // "+" in a pane, or the empty pane's button: a fresh session, opened permanent
  // (an explicit create is not a preview) in the pane it was asked for.
  const openNewSession = (paneId) => {
    const target = typeof paneId === "string" ? paneId : layout.active;
    if (typeof sessions?.create !== "function") { log("no sessions.create"); return; }
    Promise.resolve(sessions.create({})).then(
      (id) => workspaceOpenTab(target, id, {}),
      (error) => log("new session failed", String(error?.message ?? error)),
    );
  };

  return h("div", { className: "mono-root" },
    h("div", { className: "mono-toolbar" },
      h("button", {
        type: "button",
        className: "mono-tool-btn",
        title: "Split right",
        "aria-label": "Split right",
        onClick: () => workspaceSplit(layout.active, nextPaneId()),
      }, "+")),
    h(PaneTree, {
      tree: layout.tree,
      panes: layout.panes,
      byId: listState?.byId,
      activePaneId: layout.active,
      onActivate: workspaceSetActivePane,
      onActivateTab: workspaceActivateTab,
      onCloseTab: workspaceCloseTab,
      onPromoteTab: workspacePromoteTab,
      onOpenSession: openNewSession,
      sessions,
      renderSlot: props.renderSlot,
      renderFactorySlot: props.renderFactorySlot,
      SessionProvider: props.SessionProvider,
    }));
}

const MONO_PLUGIN = {
  inject: ["slots"],
  apply(ctx) {
    CTX = ctx;
    ensureStyle();
    // The \`children\` declaration is load-bearing: it is what makes the host
    // hand this panel \`SessionProvider\` and \`renderFactorySlot\`. Drop it and
    // the panes render the "no SessionProvider" fallback. Cost: with a dead
    // gateway (server restarted under a live page) the host's teardown render
    // of that session-scoped child throws SlotAssemblyError — host noise, no
    // user-visible effect. See .scratch/monocode-ui-parity/issues/07.
    ctx.effect(() => ctx.slots.inject("main", () =>
      ctx.slots.register({
        name: "main",
        key: PANEL_ID,
        children: { [PANE_SLOT]: { kind: "list", scope: "session-maybe" } },
      }, MonoRoot)
    ));

    // Without a sidebar entry the panel is unreachable: nothing calls
    // selectPanel('mono'). The seat is a list of icons.
    ctx.effect(() => {
      try {
        return ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 55,
          label: () => "Mono",
        }, PanelIcon));
      } catch (error) {
        log("panellist registration failed", String(error));
        return undefined;
      }
    });
  },
};
