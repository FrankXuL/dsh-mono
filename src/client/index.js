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

/** The main-slot panel body: a layout tree whose leaves are native conversations. */
function MonoRoot(props) {
  const sessions = service("sessions");
  const sessionIds = useSessionIds(props.sessions ?? sessions?.list);
  // One pane to start. Persistence is T06; until then the layout dies with the page.
  const [layout, setLayout] = react.useState(() => {
    const paneId = nextPaneId();
    return { tree: leaf(paneId), panes: { [paneId]: sessionIds[0] ?? null }, active: paneId };
  });

  // The session list can arrive after first paint; fill still-blank panes once
  // it does. A pane's session is state (T04 makes it a tab list), not an index.
  react.useEffect(() => {
    if (sessionIds.length === 0) return;
    setLayout((prev) => {
      let changed = false;
      const panes = { ...prev.panes };
      for (const paneId of Object.keys(panes)) {
        if (panes[paneId] === null) { panes[paneId] = sessionIds[0]; changed = true; }
      }
      return changed ? { ...prev, panes } : prev;
    });
  }, [sessionIds]);

  const layoutRef = react.useRef(layout);
  layoutRef.current = layout;

  // Hold every session the layout shows at the root as well as in its pane.
  // Splitting moves a pane into a new parent, so React remounts it: without a
  // root-level hold the pane's own retain is released before the remounted one
  // acquires, the native conversation briefly resolves no binding, and its
  // input shell throws. Ref-counting in session/reference.js makes this free.
  const heldKey = Object.values(layout.panes).filter((id) => typeof id === "string" && id !== "").sort().join(",");
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

  const addPane = (paneId, sessionId) => setLayout((prev) => ({
    tree: splitPane(prev.tree, prev.active, "row", paneId),
    panes: { ...prev.panes, [paneId]: sessionId ?? null },
    active: paneId,
  }));

  const splitActive = () => {
    const paneId = nextPaneId();
    const current = layoutRef.current;
    const used = new Set(Object.values(current.panes));
    const free = sessionIds.find((id) => !used.has(id));
    if (free !== undefined) { addPane(paneId, free); return; }
    // No spare session: ask the host for a fresh one, so the new pane opens a
    // real conversation instead of mirroring the neighbour. T04 gives it tabs.
    if (typeof sessions?.create !== "function") { addPane(paneId, current.panes[current.active]); return; }
    sessions.create({}).then((id) => addPane(paneId, id), (error) => {
      log("new session failed", String(error?.message ?? error));
      addPane(paneId, null);
    });
  };

  return h("div", { className: "mono-root" },
    h("div", { className: "mono-toolbar" },
      h("button", {
        type: "button",
        className: "mono-tool-btn",
        title: "Split right",
        "aria-label": "Split right",
        onClick: splitActive,
      }, "+")),
    h(PaneTree, {
      tree: layout.tree,
      panes: layout.panes,
      activePaneId: layout.active,
      onActivate: (paneId) =>
        setLayout((prev) => (prev.active === paneId ? prev : { ...prev, active: paneId })),
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
    // The `children` declaration is load-bearing: it is what makes the host
    // hand this panel `SessionProvider` and `renderFactorySlot`. Drop it and
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
