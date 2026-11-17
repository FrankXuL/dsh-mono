<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:research -->
<!-- DSH-IDEMPOTENCY-KEY: deck-27eb32e6-5982761 -->
<!-- DSH-CREATED: 2026-11-16T11:26:30.916Z -->
# 02: DSH 插件能力边界：拖拽分栏、多会话同屏、文件面板能不能做

Type: research

Status: resolved
## Question

以**已安装的 DSH 0.2.2-rc.3 装包**为准（不是记忆、不是网上文章），查明 DSH Web 插件能触到哪些交互面，产出能力矩阵。

1. **Slots**：`@deepseek-ai/dsh-client-ui-slots`（若不在 `@deepseek-ai/dsh-client-*` 清单里就找实际持有 `ctx.slots` 的包）暴露哪些 slot、各自 props；插件能不能在 shell 层（`shell.root`/`shell.overlay`/`main.*`/`shell.bottom`）注册；**能不能新增一个可分割容器**，还是只能在既有容器里填格子。读 `references/ui-plugin.md`、`practices.md`，以及 `dsh-client-ui-layout`、`dsh-client-ui-sidebar-right`、`dsh-client-ui-workspace` 的 README。
2. **多会话同屏**：`dsh-client-ui-session` 的 `SessionProvider` 能否在同一页面同时绑定多个 `SessionReference`；一个 pane 内切会话需要什么（`dsh-api-session-controller` 的相关 Remote 方法）。`dsh-client-ui-conversation` 是否单实例——这直接决定"多会话并排"是不是根本不可能。
3. **文件面**：`dsh-client-ui-sidebar-files`、`sidebar-documentpreview`、`sidebar-right`、`dsh-api-workspace-files` 各给什么；第三方 `dsh-better-sidebar`（web profile 里已装）的 tab/viewer 注册服务能不能直接当 FilePane 用，接口长什么样（读它 `lib/types/*.d.ts` 与 `src/`）。
4. **拖拽**：`dsh-client-ui-file-drag` 提供什么；插件能不能监听跨 slot 的 drag/drop、能否自己 `elementFromPoint` 命中容器；有没有官方 drag 契约，还是要自己造。
5. **持久化与快捷键**：插件可用的 storage/config seam；`dsh-client-ui-shortcuts` 的注册接口能不能声明 cmd-d / cmd-w 级键位并做宿主冲突检测。
6. **窗口/面板几何**：`ctx.layout` 能不能被插件驱动（右栏宽度、panel 切换），还是只读。

**交付**：`.scratch/monocode-ui-parity/research/dsh-capability-matrix.md`，逐项 **能 / 不能 / 受限** + 证据（包名 + README 小节或源码路径 + 行号）。

## Notes

外壳命令读不了 app.asar。用 `node .scratch/monocode-ui-parity/tools/asar-read.cjs '<asar 内路径>'`，或直接用 `read` 工具读 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/...`。查不到就写 **未验证**，别猜。

## Comments

### local — 2026-11-16T12:03:34.531Z
## Answer

调查完成：`.scratch/monocode-ui-parity/research/dsh-capability-matrix.md`（490 行 / 37 KB），原始摘录在 `research/_dump/` 供复核行号。对象是本机装包 DSH 0.2.2-rc.3（asar 里 340 个 `@deepseek-ai` 包的 README/.d.ts/src/lib + `dsh/docs/subsystems/*` + 生成的 `slot-catalog.ts`（**116 个可注册 slot key**）+ web 壳静态 bundle + 已装 `dsh-better-sidebar` 0.19.1）。总表 21 行，另有「明确做不到的事（按卡点分层）」与「未验证」12 条。

**三个关键判定**

1. **多会话同屏 = 能，但容器必须自建。** `SessionProvider` 显式传 `SessionReference` 只覆盖该子树（`slots.md:99`），宿主自己在右栏就这么干（`ui-subagent/src/client/sidebar-chat/index.tsx:109,152-166`）。但 `conversation.content` factory 的输入里**没有 sessionId**（`ui-conversation/README.md:223`），且 `main`/`main.conversation` 分别是 keyed 单选与 single —— **把宿主会话主列切成分栏做不到**。
2. **自建分栏树 = 受限，卡在 slot 契约。** 子 slot 只能由渲染它的组件声明（`slots.md:23,226`），`root`/`sidebar`/`rightbar` 都是 single 且 `root` 契约明写 "DO NOT register here"。插件只能在自己拥有的渲染位（新的 `main` key、右栏 tab、`shell.overlay`）里画自己的树。右栏分屏上限写死 2 个横向 pane（`sidebar-right/README.md:129`），其 dockkit **不是安装包**、无 README/.d.ts，不可当契约复用。
3. **拖拽与快捷键都被协议层卡住。** 跨 slot 拖拽**没有官方契约**（`ctx.sidebarRight` 只有命令式操作，`ui-file-drag` 只认文件且 "Internal tokens accepted only over the composer"）；`cmd-d`/`cmd-w` 级键位在 **Web 注册期直接抛错**（`binding.ts:96-112` 白名单 + `registry.ts:91-93`），Desktop 放行但 `primary+KeyW` 已被 `page.close` 占用。

**对迁移最要紧的两条附带结论**
- 官方文件面全是**只读**：`sidebar-files` "Listing only"、`sidebar-documentpreview` 不可编辑、`dsh-api-workspace-files` "exposes no mutation operation"。想要 monocode 那种 FilePane（树+编辑器+预览+git diff），要么自建（保存走 `ctx.fs` Host 路由），要么买 `dsh-better-sidebar` 的第三方契约（`service.d.ts:448-579`，有 `git.*` 与 `fs.write`，代价是绑死其 API 与 HTTP 路由）。
- 文件面板最省事的落点是**右栏 tab**：`ctx.sidebarRightTabs.register(...)` + 在 `sidebar.right.pane.tab` 注册 body。

**未验证（12 条，没有猜）**：本会话无 `cordis_inspect_query`、无浏览器控制，所以 slot 占位者与 live props、`shell.bottom` 是否真空、`main` 新 key 的 children 生命周期、better-sidebar 运行时是否真可用，全部待真机点验。

能力矩阵已交付，六个问题逐条有证据，未验证项单列

## 进度
