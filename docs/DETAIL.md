# Mono

把 DSH 主区换成多会话工作区：每栏一条会话，用的是**宿主原生的**会话体，不是重画的。

## 这个版本是什么

这是**探针版**（0.0.1）：用来验证一件事——能不能在自己的 pane 里拿到原生完整会话（头 + 体 + 输入框）。

验证点是判定表里最关键的那个岔路：如果 `conversation.content` factory 配 `SessionProvider` 能渲染出完整原生会话，那么自建多栏就不必重画 UI，也就不会重蹈「和宿主脱节」的覆辙。

结论：能。所以 0.0.1 之后的工作都在这个骨架上加结构，不再回头重画会话。

## 目录结构

    client.js                       ← 构建产物，不要手改
    src/client/index.js             ← 入口：注册 main 槽 + 侧栏入口
    src/client/base.js              ← 常量、[mono] 日志
    src/client/session/reference.js ← retain / binding / useSessionReference
    src/client/panes/Pane.js        ← 单栏：原生会话体 + 局部错误边界
    src/client/panes/PaneTree.js    ← 栏容器（占位：固定两栏，T02+ 换布局树）
    src/client/layout/tree.js       ← 布局树纯函数（占位，T02 写）
    src/client/persist/index.js     ← 持久化（占位，T05 写）
    src/client/style.css            ← 样式，构建时内联成字符串
    scripts/build.mjs               ← 拼接脚本

## 开发

改什么：只改 `src/client/` 下的文件。根目录的 `client.js` 是产物，改它下次构建就被覆盖。

怎么构建：

    npm run build

`scripts/build.mjs` 把模块按写死的顺序拼在一起（不打包、不做依赖分析、零依赖）：

    base.js → session/reference.js → panes/Pane.js → panes/PaneTree.js
            → persist/index.js → style.css（内联成 MONO_STYLE_TEXT）→ index.js

新增模块要自己加进脚本里的 `MODULES` 数组，顺序错了会 TDZ（`const` 在定义前使用）。构建完顺手 `node --check client.js`。

产物形状始终是：

    window.__ModuleLoader__.load({ id: "dsh-mono", factory(require) { ... return MONO_PLUGIN; } })

怎么装（一次性 dev profile，别碰 desktop）：

    dsh plugin --profile dev-mono add link:/Users/xulilili/Downloads/code/github/dsh-mono
    dsh --profile dev-mono --no-open --port 57997

- 用 `link:` 不用 `file:`。`file:` 是 pnpm 的拷贝快照，改完源码重建也不会生效；`link:` 是指向仓库的符号链接，`npm run build` 之后刷新页面就能看到变化（服务端按 `rev` 分发 client.js，改文件即换 rev，不用重启服务）。
- dev profile 第一次起不来是常态：要在 profile 的 `package.json` 里手动把 `@deepseek-ai/dsh-web-app` 补进 `dsh.profile.bundles`（npm 上那个版本旧，会被版本检查拒）。
- 验证：无头 Chrome（`--headless=new --remote-debugging-port=9222`）+ CDP，点侧栏 **Mono**，检查存在 `.mono-root`、`.mono-pane` 数量正确、栏内有真实会话文本、控制台无异常。
- 每轮验证开新 target（新浏览器实例或新标签），别在已经跑起来的页面上再 `Page.navigate`：那会带出旧页卸载期的噪声（`gateway/cancelled`、`remote.mux` 连接拒绝、404、偶发 `SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`）。这些是瞬态，不是回归，按它们判红会查错方向。

## 页面里有什么

最多两栏，每栏一条宿主原生会话（完整会话体 + 输入框），会话 id 取自 `main` 槽 props 的 `sessions`。

探针版左边那列诊断打印（props / main keys / 服务探测）已经删掉——它的结论都写在本文件里了。

## 关键设计

**不覆盖宿主。** 宿主自己用 `key: 'conversation'` 注册 `main` 条目；这个插件用的是**新 key**（`mono`），宿主那条完全不动。对比 `dsh-multipane` 用 `priority: -1` 盖掉宿主条目——那正是「invasive」的来源。

窗格里的渲染路径：

    SessionProvider({ session: { sessionId, binding } })
      └─ renderFactorySlot("conversation.content", { variant: "embedded", phase: "active" })

三条不能"优化"的实测结论：

- `binding` 由 `sessions.binding(id)` 现取，每次渲染重算——缓存会让 scope 重建后留下过期 owner token，栏内直接报错。
- 会话保留用 `sessions.retain(id, { source: "mono" })`，source 必须是自定义值。写成 `"mainView"` 会和宿主抢，侧栏「新会话」行会时有时无。
- 侧栏入口必须注册在 `sidebar.panellist` 槽上（`{ name, id, order, label }`）。不注册面板没有任何入口可达，`selectPanel("mono")` 也没人调用。
- 注册 `main` 时必须带子槽声明 `children: { "mono.pane": { kind: "list", scope: "session-maybe" } }`。宿主正是靠它把 `SessionProvider` / `renderFactorySlot` 注入面板 props；删掉声明面板不报错，但每栏都退化成 `no SessionProvider`（07 票实验 A 的结论）。代价见下面「已知限制」最后一条。

## 已知限制

- 布局是占位：固定两栏、只取前两条会话，没有分栏树、标签条、拖拽。
- 没有持久化：刷新后回到默认两栏。
- 没有原生会话头（`conversation.session.header`），只有体。
- 服务端在页面活着时被重启/断连，旧页卸载阶段宿主偶尔抛 `SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`（伴随 `gateway/cancelled`、`remote.mux ERR_CONNECTION_REFUSED`）。是宿主 teardown 的时序噪声：健康页面刷新从不复现，只和上面那条必需的子槽声明在死网关下有关，插件侧无法捕获（异常在宿主的 render 里）。归因见 `.scratch/monocode-ui-parity/issues/07`。
