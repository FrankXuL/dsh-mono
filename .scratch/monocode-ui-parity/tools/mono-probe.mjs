
// Throwaway probe: exercises the BUILT client.js against a fake host, so the
// three T04c fixes can be checked without booting the desktop app (headless
// verification of the app is blocked in this sandbox).
import { readFileSync } from "node:fs";

const built = readFileSync(new URL("../../../client.js", import.meta.url), "utf8");
const patched = built.replace(
  "    return MONO_PLUGIN;",
  "    return { plugin: MONO_PLUGIN, probe: { SessionPicker, pickerIds, pickerScope, mainSessionId, workspaceStart, workspaceOpenTab, workspacePromoteSession, workspaceActivateTab, workspaceGet, workspaceSubscribe } };",
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
