# DSH 插件能力边界：拖拽分栏 / 多会话同屏 / 文件面板（票 02）

调查对象：本机安装包 **DeepSeek Harness 0.2.2-rc.3**（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`，
下文把 `<asar>/` 记作该路径；`<asar>/dsh/node_modules/@deepseek-ai/<pkg>/` 记作 `<pkg>/`）。
profile：`~/.dsh/profiles/web/`（`package.json` 里 bundles = dsh-base, dsh-web-app, dsh-context,
dsh-file-review-tab, dsh-plugin, @dsh-external/dsh-visualize, dsh-better-sidebar, dshmarket）。
本次只读调查，未改插件、未装依赖、未动 profile。

**重要前提**：本会话没有 `cordis_inspect_query` / `cordis_inspect_list` 工具，也没有连上页面做真机点验，
所有结论来自装包的 README、`.d.ts`、`src/`、已构建的 `lib/client.js`，以及 web 壳的静态 bundle；
凡是要跑起来才能确认的，一律进「未验证」一节。
阅读 asar 用了仓库里已有的 `tools/asar-read.cjs`，另外补了四个同风格小工具（`asar-ls.cjs` 列目录、
`asar-find.cjs` 递归找路径、`asar-grep.cjs` 在 asar 文件内容里正则找、`asar-slice.cjs` 按偏移切片），
因为 shell 的 `ls/cat/grep` 进不去 asar。

---

## 总表

| 能力 | 判定 | 依据 | 对 monocode 迁移的含义 |
|---|---|---|---|
| 往既有 shell 座位塞 UI（左栏内层、`shell.overlay`、`shell.bottom`、`main` 新 key、右栏 tab） | **能** | `docs/subsystems/slots.md` §Declaration and lifecycle；`dsh-client-ui-layout/src/client/index.ts:192-205`；slot 目录共 116 个可注册 key | 装饰、状态条、单页工具、右侧新 tab 都能做 |
| 在 shell 层新增**自己的可分割容器**（自制 pane 树） | **受限** | `docs/subsystems/slots.md:23,226`（子 slot 只能由渲染它的组件声明）；`root` 是 single 且契约明写 "DO NOT register here"；`main` 是 keyed、key 域开放 | 只能挂成**新的 main 全局面板**（离开会话视图），或塞进右栏某个 tab；不能把会话主列切成多格 |
| 替换整个根框架（重写三列布局） | **不能**（只能整体遮蔽） | `root` 契约：注册即 shadow AppFrame——"the page would render your component alone, with every seat the frame declares gone" | 改外壳几何只有两条路：替换 AppFrame（丢掉全部宿主座位），或在它的座位里做 |
| 右栏宽度由插件驱动 | **不能** | `ctx.layout` 只有 `openRightbar/closeRightbar`（track/fullscreen 布尔）；`setRightbar(px)` 是内部 store action，仅 AppFrame 拖拽句柄调用（`layout/src/client/AppFrame.tsx:257-259`、`stores.ts:64`） | 右栏宽窄只能用户拖；插件只能决定"开/关/全屏" |
| 同一页面同时显示多个会话 | **能**（前提：自建容器） | `docs/subsystems/slots.md:99`（`SessionProvider` 显式 `SessionReference` 只覆盖该子树）；`dsh-client-ui-subagent/src/client/sidebar-chat/index.tsx:109,152-166`（右栏 tab 里 retain 子会话 + SessionProvider + `conversation.content` factory） | 多会话并排**不是根本不可能**，但宿主没有现成分栏树；要自己在某个座位里做 |
| 把宿主会话主列本身切成分栏 | **不能** | `main` keyed 只渲染选中 key；`main.conversation` 是 single；conversation 侧无 pane 概念（`apply.ts:337-341,586-589`） | monocode 那种"主区左右两个会话"必须放弃或自建面板替代 |
| 一个区域里切会话 | **能**（客户端服务，非 Remote） | `ctx.uiWorkspace.openSession(target)`（`dsh-client-ui-workspace/README.md:86`）；当前会话靠 client reference 的 `retainedBy.mainView` 计数推导（`dsh-client-ui-session/src/client/index.ts:462-472`） | 切会话不需要新 Remote 方法 |
| 右栏多 tab / 分屏 / 浮窗 | **能，但只有 2 个横向 pane** | `dsh-client-ui-sidebar-right/README.md:129` "The product allows two horizontal panes"；`stores.ts` `splitPane` 守卫 `dockPaneIds>=2`；dockkit 自身 `MAX_DOCK_PANES=4` | monocode 的多分栏缩水成"右栏最多左右两格 + 浮窗" |
| 给右栏加新 tab 类型（树/编辑器/预览都算） | **能** | `ctx.sidebarRightTabs.register({id,kind,patterns,priority,canOpen,title,guide,keepMounted})` + 在 `sidebar.right.pane.tab` 注册 body（README:85-86） | 文件面板可以做成右栏 tab，最省事 |
| 官方文件树 | **能（只读浏览）** | `dsh-client-ui-sidebar-files/README.md:12,113`——"Listing only. No content search, artifact filter, drag-and-drop, or rename." | 只能当导航，不能当 FilePane |
| 官方文件预览 | **能（只读，不可编辑）** | `dsh-client-ui-sidebar-documentpreview/README.md:12,33-39`；Excel/Office 均只读（:89） | 预览可复用，编辑必须自建 |
| 官方文件 API 的写能力 | **不能** | `dsh-api-workspace-files/README.md:12`——"The service exposes no mutation operation." | 保存要走别的缝（`ctx.fs` 的 Host 路由，或第三方插件的 HTTP 路由） |
| 第三方 FilePane（树+编辑器+预览+git diff） | **能，但买的是第三方契约** | `dsh-better-sidebar/lib/types/client/service.d.ts:448-579`（BetterSidebarService）、`:141-236`（TabDescriptor）、`:282-308`（FileViewerDescriptor）；`src/index.ts:397-477`（git.* 全套 + `fs.write`） | 直接复用它 ≈ 拿到 monocode 的 FilePane；代价是绑死第三方 API 与其 HTTP 路由 |
| 官方跨 slot 拖拽契约 | **不能（没有）** | `ctx.sidebarRight` 只暴露命令式操作（`service.ts:243-303`），无 drop 目标注册；`ui-file-drag` 只处理 `DataTransfer` 里的文件，且 "Internal tokens are accepted only over the composer"（README:27） | tab/pane 拖拽只能自造 |
| 复用宿主的 pane/tab 拖拽实现 | **受限** | 拖拽在 `@deepseek-ai/dsh-client-ui-dockkit`（sidebar-right README:34），而它**不是安装包**：asar 里没有该 package 目录，只作 seed 出现在 web 壳静态表；无 README/.d.ts | 想复用只能读未公开源码或复制；不宜当契约 |
| 监听跨 slot drag/drop、用 `elementFromPoint` 打自己容器 | **能（技术上），但无契约** | 浏览器事件可监听；但 `data-dockkit-*`／`data-sidebar-right-*` 属实现细节，官方明令 "Do not read another plugin's DOM…"（`references/ui-plugin.md`） | 自造拖拽要自带命中测试，别依赖宿主 data 属性 |
| 快捷键：声明 `cmd-d` 级键位 | **受限** | 注册接口可声明任意 profile 默认（`dsh-client-shortcuts/src/client/types.ts:20-32`），但 Web 只放行白名单（`src/binding.ts:96-112`），单修饰 `primary+KeyD` 判 `unsupported-browser` 并**在注册时抛错**（`registry.ts:91-93`） | Web 上拿不到 Cmd+D/Cmd+W；Desktop 可以但要避冲突 |
| 宿主键位冲突检测 | **能（很强）** | `registry.ts:85-101` 重复 id/重叠默认值直接 throw；`configuration.ts:135-152` 运行时再算 conflicts；dispatch 时冲突键被 consume 且 blocked（`registry.ts:154-179`） | 不能撞宿主：`page.close`=Desktop primary+KeyW / Web primary+alt+KeyW；`page.refresh` 同构；`pane.split`=primary+Backslash；`pane.fullscreen.toggle`=primary+alt+Enter |
| 插件配置写回 | **能** | `dsh-doc/references/configuration.md:1-13`（`ctx.get('configEditor').edit(entry, fn)`）；`dsh-base/cordis.patch.yml:105-107` 默认挂 `config-editor` | 设置项走 Config/ConfigForms，别手写 yml |
| 插件自留持久化数据（Host 侧） | **能** | `ctx.storage` / `ctx.storageDomain`（`docs/subsystems/storage.md`、`dsh-storage-domain/README.md`）；`dsh-base/cordis.patch.yml:179-188` 默认挂 storage + storage-json + storage-domain | Host 侧有 schema 校验 KV；浏览器侧只有 localStorage |
| 浏览器侧持久化 | **能（localStorage，无官方 session 存储）** | 宿主自用：`dsh.sidebar-right.v1.<sessionId>`（README:76）、`dsh.keybindings.v1`（shortcuts README:34）、`dsh.sidebar-files.workspace-search.v1`、`dsh.terminal.binding.v1.*`；`dsh-client-store` 的 `defineStore` 支持 `persist` 直写 localStorage（web 壳静态 bundle 内 `EN()`） | 插件可照抄；"session 级"= 自己按 sessionId 拼 key |
| `ctx.layout` 能力面 | **受限** | `layout/src/client/service.ts:28-54`：`panelInfo / selectPanel / beginNavigation / toggleSidebar / openRightbar(track,fullscreen) / closeRightbar` | 面板切换 + 左右栏开合可编程；几何不可编程 |

---

## 1. Slots：谁持有、哪些座位、能不能新增可分割容器

**持有者不是名字里带 slots 的包，是 renderer。**
`dsh-client-ui-renderer/src/client/registry.ts:160` 是 `super(ctx, 'slots')`，`lib/client.js` 里
`function apply(ctx){new SlotRegistry(ctx).install(createSlotRenderer()); …}`。
React 无关的注册账本 `SlotCore` 在 `@deepseek-ai/dsh-client-ui-slots`，而 **`ui-slots` 不是可安装包**：
asar 的 `@deepseek-ai` 下没有该目录（340 个包逐一列过），它只作为 web 壳静态模块表的 seed 存在
（`dsh-web-frontend/dist/assets/index-Ciz7DZxv.js` 内 `"@deepseek-ai/dsh-client-ui-slots":RN`）。
所以读 slot 契约的正确入口是 renderer 的 `src/client/registry.ts` 加生成的 slot 目录
（`dsh-cordis-client-runner/src/client/slot-catalog.ts`，共 **116** 个 key）。

**shell 层座位由 AppFrame 一个注册同时声明**（`layout/src/client/index.ts:192-205`）：

    const disposeRegistration = ctx.slots.register({
      name: 'root',
      locale: 'common',
      children: {
        'sidebar':      { kind: 'single', scope: 'root' },
        'main':         { kind: 'keyed',  scope: 'root' },
        'rightbar':     { kind: 'single', scope: 'root' },
        'shell.bottom': { kind: 'single', scope: 'root' },
        'shell.overlay':{ kind: 'list',   scope: 'root' },
        'shell.leading':{ kind: 'single', scope: 'root' },
      },
      store, inject, …
    }, AppFrame)

各座位语义与 props（`layout/src/client/index.ts:59-151`）：

| key | 基数 | 谁占着 | 插件能否加东西 |
|---|---|---|---|
| `root` | single | AppFrame | **不能**：注册即整体遮蔽，契约原文 "DO NOT register here" |
| `sidebar` | single | ui-sidebar 的 SidebarRoot | 不能加，只能替换整列（连带其内层座位一起消失）；要加东西进 `sidebar.workspaces`/`sidebar.settings` 等内层座位 |
| `main` | keyed，key 域开放 | `conversation`、插件管理页、任务页 | **能**：新 key = 新中央全局面板，可配 `sidebar.panellist` 入口；其 children 只在被选中时存在 |
| `rightbar` | single | ui-sidebar-right 的 RightbarRoot | 不能加，只能整列替换 |
| `shell.bottom` | single | catalog 里占位者只有实验性 inspector，web profile patch 未挂 → 推断为空 | 插件独占整条底栏："Its occupant controls its own height and visibility" |
| `shell.overlay` | list | 一票 toast/菜单/拖拽反馈 | **推荐的加法座位**：list 基数、默认点击穿透、给 `id` 即并列 |
| `shell.leading` | single | ui-sidebar 的窗口控制 | 不能加 |

右侧座位在 sidebar-right 里（`src/client/index.ts:233-247`）：`rightbar` → 声明 `rightbar.session`
（single, session 作用域）；`rightbar.session` 再声明 `sidebar.right.pane.tab`（keyed, session 作用域，
tab 体的真实渲染位）与 `sidebar.right.pane.tab.title`。

**能不能新增"可分割容器"？** 结论：**不能在宿主会话主列里加**；**能在自己拥有的渲染位里任意加**。
依据（`docs/subsystems/slots.md:23,226`）：

> Declaring a child has three effects: it makes the child key live, authorizes that parent entry's
> `renderSlot` … Registering into an undeclared slot or declaring a child already owned elsewhere fails
> during plugin activation.

> Declare a new child slot only in the component that owns and renders that location. Other packages wait
> with `ctx.slots.inject()` and contribute through `ctx.slots.register()`.

会话主列由 `ui-conversation` 渲染，它的 children 表写死（`src/client/apply.ts:337-341`：
`main.conversation` 只声明 `conversation.header`），插件插不进一格。
但插件自己的 `main` 页面可以像插件管理页那样声明任意 children
（`dsh-client-ui-plugin-manager/README.md:151`："The page's `main` registration declares `plugins.item`,
`plugins.bundle.config`, and `plugins.row.config` as its children"）。

**右栏的分割树不是 slot 契约**，是 sidebar-right 内部的 dockkit 状态机；插件只能通过
`ctx.sidebarRight.split()/float()/dock()` 间接触发。几何同理：右栏宽度是 frame 自己算的
（`AppFrame.tsx:184-200,295-296` 的 grid 模板），插件只能报 `openRightbar(track, fullscreen)` 布尔意图。

**实证补充（T03 实测，2026-11-17）**：上面「子座位只能由渲染它的 entry 声明」这条推断**被证实为硬限制**。
第三方 `main` 面板尝试渲染宿主的 `conversation.session.header` 会失败——重复声明该槽名抛
`SlotOwnershipError`（且 boot 失败），裸渲染抛 `SlotAssemblyError`。后果：自建多栏里拿不到宿主的
会话头（「标准模式 / 费用明细 / 子智能体」chips 与「对话/轨迹/上下文/编队」视图条）。
拿到的唯一办法是像 `dsh-multipane` 那样用 `priority:-1` 抢占 `main` 的 `conversation` 条目——
那会丢掉「补充件」定位。详见 `plan.md` 决策 9 的实施更正。

---

## 2. 多会话同屏：SessionProvider 能不能同时绑多个会话

**能，宿主自己就这么用。** 关键原文：

> `SessionProvider` is also present in `PropsRenderSlots` when an entry declares a `session` or
> `session-maybe` child. With no `session` prop it inherits the surrounding binding; **an explicit
> `SessionReference` or `undefined` overrides only that subtree.** The Provider does not key its whole body.
>  — `docs/subsystems/slots.md:99`

> `SessionProvider` inherits an outer binding or binds an explicit `SessionReference`, so **concurrent
> subtrees can target different Sessions**.
>  — `docs/subsystems/web-client.md:60`

真实实现例子（右栏 tab 里活着第二个会话）：

    // dsh-client-ui-subagent/src/client/sidebar-chat/index.tsx:109
    const reference = sessions.retain(address, { source: 'sidebarChat', signal })

    // :152-166
    export function SidebarChatTab({ useResource, useTabInfo, SessionProvider, renderSlot }: SidebarChatTabProps) {
      const { tab } = useTabInfo()
      const resource = useResource<'subagentchat'>(tab.contentId)
      return <div className={css.root} data-sidebar-chat="">
        {resource.value === undefined ? null : (
          <SessionProvider session={resource.value.reference}>
            {renderSlot('sidebar.chat.conversation', {})}
          </SessionProvider>
        )}
      </div>
    }

它注册的 body 也照 slot 规则声明自己的子座位（`:191-198`）：`sidebar.right.pane.tab`（key=自己的 id）
声明 child `sidebar.chat.conversation`（single, session），再在后者挂一个渲染 `conversation.content`
factory 的组件（`:196-198`、`ConversationSlotPanel`）。

宿主右栏本身就是"一个 session 一棵 View 树"：

> The root-scoped `rightbar` entry renders the selected Session **and background Sessions with initialized
> `keepMounted` bodies through separate `rightbar.session` subtrees. Each View owns its Session reference.**
>  — `dsh-client-ui-sidebar-right/README.md:63`；实现见 `src/client/session-views.ts:27-43`（`select()` 保留后台 View）

**一个区域里切会话要调什么**：不是 Remote，是客户端服务。
`ctx.uiWorkspace.openSession(target)`——"synchronously replaces the owned `mainView` reference and returns the
main area to Conversation"（`dsh-client-ui-workspace/README.md:86`）。
`ui-session` 的"当前会话"是引用计数推导的：`src/client/index.ts:462-472` 取
`retainedBy.mainView > 0` 的那个 session。Remote 侧只有 `session.create/fork/list/prompt/…`，
**没有 "select session" 这类 Remote 方法**。

**`conversation` 是不是单实例？** 不是。`conversation.content` 是可复用 Component Factory
（`dsh-client-ui-conversation/src/client/contract/slots.ts:365-383`，输入 `variant: 'main' | 'embedded'`），
subagent 聊天就是第二份 embedded 实例。但它的**输入里没有 sessionId**：

> **Factory occurrences inherit their render-position Session** — `conversation.content` does not accept an
> independently addressed Session; that requires a separate Session-provider capability.
>  — `dsh-client-ui-conversation/README.md:223`

即：多会话靠**外面套 SessionProvider**（官方能力），不是靠 factory 参数。
唯一明确的单实例限制是"同一 session 不能同时有两个可编辑输入根"：

> This separation does not support simultaneous editable roots for one Session
>  — `dsh-client-ui-conversation/README.md:101`

不同 session 各一份 composer 是允许的（右栏 subagent 聊天与主会话 composer 本来就并存；
document 级粘贴路由另有"most recently focused composer"仲裁，README:135）。

**结论**：monocode 的"多会话并排"在 DSH 里**能做出等价物**，但容器得自己画（新的 `main` 面板、
右栏某 tab、或 `shell.overlay` 浮层），格子里 `sessions.retain(id)` + `SessionProvider` +
`conversation.content` 实例。宿主**没有**现成的"把会话列切成两半"开关。

---

## 3. 文件面：官方三件套 + 第三方 FilePane

### 官方三件套

- **`dsh-api-workspace-files`**（Host+Client Remote）：`stat / read / readBytes / list / search / changes`。
  明写 **"The service exposes no mutation operation."**（README:12）。`list` 限于 workspace 根内，
  `read` 只做 regular-file 检查、不加 workspace 限制（README:41）。上限：单页 2 MiB / 5000 行、
  整文件 32 MiB、目录 2000 项、搜索 512 条（README:72-82）。
- **`dsh-client-ui-sidebar-files`**：右栏 `files` 页面 + 每 pane 一棵树 + 搜索（Host 侧 rg）。
  注册面：tab 类型 `kind='files'`；Factory `sidebar.files.tree` / `sidebar.files.navigator` /
  `sidebar.files.navigator.toggle`；列表 `sidebar.right.tab.files.actions`（README:32-39）。
  明确局限："**Listing only.** No content search, artifact filter, drag-and-drop, or rename."（README:113）
- **`dsh-client-ui-sidebar-documentpreview`**：`kind='text'`、band `fallback`、pattern 覆盖
  `dsh-resource://file/**`；渲染器注册表
  `ctx.documentPreviews.register({id,extensions,binaryExtensions,priority,title,loading,wrap,sourceLines})`
  + 在 `sidebar.right.tab.document`（keyed, session）挂 body（README:33,37）。**纯预览**：
  "editing, recalculation, and export are unsupported"（README:89）。

### 第三方：dsh-better-sidebar（已装 0.19.1）—— 事实上就是 monocode 的 FilePane

对外只暴露一个 Cordis 服务 `ctx.betterSidebar`，契约在
`~/.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/types/client/service.d.ts`：

    // :141-236 一个 tab 类型
    export interface TabDescriptor {
      id: string                       // 也是 SidebarTab.type
      title: string | (() => string)
      description?: string | (() => string)
      icon?: ReactNode | ((size: number) => ReactNode)
      order?: number
      hidden?: boolean
      available?: (ctx, scope, state) => boolean
      single?: boolean
      dedupeKey?: (tab: SidebarTab) => string | undefined
      createTab?: (state: SidebarState) => { tab: SidebarTab; patch?: Partial<SidebarState> } | null
      urlTarget?: (url: URL) => boolean
      settings?: SidebarSettingsDeclaration
      badge?: (ctx, scope, state) => string | number | null | undefined
      onOpen? / onActivate? / onClose?: (tab, scope) => void
      component: (props: TabComponentProps) => ReactNode
    }

    // :282-308 一个文件预览/编辑器
    export interface FileViewerDescriptor {
      id: string
      title?: string | (() => string)
      exts: readonly string[]          // [] = catch-all
      priority?: number
      fetchStrategy: 'none' | 'fsRead' | 'mediaUrl' | 'custom' | 'binary-download'
      detect?: (path: string, head: Uint8Array) => boolean
      load?: (path, scope, signal?) => Promise<unknown>
      settings?: SidebarSettingsDeclaration
      component: (props: FileViewerProps) => ReactNode
    }

    // :448-579 服务
    export interface BetterSidebarService {
      registerTab(descriptor): () => void
      registerFileViewer(descriptor): () => void
      registerFileIcon(descriptor): () => void
      getTabs(): readonly TabDescriptor[]
      getFileViewers(): readonly FileViewerDescriptor[]
      getFileIcons(): readonly FileIconDescriptor[]
      matchFileIcon(path) / matchFolderIcon(open, name?) / fileIcon(path, size) / folderIcon(path, open, size)
      getTab(id): TabDescriptor | undefined
      isTabEnabled(id) / isViewerEnabled(id): boolean
      matchFileViewer(path, head?): FileViewerDescriptor | undefined
      openTab(seed: OpenTabSeed, scope?: SessionScope): void
      closeTab(tabId, scope?): void
      subscribe(listener): () => void
      getSnapshot(): SidebarSnapshot
      subscribeState(listener): () => void
      updateTab(tabId, patch): void
      activateTab(tabId, scope?): void
      openFile(scope, path, title?): void
      setSurface(surface)              // @internal
    }

它把这一切**映射进 DSH 原生右栏**（非自绘窗口）：`src/client/native/index.ts:126-209` 用
`ctx.inject(['sidebarRightTabs'], …)` 拿 `ctx.sidebarRightTabs`，对每个 descriptor 调
`tabs.register({ id: 'dsh-better-sidebar:<id>', kind: descriptor.id, priority: 'extension', title, guide })`，
并在 `sidebar.right.pane.tab` + `sidebar.right.pane.tab.title` 注册 body（`:157-167`）。
其中 `editor` descriptor 占了 `patterns: ['dsh-resource://file/**']`（`:174-186`），
所以**产品里打开任何文件都会落到它的编辑器**；`files` kind 也被它接管（builtin 被遮住，`:11-14`）。

服务能力：树（`fs.tree`）、搜索（`fs.search`）、读（`fs.read`）、**写**（`fs.write`，原子 tmp+rename，`src/index.ts:360-373`）、
重命名/删除（`fs.rename`/`fs.remove`）、
git（`git.worktrees/status/diff/stage/unstage/commit/branch/checkout/log/discard/revert/show/cherry-pick`，
`src/index.ts:397-477`）、diff tab（`src/client/DiffTab.tsx`）、CodeMirror 编辑器
（`src/client/TextEditor.tsx`/`EditorHost.tsx`）、终端（node-pty，走自己的 `/sidebar` 路由与 WebSocket）、
浏览器 tab。宿主侧 `export const inject = ['webServer','sessions','webRuntime','tools']`（`src/index.ts:83`），
内容存 localStorage `dsh-sidebar:v1:<sessionId>`（`src/client/state.ts:4,824,1230`）。

**能不能直接当 monocode 式 FilePane？** 技术上能（树+编辑器+预览+git diff 齐活），
但这是**第三方契约**：版本/能力靠 `service.version` 与 `service.features` 门控
（`:544,551,620`，features 现 11 项），插件升级或 DSH 再改右栏 API 就可能断。
而且它已抢走文件地址与 `files` kind——你再注册同类 viewer 会被它的 `extension` band 压住
（band 排序见 sidebar-right README:88）。

---

## 4. 拖拽：官方有什么、缺什么

**`dsh-client-ui-file-drag` 只解决"文件出/入"**，服务面极小（`src/client/index.ts:13-18`）：

    export interface FileDragService {
      readonly actions: FileDragActions   // prepare(source, signal) → { start(), release() }; reportFailure()
      readonly read: (transfer: DataTransfer) => File | undefined
    }

原文约束：`application/x-dsh-file` 的应用内 token "resolves only in its application instance"、
"Internal tokens are accepted only over the composer"（README:27）。它**不提供**"把 tab 拖到某区域"的语义。

**官方没有跨 slot 的 drag/drop 契约。** `ctx.sidebarRight` 的公开面全是命令式操作，
无 drop 目标注册、无 drag 事件、无 payload 类型（`dsh-client-ui-sidebar-right/src/client/service.ts:243-303`）：

    openResource / openResourceIn / close / hide / active / isExpanded / toggleExpanded / focus /
    split / float / dock / openTab / focusedTarget / commandTarget / splitBlock …

**宿主自己的 pane/tab 拖拽实现存在，但不可契约化复用。** 它属于 dockkit：

> The layout itself — the split tree, its operations, **the drag gestures, the floating panels** — belongs to
> `@deepseek-ai/dsh-client-ui-dockkit` and stays host-agnostic.
>  — `dsh-client-ui-sidebar-right/README.md:34`

而 `dsh-client-ui-dockkit` **不是安装包**：`<asar>/dsh/node_modules/@deepseek-ai/` 下没有该目录
（340 个包全列过；递归搜整个 asar 索引也 0 命中），它只作 web 壳静态模块表的 seed：

    // dsh-web-frontend/dist/assets/index-Ciz7DZxv.js（约 offset 1060630）
    function qJ(){return{react:rS,"react/jsx-runtime":aS,"react-dom":fS,"react-dom/client":mS,
      "@deepseek-ai/cordis":jC,zod:tN,"@tanstack/react-virtual":cN,
      "@deepseek-ai/dsh-client-store":NN,"@deepseek-ai/dsh-client-ui-slots":RN,
      "@deepseek-ai/dsh-client-ui-primitives":DK,"@deepseek-ai/dsh-client-ui-dockkit":FJ}}

同一 bundle 里它的导出面是扁平纯函数 + 组件：
`DockSurface` / `DockLayout` / `DockController` / `FloatLayer` / `MAX_DOCK_PANES`(=4) /
`MIN_PANE_FRACTION`(=0.12) / `applyOp` / `planSplitPane` / `planDropTab` / `planFloatTab` /
`findPaneContentTab` / `canSplit`；拖拽用 **pointer events + `setPointerCapture` + `data-dockkit-*` 标记**
（`function lJ(e,t){…e.setPointerCapture(t)}`，约 offset 1030444）。
sidebar-right 传给 `DockLayout` 的参数含 `dropZones: 'horizontal'`、`minPaneFraction: .2`、
`canSplit: … && dockPaneIds<2`（`sidebar-right/lib/client.js` 的 `DockLayout` 调用处）。

**插件能否自己监听跨 slot drag/drop、用 `elementFromPoint` 命中自己容器？**
技术上是普通 DOM 事件（可以），但两条硬约束：

1. 官方禁令：`Do not read another plugin's DOM, stylesheet, or component source to estimate placement`
   （`dsh-doc/references/ui-plugin.md` 尾部）；`data-dockkit-pane` / `data-sidebar-right-session`
   是实现细节，不承诺稳定。
2. `elementFromPoint` 只能可靠识别**你自己渲染的**容器；跨到宿主 pane 上等于把 dockkit 的 DOM 属性当契约。

**结论**：跨插件拖拽在 0.2.2-rc.3 上**没有官方契约，必须自造**（pointer 捕获 + 自己的 drop 目标 +
自己的 payload 类型；或用"命令/快捷键"代替拖拽）。

---

## 5. 持久化与快捷键

### 持久化 seam

| seam | 位置 | 用途/边界 |
|---|---|---|
| `Config` + `ConfigForms` + `configEditor` | `dsh-doc/references/configuration.md:1-13`；`dsh-base/cordis.patch.yml:105-107`（`config-editor` 行，`disabled: !!js "!ctx.get('profileContext')"`） | 插件配置写回 profile patch；**不要**手改 `cordis.patch.yml` |
| `ctx.credentials.modifyRecord()` | 同上 | 密钥，不进配置 |
| `ctx.storage` / `ctx.storageDomain` | `docs/subsystems/storage.md`；`dsh-base/cordis.patch.yml:179-188`（storage + storage-json(root=`dshHomePath('storages')`) + storage-domain(backend=json)） | **Host 侧** schema 校验 KV，重启仍在；`open(spec)` 后同步读、持久写、发 `domain/changed` |
| 浏览器 localStorage | 宿主自用：`dsh.sidebar-right.v1.<sessionId>`（sidebar-right README:76）、`dsh.keybindings.v1`（shortcuts README:34）、`dsh.sidebar-files.workspace-search.v1`（sidebar-files README:86）、`dsh.terminal.binding.v1.*`（terminal README:69） | 插件完全可用（同 origin）；**没有**官方的"插件 storage 服务" |
| `dsh-client-store` 的 `defineStore({persist})` | web 壳静态 bundle 内 `EN()`：`localStorage.getItem(name)` 反序列化 + 每次 set 写回 | 最省事的客户端持久 store；右栏就用它 |
| session 级存储 | **无官方 API** | 宿主做法 = localStorage key 拼 sessionId；或 Host 侧 domain 表按 sessionId 存 |

### 快捷键

注册接口（`dsh-client-shortcuts/src/client/types.ts:20-41`）：

    export interface ShortcutCommand {
      readonly id: ShortcutCommandId
      readonly label: () => string
      readonly aliases: readonly string[]
      readonly defaults: Readonly<Partial<Record<ShortcutProfile, ShortcutBinding>>>
      readonly regions: readonly ShortcutRegion[]   // 'page' | 'editable' | 'terminal'
      readonly modals: readonly string[]
      resolve(context: ShortcutContext): ShortcutResolution   // handled/run | blocked/reason | pass
    }

`ShortcutBinding = { code: 'KeyD'…, secondCode?: string, modifiers: ('primary'|'control'|'alt'|'shift'|'meta')[] }`。

**能不能声明 cmd-d / cmd-w 级键位？三层：**

1. **Web 直接拒**：`registry.ts:91-93`——
   `if (runtime === 'web' && !isWebBindingAllowed(binding, platform)) throw new Error('Unsupported Web shortcut: ' + command.id)`。
   `isWebBindingAllowed`（`src/binding.ts:96-112`）只放行：`primary+Slash`、`primary+Shift+Comma`、
   `primary+Shift+Period`、`primary+Comma`、`primary+Backslash`、`control+Backquote`、
   任意 3~4 修饰组合、以及 `primary+alt/*`、`primary+shift/*`。
   **单修饰 `primary+KeyD`/`primary+KeyW` 在 Web 上会被判 `unsupported-browser` 并抛错。**
2. **Desktop（Electron）几乎无条件放行**：`src/configuration.ts:96-98`——
   `if (runtime === 'desktop' && (platform === 'windows' || platform === 'macos')) return null`；
   且 Desktop native 键盘桥在本地处理器之前截获（shortcuts README:50）。
3. **宿主冲突检测很硬**：
   - 注册期：重复 id、默认值重叠直接 throw（`registry.ts:85-101`，"Conflicting shortcut defaults: …"）；
   - 运行期：`effectiveShortcuts` 再算 conflicts（`configuration.ts:135-152`），重叠键被 consume 并返回
     `{ status: 'blocked', reason: 'conflict' }`（`registry.ts:154-179`）；
   - 已占键位：`page.close` = Desktop `primary+KeyW` / Web `primary+alt+KeyW`，`page.refresh` 同构；
     `pane.split` = `primary+Backslash`；`pane.fullscreen.toggle` = `primary+alt+Enter`；
     `sidebar.right.toggle` = Desktop `primary+alt+KeyB` / Web `primary+Shift+KeyB`；
     `sidebar.left.toggle` = `primary+KeyB`(desktop) / `primary+alt+KeyB`(web)
     （`sidebar-right/lib/client.js` 的 `registerSidebarShortcuts`；`layout/src/client/index.ts:206-219`）。
   - 固定只读行：`registerFixed({ id, label, keys, bindings, group })` 会把这些键**从可编辑键位池保留掉**
     （types.ts:66-95；shortcuts README:32）。

**结论**：插件能声明 `cmd-d` 级键位——**在 Desktop 上**；Web 上只能用 `primary+alt+<key>` 之类白名单组合。
想要 `Cmd+W`/`Cmd+D` 的桌面端体验，还必须避开 `page.close`（已占 `primary+KeyW`），否则注册即抛冲突。

---

## 6. 外壳几何：`ctx.layout` 的真实能力面

接口全文（`dsh-client-ui-layout/src/client/service.ts:28-54`）：

    export interface ILayout {
      readonly panelInfo: HostObservable<PanelInfo>            // { activePanelId: MainPanelId | null }
      selectPanel(panelId: MainPanelId | null): void            // 未注册 key 抛错且不改当前选择
      beginNavigation(): AbortSignal
      toggleSidebar(): void                                     // 左栏开/合
      openRightbar(track: boolean, fullscreen: boolean): void   // 只报呈现意图
      closeRightbar(): void
    }

- **panel 切换**：能（`selectPanel`；侧栏入口用 `sidebar.panellist` 注册，`dsh-client-ui-sidebar/README.md:42`）。
- **左右栏开合**：能（`toggleSidebar` / `openRightbar` / `closeRightbar`）。右栏"是否占轨道"由**占位者自己**
  报（layout README:30："Whether the panel is shown, and whether it takes a track, is the occupant's own
  recorded business"）。
- **右栏宽度**：**不能由插件设**。`setRightbar(px)` 只在内部 store 的 actions 里
  （`stores.ts:57-67,125-128`，clamp 到 `RIGHTBAR_MIN` 与 viewport×0.7），唯一调用点是 AppFrame 拖拽句柄
  （`AppFrame.tsx:257-259`）；`LayoutController` 只持有 actions 却不暴露它
  （`index.ts:188-205`；`service.ts:57-105` 仅实现上表六个方法）。
- **左栏宽度**：同理，`setSidebar` 不在 `ILayout`。
- **布局不持久**：layout README:100——"Panel geometry is transient — reload restores the sidebar default and
  the right panel hidden"。右栏自己的 tab 布局持久（sidebar-right 写 localStorage），列宽不持久。
- **可驱动程度**：开关/呈现可编程，几何不可编程。唯一"插件能决定尺寸"的壳层座位是 `shell.bottom`
  （"Its occupant controls its own height and visibility"）。

---

## 明确做不到的事（按卡点分层）

1. **"把会话主列切成左右两个会话" —— 宿主 UI 包层（ui-layout / ui-conversation）**。
   `main` 是 keyed 单选、`main.conversation` 是 single、conversation 内部无 pane 概念
   （`ui-conversation/src/client/apply.ts:337-341,586-589`）。想在主列并排，只能在 `main` 里换一个
   **你自己的**面板（离开宿主会话壳），或把会话搬进右栏 tab。
2. **"自建任意深度的分栏树（含主区）" —— slot 契约层**。
   子座位只能由渲染它的 entry 声明（`slots.md:23,226`）；`root`/`sidebar`/`rightbar` 是 single 且已被占。
   自己的容器里随便分，宿主容器里一格都加不了。右栏分割树是 sidebar-right 私有的 dockkit 状态，
   产品上限写死 **2 个横向 pane**（README:129；store 里 `dockPaneIds>=2` 直接拒绝 split），
   尽管 dockkit 自身允许 4（`MAX_DOCK_PANES=4`）。
3. **"跨插件/跨 slot 的拖拽" —— slot 契约层 + 无公开 drag API**。
   官方只有 `fileDrag`（文件出/入，应用内 token 只在 composer 被接受）；`ctx.sidebarRight` 没有 drop 目标
   注册或 drag 事件；dockkit 的拖拽不是可安装包、无 README/.d.ts。要做只能自造命中测试，
   且不能依赖 `data-dockkit-*` 这些内部标记。
4. **"插件驱动右栏/左栏宽度，或保存列宽" —— 卡在 `ctx.layout` 的面（不是 Remote、不是 slot）**。
   宽度是 frame 的私有 store + 拖拽句柄，`ILayout` 只收布尔呈现意图；列宽本身也不持久。
5. **"官方文件 API 落盘" —— Remote API 层**。
   `dsh-api-workspace-files` 明确无 mutation；文档预览只读。写只能靠 `ctx.fs`（Host 侧，自建 HTTP 路由 /
   Remote 端点），或复用第三方插件的 `/sidebar/api` `fs.write`。
6. **"Web 上声明 Cmd+D / Cmd+W" —— shortcuts 协议层**。
   `isWebBindingAllowed` 白名单 + `bindingIssue` 让注册期就抛 `unsupported-browser`；
   `primary+KeyW` 还被 `page.close` 占着。Web 的现实解是 `primary+alt+<key>`。

---

## 未验证

- **无真机点验**：本会话没有 `cordis_inspect_query`（`Slots` 子树/live 座位/props 无法实测），也无浏览器控制。
  所有 slot props、占位者列表取自生成的 `slot-catalog.ts` 与包 README，**未在运行页面核对**。
  建议下一票用「新会话 + 最小 client bundle」实测 `main` 新 key 的 children 生命周期。
- **`dsh-client-ui-dockkit` 能否被第三方 bundle `require`**：它在 web 壳静态 seed 表里
  （`"@deepseek-ai/dsh-client-ui-dockkit":FJ`），`makeRequire` 先查 seed 再查 module 表
  （`dsh-client-modules/src/client/system.ts:327-351`），**理论上**第三方 bundle `require` 就能拿到。
  但 ①它不是可安装包、无 `.d.ts`/README；②`dsh.client.external` 的 host 侧只校验自引用/环
  （`dsh-client-modules/src/index.ts:541-583`）；③`references/packages.md` 的 client 表里也没有它；
  ④官方 practices 明令不要 require 宿主 Client 包。用它 = **未验证 + 违规风险**，本次未实测。
- **"一个 `main` 面板里放 2~3 个 `conversation.content` 实例"的实际表现**：契约上成立
  （SessionProvider 显式 reference + factory `variant:'embedded'`），但性能、document 级粘贴路由仲裁
  （conversation README:135）、右栏与主区同时 `keepMounted` 时的内存/连接数，均**未实测**。
- **右栏 tab `keepMounted:true` + 后台会话**：文档说保留 body、切会话不销毁（sidebar-right README:112），
  多会话并排时 retain 计数与释放时机**未实测**。
- **`dsh-better-sidebar` 在本机的运行状态**：已装 0.19.1、patch 有聚合双重挂载保护，但它的终端（node-pty）、
  `/sidebar` 路由、`fs.write` 在当前 profile 是否真正可用**未实测**（需开页面点验）。
- **`shell.bottom` 实测占用**：catalog 里占位者是实验性 `experimental-inspector`，`dsh-web-app/cordis.patch.yml`
  里没搜到该行 → 推断为空，**未在页面确认**。
- **`main` 新 key 的 children 是否只在选中时存在**：由 keyed 语义与 `declaredBy`
  （"an entry in 'main' … so it exists while that entry is mounted"）推断，**未真机验证**；
  这直接决定"面板未选中时插件能否往自己的子座位注册"。
- **Desktop 上 `primary+KeyW` 冲突的实际报错**：由 `registry.ts:85-101` 推断为
  "Conflicting shortcut defaults: …"，**未跑**。
- **`ctx.documentPreviews` 的 host 侧完整 schema**（`sourceLines` 与导航参数格式）：只读到 README 摘要，
  未逐条读 `ui-sidebar-documentpreview/src/client/index.ts`。
- **monocode 侧对照**：本次没读 monocode 源码，因此"迁移含义"一列是基于 DSH 能力面的推演，
  不是逐功能对齐结论。

---

## 附：本次落地的取证工具（未改插件、未改 profile）

- `.scratch/monocode-ui-parity/tools/asar-read.cjs`（原有）
- `.scratch/monocode-ui-parity/tools/asar-ls.cjs`（新增：列 asar 索引目录 / 看文件大小）
- `.scratch/monocode-ui-parity/tools/asar-find.cjs`（新增：在 asar 索引里按正则递归找路径）
- `.scratch/monocode-ui-parity/tools/asar-grep.cjs`（新增：在 asar 内文件内容里正则匹配并打印上下文）
- `.scratch/monocode-ui-parity/tools/asar-slice.cjs`（新增：按字符偏移切片，用于读 web 壳静态 bundle）
- 抽取的原文副本在 `.scratch/monocode-ui-parity/research/_dump/`（README、docs、src、slot 目录、web 壳 bundle 片段），
  便于复核引用行号。
