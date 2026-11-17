// ---- split tree -> flex boxes ----------------------------------------------
/**
 * Renders the layout tree from layout/tree.js. A split is a flex container in
 * its own direction; each child gets flex-grow = its share of `sizes`. Leaf
 * cells render one Pane each, separated by a visible (not yet draggable) sash.
 */
function PaneTree(props) {
  return h("div", { className: "mono-tree" },
    h(PaneNode, { ...props, node: props.tree }));
}

function PaneNode(props) {
  const { node } = props;
  if (node === null || node === undefined) return h("div", { className: "mono-empty" }, "no layout");

  if (node.type === "leaf") {
    const paneId = node.paneId;
    const active = props.activePaneId === paneId;
    return h("div", {
      className: active ? "mono-pane mono-pane-active" : "mono-pane",
      "data-mono-pane": paneId,
      onMouseDown: () => {
        if (!active && typeof props.onActivate === "function") props.onActivate(paneId);
      },
    },
      h(Pane, {
        sessionId: props.panes?.[paneId] ?? null,
        sessions: props.sessions,
        renderSlot: props.renderSlot,
        renderFactorySlot: props.renderFactorySlot,
        SessionProvider: props.SessionProvider,
      }));
  }

  const count = node.children.length;
  // Sizes come normalized from the tree layer; fall back to an even split so a
  // malformed tree still paints instead of collapsing to zero-width cells.
  const sizes = Array.isArray(node.sizes) && node.sizes.length === count
    ? node.sizes
    : equalSizes(count);
  const cells = [];
  node.children.forEach((child, index) => {
    cells.push(h("div", {
      key: "cell-" + index,
      className: "mono-cell",
      style: { flexGrow: sizes[index] },
    }, h(PaneNode, { ...props, node: child })));
    if (index < count - 1) {
      // Sash size is fixed in flex-basis, so the shares stay the only variable.
      cells.push(h("div", {
        key: "sash-" + index,
        className: "mono-sash",
        "data-mono-sash": node.dir + ":" + index,
        "aria-hidden": true,
      }));
    }
  });

  return h("div", {
    className: "mono-split",
    "data-mono-dir": node.dir,
    style: { flexDirection: node.dir === "column" ? "column" : "row" },
  }, cells);
}
