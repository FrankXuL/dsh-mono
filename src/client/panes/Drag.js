// ---- tab drag: to a pane edge splits, to a tab strip merges -----------------
// Hit testing is geometry only: document.elementFromPoint(x, y), then the
// nearest element carrying OUR [data-mono-pane] attribute. The host's own
// dock attributes (data-dockkit-*, data-sidebar-right-*) are private to its
// dockkit implementation, carry no contract, and must never be read
// (feasibility-matrix.md #30) — so the drop target is always one of our panes.
//
// A drag only starts past DRAG_THRESHOLD px; below it the pointerdown belongs
// to the tab itself (activation, double click, middle click all keep working).
// Once a drag did start, the trailing click is swallowed for a moment so a
// drop never also triggers whatever ended up under the pointer.

const DRAG_THRESHOLD = 5;
const CLICK_GUARD_MS = 400;

/** Which half of a pane a normalized point is in. A tie resolves left/right. */
function dropEdge(nx, ny) {
  if (Math.abs(nx - 0.5) >= Math.abs(ny - 0.5)) return nx < 0.5 ? "left" : "right";
  return ny < 0.5 ? "top" : "bottom";
}

/**
 * Drop target under the pointer, or null. Over the target's own tab strip the
 * edge is null: that is "merge into this pane", not "split this pane".
 */
function dropTargetAt(x, y, fromPaneId) {
  const hit = document.elementFromPoint(x, y);
  if (hit === null || typeof hit.closest !== "function") return null;
  const paneEl = hit.closest("[data-mono-pane]");
  if (paneEl === null) return null;
  const paneId = paneEl.getAttribute("data-mono-pane");
  if (typeof paneId !== "string" || paneId === "" || paneId === fromPaneId) return null;
  const rect = paneEl.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const edge = hit.closest("[data-mono-tabs]") !== null
    ? null
    : dropEdge((x - rect.left) / rect.width, (y - rect.top) / rect.height);
  return { paneId, edge, rect };
}

// ---- the drop hint (two fixed overlays, never in the layout) ---------------
let hintWash = null;
let hintLine = null;

function ensureHint() {
  if (hintWash !== null) return;
  hintWash = document.createElement("div");
  hintWash.className = "mono-drop-wash";
  hintLine = document.createElement("div");
  hintLine.className = "mono-drop-line";
  document.body.appendChild(hintWash);
  document.body.appendChild(hintLine);
}

function hideHint() {
  if (hintWash === null) return;
  hintWash.style.display = "none";
  hintLine.style.display = "none";
}

/** Half-pane wash + a 2px accent line on the edge the split will be made at. */
function showHint(target) {
  ensureHint();
  const rect = target.rect;
  const vertical = target.edge === "left" || target.edge === "right";
  let left = rect.left;
  let top = rect.top;
  let width = rect.width;
  let height = rect.height;
  if (target.edge === "left") width = rect.width / 2;
  else if (target.edge === "right") { left = rect.left + rect.width / 2; width = rect.width / 2; }
  else if (target.edge === "top") height = rect.height / 2;
  else if (target.edge === "bottom") { top = rect.top + rect.height / 2; height = rect.height / 2; }
  hintWash.style.display = "block";
  hintWash.style.left = left + "px";
  hintWash.style.top = top + "px";
  hintWash.style.width = width + "px";
  hintWash.style.height = height + "px";

  if (target.edge === null) { hintLine.style.display = "none"; return; }
  hintLine.style.display = "block";
  if (vertical) {
    hintLine.style.left = (rect.left + rect.width / 2 - 1) + "px";
    hintLine.style.top = rect.top + "px";
    hintLine.style.width = "2px";
    hintLine.style.height = rect.height + "px";
  } else {
    hintLine.style.left = rect.left + "px";
    hintLine.style.top = (rect.top + rect.height / 2 - 1) + "px";
    hintLine.style.width = rect.width + "px";
    hintLine.style.height = "2px";
  }
}

// ---- the gesture -----------------------------------------------------------
let tabDrag = null;

function beginTabDrag(event, paneId, sessionId) {
  if (tabDrag !== null || event.button !== 0) return;
  // The close button lives inside the tab; grabbing it is a click, not a drag.
  if (typeof event.target?.closest === "function" && event.target.closest(".mono-tab-close") !== null) return;
  // Focus first: once the pointer leaves, the browser would otherwise move
  // focus to the body and the drop target would not be reachable by keyboard.
  try { event.currentTarget?.focus?.(); } catch (error) { log("tab focus failed", String(error)); }
  tabDrag = { paneId, sessionId, startX: event.clientX, startY: event.clientY, active: false, target: null };
  window.addEventListener("pointermove", dragMove, true);
  window.addEventListener("pointerup", dragUp, true);
  window.addEventListener("pointercancel", dragCancel, true);
  window.addEventListener("keydown", dragKey, true);
  window.addEventListener("blur", dragBlur, true);
}

function detachDragListeners() {
  window.removeEventListener("pointermove", dragMove, true);
  window.removeEventListener("pointerup", dragUp, true);
  window.removeEventListener("pointercancel", dragCancel, true);
  window.removeEventListener("keydown", dragKey, true);
  window.removeEventListener("blur", dragBlur, true);
}

function dragMove(event) {
  if (tabDrag === null) return;
  const dx = event.clientX - tabDrag.startX;
  const dy = event.clientY - tabDrag.startY;
  if (!tabDrag.active) {
    if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
    tabDrag.active = true;
    document.body.classList.add("mono-dragging");
  }
  event.preventDefault();
  const target = dropTargetAt(event.clientX, event.clientY, tabDrag.paneId);
  tabDrag.target = target;
  if (target === null) hideHint();
  else showHint(target);
}

function dragKey(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  endDrag(true);
}

function dragUp() { endDrag(false); }
function dragCancel() { endDrag(true); }
function dragBlur() { endDrag(true); }

function endDrag(cancelled) {
  if (tabDrag === null) return;
  const drag = tabDrag;
  tabDrag = null;
  detachDragListeners();
  document.body.classList.remove("mono-dragging");
  hideHint();
  if (!drag.active) return;             // a plain click: leave it entirely alone
  guardClick();                          // swallow the click this drag produced
  const target = cancelled ? null : drag.target;
  if (target === null) return;
  // A move is an explicit choice about that tab, so it stops being a preview.
  workspacePromoteSession(drag.sessionId);
  workspaceMoveTab(drag.paneId, drag.sessionId, target.paneId, target.edge, nextPaneId());
}

// ---- click guard -----------------------------------------------------------
// The pointerup that ends a drag still produces a click. It must not reach a
// pane (activation), a tab (double click), or the session picker underneath.
let clickGuardUntil = 0;
let clickGuardOn = false;

function guardClick() {
  clickGuardUntil = Date.now() + CLICK_GUARD_MS;
  if (clickGuardOn) return;
  clickGuardOn = true;
  window.addEventListener("click", swallowClick, true);
}

function swallowClick(event) {
  if (Date.now() >= clickGuardUntil) {
    clickGuardOn = false;
    window.removeEventListener("click", swallowClick, true);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}
