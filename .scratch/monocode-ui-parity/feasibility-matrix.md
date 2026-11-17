# 交互对交互：monocode → DSH 可行性判定表（票 03）

输入：`.scratch/monocode-ui-parity/research/monocode-interactions.md`（monocode 交互全清单）与
`.scratch/monocode-ui-parity/research/dsh-capability-matrix.md`（DSH 能力边界）。
本文件只做对齐判定，不新开调查；每条判定都指回上面两份的条目。

**判定词**（四档，比票面多一档，因为调查发现大量交互 DSH 已经做了）：

| 判定 | 含义 |
|---|---|
| **已存在** | DSH 装包里已有等价能力，不需要搬；只需确认够不够用 |
| **可做** | 缺，但用插件 + 现有 slot/服务能做，成本已标注 |
| **需降级** | 能做，但形状必须改（写在"降级成什么"里），原样搬不行 |
| **不可做** | 卡在宿主契约层，插件无法绕开；只能放弃或整体替换宿主外壳 |

成本档：**S** ≈ 一天内，**M** ≈ 数天，**L** ≈ 一两周，**XL** ≈ 需要重新设计一块架构。

---

## 结论摘要（先看这十条）

1. **DSH 已经覆盖了 monocode 大约一半的"外围面"**：权限四档、@文件引用、逐文件 diff 审阅、自动化定时、子代理协作、终端、归档、会话搜索/过滤/右键菜单、模型切换、附件、停止轮次——这些不用搬。真正缺的是**空间层**：分栏树、拖拽、tab 管理。
2. **"多会话并排"能做，但必须自建容器**：宿主会话主列（`main.conversation`）是 single，切不了。可行落点是新的 `main` key 面板（离开宿主会话壳）或右栏 tab，且右栏**产品上限写死 2 个横向 pane**。
3. **跨插件拖拽没有官方契约**，必须自造命中测试；monocode 的 `elementFromPoint + data-pane-id` 协议正是可搬的那一半（自己的容器用自己的属性）。
4. **`Cmd+D` / `Cmd+W` 在 Web 上注册即抛错**（白名单），Desktop 可以但 `primary+KeyW` 已被 `page.close` 占。这是分栏快捷键的硬约束。
5. **官方文件面全是只读**：`sidebar-files` 只列目录、`documentpreview` 只预览、`workspace-files` 无 mutation。要编辑器必须自建保存通道或买第三方契约。
6. **性价比最高、最该先做的三个**：preview 临时 tab（S）、选区 Add to chat（M）、tab 访问历史（S）——都不碰宿主禁区。
7. **最贵、最该最后做的**：自建分栏树 + 拖拽（XL），因为要连带动画、最小尺寸、焦点、持久化一起做才有手感。
8. **monocode 的 Chrome 式 tab 组不要搬**（它自己都没接线）。
9. **两套 pane 池（会话/终端永不同条）这条不变式值得保留**，即使实现降级到"右栏 tab 分开"。
10. **不要依赖 `data-dockkit-*`**：dockkit 不是安装包、无契约，官方明令不要读别家 DOM。

---

## 一、布局与分栏

| # | monocode 交互 | 判定 | 降级成什么 / 落点 | 依据 | 成本 |
|---|---|---|---|---|---|
| 1 | 向右分栏 `cmd-d`、向下 `shift-cmd-d` | **需降级** | 只能在**自己拥有的渲染位**里分：新的 `main` key 全局面板（离开宿主会话壳），或右栏 tab（最多 2 横向 pane）。宿主会话主列切不了。 | 清单 §一 layout.ts:856-923；矩阵 总表「把宿主会话主列本身切成分栏」「自建分栏树」 | XL |
| 2 | 同轴 split 归组 + `equalSizes`（同方向分栏做兄弟节点而非嵌套） | **可做** | 纯函数，直接照抄算法；与 1 同批做。 | 清单 §一 layout.ts:885-898 | M（含在 1 里） |
| 3 | sash 拖动改比例（rAF 预览、松手提交、Esc 取消、8% 最小） | **可做** | 自建容器内普通 pointer 事件 + WAAPI；min 建议保留 8%。 | 清单 §一 PaneTree.tsx:1001-1114、layout.ts:992-1026 | M |
| 4 | 垂直方向嵌套 split | **可做** | 同 1、2。 | 清单 §一 layout.ts:899-914 | S |
| 5 | 空会话时文件 pane 从左侧插入 | **可做** | 自建容器里 `before=true` 分支。 | 清单 §一 App.tsx:6899-6902 | S |
| 6 | 焦点 pane + `cmd-opt-arrows` 邻接导航 | **可做** | 自建容器内；箭头键在 Web 白名单外，需用 `primary+alt+Arrow` 或自定义键。 | 清单 §一 layout.ts:1110-1154；矩阵 §5 快捷键 | S |
| 7 | 关闭 pane + 父 split 塌缩 + 焦点落兄弟 | **可做** | 自建容器内纯函数。 | 清单 §一 layout.ts:941-977 | S |
| 8 | 两套 pane 池隔离（`isolateTerminalPanes`，终端永不同条） | **需降级** | DSH 终端是右栏一种 tab 类型（`sidebar-terminal`），不是同层 surface。降级成"终端在右栏 tab、文件在编辑器容器，两者不在一条 tab 条"。**建议保留这条不变式**。 | 清单 §一 layout.ts:455-498；矩阵 总表「右栏多 tab」 | S |
| 9 | **preview（斜体）临时 tab + 双击/编辑转正** | **可做** | 自建 tab 条内一个布尔 + 一次替换 + 双击 handler。若走第三方 `dsh-better-sidebar`，它有 `dedupeKey`/`single` 可近似表达。**最高性价比**。 | 清单 §十条第 1；矩阵 §3 TabDescriptor:141-236 | **S** |
| 10 | tab 复用规则（同路径 focus 已有 tab，跨 pane/跨 tab） | **可做** | 自建容器内 key 归一化 + find；第三方 `dedupeKey` 等价。 | 清单 §一 layout.ts:514-624 | S |
| 11 | tab key 的 10 种源类型（file/changes/review/commit/plan/session-changes/agent/terminal/release-notes） | **已存在（大半）** | plan tab、commit/review diff、subagent transcript DSH 都有对应面；不用自建虚拟文档体系。只需补"文件"和"整树 changes"两类。 | 清单 §一 layout.ts:514-524；矩阵 §3；DSH `ui-plan`/`ui-deliverables`/`ui-subagent` README | S |
| 12 | workspace-tab 模式（文件开成新的顶层 title tab） | **不可做** | 宿主 title tab 条不可编程。降级：开成右栏 tab 或 `main` 新 key。 | 矩阵 总表「往既有 shell 座位塞 UI」vs「自建容器」 | — |
| 13 | pane 进入/退出滑动动画（`deferBody`：先挂 tab 条再挂编辑器） | **可做** | 纯 WAAPI + rect 推算方向，插件里原样可跑。**分栏手感全靠它**，与 1 同批。 | 清单 §十条第 4；PaneTree.tsx:320-560 | M |
| 14 | title tab 条：宽度、溢出 chevron、滚轮横向滚动 | **不可做** | 宿主 title tab 条属于 AppFrame，不可替换（除非遮蔽整个 `root`）。自建容器里可做自己的条。 | 矩阵 §1 `root` single + "DO NOT register here" | — |
| 15 | 布局快照持久化（tabs + 树 + 焦点 + 上次 dock 侧） | **可做** | 浏览器侧 localStorage（照宿主 `dsh.sidebar-right.v1.<sessionId>` 的样），或 Host 侧 `ctx.storage`/`storageDomain`。注意矩阵：**列宽本身宿主就不持久**。 | 清单 §一 workspaceSnapshot.ts:59-265；矩阵 §5 持久化表 | M |
| 16 | `tabGroups.ts` 的组配色/自定义色/logo/mascot | **不可做（且不必做）** | 那套 UI 在 monocode React 版**根本没接线**（`groupId` 零写入点）。DSH 侧项目外观也无插件接口。**明确不搬**。 | 清单 §一「重要更正」；矩阵 §1 | — |
| 17 | 项目分组（rail 里的 Groups、可折叠可排序） | **已存在** | DSH `ui-workspace` 有 Workspace 层级（Group by WorkSpace / Workspace Tree）、折叠、拖排序（Host 持久）。 | 清单 §一 projectGroups.ts；DSH `ui-workspace` README「Workspace hierarchy」 | — |
| 18 | 快捷键表单一真相源 + 可改 + 冲突检测 | **已存在** | DSH `dsh-client-shortcuts` 比 monocode 更强：注册期冲突直接 throw、运行期再算 conflicts、`registerFixed` 保留键。 | 清单 §十条第 6；矩阵 §5 快捷键 | — |
| 19 | 分栏/关闭的 `cmd-d`/`cmd-w` 键位 | **需降级** | Web：白名单外**注册即抛错**，只能 `primary+alt+<key>`。Desktop：可声明 `primary+KeyD`，但 `primary+KeyW` 已被 `page.close` 占用，必须换。 | 矩阵 §5（`binding.ts:96-112`、`registry.ts:91-93`） | S |
| 20 | tab 访问历史 `cmd-[` / `cmd-]`（栈深 50、关 tab 时 prune） | **可做** | 90 行纯函数 + 两个键位；不碰宿主。**性价比第二高**。 | 清单 §十条第 7；tabVisitHistory.ts:1-90 | **S** |

---

## 二、拖拽

| # | monocode 交互 | 判定 | 降级成什么 / 落点 | 依据 | 成本 |
|---|---|---|---|---|---|
| 21 | `paneDropFromPoint`：`elementFromPoint` + `closest("[data-pane-id]")` + 边缘归一化判向 | **可做** | 照抄协议，但**属性换成自己的**（如 `data-monob-pane`）。只能命中自己渲染的容器。 | 清单 §二 paneDrop.ts:100-109；矩阵 §4 结论 | S |
| 22 | 拖 pane 到别的 pane 边 → 重排 / 重分栏 | **可做** | 自建容器内：同轴交换保 sizes（`reorderInSplit`）、异轴嵌套（`wrapBeside`）。 | 清单 §二 layout.ts:1215-1383 | M |
| 23 | 拖 pane 到标题 tab 条 → 拆成新 tab | **不可做** | 宿主 title tab 条不接受外部 drop。降级：自建容器内自己的 tab 条可以做同样的手势。 | 清单 §二 paneDrop.ts:111-149；矩阵 §1 | — |
| 24 | 侧栏 session 卡片拖成 pane | **需降级** | 侧栏是宿主 `ui-workspace`。能扩展的是 `sidebar.session.row.*` / `sidebar.workspaces.session.row.action` 这些 slot，但**拖动到外部容器**要自造 DataTransfer + 自己的 drop 目标；宿主不给 drop 契约。 | 清单 §二 `setExternalPaneDrop`；矩阵 §4；slot 目录 | L |
| 25 | 侧栏卡片拖进文件夹 / 卡片间重排 | **已存在（形态不同）** | DSH 侧栏有 pin、手动排序、拖行重排、归档；没有"会话文件夹"（用 Workspace 层级代替）。 | 清单 §四 sessionFolders；DSH `ui-workspace` README | — |
| 26 | 文件树 → 会话 pane（拖成附件） | **已存在** | DSH `dsh-client-ui-file-drag`：文件出/入 + 应用内 token。**但** token "只在 composer 上被接受"。 | 清单 §二 `useFileDrop`；矩阵 §4 | — |
| 27 | 拖拽阈值 5px / grabbing 光标 / 禁选文本 / 丢 pointerup 兜底 | **可做** | 自造拖拽的通用件，照抄即可。 | 清单 §二 PaneTree.tsx:205,616-686；`useAnimatedReorder` | S |
| 28 | `PANE_DROP_PULL = 32`（拖 tab 下拽 32px 才 armed，防误判） | **可做** | 自建容器里如果想要同样手感，这条防误触阈值值得抄。 | 清单 §二 TitleBar.tsx:111-112,793-836 | S |
| 29 | title tab 横向重排动画（transform 让位、rAF 合并） | **不可做** | 宿主 title tab 条不可控。自建容器内可做。 | 矩阵 §1 | — |
| 30 | 依赖宿主 `data-dockkit-*` / `data-sidebar-right-*` 做落点 | **不可做（并且禁止）** | 官方明文 "Do not read another plugin's DOM…"；dockkit 不是安装包、无 `.d.ts`，当契约用等于自找断裂。 | 矩阵 §4 约束 1、2；「未验证」dockkit 条 | — |

---

## 三、文件查看

| # | monocode 交互 | 判定 | 降级成什么 / 落点 | 依据 | 成本 |
|---|---|---|---|---|---|
| 31 | 文件树（展开/折叠、展开态持久、目录缓存） | **需降级** | 官方 `sidebar-files` **"Listing only"**：无内容搜索、无拖拽、无重命名。够当导航，不够当 FilePane。要更强用 `dsh-better-sidebar`（`fs.tree`）。 | 清单 §三 fileTree.ts；矩阵 §3 | S（复用） |
| 32 | 编辑器（高亮 worker、语言按需加载、lint、autocomplete、Emmet、自定义滚动条） | **需降级** | 自建成本 L~XL；实际选择是复用 `dsh-better-sidebar` 的 CodeMirror（`TextEditor.tsx`/`EditorHost.tsx`）。**绑第三方契约**（`service.version`/`features` 门控）。 | 清单 §三 editor/*；矩阵 §3 第三方 | L |
| 33 | 保存 / 自动保存 / 保存时格式化 / CRLF 保留 | **不可做（官方路径）** | `dsh-api-workspace-files` 明确 **no mutation**。只能走 Host `ctx.fs` 自建路由，或复用 better-sidebar 的 `fs.write`（原子 tmp+rename）。 | 矩阵 §3、§6 结论 5 | M |
| 34 | 磁盘外部变更同步（`watchFile` mtime 轮询，未保存则挂起） | **可做** | `workspace-files` 有 `stat`，轮询自建；挂起逻辑照抄。 | 清单 §三 fileWatch.ts:14-80；矩阵 §3 | M |
| 35 | git gutter + hunk stage + diff 行评论 | **需降级** | better-sidebar 有整套 `git.*`（stage/unstage/discard/revert/show）+ `DiffTab`。自建要连 git 后端一起做。 | 清单 §三 editorGit.ts；矩阵 §3 | L |
| 36 | 逐文件 review tab / 整树 unified diff | **已存在** | DSH `ui-deliverables` 的 review tab + `dsh-file-review-tab`（行级红绿 + undo）。 | 清单 §三；DSH `ui-deliverables` README | — |
| 37 | markdown 双模（预览/源码）+ mermaid 懒加载 | **已存在（预览侧）** | `sidebar-documentpreview` 提供预览 + `ctx.documentPreviews.register` 可加渲染器；**源码编辑侧**仍需 32 的编辑器。 | 矩阵 §3；清单 §三 mermaidPlugin | S |
| 38 | 图片/视频查看（magic number 判 MIME、缩放平移） | **已存在** | `documentpreviews` 覆盖 binary + Office/PDF，只读。 | 矩阵 §3；DSH `sidebar-documentpreview` README | — |
| 39 | 文件树右键菜单（新建/重命名/删除/复制路径/在终端打开…） | **需降级** | DSH 有 `dsh-client-ui-context-menu`（可加项、目标带 file/directory 身份）+ `sidebar.right.tab.files.actions` slot。**新建/删除/重命名需要写能力**，见 33。 | 矩阵 §3；slot 目录；DSH `ui-context-menu` README | M |
| 40 | 文件树 VS Code 式键盘导航 + typeahead（从 DOM 读可见行） | **可做** | 纯前端；若复用官方树则要看它自带多少。自建树时照抄"从 DOM 读顺序"的做法。 | 清单 §十条第 10；FileTree.tsx:730-833 | M |
| 41 | Go to File / 命令面板（fuzzy + 最近优先） | **需降级** | DSH 有 `dsh-client-ui-commands`（`/` 命令）与右栏 workspace search，但没有 monocode 那种 `cmd-p` 全局文件跳转。可自建（`workspace-files.search` 存在）。 | 矩阵 §3；DSH `ui-commands`/`sidebar-files` README | M |
| 42 | `@` 提及文件/文件夹 | **已存在** | `dsh-client-ui-reference` + `dsh-client-ui-input-trigger`，带原子引用与剪贴板形态。 | 清单 §三 fileMentions；DSH 两个 README | — |
| 43 | markdown 里本地文件链接可点开 | **已存在** | 宿主 deliverables 有 inline-code 链接；`documentpreviews` 有 `markdownFileLinks` 等价路径。 | 清单 §三 markdownFileLinks；`ui-deliverables` README | — |
| 44 | 文件类型图标（Material Icon Theme） | **需降级** | better-sidebar 有 `registerFileIcon`/`registerFolderIcon`；官方 files 树图标不可扩展。 | 矩阵 §3 `FileIconDescriptor` | S |
| 45 | **编辑器选区 → "Add to chat"，格式 `@path (lines a-b)`** | **可做** | 自建编辑器里挂选区浮泡，产出引用文本塞进 composer；DSH 已有 `@` 引用消费端（42）。**性价比第三高**。 | 清单 §十条第 8；矩阵 §3 + `ui-reference` | **M** |
| 46 | 文件被删 → 自动关闭相关 tab | **可做** | 自建 tab 管理里 `isEqualOrInside` 判断。 | 清单 §三 App.tsx:6812-6835 | S |
| 47 | 打开请求归一化（短路径/模糊引用落到真实文件） | **可做** | `workspace-files` 的 list/search 够用；归一化逻辑照抄。 | 清单 §三 fileIndex.ts:213-270 | S |

---

## 四、会话

| # | monocode 交互 | 判定 | 降级成什么 / 落点 | 依据 | 成本 |
|---|---|---|---|---|---|
| 48 | **一个 pane 里换会话**（`cmd-↑/↓`，同 tab 内两者互换位置） | **可做** | `SessionProvider` 显式传 `SessionReference` 只覆盖该子树（宿主自己在右栏就这么用）；切会话用 `ctx.uiWorkspace.openSession(target)`，是客户端服务、不用新 Remote。 | 清单 §四 workspaceTabGroups.ts:104-147；矩阵 总表「一个区域里切会话」、§2 | M |
| 49 | 多会话同屏（一个 tab 内多个 pane 各跑一条会话） | **需降级** | 能做，但**容器必须自建**；`conversation.content` factory 输入里没有 sessionId，宿主主列不可切。落点：`main` 新 key 面板 / 右栏 tab（≤2 横向）。性能与 retain 释放**未实测**。 | 矩阵 总表、§2、「未验证」 | XL |
| 50 | 离屏会话 transcript 池（不销毁、复用） | **需降级** | DSH 有 `retainedBy.mainView` 引用计数与 `keepMounted`，但多会话并排下的 retain 时机**未实测**。先当作需要验证的前置。 | 清单 §四 TranscriptPool；矩阵「未验证」 | M（含验证） |
| 51 | 会话卡片（状态点 / harness 图标 / 分支+worktree / 相对时间 / 草稿点） | **需降级** | 宿主 `ui-workspace` 已有会话行，插件能加的是 `sidebar.session.row.leading`/`.trailing`/`.hover`、`sidebar.session.action`、`sidebar.workspaces.session.menu.item`。**不能换掉整行**。 | 清单 §四 Sidebar.tsx:4826-4880；slot 目录 | M |
| 52 | 卡片 hover 预览浮卡 | **需降级** | 有 `sidebar.session.row.hover` slot；但浮卡布局与关闭时序要自己控制。 | 清单 §四 Sidebar.tsx:4902-4911；slot 目录 | M |
| 53 | 会话多选 + 批量右键语义 | **不可做** | 宿主会话列表是它的组件，没有多选契约；只能逐行加菜单项。 | 清单 §四 Sidebar.tsx:1783-1820；矩阵 §1 | — |
| 54 | 会话右键菜单（Pin/Rename/Archive/Delete/Link issue/Remind…） | **已存在（可扩展）** | DSH 已有行菜单 + `sidebar.workspaces.session.menu.item` 扩展点。 | 清单 §四 sessionMenuItems；slot 目录 | — |
| 55 | 归档 / 取消归档 | **已存在** | `ui-workspace` 支持 archive。 | 清单 §四 archiveShortcut；DSH README | — |
| 56 | 会话文件夹（文件夹配色、拖卡片进文件夹） | **需降级** | DSH 用 Workspace 层级 + 分组代替「会话文件夹」。**不要造第二套分组**，否则与宿主的 Workspace 概念打架。 | 清单 §四 sessionFolders；`ui-workspace` README | — |
| 57 | 会话过滤（harness/时间/状态/含归档）+ 搜索 | **已存在** | `ui-workspace` 有搜索、分组、归档过滤。 | 清单 §四 sessionFilters；DSH README | — |
| 58 | **AccessPicker 四档权限常驻 pill** | **已存在** | DSH `ui-permission-presets`：Read Only / Workspace Write / Full access（+ 实验 Auto review），composer 里就有选择器，slot 为 `conversation.input.permission`。**但形态不同**：DSH 是选择器，不是常驻四档 pill；若要常驻 pill 可在该 slot 增强。 | 清单 §十条第 5；DSH `ui-permission-presets` README；slot 目录 | S（增强） |
| 59 | 会话内查找 `cmd-f`（命中计数、上下跳） | **可做** | 宿主会话视图没有查找条；需要在会话容器里自建或增强。注意 `cmd-f` 是宿主浏览器行为，Web 上要避让。 | 清单 §四 TranscriptFind；矩阵 §5 | M |
| 60 | 消息队列（Edit/Steer/Delete/Resume） | **已存在（形态不同）** | DSH 有 steering 与排队语义，但 UI 在 Composer 内部，不是可选卡片。可视为够用。 | 清单 §四 MessageQueue；DSH composer | — |
| 61 | 停止当前轮次（Esc / 发送键变停止） | **已存在** | 宿主 composer 自带。 | 清单 §四；DSH composer | — |
| 62 | model / runtime 切换 pills + context 用量环 | **已存在** | `ui-model-selection` + `conversation.input.model` 系列 slot。 | 清单 §四 ModelPicker；slot 目录 | — |
| 63 | 附件（粘贴/拖入/按钮） | **已存在** | `ui-attachment` + `conversation.input.attachments`。 | 清单 §四 attachments；slot 目录 | — |
| 64 | MCP server / Skill 选择 | **已存在** | `ui-commands` + `ui-skill` + `/` 触发。 | 清单 §四；DSH README | — |
| 65 | 会话改动审阅卡（Undo / Keep，别的会话跑时锁 Undo） | **已存在（大半）** | `ui-deliverables` 的 changed-files 卡 + `dsh-file-review-tab` 的 undo。**跨会话锁**没有，需要时再补。 | 清单 §四 SessionReview；DSH 两 README | S（补锁） |
| 66 | 会话标题/meta 两行 + harness 图标组 | **不可做** | 宿主 title tab 条不可编程。降级：在右栏 tab 标题或自建 tab 条里表达。 | 矩阵 §1 | — |
| 67 | 新会话落位（新 tab / 分栏 / 侧栏「+」/ 拖卡片） | **已存在** | 宿主自己有新会话入口；分栏落位见 1、49。 | 清单 §四；DSH「New Session」行 | — |

---

## 五、其它一级面

| # | monocode 面 | 判定 | 说明 |
|---|---|---|---|
| 68 | source-control（Changes/stage/commit/历史图） | **需降级** | DSH 没有官方 git 面；better-sidebar 有 `git.*` 全套 + diff tab。自建成本高。 |
| 69 | terminal（真 PTY，dock 可四侧） | **需降级** | DSH 有 `ui-sidebar-terminal`（右栏 tab、可恢复进程、崩溃恢复），但**没有 dock 四侧**。够用就别搬。 |
| 70 | orchestration（lead 派 worker，各自 checkout） | **已存在（形态不同）** | DSH `ui-agent-team` + subagent 树 + 任务板。概念对得上，实现不同。 |
| 71 | automations（定时/事件触发会话） | **已存在** | `ui-schedule`：Automation 页 + 右栏任务 tab + 提醒。 |
| 72 | artifacts（文档/HTML 产物卡） | **需降级** | `ui-deliverables` 覆盖"交付文件卡"；通用 artifact 面板没有。 |
| 73 | notes（跨项目粘性笔记，可 @ 引用） | **不可做（无对等）** | DSH 没有笔记面，`@` 源里也没有 notes。真要可自建，但与本图目的地无关。 |
| 74 | inbox（GitHub PR/issue 收件箱） | **不可做（无对等）** | 无 GitHub 集成面。 |
| 75 | monos（跨项目长期 agent，有记忆/习惯） | **不可做（无对等）** | DSH 有 goal/日程/子代理，但没有"跨项目常驻 mono"这一角色。 |
| 76 | quick-composer（全局热键迷你窗） | **不可做** | 独立窗口级能力，属桌面外壳，本图 Out of scope。 |
| 77 | search（全局：会话标题/消息/文件/项目） | **需降级** | 宿主侧栏有会话搜索、右栏有工作区文件搜索，但没有统一 scope 的全局搜索页。 |
| 78 | skills 管理页 | **已存在** | DSH 有技能目录与设置页。 |
| 79 | connections（SSH 远程机器） | **不可做（形态不同）** | DSH 有 remote access（浏览器连 DSH），语义不是 monocode 的"远程机器/远程项目"。 |
| 80 | notifications（系统通知、按项目静音） | **需降级** | DSH 有完成提醒与日程提醒；系统通知级能力取决于桌面外壳。 |
| 81 | providers（harness 账号与用量配额） | **不可做（概念不同）** | DSH 的模型/provider 体系与 monocode 的"多 harness 订阅用量"不是一回事。 |
| 82 | settings | **已存在** | 宿主设置页 + 插件 `Config`/`ConfigForms`。 |
| 83 | agent-app（`/operator`：让 agent 操作 app 开会话/建 worktree） | **不可做（无对等）** | DSH 的 agent 能调工具但不能驱动 UI；这需要一套 UI 命令协议，远超本图范围。 |
| 84 | workspace（布局/tab/拖拽本体） | — | 本表第一、二节即此项的展开。 |

---

## 六、按"该不该做"重排的优先级

### 第一梯队：便宜、不碰宿主禁区、用户立刻有感

1. **preview 临时 tab**（#9，S）— 一次布尔 + 一次替换 + 双击。
2. **tab 访问历史**（#20，S）— 90 行纯函数。
3. **选区 Add to chat**（#45，M）— DSH 已有 `@` 消费端，只缺产出入。
4. **权限常驻 pill 增强**（#58，S）— 在已有 `conversation.input.permission` 上加形态。

### 第二梯队：需要自建容器，但只做一块

5. **自建分栏树 + 拖拽 + 滑入动画**（#1–#7、#13、#21–#22、#27）— 这是整个 map 的重头戏，XL。落点必须先定（`main` 新 key vs 右栏 tab），因为它决定后面所有交互的空间边界。
6. **一个 pane 内切会话**（#48，M）— 与 5 同容器。
7. **布局持久化**（#15，M）— 5 做完才有意义。

### 第三梯队：要写通道 / 绑第三方

8. **可编辑文件面**（#32–#35）— 决策点是"自建保存通道"还是"买 better-sidebar"。这是本图最大的一个岔路，建议单独拍板。

### 明确不做

- Chrome 式 tab 组（#16，monocode 自己都没接线）
- 会话多选（#53）、会话文件夹（#56）、title tab 条改造（#14/#29/#66）
- 依赖 `data-dockkit-*`（#30）
- notes / inbox / monos / agent-app / providers / connections（#73–#75、#79、#81、#83）

---

## 七、遗留的空白（写回 map 的雾）

- **自建容器落点未定**：`main` 新 key（干净但离开会话视图）vs 右栏 tab（贴着会话但只有 2 横向 pane）。这是 #1/#5 前置，需要产品决策，不是技术决策。
- **多会话并排的实测空白**：`conversation.content` 多实例的性能、document 级粘贴路由仲裁、`keepMounted` 下的 retain 释放时机——矩阵全列为「未验证」，做 #49 前必须真机点验。
- **可编辑文件面的岔路**：自建保存通道（`ctx.fs` + Host 路由）vs 绑 `dsh-better-sidebar` 契约（有版本门控风险）。这是范围与风险的选择题。
- **Web 键位降级的接受度**：`Cmd+D`/`Cmd+W` 在 Web 拿不到，只能用 `primary+alt+*`。要不要为桌面端单独放行，取决于插件是否只在 Desktop 发布。
