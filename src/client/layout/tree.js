// ---- layout tree -----------------------------------------------------------
// Pure split-tree model: no React, no DOM, no CSS. A leaf is one pane; a split
// owns children laid out along one axis. `row` means left/right and `column`
// means top/bottom — the values name the shape, not the action.
//
// Invariants every exported operation keeps:
//   * every split's sizes sum to 1
//   * a split never holds a child split of the same dir (one group, flat
//     siblings), so four panes split left-to-right stay a row of four
//   * a split keeps at least two children (an only child lifts into its parent)
//
// Kept dependency-free and top-level so scripts/build.mjs can concatenate it.

const MIN_PANE_SHARE = 0.08;
const EPSILON = 1e-6;

const isLeaf = (node) => node?.type === "leaf";
const isSplit = (node) => node?.type === "split";

let splitSeq = 0;
/** Random prefix: an id from an earlier page load cannot collide with a fresh
 *  one if T06 ever persists split ids. */
const splitPrefix = Math.random().toString(36).slice(2, 8);
const nextSplitId = () => `s${splitPrefix}-${(++splitSeq).toString(36)}`;

const leaf = (paneId) => ({ type: "leaf", paneId });

const equalSizes = (count) => Array.from({ length: count }, () => 1 / count);

const normalizeSizes = (sizes) => {
  const clean = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  const total = clean.reduce((sum, size) => sum + size, 0);
  return total > 0 ? clean.map((size) => size / total) : equalSizes(sizes.length);
};

const makeSplit = (dir, children, sizes) => ({
  type: "split",
  id: nextSplitId(),
  dir,
  children,
  sizes: normalizeSizes(sizes ?? equalSizes(children.length)),
});

const containsPane = (node, paneId) => isLeaf(node)
  ? node.paneId === paneId
  : node.children.some((child) => containsPane(child, paneId));

const findSplit = (node, splitId) => {
  if (isLeaf(node)) return null;
  if (node.id === splitId) return node;
  for (const child of node.children) {
    const hit = findSplit(child, splitId);
    if (hit !== null) return hit;
  }
  return null;
};

/** Parent split of a leaf, plus its slot. Null when the leaf is not here. */
const findParent = (node, paneId) => {
  if (isLeaf(node)) return null;
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index];
    if (isLeaf(child) && child.paneId === paneId) return { parent: node, index };
    const hit = findParent(child, paneId);
    if (hit !== null) return hit;
  }
  return null;
};

/**
 * Rebuild bottom-up: drop empty branches, lift an only child, and merge a
 * same-dir child into its parent. The merge is what keeps the flat-group
 * invariant when removing a pane would otherwise leave a row inside a row.
 * Merging keeps geometry: the child's share is divided among its own children.
 */
const canonical = (node) => {
  if (node === null || isLeaf(node)) return node;
  const children = [];
  const sizes = [];
  node.children.forEach((child, index) => {
    const share = node.sizes[index] ?? 0;
    const next = canonical(child);
    if (next === null) return;
    if (isSplit(next) && next.dir === node.dir) {
      next.children.forEach((grandchild, at) => {
        children.push(grandchild);
        sizes.push(share * next.sizes[at]);
      });
      return;
    }
    children.push(next);
    sizes.push(share);
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes: normalizeSizes(sizes) };
};

const replaceNode = (node, target, next) => {
  if (node === target) return next;
  if (isLeaf(node)) return node;
  return {
    ...node,
    children: node.children.map((child) => replaceNode(child, target, next)),
  };
};

/**
 * Split the target leaf along `dir`. Same axis joins the existing group as a
 * sibling (the group re-divides evenly); the other axis nests a new split in
 * the target's slot. `before` puts the new pane left/top of the target.
 */
const splitPane = (tree, targetPaneId, dir, newPaneId, before = false) => {
  if (dir !== "row" && dir !== "column") return tree;
  if (!containsPane(tree, targetPaneId)) return tree;
  return canonical(splitAt(tree, targetPaneId, dir, newPaneId, before));
};

const splitAt = (node, targetPaneId, dir, newPaneId, before) => {
  if (isLeaf(node)) {
    if (node.paneId !== targetPaneId) return node;
    return makeSplit(dir, before
      ? [leaf(newPaneId), node]
      : [node, leaf(newPaneId)]);
  }
  const direct = node.children.findIndex(
    (child) => isLeaf(child) && child.paneId === targetPaneId,
  );
  if (direct >= 0) {
    if (node.dir === dir) {
      const at = before ? direct : direct + 1;
      const children = [
        ...node.children.slice(0, at),
        leaf(newPaneId),
        ...node.children.slice(at),
      ];
      return { ...node, children, sizes: equalSizes(children.length) };
    }
    return {
      ...node,
      children: node.children.map((child, index) => index === direct
        ? makeSplit(dir, before ? [leaf(newPaneId), child] : [child, leaf(newPaneId)])
        : child),
    };
  }
  return {
    ...node,
    children: node.children.map((child) =>
      splitAt(child, targetPaneId, dir, newPaneId, before)),
  };
};

const dropLeaf = (node, paneId) => {
  if (isLeaf(node)) return node.paneId === paneId ? null : node;
  const children = [];
  const sizes = [];
  node.children.forEach((child, index) => {
    const next = dropLeaf(child, paneId);
    if (next === null) return;
    children.push(next);
    sizes.push(node.sizes[index] ?? 0);
  });
  return { ...node, children, sizes };
};

/** Remove one pane. Returns null when it was the last leaf. */
const removePane = (tree, paneId) => {
  if (!containsPane(tree, paneId)) return tree;
  return canonical(dropLeaf(tree, paneId));
};

/** Lift a leaf out of the tree, keeping the leaf object for re-insertion. */
const extractLeaf = (node, paneId) => {
  if (isLeaf(node)) {
    return node.paneId === paneId ? { tree: null, pane: node } : null;
  }
  let pane = null;
  const children = [];
  const sizes = [];
  node.children.forEach((child, index) => {
    const hit = extractLeaf(child, paneId);
    if (hit === null) {
      children.push(child);
      sizes.push(node.sizes[index] ?? 0);
      return;
    }
    pane = hit.pane;
    if (hit.tree !== null) {
      children.push(hit.tree);
      sizes.push(node.sizes[index] ?? 0);
    }
  });
  return pane === null ? null : { tree: { ...node, children, sizes }, pane };
};

const EDGE_AXIS = { left: "row", right: "row", top: "column", bottom: "column" };
const EDGE_BEFORE = { left: true, right: false, top: true, bottom: false };

/**
 * T08: how far (pixels, sign included) a split's child should start offset from
 * its own edge. A child at the end of its axis arrives from that edge, every
 * other child from the start — the pane a split or drop just created is always
 * appended, so the slide points back at where it came from.
 */
const enterOffset = (dir, index, count, distance = 16) => {
  if (dir !== "row" && dir !== "column") return { x: 0, y: 0 };
  if (!Number.isFinite(index) || !Number.isFinite(count) || count < 2) return { x: 0, y: 0 };
  const sign = index >= count - 1 ? 1 : -1;
  return dir === "row"
    ? { x: sign * distance, y: 0 }
    : { x: 0, y: sign * distance };
};

/** Same-group reorder: carry each pane's size with it, never re-divide. */
const reorderInGroup = (tree, parent, fromIndex, toIndex, before) => {
  let at = before ? toIndex : toIndex + 1;
  if (fromIndex < at) at -= 1;
  if (at === fromIndex) return tree;
  const children = [...parent.children];
  const sizes = [...parent.sizes];
  const [child] = children.splice(fromIndex, 1);
  const [size] = sizes.splice(fromIndex, 1);
  children.splice(at, 0, child);
  sizes.splice(at, 0, size);
  return replaceNode(tree, parent, { ...parent, children, sizes });
};

/**
 * Insert a leaf beside the target. Same axis joins the group and takes half of
 * the target's share (every other pane keeps its size); the other axis nests a
 * new split around the target.
 */
const placeBeside = (node, targetPaneId, incoming, dir, before) => {
  if (isLeaf(node)) {
    if (node.paneId !== targetPaneId) return node;
    return makeSplit(dir, before ? [incoming, node] : [node, incoming]);
  }
  const direct = node.children.findIndex(
    (child) => isLeaf(child) && child.paneId === targetPaneId,
  );
  if (direct >= 0) {
    if (node.dir !== dir) {
      return {
        ...node,
        children: node.children.map((child, index) => index === direct
          ? makeSplit(dir, before ? [incoming, child] : [child, incoming])
          : child),
      };
    }
    const children = [...node.children];
    const sizes = [...node.sizes];
    const share = (sizes[direct] ?? 0) / 2;
    sizes[direct] = share;
    const at = before ? direct : direct + 1;
    children.splice(at, 0, incoming);
    sizes.splice(at, 0, share);
    return { ...node, children, sizes };
  }
  return {
    ...node,
    children: node.children.map((child) =>
      placeBeside(child, targetPaneId, incoming, dir, before)),
  };
};

/** Drag `fromPaneId` onto an edge of `toPaneId`. Unknown ids are a no-op. */
const movePane = (tree, fromPaneId, toPaneId, edge) => {
  if (fromPaneId === toPaneId) return tree;
  const dir = EDGE_AXIS[edge];
  if (dir === undefined) return tree;
  const fromAt = findParent(tree, fromPaneId);
  const toAt = findParent(tree, toPaneId);
  if (fromAt === null || toAt === null) return tree;

  if (fromAt.parent === toAt.parent && fromAt.parent.dir === dir) {
    return canonical(reorderInGroup(
      tree, fromAt.parent, fromAt.index, toAt.index, EDGE_BEFORE[edge],
    ));
  }

  const extracted = extractLeaf(tree, fromPaneId);
  if (extracted === null || extracted.tree === null) return tree;
  if (!containsPane(extracted.tree, toPaneId)) return tree;
  return canonical(placeBeside(
    extracted.tree, toPaneId, extracted.pane, dir, EDGE_BEFORE[edge],
  ));
};

/** Normalized rects: the one shared notion of geometry the tree has. */
const layoutRects = (node, rect = { x: 0, y: 0, w: 1, h: 1 }) => {
  if (isLeaf(node)) return [{ paneId: node.paneId, ...rect }];
  const row = node.dir === "row";
  const out = [];
  let offset = 0;
  node.children.forEach((child, index) => {
    const size = node.sizes[index] ?? 0;
    out.push(...layoutRects(child, row
      ? { x: rect.x + offset, y: rect.y, w: size, h: rect.h }
      : { x: rect.x, y: rect.y + offset, w: rect.w, h: size }));
    offset += size;
  });
  return out;
};

const overlapLength = (a0, a1, b0, b1) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Geometric neighbour, not tree sibling: two leaves that share an edge in the
 * rendered layout are adjacent even when they live in different splits.
 * Prefers an overlapping edge, then the smallest gap, then the most overlap.
 */
const neighborPaneId = (tree, paneId, dir) => {
  const rects = layoutRects(tree);
  const current = rects.find((rect) => rect.paneId === paneId);
  if (current === undefined) return null;
  let best = null;
  for (const rect of rects) {
    if (rect.paneId === paneId) continue;
    let gap = 0;
    let overlap = 0;
    if (dir === "left" && rect.x + rect.w <= current.x + EPSILON) {
      gap = current.x - (rect.x + rect.w);
      overlap = overlapLength(current.y, current.y + current.h, rect.y, rect.y + rect.h);
    } else if (dir === "right" && rect.x >= current.x + current.w - EPSILON) {
      gap = rect.x - (current.x + current.w);
      overlap = overlapLength(current.y, current.y + current.h, rect.y, rect.y + rect.h);
    } else if (dir === "up" && rect.y + rect.h <= current.y + EPSILON) {
      gap = current.y - (rect.y + rect.h);
      overlap = overlapLength(current.x, current.x + current.w, rect.x, rect.x + rect.w);
    } else if (dir === "down" && rect.y >= current.y + current.h - EPSILON) {
      gap = rect.y - (current.y + current.h);
      overlap = overlapLength(current.x, current.x + current.w, rect.x, rect.x + rect.w);
    } else {
      continue;
    }
    const aligned = overlap > EPSILON;
    const better = best === null
      || (aligned && !best.aligned)
      || (aligned === best.aligned && gap < best.gap - EPSILON)
      || (aligned === best.aligned && Math.abs(gap - best.gap) <= EPSILON
        && overlap > best.overlap);
    if (better) best = { paneId: rect.paneId, gap, overlap, aligned };
  }
  return best === null ? null : best.paneId;
};

/**
 * Pointer movement along one split's axis -> normalized group units. The
 * caller passes the split's own rect length, so a nested group is measured
 * against itself and not against the whole tree.
 */
const sashDelta = (movedPx, groupPx) => (
  Number.isFinite(movedPx) && Number.isFinite(groupPx) && groupPx > 0
    ? movedPx / groupPx
    : 0
);

/**
 * New sizes for one split after dragging the sash at `index` by `delta`
 * (normalized group units; positive grows the left/top neighbour). Both
 * neighbours stay at or above 8% of the group, or half the pair when the pair
 * is too small for two floors. Returns null when the split is unknown.
 */
const sizesAtBoundary = (tree, splitId, index, delta) => {
  const split = findSplit(tree, splitId);
  if (split === null) return null;
  if (index < 0 || index >= split.sizes.length - 1) return [...split.sizes];
  const sizes = [...split.sizes];
  const pair = sizes[index] + sizes[index + 1];
  const min = Math.min(MIN_PANE_SHARE, pair / 2);
  const step = Number.isFinite(delta) ? delta : 0;
  sizes[index] = Math.min(pair - min, Math.max(min, sizes[index] + step));
  sizes[index + 1] = pair - sizes[index];
  return sizes;
};

/**
 * Replace one split's sizes (a sash commit). Returns the same tree when nothing
 * would change, and null on an unknown split or malformed sizes — the caller
 * then keeps its previous state object, so an abandoned drag writes nothing.
 */
const setSplitSizes = (tree, splitId, sizes) => {
  if (typeof splitId !== "string" || splitId === "") return null;
  if (!Array.isArray(sizes) || !sizes.every((size) => Number.isFinite(size) && size > 0)) return null;
  const split = findSplit(tree, splitId);
  if (split === null || sizes.length !== split.sizes.length) return null;
  const next = normalizeSizes(sizes);
  if (next.every((size, index) => Math.abs(size - split.sizes[index]) <= 1e-9)) return tree;
  return replaceNode(tree, split, { ...split, sizes: next });
};

// ---- self-check ------------------------------------------------------------
// Runs only on `node src/client/layout/tree.js`. The browser bundle wraps this
// file in a factory, where neither `process` nor `window`-less execution holds.

const runSelfChecks = (assert) => {
  const cases = [];
  const test = (name, fn) => cases.push([name, fn]);
  const close = (actual, expected, message) => {
    assert.ok(Math.abs(actual - expected) <= 1e-9, `${message}: ${actual} != ${expected}`);
  };
  const closeSizes = (actual, expected, message) => {
    assert.equal(actual.length, expected.length, message + " length");
    actual.forEach((size, index) => close(size, expected[index], `${message}[${index}]`));
  };
  const shape = (node) => isLeaf(node) ? node.paneId : {
    dir: node.dir,
    sizes: node.sizes.map((size) => Math.round(size * 1e6) / 1e6),
    children: node.children.map(shape),
  };
  const panes = (node) => isLeaf(node) ? [node.paneId] : node.children.flatMap(panes);
  const checkSums = (node) => {
    if (isLeaf(node)) return;
    assert.equal(node.sizes.length, node.children.length, "sizes match children");
    assert.ok(node.children.length >= 2, "split keeps at least two children");
    close(node.sizes.reduce((sum, size) => sum + size, 0), 1, "sizes sum");
    node.children.forEach(checkSums);
  };

  test("leaf carries one pane id", () => {
    assert.deepEqual(leaf("a"), { type: "leaf", paneId: "a" });
  });

  test("splitPane wraps a lone leaf and honours before", () => {
    const base = leaf("a");
    const after = splitPane(base, "a", "row", "b");
    assert.deepEqual(shape(after), { dir: "row", sizes: [0.5, 0.5], children: ["a", "b"] });
    const before = splitPane(base, "a", "row", "b", true);
    assert.deepEqual(shape(before), { dir: "row", sizes: [0.5, 0.5], children: ["b", "a"] });
    const snapshot = JSON.stringify(shape(base));
    splitPane(base, "a", "column", "c");
    assert.equal(JSON.stringify(shape(base)), snapshot, "input tree is not mutated");
    checkSums(after);
  });

  test("same-axis splits stay flat siblings", () => {
    let tree = leaf("a");
    tree = splitPane(tree, "a", "row", "b");
    tree = splitPane(tree, "b", "row", "c");
    tree = splitPane(tree, "c", "row", "d");
    assert.deepEqual(shape(tree), {
      dir: "row", sizes: [0.25, 0.25, 0.25, 0.25], children: ["a", "b", "c", "d"],
    });
    const inserted = splitPane(tree, "a", "row", "z", true);
    assert.deepEqual(shape(inserted), {
      dir: "row", sizes: [0.2, 0.2, 0.2, 0.2, 0.2], children: ["z", "a", "b", "c", "d"],
    });
    checkSums(tree);
    checkSums(inserted);
  });

  test("a perpendicular split nests a new group at the target", () => {
    let tree = splitPane(leaf("a"), "a", "row", "b");
    tree = splitPane(tree, "b", "column", "c");
    assert.deepEqual(shape(tree), {
      dir: "row", sizes: [0.5, 0.5],
      children: ["a", { dir: "column", sizes: [0.5, 0.5], children: ["b", "c"] }],
    });
    checkSums(tree);
  });

  test("nesting keeps alternating axes", () => {
    let tree = splitPane(leaf("a"), "a", "row", "b");
    tree = splitPane(tree, "b", "column", "c");
    tree = splitPane(tree, "c", "row", "d");
    assert.deepEqual(shape(tree), {
      dir: "row", sizes: [0.5, 0.5],
      children: ["a", {
        dir: "column", sizes: [0.5, 0.5],
        children: ["b", { dir: "row", sizes: [0.5, 0.5], children: ["c", "d"] }],
      }],
    });
    checkSums(tree);
  });

  test("removing a pane collapses an only-child split", () => {
    const tree = splitPane(leaf("a"), "a", "row", "b");
    assert.deepEqual(shape(removePane(tree, "b")), "a");
    assert.equal(removePane(leaf("a"), "a"), null);
  });

  test("collapse lifts an only child and merges a same-dir grandchild", () => {
    let tree = leaf("a");
    tree = splitPane(tree, "a", "row", "b");
    tree = splitPane(tree, "b", "column", "c");
    tree = splitPane(tree, "c", "row", "d");
    const next = removePane(tree, "b");
    assert.deepEqual(shape(next), {
      dir: "row", sizes: [0.5, 0.25, 0.25], children: ["a", "c", "d"],
    });
    checkSums(next);
  });

  test("same-group moves reorder children and carry their sizes", () => {
    const tree = makeSplit("row", [leaf("a"), leaf("b"), leaf("c")], [0.6, 0.3, 0.1]);
    const moved = movePane(tree, "a", "c", "right");
    assert.deepEqual(shape(moved), {
      dir: "row", sizes: [0.3, 0.1, 0.6], children: ["b", "c", "a"],
    });
    const back = movePane(moved, "a", "b", "left");
    assert.deepEqual(shape(back), {
      dir: "row", sizes: [0.6, 0.3, 0.1], children: ["a", "b", "c"],
    });
    checkSums(moved);
  });

  test("a perpendicular drop nests the moved pane beside the target", () => {
    let tree = splitPane(leaf("a"), "a", "row", "b");
    tree = splitPane(tree, "b", "row", "c");
    const moved = movePane(tree, "a", "b", "top");
    assert.deepEqual(shape(moved), {
      dir: "row", sizes: [0.5, 0.5],
      children: [{ dir: "column", sizes: [0.5, 0.5], children: ["a", "b"] }, "c"],
    });
    checkSums(moved);
  });

  test("a same-axis drop into another group takes half the target's share", () => {
    let tree = splitPane(leaf("a"), "a", "column", "c");
    tree = splitPane(tree, "a", "row", "b");
    tree = splitPane(tree, "c", "row", "d");
    const moved = movePane(tree, "a", "c", "right");
    assert.deepEqual(shape(moved), {
      dir: "column", sizes: [0.5, 0.5],
      children: ["b", {
        dir: "row", sizes: [0.25, 0.25, 0.5], children: ["c", "a", "d"],
      }],
    });
    checkSums(moved);
  });

  test("normalizeSizes sums to one and equalSizes divides evenly", () => {
    closeSizes(normalizeSizes([1, 1, 2]), [0.25, 0.25, 0.5], "normalize");
    closeSizes(normalizeSizes([0, 0]), [0.5, 0.5], "all-zero fallback");
    closeSizes(equalSizes(4), [0.25, 0.25, 0.25, 0.25], "equal");
    assert.deepEqual(normalizeSizes([]), []);
  });

  test("sash moves clamp both neighbours to 8% of the group", () => {
    const tree = splitPane(leaf("a"), "a", "row", "b");
    closeSizes(sizesAtBoundary(tree, tree.id, 0, 10), [0.92, 0.08], "grow");
    closeSizes(sizesAtBoundary(tree, tree.id, 0, -10), [0.08, 0.92], "shrink");
    assert.equal(sizesAtBoundary(tree, "missing", 0, 1), null);
    closeSizes(sizesAtBoundary(tree, tree.id, 9, 1), [0.5, 0.5], "bad index");
    const nested = splitPane(tree, "b", "column", "c");
    const column = nested.children[1];
    closeSizes(sizesAtBoundary(nested, column.id, 0, 10), [0.92, 0.08], "nested split");
  });

  test("sash clamping works inside a larger group and below two floors", () => {
    const custom = makeSplit("row", [leaf("a"), leaf("b"), leaf("c")], [0.6, 0.3, 0.1]);
    closeSizes(sizesAtBoundary(custom, custom.id, 0, 0.5), [0.82, 0.08, 0.1], "first");
    closeSizes(sizesAtBoundary(custom, custom.id, 1, -1), [0.6, 0.08, 0.32], "second");
    const thin = makeSplit("row", [leaf("a"), leaf("b"), leaf("c")], [0.93, 0.05, 0.02]);
    closeSizes(sizesAtBoundary(thin, thin.id, 1, -1), [0.93, 0.035, 0.035], "thin pair");
  });

  test("sash delta converts pixels to group units, then the floor holds", () => {
    close(sashDelta(100, 800), 0.125, "pixels over group length");
    close(sashDelta(100, 0), 0, "no length");
    close(sashDelta(Number.NaN, 800), 0, "no pointer delta");
    const custom = makeSplit("row", [leaf("a"), leaf("b"), leaf("c")], [0.5, 0.3, 0.2]);
    // 300px over a 1000px group wants +0.3 on the first pane; 8% lifts the
    // second out of the floor and the third keeps its share.
    closeSizes(sizesAtBoundary(custom, custom.id, 0, sashDelta(300, 1000)), [0.72, 0.08, 0.2], "drag");
  });

  test("a sash commit replaces one split's sizes and only that one", () => {
    const tree = splitPane(leaf("a"), "a", "column", "c");
    const nested = splitPane(tree, "a", "row", "b");
    const row = nested.children[0];
    const next = setSplitSizes(nested, row.id, [0.7, 0.3]);
    closeSizes(next.children[0].sizes, [0.7, 0.3], "committed row");
    closeSizes(next.sizes, [0.5, 0.5], "outer untouched");
    // Same sizes -> same tree (the store can skip the write).
    const same = setSplitSizes(next, row.id, [0.7, 0.3]);
    assert.equal(same, next);
    // Garbage -> null, never a half-written tree.
    assert.equal(setSplitSizes(next, row.id, [0, 1]), null);
    assert.equal(setSplitSizes(next, row.id, [0.5]), null);
    assert.equal(setSplitSizes(next, row.id, "nope"), null);
    assert.equal(setSplitSizes(next, "missing", [0.5, 0.5]), null);
    assert.equal(setSplitSizes(next, row.id, [0.3, 0.7]).children[0].sizes[0], 0.3);
  });

  test("enterOffset points back at the edge a new child came from", () => {
    assert.deepEqual(enterOffset("row", 1, 2), { x: 16, y: 0 }, "row, appended");
    assert.deepEqual(enterOffset("row", 0, 2), { x: -16, y: 0 }, "row, prepended");
    assert.deepEqual(enterOffset("column", 2, 3), { x: 0, y: 16 }, "column, appended");
    assert.deepEqual(enterOffset("column", 0, 3), { x: 0, y: -16 }, "column, prepended");
    assert.deepEqual(enterOffset("row", 0, 1), { x: 0, y: 0 }, "single child does not slide");
    assert.deepEqual(enterOffset("diagonal", 1, 2), { x: 0, y: 0 }, "unknown axis does not slide");
  });

  test("neighborPaneId walks geometry in a flat group", () => {
    let tree = splitPane(leaf("a"), "a", "row", "b");
    tree = splitPane(tree, "b", "row", "c");
    assert.equal(neighborPaneId(tree, "a", "right"), "b");
    assert.equal(neighborPaneId(tree, "b", "left"), "a");
    assert.equal(neighborPaneId(tree, "c", "left"), "b");
    assert.equal(neighborPaneId(tree, "a", "left"), null);
    assert.equal(neighborPaneId(tree, "c", "right"), null);
    assert.equal(neighborPaneId(tree, "a", "down"), null);
    assert.equal(neighborPaneId(tree, "zzz", "left"), null);
  });

  test("neighborPaneId finds panes across split boundaries", () => {
    let tree = splitPane(leaf("a"), "a", "row", "b");
    tree = splitPane(tree, "b", "column", "c");
    assert.equal(neighborPaneId(tree, "b", "left"), "a");
    assert.equal(neighborPaneId(tree, "c", "left"), "a");
    assert.equal(neighborPaneId(tree, "b", "down"), "c");
    assert.equal(neighborPaneId(tree, "c", "up"), "b");
    assert.equal(neighborPaneId(tree, "a", "right"), "b");
  });

  test("unknown ids and edges are no-ops", () => {
    const tree = splitPane(leaf("a"), "a", "row", "b");
    assert.equal(removePane(tree, "zzz"), tree);
    assert.equal(splitPane(tree, "zzz", "row", "c"), tree);
    assert.equal(splitPane(tree, "a", "right", "c"), tree);
    assert.equal(movePane(tree, "a", "zzz", "right"), tree);
    assert.equal(movePane(tree, "a", "b", "middle"), tree);
  });

  test("compound: five splits and two closes leave a valid tree", () => {
    let tree = leaf("a");
    tree = splitPane(tree, "a", "row", "b");
    tree = splitPane(tree, "b", "column", "c");
    tree = splitPane(tree, "c", "row", "d");
    tree = splitPane(tree, "d", "column", "e");
    tree = splitPane(tree, "a", "row", "f");
    checkSums(tree);
    tree = removePane(tree, "f");
    tree = removePane(tree, "b");
    assert.deepEqual(shape(tree), {
      dir: "row", sizes: [0.5, 0.25, 0.25],
      children: ["a", "c", { dir: "column", sizes: [0.5, 0.5], children: ["d", "e"] }],
    });
    assert.deepEqual(panes(tree).sort(), ["a", "c", "d", "e"]);
    checkSums(tree);
    layoutRects(tree).forEach((rect) => {
      assert.ok(rect.w >= MIN_PANE_SHARE - 1e-9 && rect.h >= MIN_PANE_SHARE - 1e-9,
        `leaf ${rect.paneId} is smaller than the floor`);
    });
  });

  let failed = 0;
  cases.forEach(([name, fn], index) => {
    try {
      fn();
      console.log(`  ok ${index + 1} - ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  not ok ${index + 1} - ${name}`);
      console.log(String(error?.stack ?? error));
    }
  });
  if (failed > 0) {
    console.log(`${failed} of ${cases.length} checks failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`${cases.length} checks passed`);
};

const isDirectNodeRun = typeof process !== "undefined"
  && typeof window === "undefined"
  && typeof document === "undefined"
  && /(^|[\\/])tree\.js$/.test(process.argv?.[1] ?? "");

if (isDirectNodeRun) {
  import("node:assert/strict")
    .then(({ default: assert }) => runSelfChecks(assert))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
