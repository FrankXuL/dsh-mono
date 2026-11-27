// ---- split tree -> flex boxes ----------------------------------------------
/**
 * Renders the layout tree from layout/tree.js. A split is a flex container in
 * its own direction; each child gets flex-grow = its share of \`sizes\`. Leaf
 * cells render one Pane each, separated by a draggable sash. A sash drag is
 * previewed in the split's own state and committed once, on release.
 */
function PaneTree(props) {
  return h("div", { className: "mono-tree" },
    h(PaneNode, { ...props, node: props.tree }));
}

/** A pane whose last tab was closed: the pane stays, the session does not. */
function PaneEmpty(props) {
  return h("div", { className: "mono-pane-empty", "data-mono-empty": props.paneId },
    h("div", { className: "mono-pane-empty-title" }, "从这里开始"),
    h("button", {
      type: "button",
      className: "mono-pane-empty-btn",
      title: "Open session",
      "aria-label": "Open session",
      onClick: () => props.onOpenSession(props.paneId),
    }, "打开会话"));
}

// ---- sash drag: preview here, commit once on release -----------------------
// The dragged split's own React state carries the preview (it feeds flexGrow);
// nothing touches the store until pointerup, so T06's persistence writes once
// per gesture instead of once per frame. tree.js owns the 8% floor and the
// pixel->share math; this file only turns a pointer into (split, pixels) and
// owns the gesture's lifetime: capture, rAF coalescing, Esc, blur, unmount.

let sashDrag = null;

/** Apply the last pointer position of the frame; returns the previewed sizes. */
function flushSashFrame(drag) {
  const point = drag.pending;
  drag.pending = null;
  if (point === null) return drag.sizes;
  const rect = drag.splitEl.getBoundingClientRect();
  const length = drag.dir === "row" ? rect.width : rect.height;
  const moved = drag.dir === "row" ? point.clientX - drag.startX : point.clientY - drag.startY;
  const sizes = sizesAtBoundary(drag.tree, drag.splitId, drag.index, sashDelta(moved, length));
  if (sizes !== null) {
    drag.sizes = sizes;
    drag.setPreview({ sizes });
  }
  return drag.sizes;
}

function sashFrame() {
  if (sashDrag === null) return;
  sashDrag.frame = 0;
  flushSashFrame(sashDrag);
}

/** Only the newest position matters: at most one frame is ever in flight. */
function sashMove(event) {
  const drag = sashDrag;
  if (drag === null || event.pointerId !== drag.pointerId) return;
  drag.pending = { clientX: event.clientX, clientY: event.clientY };
  if (drag.frame !== 0) return;
  drag.frame = requestAnimationFrame(sashFrame);
}

function sashUp(event) {
  const drag = sashDrag;
  if (drag === null || event.pointerId !== drag.pointerId) return;
  // pointerup and pointercancel both settle where the pointer is; only an
  // explicit cancel (Esc, window blur, unmount) puts the old sizes back.
  endSashDrag(true);
}

function sashKey(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  endSashDrag(false);
}

const sashBlur = () => endSashDrag(false);

/** Tear down the gesture; commit=false restores the store's sizes. */
function endSashDrag(commit) {
  const drag = sashDrag;
  if (drag === null) return;
  sashDrag = null;
  // The pointerup that ends a drag usually has no frame of its own yet: flush
  // it first, so the committed sizes match the pixels the user let go on.
  const sizes = flushSashFrame(drag);
  if (drag.frame !== 0) { cancelAnimationFrame(drag.frame); drag.frame = 0; }
  window.removeEventListener("pointermove", sashMove, true);
  window.removeEventListener("pointerup", sashUp, true);
  window.removeEventListener("pointercancel", sashUp, true);
  window.removeEventListener("keydown", sashKey, true);
  window.removeEventListener("blur", sashBlur, true);
  document.body.classList.remove("mono-sash-dragging");
  try {
    if (drag.sashEl.hasPointerCapture?.(drag.pointerId)) {
      drag.sashEl.releasePointerCapture(drag.pointerId);
    }
  } catch { /* the capture is already gone */ }
  if (commit && sizes !== null) workspaceSetSplitSizes(drag.splitId, sizes);
  drag.setPreview(null);
}

/** For plugin teardown: a drag must not keep listeners across an unload. */
function cancelSashDrag() {
  if (sashDrag !== null) endSashDrag(false);
}

function beginSashDrag(event, props, node, index, setPreview) {
  if (sashDrag !== null || event.button !== 0) return;
  const sashEl = event.currentTarget;
  const splitEl = sashEl.parentElement;
  // Only a split the painted tree still holds may move.
  if (splitEl === null || findSplit(props.tree, node.id) === null) return;
  event.preventDefault(); // no text selection under the pointer
  sashDrag = {
    splitId: node.id,
    index,
    dir: node.dir,
    tree: props.tree,
    splitEl,
    sashEl,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    pending: null,
    frame: 0,
    sizes: null,
    setPreview,
  };
  try { sashEl.setPointerCapture(event.pointerId); } catch { /* window listeners still track it */ }
  document.body.classList.add("mono-sash-dragging");
  window.addEventListener("pointermove", sashMove, true);
  window.addEventListener("pointerup", sashUp, true);
  window.addEventListener("pointercancel", sashUp, true);
  window.addEventListener("keydown", sashKey, true);
  window.addEventListener("blur", sashBlur, true);
}

// ---- pane entry: slide in, then mount the heavy body -----------------------
// T08. A pane a split just created slides in from its own edge while the split's
// shares ease (CSS, .mono-cell); its body — the host conversation — mounts only
// after the slide, so a large session cannot stall the animation. Reduced motion
// skips both: no offset, body mounted immediately.
const ENTER_MS = 150; // keep in step with the .mono-pane-enter duration in style.css

const prefersReducedMotion = () => (
  typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
);

function PaneLeaf(props) {
  const { paneId, enter } = props;
  const active = props.activePaneId === paneId;
  // panes can still hold the T03 shape; paneOf upgrades it on read.
  const pane = paneOf(props.panes, paneId);
  const tab = pane.tabs[pane.activeIndex];
  // Read once: adding a sibling must not restart a pane's entry animation.
  const [entering, setEntering] = react.useState(() => (
    enter !== undefined && (enter.x !== 0 || enter.y !== 0) && !prefersReducedMotion()
  ));
  react.useEffect(() => {
    if (!entering) return undefined;
    const timer = window.setTimeout(() => setEntering(false), ENTER_MS);
    return () => window.clearTimeout(timer);
  }, [entering]);
  return h("div", {
    className: entering ? "mono-pane mono-pane-enter" + (active ? " mono-pane-active" : "")
      : active ? "mono-pane mono-pane-active" : "mono-pane",
    "data-mono-pane": paneId,
    style: entering ? { "--mono-enter-x": enter.x + "px", "--mono-enter-y": enter.y + "px" } : undefined,
    onMouseDown: () => {
      if (!active && typeof props.onActivate === "function") props.onActivate(paneId);
    },
  },
    h(TabStrip, {
      paneId,
      pane,
      byId: props.byId,
      ids: props.ids,
      onPickSession: props.onPickSession,
      onActivateTab: props.onActivateTab,
      onCloseTab: props.onCloseTab,
      onPromoteTab: props.onPromoteTab,
      onOpenSession: props.onOpenSession,
    }),
    entering ? null : tab === undefined
      ? h(PaneEmpty, { paneId, onOpenSession: props.onOpenSession })
      : h(Pane, {
        // key: switching tabs must remount the native conversation, otherwise
        // the SessionProvider keeps the old session's scope.
        key: tab.sessionId,
        sessionId: tab.sessionId,
        sessions: props.sessions,
        renderSlot: props.renderSlot,
        renderFactorySlot: props.renderFactorySlot,
        SessionProvider: props.SessionProvider,
      }));
}

function PaneNode(props) {
  const { node } = props;
  // Preview sizes are local to this split; the committed tree is untouched
  // until the gesture ends.
  const [preview, setPreview] = react.useState(null);
  const splitId = node?.type === "split" ? node.id : null;
  // Unmount must end a drag this split owns: no listener, body class, or
  // pointer capture may outlive the pane (the host unloads panels at will).
  react.useEffect(() => () => {
    if (sashDrag !== null && sashDrag.splitId === splitId) endSashDrag(false);
  }, [splitId]);
  if (node === null || node === undefined) return h("div", { className: "mono-empty" }, "no layout");

  if (node.type === "leaf") return h(PaneLeaf, { ...props, paneId: node.paneId });

  const count = node.children.length;
  // Sizes come normalized from the tree layer; fall back to an even split so a
  // malformed tree still paints instead of collapsing to zero-width cells.
  const base = Array.isArray(node.sizes) && node.sizes.length === count
    ? node.sizes
    : equalSizes(count);
  const sizes = preview !== null && preview.sizes.length === count ? preview.sizes : base;
  const cells = [];
  node.children.forEach((child, index) => {
    cells.push(h("div", {
      key: "cell-" + index,
      className: "mono-cell",
      style: { flexGrow: sizes[index] },
    }, h(PaneNode, { ...props, node: child, enter: enterOffset(node.dir, index, count) })));
    if (index < count - 1) {
      // Sash size is fixed in flex-basis, so the shares stay the only variable.
      cells.push(h("div", {
        key: "sash-" + index,
        className: "mono-sash",
        "data-mono-sash": node.dir + ":" + index,
        // Pointer-only for now: role tells a screen reader what this is, and
        // keyboard resizing was explicitly left out (YAGNI).
        role: "separator",
        "aria-orientation": node.dir === "row" ? "vertical" : "horizontal",
        onPointerDown: (event) => beginSashDrag(event, props, node, index, setPreview),
      }));
    }
  });

  return h("div", {
    className: "mono-split",
    "data-mono-dir": node.dir,
    style: { flexDirection: node.dir === "column" ? "column" : "row" },
  }, cells);
}
