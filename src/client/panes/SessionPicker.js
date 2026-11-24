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

/** The session the host's own sidebar treats as current (retainedBy.mainView). */
function mainSessionId(byId) {
  if (byId === undefined || byId === null) return undefined;
  return Object.keys(byId).find((id) => Number(byId[id]?.retainedBy?.mainView ?? 0) > 0);
}

/**
 * Which sessions the host sidebar would show for the pane's workspace, replayed
 * here (ui-workspace/src/client/tree.ts sessionVisible, rows/WorkspaceBrowser.tsx):
 *
 *  - a blank Session is the provisional "New Session" row of its workspace, and
 *    only the host's current one is ever shown;
 *  - archived Sessions are hidden;
 *  - membership is WorkspaceView.sessionIds — the session row carries no
 *    workspace field, so it has to come from the workspaces service. That
 *    service is not in this plugin's inject list (it stays optional): without
 *    it, or without a workspace to anchor on, nothing is filtered by workspace
 *    and each row labels its cwd instead. Degraded mode is recorded in Todo T04c.
 *
 * ponytail: the workspace list is read once per render, not subscribed — the
 * picker lives for a moment, and a stale list only misgroups a row until the
 * next open.
 */
function pickerScope(pane, byId) {
  let snapshot;
  try {
    const list = service("workspaces")?.list;
    if (list === undefined || typeof list.getSnapshot !== "function") return null;
    snapshot = list.getSnapshot();
  } catch (error) {
    log("workspaces snapshot failed", String(error));
    return null;
  }
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const tab = pane?.tabs?.[pane?.activeIndex ?? 0];
  // The workspace the user is looking at: the pane's own session first, else
  // the host's current one.
  for (const sessionId of [tab?.sessionId, mainSessionId(byId)]) {
    if (typeof sessionId !== "string") continue;
    const item = items.find((workspace) => (
      Array.isArray(workspace?.sessionIds) && workspace.sessionIds.includes(sessionId)
    ));
    if (item !== undefined) {
      return {
        members: new Set(item.sessionIds),
        archived: new Set(Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : []),
      };
    }
  }
  return null;
}

/** Last path segment of a cwd: how the sidebar tells same-titled sessions apart. */
function cwdLabel(cwd) {
  if (typeof cwd !== "string" || cwd === "") return "";
  const clean = cwd.replace(/[\\/]+$/, "");
  const at = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return at < 0 ? clean : clean.slice(at + 1);
}

function pickerIds(all, byId, scope) {
  const ids = Array.isArray(all) ? all : [];
  const main = mainSessionId(byId);
  return ids.filter((sessionId) => {
    const row = byId?.[sessionId];
    if (row === undefined) return false;
    if (row.blank === true && sessionId !== main) return false;
    if (scope === null) return true;
    return scope.members.has(sessionId) && !scope.archived.has(sessionId);
  });
}

function SessionPicker(props) {
  const { paneId, pane, byId } = props;
  const held = new Set(pane.tabs.map((tab) => tab.sessionId));
  const ids = pickerIds(props.ids, byId, pickerScope(pane, byId)).slice(0, 12);

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
      const cwd = byId?.[sessionId]?.cwd;
      const dir = cwdLabel(cwd);
      return h("button", {
        key: sessionId,
        type: "button",
        className: "mono-picker-item" + (inPane ? " mono-picker-item-held" : ""),
        title: dir === "" ? title : title + " — " + cwd,
        "data-mono-picker-item": sessionId,
        "data-mono-picker-held": inPane ? "true" : "false",
        onClick: () => props.onPick(sessionId),
      },
        h("span", { className: "mono-picker-title" }, title),
        dir === "" ? null : h("span", { className: "mono-picker-dir" }, dir),
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
