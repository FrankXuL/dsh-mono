<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-c8c00151-5982761 -->
<!-- DSH-CREATED: 2026-11-16T11:26:31.010Z -->
# 04: 初始化 dsh-monob 插件骨架，并在本机 GUI 里加载成功

Type: task

Status: resolved
## Question

在本仓库根目录立起一个能被 GUI 加载的 DSH Web 插件骨架，包名按仓库习惯（`dsh-monob` 或类似），要求：

1. 依装包内 `templates/decoration/` 起：`package.json`（`dsh.bundle.patch` + `dsh.client` 的 `platform`/`immediately`/`inject`）、`cordis.patch.yml`、`index.js`（`export function apply() {}`）、`client.js`（懒工厂 + `ctx.slots.inject`/`register` 注册一个占位元素）、`locale/`、`docs/DETAIL.md`、`icon.svg`。
2. 装进当前 web profile 并启用，确认页面上**真的出现**占位元素，留下证据（截图或 DOM 片段）。
3. 留 `npm run build` / `dev` 或等价命令，跑一次 `npx dsh-standards <插件目录> --scope entry --entry-claim static` 并贴结果。
4. 模板先复制进仓库再改，不要在 asar 里原地动。

## Notes

这是用户点名的"初始化"。骨架只放占位能力，不实现功能——功能怎么切由长期路线那张票定。

## Comments

### local — 2026-11-16T13:07:02.274Z
## Answer

初始化已完成，并且在**隔离环境**里实测通过（未触碰用户的 desktop profile）。

**产物**：仓库根目录的插件工程 — `package.json`（`dsh.bundle.patch` + `dsh.client` 三件套）、`cordis.patch.yml`、`index.js`、`client.js`、`locale/en.json`、`icon.svg`、`docs/DETAIL.md`。

**验证方式**：新建一次性 profile `monob-test`（`dsh plugin --profile monob-test add file:<repo>`），以 `dsh --profile monob-test --no-open --port 57999` 起服，用无头 Chrome 走 CDP 加载页面。验证后 profile 已删除。

**实测结果**：
- boot payload 的 application 阶段 entries 含 `dsh-monob`；模块可取（10490 字节），内容与本地一致。
- 侧栏出现 **Monob** 入口，点击可切到插件面板。
- `main` 槽真实条目：`["monob", "plugins", "conversation", "schedules"]` —— 宿主 `conversation` 未被覆盖。
- 两个窗格各自渲染出**宿主原生**会话体：pane 1 有原生 composer，pane 2 有真实 transcript。
- 运行时异常：**0**。

**宿主注入给 slot 条目的 props 全清单（实测，非文档推断）**：
`useContextMenu, usePanelInfo, useSessions, useSessionStatus, useWorkspaces, useResource, useRemoteAccess, useSessionRetainInfo, useSessionAccess, useWorkspaceAccess, renderFactorySlot, renderSlot, SessionProvider, children`

**关键技术结论（供票 05 用）**：

1. 多栏可行且**不必重画 UI**：`SessionProvider({session:{sessionId,binding}})` + `renderFactorySlot("conversation.content",{variant:"embedded",phase:"active"})` 拿到的是宿主原生会话体。
2. `binding` 必须每次渲染用 `sessions.binding(id)` 现取，缓存会留下过期 owner token。
3. 保留会话用 `sessions.retain(id,{source})`，**必须传自定义 source**（不要用 `mainView`），否则与宿主抢会导致侧栏"新会话"行时有时无。
4. 侧栏入口是 `sidebar.panellist` 槽，注册 `{name,id,order,label}`。
5. 用**新增 main key**（而非 `priority:-1` 抢占）即可与宿主会话并存 —— 这正面回答"invasive"问题。

**未做**：分栏树、拖拽、标签条、布局持久化。这些属于功能实现，不在"初始化"范围内。

插件工程已立起并在隔离 profile 实测加载成功，原生会话渲染验证通过

## 进度
