<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:research -->
<!-- DSH-IDEMPOTENCY-KEY: deck-de847791-5982761 -->
<!-- DSH-CREATED: 2026-11-16T11:25:56.419Z -->
# 01: monocode 交互全清单：它到底让用户做了什么

Type: research

Status: resolved
## Question

把 hardbeat920/monocode 的 **React/Tauri 生产版**（`src/`，不是 `crates/` native 版）交互面穷举成清单。每条写清：用户动作 → 界面反馈 → 背后数据结构 → 源码路径。

必须覆盖：

- **布局**：`src/features/workspace/model/layout.ts`（`LayoutNode` 的 leaf/split、`SplitDir`、同轴 split 归组、sash 拖动与 `MIN_SIZE`、`focusedId`、`editorPanes`/`terminalPanes` 两套 pane 池、`preview` 临时 tab、各种 `new*Tab` 源类型）、`tabGroups.ts`（Chrome 式 tab 组：每组配色/自定义色/logo/mascot、localStorage 键与迁移）、`tabKeys.ts`（全套快捷键表，含 split/focus/cycle/activate）。
- **拖拽**：`paneDrop.ts`（`document.elementFromPoint` + `data-pane-id` 命中、`paneEdgeFromPoint` 边缘判向、拖到标题 tab 条拼接成 tab、侧栏 session 卡片拖成 pane 的外部拖拽 overlay）、`ui/PaneTree.tsx` 与 `SurfaceTabs.tsx` 的落点渲染。
- **文件查看**：`src/features/files/` 全量——`FilePane`/`FileTree`/`FilePreview`/`FileEditor`/`FilePicker`/`BinaryFileView`/`FileTypeIcon`，`model/` 下 fileIndex/fileWatch/filePreview/fileTree/fileViewMode/fileMentions/markdownSource，`editor/` 下 CodeMirror-ish 高亮 worker、git gutter、搜索、lint、autocomplete、mermaid。
- **会话**：`src/features/sessions/`——一个 pane 内切会话、session 卡片、归档、访问权限选择器（`AccessPicker`）、新会话落位。
- **其它一级面**（每个一句"解决什么"，不展开）：source-control / terminal / artifacts / notes / automations / inbox / monos / orchestration / projects / quick-composer / search / skills / connections / notifications / providers / settings / agent-app / workspace。

**交付**：`.scratch/monocode-ui-parity/research/monocode-interactions.md`。表格优先，每行带源码路径；GitHub API 的 contents 接口目录列表会被截断，改用 `git/trees?recursive=1` 或按已知路径直取 raw。

## Comments

### local — 2026-11-16T11:38:55.297Z
## Answer

调查完成，结论落在 `.scratch/monocode-ui-parity/research/monocode-interactions.md`（362 行 / 63 KB / 205 行表格）。基线 commit `09d04436`（monocode-desktop 0.16.0），本地 clone 后 grep+read，所有行号可回溯。

**交互骨架**：项目（ProjectRail）→ 标题 tab（一个 tab = 一个 workspace）→ 每 tab 一棵二分分栏树（`LayoutNode` = leaf | split）→ leaf 是一个 pane → pane 里是「一条会话」或「一个文件/终端 tab 组」，后者分 `editorPanes`/`terminalPanes` 两套池且永不同处一条 tab 条。

**三条推翻票面假设的实证发现**（都已写进文件）：
1. 「Chrome 式 tab 组」在 React 版**没有接线**——`WorkspaceTab.groupId` 零写入点，`segmentTabs`/`joinTabOnto` 零生产调用，`TabGroupMenu` 两个调用点传项目 key 且 `showActions={false}`。真实存在的「组」是 `projectGroups.ts` 的项目分组。所以搬 DSH 时不必复刻 tab 组配色/logo/mascot 那一整套。
2. `diffOpen` 是**死字段**，只有写 `false` 的地方。
3. `data-pane-id` 全仓只有**一处**写入（PaneTree.tsx:717），落点判定不覆盖右侧面板/Mono——对「跨插件拖拽能否拿到别家 slot 落点」是负面信号。

**迁移性价比排序（前 5）**：preview 斜体临时 tab（编辑即转正）→ 拖 pane 边缘分栏 → `elementFromPoint + data-pane-id` 落点协议 → PaneTree 滑入动效 → AccessPicker 四档权限。

**读不全**：13 条单列，最大缺口是 App.tsx（15104 行只读了约 40 个片段）、Sidebar（5872 行）、AgentTranscript（5437 行）、全部样式 CSS、全部其余测试。

未改动插件、依赖或 profile。

交互清单已交付，含三条推翻原始假设的实证发现

## 进度

