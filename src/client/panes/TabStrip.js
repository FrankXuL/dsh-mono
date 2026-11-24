// ---- tab strip: one tab per session in a pane -------------------------------
// A tab's label is the host's own displayTitle (durable title, else workspace
// basename, else id). The tab strip exists because the native session header is
// not obtainable from a third-party pane (Pane.js / plan.md decision 9).
function tabTitle(byId, sessionId) {
  const row = byId?.[sessionId];
  if (typeof row?.title === "string" && row.title !== "") return row.title;
  if (typeof row?.displayTitle === "string" && row.displayTitle !== "") return row.displayTitle;
  return sessionId.slice(0, 8);
}

/**
 * Tabs are divs, not buttons: each one carries its own close button and nesting
 * buttons is invalid. role=tab + key handling keeps them operable from the
 * keyboard; middle click closes, like a browser tab.
 *
 * data-mono-preview / .mono-tab-preview is the transient state: italic title,
 * replaced by the next session opened in this pane, promoted on double click,
 * Enter, or the first prompt sent inside it.
 *
 * The "+" opens the in-pane session picker (SessionPicker), not a bare create:
 * a session opened from the host sidebar reveals the host's panel, and the
 * picker is how the same thing is done without leaving Mono.
 */
function TabStrip(props) {
  const { paneId, pane, byId } = props;
  // Local to one strip: a pane is only remounted (split) with an empty strip,
  // so there is no open picker to lose.
  const [pickerOpen, setPickerOpen] = react.useState(false);
  const items = pane.tabs.map((tab, index) => {
    const title = tabTitle(byId, tab.sessionId);
    const active = index === pane.activeIndex;
    return h("div", {
      key: tab.sessionId,
      className: "mono-tab"
        + (active ? " mono-tab-active" : "")
        + (tab.preview ? " mono-tab-preview" : ""),
      role: "tab",
      tabIndex: active ? 0 : -1,
      "aria-selected": active,
      "aria-label": title,
      title,
      "data-mono-tab": tab.sessionId,
      "data-mono-preview": tab.preview ? "true" : "false",
      // Drag is a gesture on top of the tab: pointerdown arms it, mousedown
      // still activates, and Drag.js decides past 5px whether it is a drag.
      onPointerDown: (event) => beginTabDrag(event, paneId, tab.sessionId),
      onMouseDown: (event) => {
        if (event.button !== 0) return;
        props.onActivateTab(paneId, index);
      },
      onAuxClick: (event) => {
        if (event.button === 1) props.onCloseTab(paneId, index);
      },
      onDoubleClick: () => props.onPromoteTab(paneId, index),
      onKeyDown: (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onActivateTab(paneId, index); }
        else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); props.onCloseTab(paneId, index); }
      },
    },
      h("span", { className: "mono-tab-title" }, title),
      h("button", {
        type: "button",
        className: "mono-tab-close",
        title: "Close tab",
        "aria-label": "Close " + title,
        onMouseDown: (event) => event.stopPropagation(),
        onClick: (event) => { event.stopPropagation(); props.onCloseTab(paneId, index); },
      }, "\u00d7"));
  });
  items.push(h("button", {
    key: "new-tab",
    type: "button",
    className: "mono-tab-add",
    title: "Open session",
    "aria-label": "Open session",
    "aria-expanded": pickerOpen ? "true" : "false",
    "data-mono-tab-add": paneId,
    onMouseDown: (event) => event.stopPropagation(),
    onClick: () => setPickerOpen((open) => !open),
  }, "+"));

  // The wrapper only exists to anchor the popover: .mono-tabs scrolls, and a
  // scrolling box clips an absolutely positioned child.
  return h("div", { className: "mono-tabstrip" },
    h("div", { className: "mono-tabs", role: "tablist", "data-mono-tabs": paneId }, items),
    pickerOpen
      ? h(SessionPicker, {
        paneId,
        pane,
        byId,
        ids: props.ids,
        onPick: (sessionId) => {
          setPickerOpen(false);
          if (typeof props.onPickSession === "function") props.onPickSession(paneId, sessionId);
        },
        onNew: () => { setPickerOpen(false); props.onOpenSession(paneId); },
        onClose: () => setPickerOpen(false),
      })
      : null);
}
