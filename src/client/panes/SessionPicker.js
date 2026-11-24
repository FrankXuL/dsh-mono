// ---- in-pane session picker: "+" in a tab strip -----------------------------
// The host's own sidebar is the only place to see sessions, and clicking one
// there reveals the host's Conversation panel (unmounting this one). The picker
// is the in-pane way to do the same thing without leaving Mono: an explicit
// pick is a permanent tab, not a preview (T04b item 1).
//
// Titles come from tabTitle() (tab strip) — the same title -> displayTitle ->
// id[0,8] fallback the tabs use: one label source, no second copy of the rule.
//
// ponytail: anchored inside the tab strip, no portal and no collision flip. A
// pane shorter than the list clips the popover at its bottom; add measurement
// only if that ever bites.
function SessionPicker(props) {
  const { paneId, pane, byId } = props;
  const held = new Set(pane.tabs.map((tab) => tab.sessionId));
  const ids = Array.isArray(props.ids) ? props.ids.slice(0, 12) : [];

  // One capture-phase pair for the whole popover: mousedown outside closes,
  // Escape closes. The "+" that owns this picker is ignored so its own click
  // can toggle it shut instead of close-then-reopen.
  react.useEffect(() => {
    const onDown = (event) => {
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest('[data-mono-tab-add="' + paneId + '"]') !== null) return;
        if (target.closest("[data-mono-picker]") !== null) return;
      }
      props.onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    // props.onClose is a fresh closure per render; re-subscribing for it would
    // be pointless. paneId is the only input that changes.
  }, [paneId]);

  const items = ids.length === 0
    ? [h("div", { key: "none", className: "mono-picker-empty" }, "还没有会话")]
    : ids.map((sessionId) => {
      const title = tabTitle(byId, sessionId);
      const inPane = held.has(sessionId);
      return h("button", {
        key: sessionId,
        type: "button",
        className: "mono-picker-item" + (inPane ? " mono-picker-item-held" : ""),
        title,
        "data-mono-picker-item": sessionId,
        "data-mono-picker-held": inPane ? "true" : "false",
        onClick: () => props.onPick(sessionId),
      },
        h("span", { className: "mono-picker-title" }, title),
        inPane ? h("span", { className: "mono-picker-check", "aria-hidden": true }, "\u2713") : null);
    });

  return h("div", {
    className: "mono-picker",
    role: "dialog",
    "aria-label": "Open a session",
    "data-mono-picker": paneId,
  },
    h("button", {
      type: "button",
      className: "mono-picker-new",
      "data-mono-picker-new": "true",
      onClick: () => props.onNew(),
    }, "新建会话"),
    h("div", { className: "mono-picker-head" }, "最近会话"),
    items);
}
