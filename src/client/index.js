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

/** Pane ids only have to be unique within this page; restored ids are already taken. */
let paneSeq = 0;
const nextPaneId = () => {
  const taken = new Set(Object.keys(workspaceGet()?.panes ?? {}));
  let id;
  do { id = "pane-" + ++paneSeq; } while (taken.has(id));
  return id;
};

/**
 * The user's intent to sit in Mono — page-level on purpose: MonoRoot unmounts
 * every time the host reveals a panel of its own, and the bounce has to outlive
 * it. Set true by entering Mono; cleared ONLY by the toolbar exit (T04b: the
 * exit ships with the bounce, otherwise the bounce traps the user).
 */
let monoIntent = false;


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
 * It does call layout.selectPanel("mono") after such an open — but only while
 * the user's intent is Mono (monoIntent below). The toolbar exit clears that
 * intent, and the two ship together: without the exit the bounce would trap
 * the user inside Mono (T04b).
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

/**
 * The session the host is showing: the one it retains for mainView. Read at
 * bounce time, because the reveal does not always change the list (clicking the
 * session that is already selected re-reveals it without a retention delta).
 */
function hostMainSession() {
  const list = service("sessions")?.list;
  if (list === undefined) return undefined;
  try {
    const snapshot = list.getSnapshot();
    const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : [];
    return ids.find((id) => (snapshot.byId?.[id]?.retainedBy?.mainView ?? 0) > 0);
  } catch { return undefined; }
}

/** Reveal Mono when the intent says Mono. No-op when already there. */
function bounceToMono() {
  const layout = service("layout");
  if (layout === undefined || typeof layout.selectPanel !== "function") return;
  try {
    if (layout.panelInfo?.getSnapshot?.()?.activePanelId === PANEL_ID) return;
    layout.selectPanel(PANEL_ID);
  } catch (error) {
    // selectPanel throws when the main key is not registered (host torn down).
    log("bounce back failed", String(error));
  }
}

/**
 * monoIntent is page-level state, so the subscription lives in apply(), not in
 * a component: the host unmounts MonoRoot whenever it reveals one of its own
 * panels, and the intent must survive that. Two rules, no timer between them:
 *  - looking at Mono sets the intent;
 *  - the panel turning into the Conversation never clears it — that reveal is
 *    the host open this feature answers. Only the toolbar exit clears it.
 *
 * Services are resolved lazily and retried like watchSessions: cordis may
 * materialise a service slightly after apply(). The returned disposer is what
 * ctx.effect releases on unload.
 */
function watchPanelIntent() {
  let stopped = false;
  let unlisten = null;
  let attempts = 0;

  const attach = () => {
    if (stopped) return;
    const source = service("layout")?.panelInfo;
    if (source === undefined || typeof source.subscribe !== "function") {
      if (attempts++ < 40) setTimeout(attach, 250);
      return;
    }
    const activePanel = () => {
      try { return source.getSnapshot()?.activePanelId ?? null; } catch { return null; }
    };
    // Opening Mono from the sidebar is the ordinary case; a page that starts on
    // Mono (restored selection) is the same intent.
    if (activePanel() === PANEL_ID) monoIntent = true;
    const off = source.subscribe(() => {
      if (activePanel() === PANEL_ID) {
        monoIntent = true;
        return;
      }
      // Any id other than null is another global panel the user picked on
      // purpose (插件, settings…): drop the intent, they are not coming back to
      // Mono by accident. Clicking a session from inside that panel must leave
      // them there, and watchSessions still parks the session in a Mono tab.
      if (activePanel() !== null) { monoIntent = false; return; }
      // null is the Conversation: the host opened a session, or the user left
      // through it — that is the case that reveals Mono again.
      if (!monoIntent) return;
      // Settle on the next task: the host's reveal transaction finishes first,
      // so the session id below is the one it actually selected.
      setTimeout(() => {
        if (stopped || !monoIntent || activePanel() !== null) return;
        const sessionId = hostMainSession();
        if (sessionId !== undefined) workspaceOpenTab(workspaceActivePane(), sessionId, { preview: true });
        bounceToMono();
      }, 0);
    });
    unlisten = typeof off === "function" ? off
      : off !== undefined && off !== null && typeof off.unsubscribe === "function"
        ? () => off.unsubscribe()
        : null;
  };

  attach();
  return () => {
    stopped = true;
    if (unlisten !== null) {
      try { unlisten(); } catch (error) { log("layout unsubscribe failed", String(error)); }
      unlisten = null;
    }
  };
}

/** Sessions the host has archived: the layout treats them as gone. */
function archivedSessionIds() {
  const list = service("workspaces")?.list;
  if (list === undefined || typeof list.getSnapshot !== "function") return new Set();
  try {
    const ids = list.getSnapshot()?.archivedSessionIds;
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch { return new Set(); }
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
  let primed = false;
  const scan = () => {
    let snapshot;
    try { snapshot = list.getSnapshot(); } catch { return; }
    const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : [];
    const byId = snapshot?.byId ?? {};
    // T06: stored tabs for sessions the host no longer has are dropped here.
    // Only when the list is complete: while phase is 'pending' an empty `ids`
    // means "not loaded yet", and pruning then would erase every tab on boot.
    // Archived sessions stay in the session list (the host keeps their data and
    // offers unarchive), so they are subtracted explicitly: a tab the sidebar
    // no longer shows is a dead tab for this layout.
    if (snapshot?.phase === "ready") {
      const archived = archivedSessionIds();
      const alive = new Set(ids.filter((id) => !archived.has(id)));
      workspaceUpdate((previous) => pruneWorkspaceSessions(previous, alive) ?? previous);
    }
    // ponytail: first positive mainView in list order covers the instant the
    // host holds two (retain new, then release old); the next scan settles it.
    const opened = ids.find((id) => (byId[id]?.retainedBy?.mainView ?? 0) > 0);
    // Only the first scan is the baseline: a session the host already had
    // selected at boot is not a fresh open. The baseline is consumed even when
    // nothing is retained (a page that boots on the home screen), otherwise the
    // first session opened afterwards would be swallowed as the baseline and
    // the bounce would never latch.
    const booting = !primed;
    primed = true;
    if (opened === undefined) return;
    if (!booting && opened !== host) {
      // Mirror the host's open into this pane. The bounce back to Mono is not
      // this branch's job: watchPanelIntent owns it, keyed on the panel turning
      // into the Conversation, because that reveal also happens without a list
      // change (re-clicking the session the host already shows).
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
  // Archiving changes the workspace snapshot (and usually the session list too);
  // subscribing to both means an archive prunes even when ids stay put.
  try { service("workspaces")?.list?.subscribe?.(scan); } catch (error) {
    log("archive watch failed", String(error));
  }
  scan(); // baseline: the current selection is not a new open
}

/**
 * A valid stored layout wins over the fresh one. Runs during render like
 * workspaceStart: the backup key is read once, because a non-null store
 * short-circuits before restoreWorkspaceState is called.
 */
function bootWorkspace(listState) {
  return workspaceGet()
    ?? workspaceRestore(restoreWorkspaceState())
    ?? workspaceStart(nextPaneId(), initialSessionId(listState));
}

/**
 * The layout as it should paint. A restored tab for a session the host no longer
 * has is left out of the very first render, before the scan effect commits the
 * pruned store: painting it would ask the host to retain an unknown session and
 * log a warning for a frame the user never keeps.
 */
function paintedWorkspace(layout, listState) {
  if (listState?.phase !== "ready") return layout;
  const archived = archivedSessionIds();
  const ids = Array.isArray(listState.ids) ? listState.ids : [];
  const alive = new Set(ids.filter((id) => !archived.has(id)));
  return pruneWorkspaceSessions(layout, alive) ?? layout;
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
    ?? bootWorkspace(listState);
  const painted = paintedWorkspace(layout, listState);

  react.useEffect(() => { watchSessions(service("sessions")); }, []);

  // Hold every session the layout shows — every tab of every pane, not just the
  // active one — so switching tabs or splitting never resolves no binding.
  // Splitting moves a pane into a new parent, so React remounts it: without a
  // root-level hold the pane's own retain is released before the remounted one
  // acquires, the native conversation briefly resolves no binding, and its input
  // shell throws. Ref-counting in session/reference.js makes this free.
  const heldKey = Array.from(new Set(paneSessionIds(painted.panes))).sort().join(",");
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

  // The way back to the host's own view, and the only thing that clears the
  // intent: leaving through the host (clicking a sidebar session) is answered
  // by the bounce, so without this button Mono would be a one-way door.
  const exitToHost = () => {
    monoIntent = false;
    const host = service("layout");
    if (host === undefined || typeof host.selectPanel !== "function") { log("no layout service"); return; }
    try { host.selectPanel(null); } catch (error) { log("exit to host failed", String(error)); }
  };

  return h("div", { className: "mono-root" },
    h("div", { className: "mono-toolbar" },
      h("button", {
        type: "button",
        className: "mono-tool-btn",
        title: "Split right",
        "aria-label": "Split right",
        onClick: () => workspaceSplit(layout.active, nextPaneId()),
      }, "+"),
      h("button", {
        type: "button",
        className: "mono-tool-btn mono-tool-exit",
        title: "回到宿主视图",
        "aria-label": "回到宿主视图",
        "data-mono-exit": "true",
        onClick: exitToHost,
      }, "回到宿主视图")),
    h(PaneTree, {
      tree: painted.tree,
      ids: listState?.ids,
      // A pick is an explicit choice, so it promotes. openTabInPane returns
      // early for a tab already in this pane (switching tabs must not promote a
      // preview — that early return is load-bearing elsewhere), so promotion is
      // its own step, before the open.
      onPickSession: (paneId, sessionId) => {
        workspacePromoteSession(sessionId);
        workspaceOpenTab(paneId, sessionId, {});
      },
      panes: painted.panes,
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
  // layout is read for the occupancy and written only on the user's behalf:
  // selectPanel("mono") is the bounce, selectPanel(null) is the exit they asked
  // for by pressing the button.
  inject: ["slots", "layout"],
  apply(ctx) {
    CTX = ctx;
    ensureStyle();
    // Page-level, not panel-level: it has to keep receiving panel switches while
    // MonoRoot is unmounted, and a write on the way out must not be dropped.
    ctx.effect(watchPanelIntent);
    ctx.effect(startWorkspacePersistence);
    // A sash drag holds window listeners, a rAF and a pointer capture; plugin
    // teardown must release all three, not just a panel unmount.
    ctx.effect(() => () => cancelSashDrag());
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
