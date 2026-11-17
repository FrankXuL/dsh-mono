# monocode 交互全清单（React/Tauri 生产版）

> 调查对象：`github.com/hardbeat920/monocode` 的 `src/`（React + Tauri 生产版）。
> 基线 commit：`09d04436babb39ad72198cdf22f735067027fc04`（2026-11-12），`package.json` 版本 `monocode-desktop 0.16.0`。
> 方法：`git clone --depth 1` 到 `/tmp/monocode` 后本地 grep + read，所有行号以此为基准。
> 范围：**不含** `crates/`、`src-tauri/`（README 明说 Rust/GPUI native 是实验预览）、`mobile/`。
> 未读到的部分单列在文末「读不全的地方」。

---

## 这是什么产品 / 交互骨架（10 行以内）

MonoCode 是本地编码 agent 的 GUI 外壳：它自己不卖 token，而是把 Claude Code / Codex / opencode / Devin 等已有 CLI harness 包在一个桌面窗口里。

1. **最外层是「项目」**：左侧 ProjectRail 列近期项目，可分组（project groups）、置顶、右侧 Sidebar 有 Sessions / Explorer / Changes / History 四个可拖排序的页签。
2. **中间是「标题 tab 条」**：一个 title tab = 一个 workspace（`WorkspaceTab`）；tab 可以 Chrome 式分组（`groupId` + 每组配色/自定义 hex/logo/mascot）。
3. **每个 title tab 内部是一棵二分分栏树**（`LayoutNode` = leaf | split），leaf 就是一个 pane；pane 里要么是**一条会话**（`SessionPane`），要么是**一个文件/终端 tab 组**（`FilePane` → `SurfaceTabs`）。
4. **会话 pane 与文件 pane 分属两套池**：`editorPanes` 与 `terminalPanes`，两者永不同处一条 tab 条（`isolateTerminalPanes`）。
5. **拖拽是核心手势**：拖 pane 边缘重新分栏、拖 pane 到标题条拆成新 tab、拖侧栏 session 卡进 pane、拖 title tab 到 pane 里合并。
6. **文件面是 VS Code 级别的**：CodeMirror 6 编辑器（shiki 高亮 worker、git gutter+hunk stage、诊断、autocomplete、Ember、mermaid 懒加载、预览/源码双模、图片/视频查看、fuzzy 跳转）。
7. **快捷键可改**：`KEYBINDINGS` 表（约 45 条）+ localStorage 覆盖层 + Tauri 原生菜单加速键三处对齐。
8. **布局可持久化**：`workspaceSnapshot`（tabs + session stub + 项目终端 dock）写快照，重开恢复。
9. 面向 agent 的额外面：Mono（跨项目长期 agent）、Orchestration（派 worker）、Automations（定时/事件触发会话）、Inbox（GitHub PR/issue）、Artifacts、Notes。

一句话：**它卖的是「多 agent 会话 + 文件/终端为一个工作台」的窗口管理**，其余功能都是围绕会话打的辅助面。

---

## 一、布局与分栏

数据模型：`src/features/workspace/model/layout.ts:25-103`

```ts
type LayoutNode = { type:"leaf"; id:string }
               | { type:"split"; id:string; dir:"right"|"down"; children:LayoutNode[]; sizes:number[] }
type WorkspaceTab = { kind:"session"; id; layout; focusedId; editorPanes:EditorPane[]; terminalPanes:EditorPane[]; diffOpen?; diffFocused?; groupId? }
type EditorPane  = { id; files:FilePaneTab[]; activeFileId }
type FilePaneTab = { id; path; cwd; projectCwd?; plan?; releaseNotes?; review?; changes?; changeKind?; sessionChanges?; commit?; agent?; terminal?; foreground?; preview? }
```

| 交互 | 用户动作 | 界面反馈 | 数据结构/状态 | 源码路径:行号 |
|---|---|---|---|---|
| 向右分栏 | `cmd-d` | 当前 pane 右侧等分出新 pane，焦点给新 pane 且 composer 拿焦点 | `splitPane(layout, focusedId, "right", newSessionId)`；新建 `newDefaultSession` 塞进 sessions | `model/layout.ts:856-923`；调用处 `app/App.tsx:3178-3200` |
| 向下分栏 | `shift-cmd-d` | 上下等分 | 同上，`dir:"down"` | `model/layout.ts:862`；`App.tsx:13183-13190` |
| 同轴 split 归组 | （无独立手势，分栏时自动） | 同方向分栏不再套一层 split，而是成为兄弟节点并**等分**（`equalSizes`），已有的 sash 拖动比例被重置 | `splitPaneRelative`：父节点 `node.dir === dir` 时 insert 到 children 并 `sizes = equalSizes(n)` | `model/layout.ts:885-898` |
| 垂直方向分栏 | 同上 | 父节点方向不同则在目标 leaf 处**嵌套**一个新 split（`children:[leaf,node]`，`sizes:[0.5,0.5]`） | `splitPaneRelative` 的 wrap 分支 | `model/layout.ts:899-914` |
| 左/上侧插入 | 打开文件时若当前会话是空会话（`blocks.length===0`） | 文件 pane 出现在**左侧**而不是右侧 | `openEditorTab(..., { split:"left" })` → `splitPaneRelative(..., before=true)` | `app/App.tsx:6899-6902`；`model/layout.ts:660-666`、`865-923` |
| 拖动 sash 改比例 | 拖 pane 之间的分隔线 | 拖动中实时预览（rAF 节流），松手才提交；`Esc` 取消回原样 | `Sash` 组件：`onPreview` → `setDraft(setSplitRatio(...))`；`onCommit` → `onRatio(splitId,index,ratio)`；`onCancel` → `setDraft(null)`。`setSplitRatio` 走 `splitSizesAtBoundary` | `ui/PaneTree.tsx:1001-1114`（挂载在 `:852-868`）；`model/layout.ts:992-1026` |
| sash 最小尺寸 | — | 相邻两块各自不得小于组内 8% | `const MIN_SIZE = 0.08`；`splitSizesAtBoundary` 里 `min = Math.min(MIN_SIZE, pair/2)` | `model/layout.ts:105`、`1021-1022` |
| sash 拖动时的渲染隔离 | — | 每帧重渲染只发生在树层，session 子树不重渲 | `dragHandlers` 用 `useRef<Map>` 缓存每个 pane 的 pointer down handler；`SessionPane` shallow compare | `ui/PaneTree.tsx:301-314` |
| 焦点 pane | 点击 pane 任意位置 / `cmd-opt-arrows` | 会话 pane 的分栏标题条上圆点亮 accent；文件 pane 高亮 | `tab.focusedId`；`neighborLeafId` 按 rect 相邻 + 边共享（`hit`=0 优先）挑下一个 | `model/layout.ts:1110-1154`；`App.tsx:6148-6155`、`4393-4431` |
| 关闭 pane | pane 标题条 `×`；`cmd-w` 关焦点 tab/pane | 兄弟节点顶替空间，父 split 只剩一个孩子时塌缩；焦点落到兄弟的第一个 leaf | `removePane`（kept.length===1 直接返回该 child）；`siblingLeafId` | `model/layout.ts:941-977`、`1156-1174` |
| 关闭某种 surface 的全部 pane | 关闭最后一个 terminal tab 等 | 该 surface 的池清空 | `closeSurfacePanes(tab, kind)` | `model/layout.ts:979-989` |
| 两套 pane 池隔离 | 把 terminal 拖进文件 pane 的 tab 条 | 终端被强制搬进自己的 pane（必要时 `splitPane(..., "down")`） | `isolateTerminalPanes`：混合时把 terminal 分离，`layout` 里给新 pane 加 `down` 分栏 | `model/layout.ts:455-498` |
| preview 临时 tab（光标 tab） | 单击 Explorer / Changes / 搜索里的文件 | 以斜体标题打开，**下一次 preview 打开会替换它**，不堆 tab | `FilePaneTab.preview?: boolean`；`isPreviewableTab`；`openEditorTab` 找同 pane 内已有 preview 的 index 替换（`:632-640`） | `model/layout.ts:542-556`、`625-655` |
| preview 转正 | 双击 tab（`onDoubleClick`）／双击 title tab 上的 preview 文件／开始编辑 | 斜体消失，成为常驻 tab | `pinEditorFile` 去掉 `preview`；`onFileDirtyChange` 里 `if (dirty) onPinFile(fileId)` | `model/layout.ts:558-573`；`ui/SurfaceTabs.tsx:365`；`app/shell/TitleBar.tsx:406-408`；`App.tsx:6953-6966` |
| tab 复用规则 | 同一路径再次打开 | 直接 focus 已有 tab（跨 pane、跨 title tab 都算命中），不新开 | `editorTabKey(file)` 归一化 key；`openEditorTab` 先 `find` existing pane/file | `model/layout.ts:514-524`、`584-623` |
| tab key 的全部变体 | — | — | `terminal:${id}` / `agent:${sessionId}` / `plan:${blockId}` / `release-notes:${version}` / `commit:${cwd}:${sha}` / `session-changes:${cwd}:${sessionId}` / `changes:${cwd}` / `review:${path}` / `file:${path}` | `model/layout.ts:514-524` |
| workspace-tab 模式的 open 规则 | 设置里文件打开方式 = `workspace`（"Top bar"） | 文件开成**新的 title tab**；同项目复用一个 preview title tab | `openWorkspaceFile(tabs, file, created, insert, pin)`：先找同 key，再找同项目的 `previewWorkspaceFile`，否则 insert | `model/layout.ts:249-299`；`App.tsx:6857-6891` |
| 各 tab 源类型 | — | Plan / Release notes / Commit diff / Session 捕获 diff / 整棵工作树 diff / agent transcript / terminal 各有 tab 工厂 | `newFileTab / newChangesTab / newSessionChangesTab / newCommitTab / newPlanTab / newAgentTab / newTerminalFile / newReleaseNotesWorkspaceTab / newEditorWorkspaceTab / newTerminalWorkspaceTab` | `model/layout.ts:138-334` |
| 虚拟文档判定 | — | plan/release-notes/commit/agent 都不当文件系统 tab；`sessionChanges` 同样不算 | `isVirtualDocumentTab` / `isFilesystemTab` / `isReviewTab` / `isChangesTab` | `model/layout.ts:405-512` |
| Changes tab 的合并 | 在 Changes 里点不同文件 | 复用同一个 Changes tab，只换 `path/focusKind`，并把该 cwd 下的 per-file review tab 丢掉 | `openChangesTab` + `dropPerFileReviewTabs` | `model/layout.ts:673-791` |
| pane 新增/关闭的滑动动画 | 分栏、关闭 pane | 新 pane 从被加入的那条边挤入，关闭的 pane 沿同一方向滑出；邻 pane 跟随移动。进入时先只挂 tab 条（`deferBody`），到达后再挂编辑器 | `enteringPanes/leavingPanes/slideFrom` refs；`paneEnterFrom` 按 rect 贴哪条边决定方向；`collapsedRect`；'fade' 兜底；`duration = 240/200 * pace`，`cubic-bezier(0.32,0.72,0,1)` | `ui/PaneTree.tsx:320-560`、`906-974` |
| 分栏树 props 只在必要时重渲 | — | 别的 tab 的 session 流不会重渲本树 | `samePaneTreeProps`：只比较本树 leaf 对应的 session 引用 + busy cwd 集合 | `ui/PaneTree.tsx:881-904` |
| title tab 顺序/字号/密集 | — | tab 宽度 `w-56 min-w-28`，溢出时左右出现 chevron，滚轮纵向转横向 | `tabStripOverflow`、`scrollTabsBy`、`onWheel` | `app/shell/TitleBar.tsx:1237-1341`；`847-867` |
| 关闭后的焦点去向 | 关 title tab | 焦点落到右邻，末尾则左邻 | `nextDisplayedTabAfterClose` | `model/appViewTabs.ts:46-57` |
| app view / mono 也是 title tab | `cmd-k` 搜索、Inbox、Notes、Automations、Mono | 它们以 id 前缀 `app-view:` / `mono:` 混在 tab 里，不可拖到 pane（`appTabIds` 拦截） | `appViewTabId / monoForTab / isViewTab / reconcileTitleTabOrder` | `model/appViewTabs.ts:1-44`；`app/shell/TitleBar.tsx:789-836` |
| 布局快照持久化 | 关窗重开 | 恢复 tabs（含 tree、editorPanes、terminalPanes、focusedId、groupId）、session stub、项目终端 dock、上次 dock 位置 | `collectWorkspaceSnapshot / parseWorkspaceSnapshot / hydrateWorkspaceSnapshot` | `model/workspaceSnapshot.ts:59-110`、`203-265` |
| 树形摆放原语 | 拖放时用 | — | `placeLayout / replacePaneWithLayout / movePane / placePane` | `model/layout.ts:1293-1434` |

### tabGroups.ts —— Chrome 式 tab 组

**重要更正：** `tabGroups.ts` 里那套「组 = Chrome 式 tab 组，按项目配色/logo/mascot」的 UI，在 React 版里其实是**项目外观**与**项目分组**，不是 title tab 组。线索：
- `TabGroupMenu` 的调用点只有 `app/shell/useProjectMenu.tsx:406`（项目右键菜单）和 `:480`（项目分组菜单），并且 `groupId` 传的是 `projectKey(path)` / `projectGroup.id`。
- `WorkspaceTab.groupId` 在生产代码里**没有任何写入点**（只有 `workspaceSnapshot` 的读回、`applyDetachPaneToTab` 的继承、`removeTabFromGroup` 的迁出、以及 `applyGroupedReorder` 里的 join/leave 计算）；`segmentTabs / joinTabOnto / addTabToGroup / addTabsToNewGroup / ungroupTabs / insertTabInGroup / loadCollapsedTabGroups` **在生产代码里零调用**，只有测试引用。

| 交互 | 用户动作 | 界面反馈 | 数据结构/状态 | 源码路径:行号 |
|---|---|---|---|---|
| 组配色（预设） | 项目/分组右键菜单里点色块 | 该项目的 tab 图标/命名配色变了 | `TAB_GROUP_COLORS`（9 色 HSL），索引存 `monocode:tab-group:colors` | `model/tabGroups.ts:5-16`、`154-205` |
| 组自定义色 | 打开取色器选 hex | 覆盖预设色 | `monocode:tab-group:custom-colors`，须匹配 `/^#[0-9a-fA-F]{6}$/` | `model/tabGroups.ts:27`、`164-217` |
| 组改名 | 菜单顶部输入框 | 项目在 rail / tab 上的显示名变了 | `monocode:tab-group:labels`；`saveTabGroupLabel`；空串=删除，并广播 `monocode:tab-group-labels-changed` | `model/tabGroups.ts:219-242`；`ui/TabGroupMenu.tsx:229-236` |
| 组 logo | 菜单里 `ImagePlus` 按钮选图 | rail/tab/composer 用图片代替文件夹图标 | `monocode:tab-group:logos`（路径字符串）；`logoDisplayRevision` + `monocode:tab-group-logos-changed` | `model/tabGroups.ts:244-253`、`314-317`；`ui/TabGroupMenu.tsx:238-288` |
| 组 mascot | 菜单里一排 mascot swatch | 项目有像素小怪兽 | `monocode:tab-group:mascots`；`null` = 回到按项目名 hash 的默认 | `model/tabGroups.ts:255-266`；`ui/TabGroupMenu.tsx:311-329` |
| 未设色时的默认色 | — | 按项目名 hash 从 9 色里挑（跳过第 0 个灰色） | `tabGroupColor(project)`：`hash*31+c`，`% (len-1) + 1` | `model/tabGroups.ts:18-24` |
| localStorage 键迁移（v2） | 启动时自动 | 旧版按「文件夹名」存的外观键搬到「完整路径」键；一把钥匙分给所有同名项目；有未认领的名字就留个未完成的 pass，下次启动再试 | `KEY_VERSION_KEY = "monocode:tab-group:key-version"`、`KEY_VERSION="2"`、`migrateProjectAppearanceKeys`、`migrateNow`、`looksLikeFolderNameKey` | `model/tabGroups.ts:78-152` |
| 项目移动后重挂 | 项目被重命名/移动 | 外观跟着走 | `rebaseProjectTabGroupSettings(from,to)` | `model/tabGroups.ts:280-298` |
| 清空项目外观 | 「Reset」类动作 | 五个键里该项目的记录全删 | `clearTabGroupSettings` | `model/tabGroups.ts:268-278` |
| 组的作用域限制 | 拖动跨项目的 tab | 一个组不能横跨项目 | `tabGroupProject / canJoinTabGroup / canJoinTabOnto`（未知项目当通配） | `model/tabGroups.ts:378-445` |
| 拖动进/出组的纯函数 | 拖 tab | 落在组中间=加入；拖出=离开；跨项目则 slide past 而不是劈开组 | `applyGroupedReorder`（生产里唯一被用的组逻辑，`App.tsx:4587`）、`slideOutOfGroup` | `model/tabGroups.ts:539-603` |
| 新 tab 继承组 | `cmd-t` 在组内 tab 上 | 新 tab 落在当前 tab 右边并继承组 | `insertTabBesideActive(tabs, tab, activeId, projectOf)`（`App.tsx:2889` 在用） | `model/tabGroups.ts:694-712` |
| 折叠的组 | — | （未接线） | `monocode:tab-groups:collapsed`；`loadCollapsedTabGroups / saveCollapsedTabGroups` **生产零调用** | `model/tabGroups.ts:723-745` |
| **真实存在的「组」UI** | 项目右键 → New group… | rail 里出现 "Groups" 段，组可折叠、可拖排序、有自己的菜单 | `ProjectGroup{id,name,collapsed,colorIndex?,customColor?,mascot?}`；`monocode.projectGroups` / `monocode.projectGroupAssignments` | `features/projects/model/projectGroups.ts:6-30`；`app/shell/ProjectRail.tsx:487-528`、`371-372` |
| 组的菜单动作 | 组标题右键 | 只出现「组名输入框 + logo + 配色 + mascot + Delete group」 | `TabGroupMenuAction` 五个动作（New tab in group / Move group to new window / Close group / Ungroup / Delete group）在 `ITEMS` 里定义，但**两个调用点都传 `showActions={false}`**，所以这五个按钮实际不渲染；`Delete group` 是通过 `extraItems` 单独加回来的 | `ui/TabGroupMenu.tsx:32-37`、`93-122`、`331-366`；`app/shell/useProjectMenu.tsx:437`（项目菜单）、`:523`（分组菜单） |

### tabKeys.ts —— 快捷键表

来源两处，必须对齐：`model/tabKeys.ts:1-32` 的头部注释 + `features/settings/model/settings.ts:1150-1256` 的 `KEYBINDINGS` 表（后者是用户可见、可改的那份）。

| 交互 | 用户动作 | 界面反馈 | 数据结构/状态 | 源码路径:行号 |
|---|---|---|---|---|
| tab 命令解析 | 按键 | 返回 `TabCommand` 联合类型 | `tabCommand(e): TabCommand | null`；先判 `e.isComposing`（中文输入法不误触） | `model/tabKeys.ts:62-112` |
| 新 tab | `cmd-t` | 新 workspace tab | `"new"` | `:101` |
| 关其他 tab | `cmd-opt-t` | 只留当前 | `"close-others"` | `:67-69` |
| 关 tab | `cmd-w` | 关焦点 pane / tab | `"close"` | `:104` |
| 关全部 tab | `shift-cmd-w` | 全关，可能落回空态 | `"close-all"` | `:97` |
| 分栏 | `cmd-d` / `shift-cmd-d` | 见上一节 | `"split-right"` / `"split-down"` | `:105`、`:96` |
| tab 前后 | `shift-cmd-]` / `shift-cmd-[` | 切 tab | `"next"` / `"prev"` | `:90-91` |
| tab 历史后退/前进 | `cmd-[` / `cmd-]` | 浏览器式访问栈（栈深 50） | `"back"/"forward"`；`tabVisitHistory.ts` 的 `recordTabVisit/tabVisitBack/tabVisitForward/pruneTabVisitHistory` | `:107-108`；`model/tabVisitHistory.ts:1-90` |
| 激活第 1–8 个 tab | `cmd-1 … cmd-8` | 切到该序号的 tab（序号是**当前项目**的 tab 列表 `deckProjectTabs`） | `{activate: n}`；`onActivate` | `:109`；`App.tsx:4382-4391` |
| 激活最后一个 tab | `cmd-9` | — | `{activate:-1}` | `:110` |
| 循环 tab | `ctrl-tab` / `ctrl-shift-tab` | 循环下一个/上一个 | `"cycle-next"/"cycle-prev"`；实现复用 onNext/onPrev | `:76-78`；`App.tsx:13077-13078` |
| 焦点移到相邻 pane | `cmd-opt-arrows` | 焦点换 pane | `{focus:FocusDir}` | `:67-73` |
| 新终端 / 新终端 tab | `cmd-`` / `shift-cmd-`` | 项目终端 dock 或独立终端 tab | `"new-terminal" / "new-terminal-tab"` | `:82-84` |
| 切换终端 dock | `cmd-j` | 底部（或上次那侧）终端抽屉开/关 | `"toggle-terminal"` | `:106` |
| 上一个/下一个会话（跨 tab） | `shift-cmd-↑/↓` | 切会话，必要时切 tab | `"prev-session"/"next-session"` | `:92-93` |
| 上一个/下一个会话（本 tab 内） | `cmd-↑/↓` | **在本 tab 的同一 pane 里换会话** | `"prev-session-in-tab"` → `switchSessionInTab` | `:102-103`；`App.tsx:12583-12604` |
| 上一个/下一个项目 | `shift-cmd-←/→` | 切项目 | `"prev-project"/"next-project"` | `:94-95` |
| 归档会话 | `shift-cmd-a` | 焦点会话归档 | `"archive-session"`；先过 `archiveShortcut.ts` 的守卫（终端/编辑器/输入框/有 popover 打开都不抢） | `:89`；`features/sessions/model/archiveShortcut.ts:1-60` |
| 停止正在跑的轮次 | `Esc`（固定键，不可改） | 中断当前 turn | `shouldStopFocusedTurnOnEscape`；`deferUnhandledEscape` 让 Settings 等 surface 先吃掉 Esc | `model/tabKeys.ts:231-267`；`settings.ts:1205-1209` |
| 快捷键 ↔ 命令名映射 | 设置页改键 | 设置面板里显示可读名字（`Tab: New`、`Pane: Split Right`…） | `TAB_COMMAND_KEYBINDINGS`、`tabCommandKeybinding`、`tabCommandForKeybinding` | `model/tabKeys.ts:114-172` |
| 应用级快捷键 | 各种 | 见下面一行 | `resolveAppShortcut` → `App: Settings/Search/Go to File/Command Palette/Find in Files/Open Project/New Window/Toggle Sidebar/Toggle Session Sidebar/Switch Model/Toggle Mono` | `settings.ts:1151-1183`；`features/settings/model/appShortcuts.ts:18-24`；`App.tsx:13122-13157` |
| 快捷键覆盖持久化 | 设置页录音 | 与默认冲突时报错（"Already used by App: Go to File"） | `KeybindingOverride{disabled?,shortcut?}`，`monocode.keybindingOverrides`，`VALID_COMMANDS` 排除 `fixed` 的 Esc | `settings.ts:1258-1270` |
| 原生菜单加速键同步 | — | 菜单里显示的快捷键与 Web 侧一致 | `keybindings_set_overrides` invoke 到 Rust | `App.tsx:12949-12950` |

---

## 二、拖拽

三层实现，全是 pointer event + `document.elementFromPoint`，没有 HTML5 drag。

| 交互 | 用户动作 | 界面反馈 | 数据结构/状态 | 源码路径:行号 |
|---|---|---|---|---|
| 命中判定原语 | — | — | `paneDropFromPoint(x,y)`：`document.elementFromPoint` → `closest("[data-pane-id]")` → `paneEdgeFromPoint` 用 rect 归一化中心比 | `model/paneDrop.ts:100-109` |
| 边缘判向算法 | — | 鼠标偏哪半边就判哪条边 | `nx=(x-left)/w-0.5`、`ny` 同理；`|nx|>|ny|` 时 left/right，否则 top/bottom | `model/layout.ts:1181-1190` |
| 拖 pane 重排/重分栏 | 按住 pane 标题条的 grip（或 SurfaceTabs 左侧 grip／tab 条空白处）拖到别的 pane 上 | 被拖 pane `opacity-40`；目标 pane 上半透明 wash + 2px accent 线标出落边 | `PaneDrag{fromId,overId,edge}`；`PaneDropHint`（wash 占目标一半，line 贴边） | `ui/PaneTree.tsx:604-694`、`739-741`、`976-999` |
| 拖拽阈值 | — | 移动 <5px 不算拖拽，不抢点击 | `DRAG_THRESHOLD = 5` | `ui/PaneTree.tsx:205`、`621-627` |
| 拖动时的手感 | — | 全局 grabbing 光标 + 禁止选中文本（`selectstart` 拦截 + `is-reordering` 类） | `setGrabbing`、`suppressTextSelection` | `ui/PaneTree.tsx:616,629`；`shared/lib/drag.ts:20-33` |
| 同轴兄弟交换 | 拖到同轴相邻 pane 的边 | 只换顺序，**保留原有 sizes** | `movePane` → 同一 parent 且 `toAt.dir===dir` → `reorderInSplit`（children 与 sizes 一起 splice） | `model/layout.ts:1215-1253`、`1354-1374` |
| 垂直方向落边 | 拖到垂直方向的边 | 在目标处**嵌套**新 split | `movePane` → `extractLeaf` 摘出，再 `insertBeside` / `wrapBeside` | `model/layout.ts:1255-1346`、`1376-1383` |
| 拖起时先 focus 被拖 pane | 开始拖 | 焦点先切过去 | `onFocusRef.current(fromId)` | `ui/PaneTree.tsx:630` |
| `Esc` 取消拖拽 | 拖动中按 Esc | 立刻复原，不提交 | `finish(false)`；commit 只在 pointerup | `ui/PaneTree.tsx:652-656`、`658-686` |
| 拖 pane 到标题 tab 条 → 拆成新 tab | 把 pane 拖到顶栏某个 tab 上/之间 | 目标 tab 左右出现 2px accent 竖线（`data-pane-tab-drop-hint`） | `titleTabDropFromPoint`：先 `closest("[data-title-tab-strip]")`，再 `closest("[data-title-tab-id]")`，没有就按 tab 中心距离取最近；以中线分 before/after | `model/paneDrop.ts:111-149`；`App.tsx:4636-…` → `applyDetachPaneToTab`；`ui/PaneTree.tsx:633-638,673-681`；`app/shell/TitleBar.tsx:1272-1281` |
| 拆 tab 的限制 | — | 只有 ≥2 个 pane 的 tab 能拆出一个；拆出的 tab 若相邻仍属同组则继承 `groupId` | `applyDetachPaneToTab` 里 `leafIds.length < 2 → null`；`keepsSourceGroup` | `model/workspaceTabGroups.ts:394-464` |
| 外部拖拽 overlay（侧栏 session 卡 → pane） | 拖侧栏 session 卡到某个 pane 边上 | 同上的落边提示；松手后会话**插到那个 pane 的位置** | `setExternalPaneDrop`（模块级 store + `useSyncExternalStore`），PaneTree 用 `paneDrag ?? externalDrop` | `model/paneDrop.ts:31-85`；`ui/PaneTree.tsx:288-289` |
| 侧栏 session 卡拖拽源 | 按住卡片拖 >5px | 卡片进入拖拽态；不触发「打开会话」 | `onPointerDown` 只 `onPrefetch`，点击才切换；`skipClickUntil = now+400` 吞掉尾随 click | `app/shell/Sidebar.tsx:5067-5172` |
| 落点是空会话 pane | 拖会话到空 pane | 空会话被**替换**（旧 harness session 被 forget） | `replaceTarget = isBlankSession(target)`；`forgetHarnessSession` | `App.tsx:5386-5413` |
| 侧栏卡片内的列表内拖放 | 把卡片拖到另一个卡片/文件夹 | 文件夹高亮为 drop target | `sessionListDropFromPoint`：`[data-session-card]` / `[data-session-folder]`；`SessionListDropTarget{folder|session}` | `app/shell/Sidebar.tsx:4417-4436`、`5155-5161` |
| **title tab → pane** | 把顶栏 tab 拖到下方 pane 区域 | 必须「刻意」往下拉 32px 才 armed，防止横向拖 tab 时误判；一旦 armed 到回到 tab 区才解除 | `PANE_DROP_PULL = 32`；`pulledBelowTabs`（`paneDropArmed` ref） | `app/shell/TitleBar.tsx:111-112`、`793-836` |
| 拖整个 tab 合并进目标 tab | 松手 | 源 tab 消失，其 layout **整棵**摆到目标 pane 的边上，editorPanes/terminalPanes 合并 | `applyPlaceTabOnPane` → `placeLayout(target.layout, source.layout, targetId, edge)`；`replaceTarget` 时用 `replacePaneWithLayout` | `model/workspaceTabGroups.ts:338-392`；`App.tsx:5427-…` |
| 阻止自环/自嵌套 | — | 拖到自己、或源 tab 内含目标 id → 不动作 | `source.id === target.id`、`leafIds(source).some(targetIds.has)` | `workspaceTabGroups.ts:358-363` |
| title tab 横向重排 | 拖 tab 左右 | 其他 tab 用 transform 让位（rAF 合并，settling 动画） | `useAnimatedReorder(tabIds, onReorder, "x", externalTabDrop)` | `app/shell/TitleBar.tsx:837`；`shared/hooks/useAnimatedReorder.ts:30-…`（阈值 5px @ `:251`） |
| 外部落点把 reorder 让出去 | 拖 tab 到 pane 区 | reorder 立即 `preview(from)` 回到原位，交给 external drop | `overExternalTarget`；`externalDrop.onMove` 返回 true | `shared/hooks/useAnimatedReorder.ts:264-271` |
| 丢 pointerup 兜底 | 拖到窗口外松开 | `LOST_POINTERUP_GRACE` 后自动取消 | `lostPointerUpTimer` | `shared/hooks/useAnimatedReorder.ts:21-24`、`240-248` |
| 文件树 → 会话（附件） | 把 Explorer 文件拖到某个 session pane | 该文件成为 composer 附件 | DOM CustomEvent `monocode:explorer-file-pointer-drag`（`move`/`drop`/`end` + 坐标）；`useFileDrop` 监听并入附件（OS 原生拖放也走同一入口） | `shared/lib/drag.ts:1-18`；`ui/FileTree.tsx:305-447`；`features/sessions/hooks/useFileDrop.ts:15-155` |
| 文件树拖拽的自绘预览 | 拖动文件行 | 一个跟随指针的小卡片（图标+名字），被拖行半透明 | `explorer-file-drag-preview` div，translate3d 跟随，边界 8px 内缩 | `ui/FileTree.tsx:340-354`、`320-338` |
| surface tab 条重排 | 拖文件 tab | 同 `useAnimatedReorder`（`"x"`） | `onReorderFiles(paneId, ids)` → `orderByIds(pane.files, ids)` | `ui/SurfaceTabs.tsx:342`；`App.tsx:4601-4617` |
| 中键关 tab | 中键点 tab | 直接关闭 | `onAuxClick` (`button===1`)；同时 `onMouseDownCapture` 阻止中键的自动滚动 | `ui/SurfaceTabs.tsx:321-330`；`app/shell/TitleBar.tsx:378-386` |
| 侧栏/项目 rail/文件夹 重排 | 拖 rail 项、文件夹 | 同上 reorder 动画（`"y"` 轴） | `useAnimatedReorder(..., "y")`；文件夹用 `useSortable`（另一套，支持 `onDropOnGroup`） | `app/shell/ProjectRail.tsx:372-378`；`app/shell/Sidebar.tsx:953-957`；`shared/hooks/useSortable.ts:25` |

---

## 三、文件查看

目录：`src/features/files/{ui,model,editor}`。总共 15 个 model/editor 模块 + 12 个 UI 组件。

| 交互 | 用户动作 | 界面反馈 | 数据结构/状态 | 源码路径:行号 |
|---|---|---|---|---|
| FilePane 总装 | — | 上面 tab 条（≥2 tab 或分栏时显示）+ 下面 `data-pane-body`；同一 pane 的所有 file 都挂载，非 active 用 `hidden` 保留状态 | `FilePane{pane,focused,visible,showTabs,deferBody,...}`；`active = visible && file.id===activeFileId` | `ui/FilePane.tsx:117-236` |
| 按 tab 类型分发 body | — | session-changes diff / commit diff / 统一 diff / agent transcript / plan / release notes / terminal / 图片视频 / 编辑器 | `isSessionChangesTab / isCommitTab / unifiedReview / isAgentTab / isPlanTab / isReleaseNotesTab / isTerminalTab / isImagePath||isVideoPath` | `ui/FilePane.tsx:154-229` |
| 懒加载重组件 | 首次打开 | 分组代码切割 | `lazySurface`：CommitDiff / FileEditor / SessionChangesDiff / TerminalView | `ui/FilePane.tsx:39-54` |
| 统一 diff 可选 | 设置 → diff viewer = `unified` | 单文件 review tab 改用整棵工作树统一 diff 渲染 | `loadDiffViewer()`；`unifiedReview` | `ui/FilePane.tsx:112-116`、`141-143` |
| 打字高亮（worker） | 打开文件 | shiki 高亮在 web worker 里排队，超限降级 | `codeHighlight.worker.ts`；`MAX_CHARS = 500_000`、`MAX_RESULTS = 100`、单 active job + 优先级 + 缓存 | `editor/codeHighlightPlugin.ts:14-40`；`editor/codeHighlightEngine.ts:56` |
| 语言按需加载 | 打开不同后缀 | 语言包 `await import()` 后才 reconfigure | `languageForPath(path)`：js/json/css/sass/less/html/vue/svelte/markdown/rust/python/c/cpp/java/php/sql/xml… | `editor/editorLanguage.ts:115-210`；`ui/FileEditor.tsx:879-883` |
| 语法诊断 | 输入 | 波浪线 + 滚动条 overview 标记 + tab 上红点带错误数 | `editorLint`：Lezer parse tree 取 error node，`MAX_DIAGNOSTICS`，防抖；`diagnosticCount` 回调到 `onErrorCountChange` | `editor/editorLint.ts:59-126`；`editor/editorScrollbar.ts:55-70`；`ui/FileEditor.tsx:799` |
| 自动补全 | 输入 | 补全列表；Tab 若补全开着先接受补全 | `editorAutocomplete`；`completionStatus(view.state)==="active" && acceptCompletion(view)` | `editor/editorAutocomplete.ts:4`；`ui/FileEditor.tsx:806-816` |
| Emmet 展开 | 在 HTML 里按 Tab | 缩写展开 | `tryExpandEmmet(view) || indentOrInsertTab(view)` | `ui/FileEditor.tsx:815` |
| git gutter + hunk 操作 | 鼠标悬停变更行 | 行号旁出现 `Comment / Revert / Stage` 三个小按钮 + 旧行号 | `editorGit({onStage,onComment})`；`GitMarker/GitRowClass/OldLineNumber`；`stageChunkAt(view,pos)` 只 stage 那一段 | `editor/editorGit.ts:61-232`、`375-410`、`1001-1134` |
| 编辑器内查找替换 | `cmd-f` / `cmd-opt-f` / `F3` / `cmd-g` | CodeMirror 自带 find 面板 + `Aa`(match case,`alt-c`)/整词/正则三个开关 | `editorSearch`；`Mod-f`/`Mod-Alt-f`/`F3`/`Mod-g`/`Escape` keymap；`openFindInActiveEditor()` | `editor/editorSearch.ts:64-128`、`165-225`、`852` |
| 预览内查找 | `cmd-f` 在 markdown 预览里 | 自带搜索条：命中数、上一个/下一个（`cmd-shift-g`/`cmd-g`）、大小写/整词 | `FilePreviewSearch`；`handleFilePreviewFindKey`；`findPreviewTextMatches` | `ui/FilePreviewSearch.tsx:86-142`、`384-420`、`493-502` |
| markdown 双模 | 切换 Preview / Source | 预览里渲染（含 mermaid 懒加载），源码里 CodeMirror；末尾 footer 显示相对路径+保存状态 | `useMarkdownMode`（`MarkdownViewShell`）；`monocode.fileViewMode` 全局默认 + 每文件记忆 | `ui/FileEditor.tsx:462-511`；`model/fileViewMode.ts:1-26` |
| mermaid 图 | markdown 里 ```mermaid | 首次渲染才按需 import 引擎（~730KB 不进 boot chunk） | `createLazyMermaidPlugin`；`securityLevel:"strict"` | `editor/mermaidPlugin.ts:1-40` |
| 保存 | `cmd-s` | footer 依次显示 Saving… / Saved / Save failed: 原因 | `save(content)`：写盘 → `syncWatchedMtime` → `notifyGitChanged`；`saveGeneration` 防竞态 | `ui/FileEditor.tsx:339-364`、`531-547`、`805` |
| 自动保存 | 停止输入一会 | 无感保存 | `loadAutosave()` + `FILE_EDITOR_AUTOSAVE_DELAY_MS` 防抖；失败且仍 dirty 则重排一次 | `ui/FileEditor.tsx:764-777`、`822-845` |
| 保存时格式化 | `loadFormatOnSave()` 开着 | 先格式化再写，光标位置被修正 | `formatText(path, before, cursorHead)`；只在文档没被改过时替换 | `ui/FileEditor.tsx:718-740` |
| 磁盘变更外部同步 | agent/终端改了文件 / 窗口重新聚焦 / git restore | 没有本地未保存改动时自动重载；有未保存改动则记 pending，等保存后再载 | `watchFile(path, cb)` mtime 轮询（`MAX_PATHS=64`）；`pendingDiskRef`；`invalidateWatchedFiles` | `model/fileWatch.ts:14-80`；`ui/FileEditor.tsx:295-337`、`392-408` |
| 保存时保留行尾 | — | CRLF 文件保存后仍是 CRLF；EOL-only 变更显示提示条 | `restoreLineEnding(content, eolRef.current)`；`gitDiff.eolOnly` 的 `role="status"` 提示 | `ui/FileEditor.tsx:453-461` |
| 选区 → 加进对话 | 选中若干行 | 选区上方浮出 "Add to chat" 气泡；点它把 `@path (lines a-b)` 塞进 composer | `editorSelectionTarget(view, commentPath)` → `EditorSelectionMenu`（`role="toolbar"`）；`formatEditorSelectionReference`；`requestAddToChat` | `ui/FileEditor.tsx:833-837`；`ui/EditorSelectionMenu.tsx:14-67`；`model/editorSelection.ts:8-16` |
| 滚动条（自定义） | 滚动 | 自绘滚动条 + 诊断/变更 overview ticks | `editorScrollbar`；`scrollbarMetrics`、`diagnosticOverviewTicks` | `editor/editorScrollbar.ts:12-70`、`368` |
| 行高与 diff 对齐 | — | 统一 diff 和编辑器行高都是 20px | `EDITOR_LINE_HEIGHT_PX = 20` | `editor/editorMetrics.ts:1-3` |
| 文件树 | 侧栏 Explorer 页签 | 目录展开/折叠，展开状态与选中项按项目存 localStorage | `loadExpanded/saveExpanded/loadSelected/saveSelected`；`monocode.*` 键 | `model/fileTree.ts:15-31`；`ui/FileTree.tsx:263-267` |
| 文件树目录缓存 | 重开项目 | 目录列表走缓存，agent/终端写盘后局部失效重列 | `peekDir/listCachedDir/refreshDir/forgetDir/refreshCachedDirs/notifyDirsChanged` | `model/fileTree.ts:32-108` |
| 文件树键盘导航（VS Code 式） | 方向键/Home/End/PageUp/PageDown/Enter/Space | 行焦点跟随；`→` 展开或进第一个孩子，`←` 收起或回父级；`cmd-↓` 打开 | `onNavigationKey`；行从 DOM 读（`visibleRows()`）保证与渲染顺序一致 | `ui/FileTree.tsx:730-833` |
| 文件树 typeahead | 连续敲字母 | 跳到下一个前缀匹配的行；重复同一字母则在同首字母间循环（700ms 内算连续） | `typeahead.current{text,at}`；`cycling` 判断 | `ui/FileTree.tsx:814-832` |
| 文件树右键菜单 | 右键某行 | New File / New Folder / Cut(`cmd-x`)/Copy(`cmd-c`)/Paste(`cmd-v`)/Duplicate / Copy Path(`cmd-shift-c`)/Copy Relative Path / Rename(`F2`)/Delete(`⌫`,danger) / Open in Terminal / Reveal in Finder | `explorerItems(target,clip,canOpenTerminal)`；粘贴禁止把目录粘进自己子树 | `ui/FileTree.tsx:172-248` |
| 文件树快捷键 | — | 与菜单同键（`cmd-c/x/v/shift-c`、`F2`、`Delete/Backspace`、`Esc` 取消 cut） | `onKeyDown`；非拉丁键盘用 `shortcutLetter` 回落 `e.code` | `ui/FileTree.tsx:835-890`、`165-170` |
| 内联新建/重命名 | New File / F2 | 行内输入框；重命名时选主名不含扩展名（VS Code 习惯） | `creating`/`renaming` state；`validateFileName(raw, siblingNames)` 返回 empty/slash/exists/invalid/whitespace | `ui/FileTree.tsx:269-272`、`1435-1450`；`model/fileName.ts:3-60` |
| 目录树随文件操作重映射 | 新建/移动/删除 | 展开态、选中态、剪贴板路径一起 rebase | `remapTreePaths`、`dirsTouchedByCreate`、`dirsTouchedByMove` | `ui/FileTree.tsx:469-486`；`model/fileTree.ts:120-136` |
| 排除文件开关 | 切换 hide excluded | 显示/隐藏 .gitignore 里的文件 | `loadShowExcludedFiles` + `useSyncExternalStore` | `ui/FileTree.tsx:276-280` |
| 项目级文件搜索 | Explorer 标题里点搜索 | 整个项目内容搜索视图 | `ProjectSearch`（`features/projects/ui/ProjectSearch.tsx`） | `app/shell/Sidebar.tsx:2481-2487` |
| Go to File / 命令面板 | `cmd-p`；输入 `>` 切成命令面板 | fuzzy 结果列表；最近打开的文件优先（无 query 时只列最近） | `rankProjectFiles(files, query, recents, limit)`；`scorePath` + recency 加权 `(MAX_RECENTS-index)*8`；`ACTIONS`（目前只有 Reload） | `ui/FilePicker.tsx:54-104`、`219-262`；`model/fileIndex.ts:168-211` |
| 文件索引 | 只读 | 每个项目一份文件清单缓存，可预热 | `subscribeProjectFiles/peekProjectFiles/invalidateProjectFiles/prefetchProjectFiles/loadProjectFiles` | `model/fileIndex.ts:40-119` |
| 最近打开 | — | Go to File 无 query 时按它排 | `rememberOpenedFile/recentOpenedFiles` | `model/fileIndex.ts:100-113` |
| 打开请求归一化 | 从 transcript 链接、markdown 链接、搜索命中打开 | 短路径/模糊引用能落到真实文件；用户从文件 UI 选的路径优先 | `resolveOpenablePath` / `resolveFileOpenRequest`（`{exact}` 选项） | `model/fileIndex.ts:213-270`；`App.tsx:6837-6844` |
| @ 提及文件 | composer 里打 `@` | 弹出文件/文件夹（+notes）选择器；上下键/Tab/Enter 选；Esc 关 | `mentionTokenAt / replaceMentionToken / sharedMentionIndex / buildMentionIndex / mentionLabel / rankMentionFiles / fileMentionParts / fileMentionsInText` | `model/fileMentions.ts:49-230`；`ui/Composer.tsx:1517-1552`；`features/sessions/ui/FileMentionPicker.tsx:19-141` |
| @ 提及消歧 | — | 发给 harness 前把 `@name` 补成项目相对路径描述，避免同名文件歧义 | `applyFileMentionsToTurn(text, index)` | `model/fileMentions.ts:223-230` |
| markdown 里的本地文件链接 | 点预览里的链接 | 能打开的文件就地打开 | `remarkWorkspaceFileLinks({cwd})`（rehype/remark 插件） | `model/markdownFileLinks.ts:9-10` |
| markdown 标题识别 | — | 供 outline 类 UI 用 | `isAtxHeadingLine(line)` | `model/markdownSource.ts:1-4` |
| 图片/视频查看 | 打开 .png/.jpg/.mp4… | 图片按 magic number（不信扩展名）判 MIME 后走 blob URL；视频只在显式 video MIME 时才建 blob；失败给「不可读」卡片 | `isImagePath/isVideoPath/videoMimeForPath/sniffImageMime/sniffDocumentImageMime`；`BinaryFileView`（缩放/平移/fit/trackpad magnify） | `model/filePreview.ts:39-104`；`ui/BinaryFileView.tsx:60-232` |
| .svg 例外 | 打开 svg | 走**源码编辑器**（旁边有渲染预览），不是二进制查看器 | `isImagePath` 注释明说不含 `.svg` | `model/filePreview.ts:33-39` |
| 文件类型图标 | — | Material Icon Theme 映射 | `FileTypeIcon` | `ui/FileTypeIcon.tsx:43-83` |
| 工具预览卡片 | agent 改文件后 | transcript 里显示带 +/- 行号的小 diff 卡（点击跳真文件） | `FilePreview{preview,status,cwd,onOpenFile,variant}`；关键字轻量上色 | `ui/FilePreview.tsx:66-230` |
| 逐文件 diff（review tab） | 从 Changes 点一个文件 | 该文件以 diff 模式打开（`showDiff`），git gutter 显示变更块 | `newFileTab(..., review=true, changeKind)`；`openEditorTab` 里 `file.review` 只更新 `changeKind` | `model/layout.ts:138-153`、`604-617` |
| 变更块导航 | diff tab 里 | 上一个/下一个 change 按钮 + `+N/-M` 统计 | `syncChunkNav / stepChunkNav / diffScrollToChunk / diffNavigablePositions / diffLineStatsForView` | `ui/FileEditor.tsx:602-689` |
| diff 里直接 stage | git gutter 的 Stage 按钮 | 只 stage 该 hunk（把选中段内容写进 index） | `stageChunkText / stageChunkAt / stageChunkChanges`；`onStageGit` 只在 unstaged 时给 | `editor/editorGit.ts:375-477`；`ui/FileEditor.tsx:366-390`、`502-506` |
| diff 行上留评论 | git gutter 的 Comment 按钮 | 打开 `DiffCommentComposer`（发进对话） | `GitCommentTarget{line,anchor}`；`gitCommentFacet` | `editor/editorGit.ts:45-58`；`ui/FileEditor.tsx:608-617` |
| 编辑器主题 | 浅/深色 | 跟随 app 配色 | `editorScheme.of(schemeExtensions(isLightScheme() ? "light":"dark"))`；`editorHighlightStyle`（同一套 tag→色，供 CodeMirror 外用） | `ui/FileEditor.tsx:795`；`editor/editorLanguage.ts:90-113` |
| 打开失败 | 文件不存在/无权限 | 卡片：Couldn't open X + 原因 + Retry 按钮 | `loadState.status === "error"` | `ui/FileEditor.tsx:427-449` |
| 文件被删 | 从 Explorer Delete | 打开该路径（及其子路径）的 tab 自动关掉，dirty 记录清掉 | `onFileDeleted`：`isEqualOrInside(file.path, path)` → `dropOpenFiles` | `App.tsx:6812-6835`；`App.tsx:14993-…` |

---

## 四、会话

| 交互 | 用户动作 | 界面反馈 | 数据结构/状态 | 源码路径:行号 |
|---|---|---|---|---|
| 会话 pane | — | 分栏时顶部有 `data-split-header`：grip + 焦点圆点 + 标题 + 关闭；无分栏时不显示 | `inSplit` 控制；`onPaneDragStart` 挂在标题条整条上（除 `[data-no-drag]`） | `ui/SessionPane.tsx:827-874` |
| **一个 pane 里换会话** | `cmd-↑/↓` | 当前 pane 的会话被换成另一个（同 tab 内两者**互换位置**；若目标在别的 tab，则两个 leaf id 互换） | `switchSessionInTab(tabs, activeTabId, currentSessionId, targetSessionId)`：`replaceLeafId` 双向交换 | `model/workspaceTabGroups.ts:104-147`；`App.tsx:12597-12600` |
| 换会话的守卫 | — | 只有在「当前 tab 未被 diff 抢占 且 focusedId 就是当前会话」时才换 | `activeTab.diffFocused`、`focusedId !== currentSessionId` → `null` | `workspaceTabGroups.ts:111-115` |
| 跨 tab 切会话（不换 pane） | `shift-cmd-↓/↑` | 直接激活含该会话的 tab；没有就新开 | `onSelectHistorySession` 路径 | `App.tsx:12583-12586` |
| 侧栏 session 卡片 | 看 | 状态点（busy/done/needsApproval）、harness 图标、标题、分支+worktree、相对时间、draft 点、orchestrator/operator 徽标 | `SessionCard` props：`busy/done/linkedUpdate/needsApproval/dropTarget/dense/nested/startedCount` | `app/shell/Sidebar.tsx:4826-4880` |
| 卡片 hover 预览（dense 布局） | 悬停 | 浮出该会话的预览卡；移开 120ms 才关（容许指针跨过缝隙） | `previewOpen` + `previewCloseTimer` | `Sidebar.tsx:4902-4911` |
| 卡片按压预热 | 按下 | 预取 transcript，但不切会话 | `onPrefetch(session.id)` 在 pointerdown 里 | `Sidebar.tsx:5069-5075` |
| 多选会话 | `cmd/ctrl` 点、`shift` 点范围 | 多行高亮；右键菜单变批量语义（"Delete all N conversations"） | `selectedSessionIds: Set<string>`；`toggleSessionSelection` / range | `Sidebar.tsx:715`、`1783-1820` |
| 会话右键菜单 | 右键卡片 | Cancel reminder / Pin·Unpin / Rename(F2) / Copy session ID（Harness ID / MonoCode ID 子菜单）/ Link GitHub issue or PR… / Remind me（预设子菜单）/ New folder / Add to <folder> / Remove from folder / Archive·Unarchive / Delete(⌫, danger) | `sessionMenuItems` | `Sidebar.tsx:1483-1609` |
| 归档 | `shift-cmd-a` 或菜单 | 会话从列表消失，进 archived 过滤 | `archiveFocusedSession(event, ctx, archive)` 守卫：不在终端/编辑器/非 composer 输入框/无 popover 才抢键 | `features/sessions/model/archiveShortcut.ts:8-60` |
| 归档/删除的生命周期 | — | 同一个 remover 处理 archive 与 delete，每一步都重读状态 | `createSessionRemover` | `model/sessionRemoval.ts:73-98` |
| 会话文件夹 | New folder / 拖卡片进文件夹 | 文件夹有颜色（预设/自定义）、可折叠、可拖排序、F2 改名 | `SessionFolder{id,name,sessionIds,collapsed,colorIndex?,customColor?}`；`monocode.sessionFolders`；`monocode.pinnedSessionsCollapsed`、`monocode.reminderSessionsCollapsed` | `model/sessionFolders.ts:8-46`；`Sidebar.tsx:4477-4520` |
| 会话列表分区 | — | Pinned / Reminders（橙色）/ Folders / 普通会话；inset 布局按 Today/Yesterday/Last 7 days/Older 分组 | `SessionListEntry`；`sessionAgeLabel` | `sessionFolders.ts:30-46`；`Sidebar.tsx:4219-4227` |
| 会话过滤 | 过滤器按钮 | harness / 时间（all/today/7d/30d）/ 状态（working / needsApproval / done）/ 含归档 / 搜索 | `SessionSidebarFilters`；`loadSessionSidebarFilters/saveSessionSidebarFilters` | `model/sessionFilters.ts:5-129`；`Sidebar.tsx:2004-2021` |
| 会话搜索 | 输入框打字 | 实时过滤 + Esc 清空 | `searchQuery`；`filterSessionsByQuery` | `Sidebar.tsx:2023-2045` |
| 会话改名 | F2 / 菜单 | 行内输入 | `renamingSessionId` + `SessionRenameRow` | `Sidebar.tsx:1955-1965` |
| **AccessPicker 权限选择器** | composer 里点锁/铅笔/星/盾图标 | 弹出四档：`supervised`(Lock) / `auto-accept-edits`(Pencil) / `auto`(Sparkles) / `full-access`(Shield)，各带 `RUNTIME_MODE_LABEL` 与 `RUNTIME_MODE_HINT`；上下键+Enter 选，Esc 关 | `value: RuntimeMode`；`RUNTIME_MODES` 索引 | `ui/AccessPicker.tsx:22-90`；`features/sessions/model/session.ts`（`RUNTIME_MODES`） |
| AccessPicker 的可用性 | — | `compact` 或 `harness==="fx"` 时不显示；`busy` 时可见但受限 | `{!compact && harness !== "fx"}` | `ui/Composer.tsx:2425-2432` |
| 新会话落位 | `cmd-t`（新 tab）/ `cmd-d`（分栏）/ 侧栏「+」/ 拖卡片 | 新 tab 继承组并插在当前 tab 右侧；分栏走 `splitPane`；拖卡片走 `placePane` | `insertTabBesideActive` / `splitPane` / `applyPlaceSessionOnPane` | `App.tsx:2889`、`3178-3200`；`workspaceTabGroups.ts:251-336` |
| 把会话插到某 pane | 拖卡片到 pane 边 | 该 pane 位置被会话占据（空会话则替换） | `applyPlaceSessionOnPane({tabs,sessions,sessionId,targetId,edge,replaceTarget,...})`；`scope` 影响关 tab 策略 | `workspaceTabGroups.ts:251-336`；`App.tsx:5369-5420` |
| **把引用加进对话（Add to chat）** | 编辑选区浮泡 / transcript 里选中文字 / 卡片右上 "add to chat" | 新建（或复用）一个会话 pane，并在 composer 里预置引用文本 | `applyAddToChatRequest({sessions,tabs,activeTabId,projectCwd,text,mode})`；零 tab 时用最后一个会话作 donor 但**不沿用它的 cwd** | `model/addChatToWorkspace.ts:40-…`；`model/quoteDraft.ts` |
| transcript 选中校验 | 拖选跨块 | 只允许合法选择（不能跨 turn 边界乱选） | `validateTranscriptSelection`；`useTranscriptSelection` | `model/transcriptSelection.ts:15`；`hooks/useTranscriptSelection.ts:57` |
| 会话内查找 | `cmd-f`（会话聚焦时） | Find in conversation 条：命中计数、上下跳 | `TranscriptFind`；`features/sessions/model/transcriptFind.ts` | `ui/TranscriptFind.tsx:25-173` |
| 消息队列 | agent 忙时再发送 | 消息进队列卡片；可 Edit（行内改）/Steer（改成 steer 立即插入）/Delete；可 Resume 重试 | `QueuedMessage`、`MessageQueueStatus`；`MessageQueue{messages,status,onDelete,onEdit,onSteer,onResume}` | `ui/MessageQueue.tsx:15-56`；`ui/Composer.tsx:1864-1872` |
| 停止当前轮次 | `Esc` 或发送键变停止 | 发送按钮在 busy 时变 `ArrowUp`→停止图标 | `ComposerAction{busy,onSend,onStop}`；`tabKeys.ts:231-241` | `ui/Composer.tsx:2449-2459`、`2592-2650` |
| 收回上一条消息编辑 | 在空 composer 里 `↑` | 最后一条用户消息回填到 composer，出现 "Cancel edit" | `editLastTurnSupported && navigationEmpty && selectionStart===0` → `recallLastTurn()` | `ui/Composer.tsx:1607-1617`、`2436-2448` |
| model 与 runtime 切换 | composer 左下角 pills | 模型选择器（含 effort 档位）+ 设置 pills + context 用量环 | `ModelPicker{harness,model,values,onChange,onSettingsChange}`；`ModelControlPills`；`ContextMeter` | `ui/ModelPicker.tsx:83-208`；`ui/SessionPane.tsx:1240-1269` |
| 附件 | 粘贴图片/文件、拖文件、点附件按钮 | 附件 chip（可移除） | `pickAttachments/attachmentsFromFiles/mergeAttachments/revokeAttachment`；`harnessSupportsAttachments` | `model/attachments.ts`；`ui/Composer.tsx:1728-1732`、`2050-2065` |
| MCP server 选择 | composer 里 MCP 按钮 | 选中的 server 以 `@tag` 写进文本 | `McpServerPicker`；`taggedMcpServers`；`newMcpTag` | `ui/Composer.tsx:1874-1900`；`model/mcpCommand.ts` |
| Skill 选择 | 输入 `/` | 技能选择器（可现场新建 skill） | `slashTokenAt`、`SkillPicker`、`createBlankSkill` | `ui/Composer.tsx:1960-2000`；`features/skills/ui/SkillPicker.tsx` |
| 会话文件夹命令 | 输入特定命令 + 空格 | 弹出 session folder picker | `runsSessionFolderCommandOnSpace` → `openSessionFolderPicker` | `ui/Composer.tsx:1501-1515` |
| worktree 模式切换 | composer 里快捷键 | 当前目录 ↔ 新建 worktree | `isWorkspaceModeShortcut` → `onWorkspaceModeChange` | `ui/Composer.tsx:1625-1647` |
| 会话改动审阅卡 | 一轮结束 | 卡片列出改动文件 + `+/- `；Undo / Keep 两个按钮；别的会话在同项目跑时 Undo 被锁 | `SessionReview{files,undoLocked,disabled}`；`sessionEditPaths`；`reviewUndoLocked` 由 PaneTree 计算 | `ui/SessionReview.tsx:38-160`；`ui/PaneTree.tsx:778-786`、`873-879` |
| 会话标题/元信息 | — | title tab 上两行：标题 + meta（分支/文件）；harness 图标最多 3 个+超出计数 | `Tab{title,more,sessionCount,harnesses,busyHarnesses,doneHarnesses,files,multiPane,fileFocused,blank,dirty,terminal,previewFileId,groupId}`；`TabHarnesses` | `app/shell/TitleBar.tsx:95-109`、`275-330`；`App.tsx:14960-14990` |
| 会话 tab 右键 | 右键 title tab | Close Tab(cmd-w) / Close Others / Close to Right / Close to Left / Close All(shift-cmd-w) / Archive（"All N conversations in this tab"）/ Delete（danger，N 条） | `contextMenuItems` | `app/shell/TitleBar.tsx:937-1009` |
| 会话清单导航的顺序 | `cmd-↑↓` 等 | 顺序来自当前列表（`sessionNavigationIds`），未来一步的会话会预取 | `adjacentItemId(ids, current, delta)`（循环）；`prefetchAhead` | `model/tabKeys.ts:174-184`；`App.tsx:12575-12582` |
| 空会话欢迎 | 新建空会话 | 有的模型有专属欢迎动画（Astra / Opus），可 dismiss | `AstraWelcome` / `OpusWelcome`；`dismissModelWelcome` | `ui/SessionPane.tsx:820-826` |
| transcript 池 | 切 tab | 离屏会话的 transcript 不销毁，复用 | `TranscriptPool` / `PooledTranscript` | `ui/TranscriptPool.tsx:1-272`；`ui/PaneTree.tsx:194` |

---

## 五、其它一级面（每个只给「解决什么问题 + 入口」）

| 面 | 解决什么问题 | 入口文件 | 备注 |
|---|---|---|---|
| source-control | 看/暂存/提交/丢弃变更，看历史图与分支操作 | `src/features/source-control/ui/GitChangesPanel.tsx`（1794 行）、`UnifiedDiffView.tsx`、`GitHistoryGraph.tsx`、`SidebarWorktreeSwitcher.tsx` | 侧栏 Changes 页签；分支菜单、stage/unstage all、discard、commit message 生成 |
| terminal | 真 PTY（xterm.js + Rust pty） | `src/features/terminal/ui/TerminalView.tsx`、`ProjectTerminalDock.tsx` | `spawnPty/writePty/resizePty/killPty/subscribePty`；dock 可在 top/bottom/left/right 四侧，尺寸可拖；还有 arcade（pacman/snake 彩蛋） |
| artifacts | 会话产出的文档/HTML 卡片，可读可删可复制 | `src/features/artifacts/artifacts.ts`、`ui/ArtifactPanel.tsx` | `ArtifactKind = "document" | "html"` |
| notes | 跨项目粘性笔记，可 @ 引用进对话 | `src/features/notes/notes.ts`、`ui/NotesView.tsx`（1104 行） | `notesAsProjectFiles` 让它出现在 @ 选择器里 |
| automations | 定时/事件触发地起会话跑任务 | `src/features/automations/model/automations.ts`、`ui/AutomationsView.tsx`（2001 行） | `AutomationScheduleKind: hourly/daily/weekdays/weekly` + 事件触发；run 有 status |
| inbox | GitHub PR/issue 收件箱，含 CI 检查与评论 | `src/features/inbox/ui/InboxView.tsx`（3321 行）、`InboxPrChecks.tsx`、`InboxComments.tsx` | 可从 issue/PR 直接开会话（`linkedWorkItem`） |
| monos | 跨项目的长期 agent（有记忆、习惯/定时、产物） | `src/features/monos/model/mono.ts`、`ui/MonoOverview.tsx`、`FloatingMonoChat.tsx` | 实验特性；有 mascot/配色/status（idle/working/needs-you） |
| orchestration | 一个 lead 派出多个 worker，各自在独立 checkout 里干活再整合 | `src/features/orchestration/model/orchestration.ts`（2162 行）、`ui/OrchestrationPreview.tsx` | `OrchestrationRun/OrchestrationTask/DispatchStage`；`createWorker/integrateWorker` |
| projects | 项目列表、置顶、分组、外观（logo/mascot/背景）、worktree | `src/features/projects/model/recents.ts`、`projectGroups.ts`、`ui/SearchableProjectPicker.tsx`、`CwdPicker.tsx` | 项目分组是 rail 里真实可见的「Groups」 |
| quick-composer | 全局热键（mac `cmd-shift-space`）弹出的迷你输入面板，发完就起会话 | `src/features/quick-composer/ui/QuickComposer.tsx`（909 行）、`model/quickComposer.ts` | 独立窗口（`quick-composer.html`） |
| search | 全局搜索：会话标题、会话消息、文件、项目；带 scope 过滤 | `src/features/search/ui/SearchView.tsx`、`model/appSearch.ts` | `SearchScope = all|conversations|files|projects` |
| skills | 查看/启用禁用/新建文件技能 | `src/features/skills/model/skills.ts`、`ui/SkillsPage.tsx` | 明确「不改 provider 自己的 catalog」 |
| connections | 远程机器（SSH）连接与远程项目会话 | `src/features/connections/model/connections.ts`、`ui/ConnectionsSettings.tsx`、`RemoteSession.tsx` | 实验特性 |
| notifications | 系统通知（默认关）、按项目静音、提醒、资源压力提示 | `src/features/notifications/model/notifications.ts`、`ui/ResourcePressureNotice.tsx` | `NOTIFICATIONS_DEFAULT = false`，点击通知回跳会话 |
| providers | harness 账号与用量配额（5h/7d 窗口、reset credit） | `src/features/providers/model/rateLimits.ts`、`providerAccounts.ts`、`app/shell/UsageProviderChip.tsx` | `RateLimitProvider = claude|codex|opencode|devin` |
| settings | 全部偏好：外观、diff 查看器、文件打开方式、快捷键、声音、通知… | `src/features/settings/model/settings.ts`（1551 行）、`ui/SettingsView.tsx`（4879 行） | `KEYBINDINGS` 表就在这里 |
| agent-app | 把「agent 自己操作 app」的命令协议化（`/operator`） | `src/features/agent-app/model/agentApp.ts`（1259 行） | 会话可开新会话/建 worktree/放文件夹/写 note |
| workspace | 就是本文第一、二节的主体（layout/tabGroups/tabKeys/paneDrop/snapshot） | `src/features/workspace/` | — |

---

## DSH 里最值得抄的 10 个交互（按迁移价值排序）

排序标准：**对 DSH Web 插件模型的迁移性价比** —— 能在 cordis 插件 + Slots 里用普通 DOM/CSS 复刻的程度 × 对用户体验的提升。

1. **preview（斜体）临时 tab + 双击转正**
   为什么：整个文件浏览体验的分水岭。点十个文件不会炸出十个 tab，而一旦你动手编辑就自动 pin（`if (dirty) onPinFile(fileId)`）。实现成本极低（一个布尔 + 一次替换 + 一个双击 handler），收益极大。DSH 的文件槽目前是「点开就常驻」，这是最便宜的一个改进。
   落点：`layout.ts:542-573` + `App.tsx:6953-6966` + `SurfaceTabs.tsx:365`。

2. **拖 pane 到边缘做二分分栏（含同轴归组 + 8% 最小尺寸）**
   为什么：这是 monocode「多会话同屏」的真正抓手。核心算法不到 250 行纯函数（`splitPaneRelative / movePane / insertBeside / wrapBeside / setSplitRatio`），不依赖任何库，也不依赖 Tauri。DSH 有 Slots 但没有布局树，这一块是必须自建的。
   落点：`layout.ts:856-1434`。注意要一起抄「同轴 split 归组」和「拖动中 rAF 预览 + 松手提交 + Esc 取消」，否则手感会很差。

3. **`paneDrop.ts` 的 `elementFromPoint + data-pane-id` 命中协议**
   为什么：拖拽落点判定的通用解。它不要求拖拽源和目标在同一 React 树、同一插件，只要目标 DOM 上有 `data-pane-id` 就能被命中——这正是**跨插件**拖拽需要的东西。DSH 有 `dsh-client-ui-file-drag`，但落点协议值得直接照抄这一套（一个属性 + 一个 point→edge 函数）。
   落点：`paneDrop.ts:100-149`。

4. **PaneTree 的「进入/退出滑动」动画（含 deferBody）**
   为什么：分栏是个空间操作，没有方向感就永远像卡了一下。它的做法很省：先量出每个 pane 的归一化 rect，从「贴着哪条边」推出滑入方向，用 Web Animations 对 rect 做 keyframe，邻 pane 自然跟随；**新 pane 先只挂 tab 条，到达后再挂编辑器**，所以打开大文件不会拖住动画。纯 CSS/WAAPI，插件里能原样跑。
   落点：`PaneTree.tsx:320-560`、`906-974`。

5. **访问权限选择器（AccessPicker）四档 + 文案分层**
   为什么：agent 权限是危险区，monocode 用一个常驻 pill 把「现在有多危险」变成一眼可见：图标（锁/笔/星/盾）+ 标签 + 提示两层文案。DSH 侧 agent 权限往往藏在设置里或每轮弹窗，常驻 pill 是更好的形状。纯 UI，零后端依赖。
   落点：`AccessPicker.tsx:22-90` + `session.ts` 的 `RUNTIME_MODES/LABEL/HINT`。

6. **快捷键表单一真相源 + 可改 + 三处对齐（Web / 菜单 / Rust）**
   为什么：`KEYBINDINGS` 是数据表（约 45 行），`when` 字段描述作用域，`fixed` 标记不可改（Esc），冲突检查在保存时做。这套东西的好处是**能同时驱动帮助面板、设置页录音、菜单加速键**。DSH 若要让插件注册快捷键，这是一份现成的好 schema。
   落点：`settings.ts:1150-1270`、`tabKeys.ts:114-172`。

7. **tab 访问历史（cmd-[ / cmd-]）**
   为什么：多 tab + 多项目时，「我刚才那个会话呢」是最常见的挫败。90 行纯函数就解决：back/forward 两个栈、上限 50、关 tab 时 prune、相邻去重。零 UI，只有两个按钮 + 两个快捷键。
   落点：`tabVisitHistory.ts:1-90`。

8. **Editor 选区浮泡「Add to chat」+ 引用格式 `@path (lines a-b)`**
   为什么：这是「文件和对话之间最短的那条路」。monocode 把它做成选中即出现、一次点击塞进 composer，且引用格式是可被 agent 按需读取的紧凑形式（不是把代码贴进去）。DSH 有 session 有文件面板，缺的就是这个接缝。
   落点：`EditorSelectionMenu.tsx:14-67` + `editorSelection.ts:8-16` + `quoteDraft.ts`。

9. **workspace snapshot 的可恢复布局（含「什么不该存」的判断）**
   为什么：分栏/多 tab 如果不能恢复，用户每次开机都要重搭一次。它的 snapshot 有三点值得抄：(a) 存 session **stub** 而不是整个会话；(b) 显式剔除 inbox/agent 这类「活的、不该复活」的 tab；(c) 保存 project terminal dock 与上次 dock 侧。这三条决定了恢复体验是「接上」还是「诈尸」。
   落点：`workspaceSnapshot.ts:59-265`。

10. **Explorer 的 VS Code 式键盘 + typeahead（当 DOM 顺序就是真相）**
    为什么：它从 DOM 读可见行（`visibleRows()`）而不是从数据模型算顺序，所以折叠/过滤/隐藏文件都不会算错。typeahead 还处理了「重复同一字母=在同首字母间循环」这种细节。任何要自己实现文件树的插件都会踩这两类坑。
    落点：`FileTree.tsx:730-833`。

> 落选但值得单独看一眼的：git gutter 的 hunk stage（`editorGit.ts:375-477`，可直接 stage 单段，很香但依赖 git 后端）、`isolateTerminalPanes` 的「两种 surface 永不同 tab 条」这条不变式（`layout.ts:455-498`，是个很好的设计约束，但要求先有两种 surface）、Chrome 式 tab 组（`tabGroups.ts` 的 UI 在 React 版实际没接线，见上文「重要更正」，不要照着它做）。

---

## 读不全的地方

诚实清单。以下要么没读到，要么只读了入口没读实现，要么读了但结论不确定。

### 完全没读的（体量原因，且不属于本票核心）
- `src/app/App.tsx`（**15104 行**）：只按 grep 命中读了约 40 个片段（快捷键分发 `13060-13230`、文件打开 `6800-6980`、分栏/焦点/激活 `3178-3200 / 4382-4431 / 6148-6168`、放置 pane `5369-5420 / 5427-5460`、快照产出 `14960-14990` 等）。**中间大量状态编排没读**，尤其是：多窗口 transfer、project return、mono view 的覆盖逻辑、inbox ask portal、以及 `App.tsx` 里绝大部分 `useEffect` 的副作用顺序。任何「monocode 在某边界情形下会怎样」的问题，凡是涉及 App 编排的，都应视为**未验证**。
- `src/app/shell/Sidebar.tsx`（**5872 行**）：读了 session card（`4826-5172`）、右键菜单（`1483-1609`）、文件树/Changes 挂载（`2480-2530`）、tab 重排（`936-960`）、inset 布局片段。**没读**：inset 布局的完整分支、right panel 的 tab 逻辑、会话列表分组渲染的完整实现、drag 与 folder 折叠的交互细节。
- `src/features/settings/ui/SettingsView.tsx`（4879 行）、`model/settings.ts`（1551 行，只读了 KEYBINDINGS 段及个别 load/save）、`model/appearance.ts`（1194 行，只确认了 `SidebarTabId` 定义）。
- `src/features/sessions/ui/AgentTranscript.tsx`（5437 行）、`Composer.tsx`（2651 行，只读了键盘/粘贴/工具栏/队列挂载几个窗口）、`ModelPicker.tsx`（1803 行）、`data/sessionStore.ts`（1614 行）、`model/session.ts`（799 行，只引用了其中的类型名与 `RUNTIME_MODES`）。
- `src/features/files/ui/FileTree.tsx`（1523 行，读了约 500 行：菜单模型、键盘导航、拖拽、创建/重命名入口；**没读**目录行渲染、git status 徽标、virtual scroll 之类的部分——不确定有没有 virtual scroll）。`FileEditor.tsx`（1316 行）读了约 700 行，**没读** `CodeMirrorEditor` 的一些次要 effect（`898-1316` 区间只扫过）。
- 所有 `*.test.ts(x)`：只完整读了 `src/app/shell/TitleBarPaneDrop.test.ts`（它揭示了「下拉 32px 才 armed」和 title tab 落点 before/after 的判定）。**没读**的有：`layout.test.ts` 774 行、`tabGroups.test.ts` 451 行、`workspaceTabGroups.test.ts` 702 行、`PaneTreeEnter.test.ts`（**这个是滑动动画的测试，最可能含我没读出的动效边界**）、`workspaceSnapshot.test.ts` 747 行、`ComposerFileDrop.test.ts`、`FileTree.test.ts`。这些很可能揭示更多边界行为。
- `src/styles/index.css`：只 grep 了 `[data-pane-sash]` 相关的一行，**没读**动画/玻璃质感/布局的全部 CSS。所以文中关于视觉的描述均来自 JSX className 的语义推测，不是渲染结果。
- 一级面里的 `agent-app`、`orchestration`、`monos`、`inbox`、`automations`、`connections`、`notifications`、`providers`：**只读了 30–80 行文件头**，用来写「解决什么问题 + 入口」。这些面的具体交互**未验证**。

### 读了但结论不确定 / 需要下游复核
- **`tabGroups.ts` 的那套「Chrome 式 tab 组」在 React 版是否真的可用**。证据是：`segmentTabs / joinTabOnto / addTabToGroup / addTabsToNewGroup / ungroupTabs / insertTabInGroup / loadCollapsedTabGroups / replaceGroupInTabOrder` 在生产代码里零调用（只有测试），`TabGroupMenu` 的两个调用点传的都是**项目 key / 项目分组 id**，`WorkspaceTab.groupId` 无写入点。**我的结论是「没接线、是项目外观 + 项目分组」**，但我没有跑起 app 实测，也没读 `docs/` 或 CHANGELOG 确认是否有计划。这一条是「高置信度推断，非实测验证」。
- ~~`TabGroupMenu` 的 `showActions` 三组按钮有没有 UI 入口~~ → **已确认**：`renderProjectMenu`（`useProjectMenu.tsx:437`）和 `renderGroupMenu`（`:523`）**都传 `showActions={false}`**，所以 New tab in group / Move group to new window / Close group / Ungroup / Delete group 这五个动作在 React 生产版里**没有任何 UI 入口**（只有 `Delete group` 通过 `extraItems` 单独加回）。它们是 native 版或未来版的残留。
- **`diffOpen` 字段 → 已确认是死字段**：全仓 grep 后，生产代码里只有把它写成 `false` 的地方（`layout.ts:133`、`App.tsx:3749/3959`、`workspaceTabGroups.ts:326/457`、`sessionWorkspaceLifecycle.ts:95`）；`workspaceSnapshot.ts:478` 有 `value.diffOpen === true ? {diffOpen:true}` 的读回分支，但既然没人写 `true`，它永不触发。只有 `layout.test.ts:560` 手工造了 `diffOpen:true` 来验证 `resetTabToSession` 会清掉它。`diffFocused`（另一个字段）才有真实用途。**结论：残留字段，DSH 不用抄。**
- **`useExternalPaneDrop` 在 PaneTree 里以 `visible` 作为 `enabled`**（`PaneTree.tsx:288`）—— 非激活 tab 的树不订阅外部拖拽。这个我读到了，但**没有验证**切换 tab 期间拖拽的时序行为。
- **性能**：文中说 PaneTree 用 `samePaneTreeProps` 避免重渲、sash 拖动用 rAF 节流 —— 这些是代码里写明的意图，但**我没有实测帧率或 profile**，不能声称「性能没问题」。多 pane 同时渲染多条会话流的真实上限**未验证**（这正是 00 号票里列为 "Not yet specified" 的那条）。
- **快捷键 `Tab: Activate 1–8` 的序号语义** → **已确认**：`deckProjectTabs`（`App.tsx:4299-4310`）只含**当前项目**的 tabs，且再做一层 worktree 过滤（别的 worktree 的 tab 虽然开着但被排除）；无项目的会话单独成列表。所以 `cmd-1..8` / `cmd-9` 的序号是「当前项目当前 worktree 的 tab 顺序」，不是全局 tab 顺序。
- **`data-pane-id` 的覆盖范围 → 已确认唯一**：全仓 grep 只有 `ui/PaneTree.tsx:717` 一处写这个属性（其余是 `paneDrop.ts:105` 的读取和 `PaneTreeEnter.test.ts` 的测试选择器）。所以拖拽落点判定**只覆盖 workspace tab 内的 pane**，右侧面板/Mono 视图/文件侧栏都不是落点。这对 DSH 的跨插件拖拽是个负面信号：单一 `data-pane-id` 协议只在一个组件内自洽。
- **`mono view` 与 workspace tabs 的共存**：App 里 `monoCovers` / `monoViewId` 到处出现，我只读了渲染层（`14326-14480`），**没读**覆盖/恢复的状态机。这块在 DSH 里大概率不需要抄，但如果要抄「一个面板切多种视图」，得补读。
