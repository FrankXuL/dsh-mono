
// Throwaway probe: exercises the BUILT client.js against a fake host, so the
// three T04c fixes can be checked without booting the desktop app (headless
// verification of the app is blocked in this sandbox).
import { readFileSync } from "node:fs";

const built = readFileSync(new URL("../../../client.js", import.meta.url), "utf8");
const patched = built.replace(
  "    return MONO_PLUGIN;",
  "    return { plugin: MONO_PLUGIN, probe: { SessionPicker, pickerIds, pickerScope, mainSessionId, workspaceStart, workspaceOpenTab, workspacePromoteSession, workspaceActivateTab, workspaceGet, workspaceSubscribe, workspaceMoveTab, workspaceSplit, layoutRects, dropEdge, dropTargetAt, showHint, hideHint, hintState: () => ({ wash: hintWash === null ? null : { ...hintWash.style }, line: hintLine === null ? null : { ...hintLine.style } }) } };",
);
if (patched === built) throw new Error("could not patch the bundle");

let failures = 0;
const check = (name, ok, detail) => {
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || detail === undefined ? "" : "  << " + JSON.stringify(detail)));
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fake react: elements as plain objects, hooks that keep no state -------
const makeElement = (type, props, children) => ({ type, props: { ...(props ?? {}), children: children.flat() } });
class FakeComponent {
  constructor(props) { this.props = props; this.state = {}; }
  setState(update) { Object.assign(this.state, typeof update === "function" ? update(this.state) : update); }
}
const fakeReact = {
  Component: FakeComponent,
  createElement: (type, props, ...children) => makeElement(type, props, children),
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

// ---- fake DOM, just enough for style injection and event bookkeeping -------
const styleNodes = [];
const fakeDocument = {
  head: { appendChild: () => {} },
  body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, removeChild() {} },
  getElementById: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} }, parentNode: null }),
  addEventListener() {},
  removeEventListener() {},
  elementFromPoint: () => null,
};
const fakeWindow = { __ModuleLoader__: { load: (entry) => { loaded = entry; } }, addEventListener() {}, removeEventListener() {} };
let loaded;
const factory = new Function("window", "document", "Element", "setTimeout", "clearTimeout", patched);
const doc = { ...fakeDocument };
factory(fakeWindow, doc, class {}, setTimeout, clearTimeout);
const { plugin, probe } = loaded.factory((name) => {
  if (name === "react") return fakeReact;
  return {};
});

// ---- fake host services ----------------------------------------------------
const panels = { active: null, listeners: [] };
const byId = {
  s1: { id: "s1", title: "kspay-ui", cwd: "/w/kspay-ui", retainedBy: { mainView: 1 }, updatedAt: 5 },
  s2: { id: "s2", title: "tmp", cwd: "/w/a/tmp", retainedBy: {}, updatedAt: 4 },
  s3: { id: "s3", title: "tmp", cwd: "/w/b/tmp-2", retainedBy: {}, updatedAt: 3 },
  s4: { id: "s4", title: "New session", cwd: "/w/a", blank: true, retainedBy: {}, updatedAt: 2 },
  s5: { id: "s5", title: "tmp", cwd: "/w/a/tmp2", retainedBy: {}, updatedAt: 1, archived: true },
};
const sessionsService = { list: { getSnapshot: () => ({ ids: ["s1", "s2", "s3", "s4", "s5"], byId }), subscribe: () => () => {} } };
const workspacesService = {
  list: {
    getSnapshot: () => ({
      items: [
        { workspaceId: "wA", path: "/w/a", title: "a", sessionIds: ["s1", "s2", "s4"] },
        { workspaceId: "wB", path: "/w/b", title: "b", sessionIds: ["s3"] },
      ],
      archivedSessionIds: ["s5"],
    }),
  },
};
let workspacesOn = true;
const selectPanelCalls = [];
const ctx = {
  get: (name) => {
    if (name === "layout") {
      return {
        panelInfo: { getSnapshot: () => ({ activePanelId: panels.active }), subscribe: (fn) => { panels.listeners.push(fn); return () => {}; } },
        selectPanel: (id) => selectPanelCalls.push(id),
      };
    }
    if (name === "sessions") return sessionsService;
    if (name === "workspaces") return workspacesOn ? workspacesService : undefined;
    return undefined;
  },
  effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === "function") dispose(); }; },
  slots: { inject: (_name, fn) => { fn(); }, register: (def, component) => { registered.push({ def, component }); return {}; } },
};
const registered = [];
plugin.apply(ctx);

// ---- defect 1: intent must not leak across another global panel ------------
const main = () => ({ tree: probe.workspaceGet()?.tree, panes: probe.workspaceGet()?.panes });
const hostSession = () => "s1";
const fire = () => { for (const fn of panels.listeners.slice()) fn(); };
const bounce = async (active) => { panels.active = active; fire(); await sleep(25); };

probe.workspaceStart("pane-A", "s2");
await bounce("mono");           // entered Mono: intent latched
const tabsAfterEnter = JSON.stringify(main().panes);
await bounce("plugins");        // clicked 插件: intent dropped
selectPanelCalls.length = 0;
await bounce(null);             // clicked a sidebar session
check("d1: 插件面板里点会话不被拽回 Mono", selectPanelCalls.length === 0, selectPanelCalls);
check("d1: 也不往栏里塞 preview 标签", JSON.stringify(main().panes) === tabsAfterEnter, main().panes);

await bounce("mono");           // back to Mono: intent latched again
await bounce(null);             // click a session
check("d1: 回 Mono 后弹回仍然生效", selectPanelCalls.includes("mono"), selectPanelCalls);
check("d1: 弹回时把宿主会话停成 preview 标签", (main().panes["pane-A"]?.tabs ?? []).some((t) => t.sessionId === hostSession() && t.preview), main().panes);

// exit button clears the intent: later reveals must not bounce
const monoRoot = registered.find((r) => r.def?.name === "main")?.component;
const rootProps = { renderSlot: () => null, renderFactorySlot: () => null, sessions: sessionsService.list, SessionProvider: () => null };
const exitBtn = find(monoRoot(rootProps), (el) => el?.props?.["data-mono-exit"] === "true");
check("d1: 出口按钮存在", exitBtn !== undefined);
selectPanelCalls.length = 0;
exitBtn.props.onClick();
await bounce(null);
check("d1: 出口后再点会话不被拽回", !selectPanelCalls.includes("mono"), selectPanelCalls);

// ---- defect 3: the picker lists what the sidebar lists --------------------
const pickerRows = (props) => find(monoRoot(rootProps), (el) => el?.type?.name === "PaneTree").props;
const renderPicker = (pane, ids = ["s1", "s2", "s3", "s4", "s5"]) => {
  const tree = probe.SessionPicker({ paneId: "pane-A", pane, byId, ids, onPick: () => {}, onNew: () => {}, onClose: () => {} });
  return collect(tree, (el) => typeof el?.props?.["data-mono-picker-item"] === "string")
    .map((el) => el.props["data-mono-picker-item"]);
};
const paneA = { tabs: [{ sessionId: "s1", preview: false }], activeIndex: 0 };
check("d3: 只列当前工作区（wA），不列 wB 的 s3", JSON.stringify(renderPicker(paneA).sort()) === JSON.stringify(["s1", "s2"]), renderPicker(paneA));
check("d3: 空白会话只留当前选中的那条", !renderPicker(paneA).includes("s4"));
check("d3: 归档会话不出现在选择器里", !renderPicker(paneA).includes("s5"));
// Without the workspaces service there is no membership and no archive list:
// every session is listed (blank rule still applies, it only needs the row) and
// the cwd suffix on each row is what tells same-titled sessions apart.
workspacesOn = false;
const degraded = renderPicker(paneA);
const degradedTree = probe.SessionPicker({ paneId: "pane-A", pane: paneA, byId, ids: ["s1", "s2", "s3", "s4", "s5"], onPick() {}, onNew() {}, onClose() {} });
workspacesOn = true;
check("d3: 降级（无 workspaces 服务）时退回全量，空白规则仍生效",
  JSON.stringify(degraded.sort()) === JSON.stringify(["s1", "s2", "s3", "s5"]), degraded);
const dirLabels = collect(degradedTree, (el) => el?.props?.className === "mono-picker-dir").map((el) => el.props.children[0]);
check("d3: 每行带 cwd 后缀，同标题 tmp 也能区分", JSON.stringify(dirLabels) === JSON.stringify(["kspay-ui", "tmp", "tmp-2", "tmp2"]), dirLabels);

// ---- defect 2: a pick promotes a tab that is already in the pane ----------
// The bounce above parked the host session (s1) as this pane's preview tab;
// s2, opened at start, is the permanent one.
const tabOf = (sessionId) => main().panes["pane-A"].tabs.find((t) => t.sessionId === sessionId);
const paneTreeProps = pickerRows();
check("d2: 前置条件 s1 是 preview", tabOf("s1")?.preview === true, main().panes["pane-A"]);
probe.workspaceActivateTab("pane-A", 0);
check("d2: 切标签不动 preview（openTabInPane 语义未变）", tabOf("s1")?.preview === true, tabOf("s1"));
paneTreeProps.onPickSession("pane-A", "s1");
check("d2: 选择器点已在本栏的预览标签 -> 转正", tabOf("s1")?.preview === false, tabOf("s1"));

// ---- T05: drop hit test, hint geometry, and the move itself ---------------
// The pane element the fake pointer can hit. `over` decides which attribute
// closest() answers, which is how the strip (merge) is told from content.
const makePaneEl = (paneId, rect, over) => ({
  getAttribute: (name) => (name === "data-mono-pane" ? paneId : null),
  getBoundingClientRect: () => rect,
  closest: (selector) => (over === "strip" && selector === "[data-mono-tabs]" ? {} : selector === "[data-mono-pane]" ? makePaneElSelf : null),
});
let makePaneElSelf = null;
const pointAt = (paneId, x, y, over) => {
  const rect = { left: 0, top: 0, width: 1000, height: 600 };
  const self = { getAttribute: () => paneId, getBoundingClientRect: () => rect };
  const el = {
    getAttribute: (name) => (name === "data-mono-pane" ? paneId : null),
    getBoundingClientRect: () => rect,
    closest: (selector) => (selector === "[data-mono-pane]" ? self : over === "strip" && selector === "[data-mono-tabs]" ? {} : null),
  };
  doc.elementFromPoint = () => el;
  return probe.dropTargetAt(x, y, "pane-A");
};

check("t05: 判向 左半", probe.dropEdge(0.1, 0.5) === "left");
check("t05: 判向 右半", probe.dropEdge(0.9, 0.45) === "right");
check("t05: 判向 上半", probe.dropEdge(0.5, 0.1) === "top");
check("t05: 判向 下半", probe.dropEdge(0.4, 0.95) === "bottom");
check("t05: 判向 等距时优先左右", probe.dropEdge(0.6, 0.6) === "right");

check("t05: 命中 右半 -> edge right", pointAt("pane-B", 900, 300)?.edge === "right", pointAt("pane-B", 900, 300));
check("t05: 命中 左半 -> edge left", pointAt("pane-B", 10, 300)?.edge === "left");
check("t05: 命中 上半 -> edge top", pointAt("pane-B", 500, 10)?.edge === "top");
check("t05: 命中 标签条 -> 合并（edge null）", pointAt("pane-B", 500, 10, "strip")?.edge === null, pointAt("pane-B", 500, 10, "strip"));
check("t05: 自己的栏不是落点", pointAt("pane-A", 900, 300) === null);
doc.elementFromPoint = () => null;
check("t05: 栏外不是落点", probe.dropTargetAt(5, 5, "pane-A") === null);
check("t05: 元素上没有 closest 也不炸", (() => { doc.elementFromPoint = () => ({}); return probe.dropTargetAt(5, 5, "pane-A") === null; })());

// The wash covers the half the new pane will take; the line sits on the split.
probe.showHint(pointAt("pane-B", 900, 300));
const rightHint = probe.hintState();
check("t05: 右半 wash 只盖右半屏", rightHint.wash.left === "500px" && rightHint.wash.width === "500px" && rightHint.wash.height === "600px", rightHint.wash);
check("t05: 分栏线 2px 落在中线", rightHint.line.left === "499px" && rightHint.line.width === "2px" && rightHint.line.height === "600px", rightHint.line);
probe.showHint(pointAt("pane-B", 500, 590));
const bottomHint = probe.hintState();
check("t05: 下半 wash 只盖下半屏", bottomHint.wash.top === "300px" && bottomHint.wash.height === "300px" && bottomHint.wash.width === "1000px", bottomHint.wash);
check("t05: 横线 2px 落在中线", bottomHint.line.top === "299px" && bottomHint.line.width === "1000px" && bottomHint.line.height === "2px", bottomHint.line);
probe.showHint(pointAt("pane-B", 500, 10, "strip"));
check("t05: 合并提示盖整栏、不画线", probe.hintState().wash.width === "1000px" && probe.hintState().line.display === "none", probe.hintState());
probe.hideHint();
check("t05: 无落点时提示隐藏", probe.hintState().wash.display === "none" && probe.hintState().line.display === "none");

// The move itself: A(s2,s1) | B(s3).
const panesOf = () => probe.workspaceGet().panes;
const layout = () => probe.layoutRects(probe.workspaceGet().tree).map((rect) => rect.paneId);
probe.workspaceSplit("pane-A", "pane-B");
probe.workspaceOpenTab("pane-B", "s3", {});
check("t05: 前置 A|B 两栏", JSON.stringify(layout()) === JSON.stringify(["pane-A", "pane-B"]), layout());

probe.workspaceMoveTab("pane-B", "s3", "pane-A", "left", "pane-C");
check("t05: 整栏拖到邻居左半边 -> 同行重排（B 在前）", JSON.stringify(layout()) === JSON.stringify(["pane-B", "pane-A"]), layout());
check("t05: 重排后两栏标签都不动", panesOf()["pane-B"].tabs[0].sessionId === "s3" && panesOf()["pane-A"].tabs.length === 2, panesOf());

probe.workspaceMoveTab("pane-A", "s1", "pane-B", "right", "pane-C");
check("t05: 从多标签栏拖出一个 -> 目标右侧新建栏", JSON.stringify(layout()) === JSON.stringify(["pane-B", "pane-C", "pane-A"]), layout());
check("t05: 新栏只带被拖的那一个标签", JSON.stringify(panesOf()["pane-C"]) === JSON.stringify({ tabs: [{ sessionId: "s1", preview: false }], activeIndex: 0 }), panesOf()["pane-C"]);
check("t05: 原栏留下其余标签", JSON.stringify(panesOf()["pane-A"].tabs.map((tab) => tab.sessionId)) === JSON.stringify(["s2"]), panesOf()["pane-A"]);
check("t05: 活动栏是新建的栏", probe.workspaceGet().active === "pane-C", probe.workspaceGet().active);

probe.workspaceMoveTab("pane-C", "s1", "pane-A", null, "pane-D");
check("t05: 拖回标签条 -> 合并，空栏被移除", JSON.stringify(layout()) === JSON.stringify(["pane-B", "pane-A"]), layout());
check("t05: 合并后标签落在目标栏末尾", JSON.stringify(panesOf()["pane-A"].tabs.map((tab) => tab.sessionId)) === JSON.stringify(["s2", "s1"]), panesOf()["pane-A"]);
check("t05: 合并后活动栏是目标栏", probe.workspaceGet().active === "pane-A", probe.workspaceGet().active);

const beforeGuards = JSON.stringify(probe.workspaceGet());
probe.workspaceMoveTab("pane-A", "s1", "pane-A", "left", "pane-X");
probe.workspaceMoveTab("pane-A", "s1", "pane-nope", "left", "pane-X");
probe.workspaceMoveTab("pane-A", "s1", "pane-B", "diagonal", "pane-X");
check("t05: 同栏 / 未知栏 / 坏边缘 都是 no-op", JSON.stringify(probe.workspaceGet()) === beforeGuards, probe.workspaceGet());

console.log(failures === 0 ? "ALL PROBE CHECKS PASSED" : failures + " PROBE CHECK(S) FAILED");
process.exitCode = failures === 0 ? 0 : 1;

// ---- helpers --------------------------------------------------------------
function collect(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (predicate(node)) { out.push(node); return out; }
  for (const child of node.props?.children ?? []) collect(child, predicate, out);
  return out;
}
function find(node, predicate) { return collect(node, predicate)[0]; }
