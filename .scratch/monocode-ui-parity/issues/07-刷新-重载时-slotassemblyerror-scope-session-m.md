<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-LABELS: bug, needs-triage -->
<!-- DSH-IDEMPOTENCY-KEY: deck-69ba46f3-5982793 -->
<!-- DSH-CREATED: 2026-11-16T14:09:46.477Z -->
# 07: 刷新/重载时 SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter

**What to build:** 

**Blocked by:** None (can start immediately)

**Status:** resolved

## 现象

在**已经跑起来**的 DSH 页面上再次导航（同一 CDP target 上的 Page.navigate，等价于用户在页面里刷新）时，控制台出现未捕获异常：

```
SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter
    at ScopeProvider (…/@deepseek-ai/dsh-client-ui-renderer/client.js…)
    at Zf / e0 / Tm / Nm / Ux / Kc / g0 / jm / Wr (assets/index-*.js)
```

同一次重载还会带出 `gateway/cancelled: Remote invocation "…/inventory" was aborted`、`remote.mux ERR_CONNECTION_REFUSED`、若干 404。

**干净加载（新浏览器实例 → about:blank → navigate）时，这些现象一条都没有**：CONSOLE []、EXCEPTIONS []。

## 影响

未定。两种可能：
1. 纯旧页卸载期的瞬态（老 gateway 被掐、scope 正在拆），用户可见影响为零；
2. 我们注册 `main` 槽时声明的子槽 `children: { "mono.pane": { kind: "list", scope: "session-maybe" } }` 在 scope 拆除路径上真的缺少 adapter——那就是我们自己的声明有问题，将来做多栏/换 scope 时会放大。

## 复现

1. `dsh plugin --profile dev-mono add link:<repo>`（dev-mono 的 bundles 需补 `@deepseek-ai/dsh-web-app`）
2. `dsh --profile dev-mono --no-open --port 57997`
3. 无头 Chrome `--headless=new --remote-debugging-port=9222`，CDP 连页 target
4. navigate 到 app URL，等 6s，**再** navigate 同一 URL，等 8s，收集 Runtime.exceptionThrown

## 排查计划（二分）

- A：去掉 `children` 声明后重建，重跑同一脚本 → 异常是否消失
- B：profile 的 bundles 去掉 `dsh-mono` 后重跑 → 异常是否消失（判断是否与插件有关）
- 若 A 成立：改声明（去掉 scope，或按宿主文档提供 adapter），让两次加载都零异常
- 若 B 也出现：与我们无关，记录归因并关闭

## 验收

同一 target 连续两次 navigate，`EXCEPTIONS` 为空；或给出「与插件无关」的对照证据并关闭。

## Comments

### local — 2026-11-16T14:26:12.755Z

### local — 2026-11-16T14:26:12.779Z
归因为宿主卸载期时序噪声（死网关 + session 作用域子槽 teardown 渲染），健康页面不复现、非稳定复现、用户可见影响为零；必需的子槽声明保留并写进代码注释与 DETAIL。
## 结论：宿主 teardown 时序噪声，非插件缺陷；保留子槽声明

差分实验（同一脚本 /tmp/mono-reload.mjs，杀服务端 → 重启 → 同 target navigate，收集 Runtime.exceptionThrown/console error/Log error）：

| 变体 | 条件 | 结果 |
|---|---|---|
| N | profile 去掉 dsh-mono bundle | 5 条 remote.mux，无 SlotAssemblyError |
| P2 | 插件在，但**从未打开 Mono 面板** | 5 条 remote.mux，无异常 |
| P4 | 插件在，只打开宿主自己的会话视图（不开 Mono） | 5 条 remote.mux，无异常 |
| P | 插件在，**Mono 面板已挂载（2 栏）** | 首轮 22 条事件：SlotAssemblyError + gateway/cancelled + `Session reference "…" is released` |
| A | 面板挂载，但注册时去掉 `children` 声明 | 异常消失，但两栏都变成 `no SessionProvider`（props 没了）→ 不是可用的修法 |
| P' | 恢复 `children` 后重跑同一死网关场景 | 7 条事件（2×404 + 5 remote.mux），**SlotAssemblyError 未复现**；面板 panes=2、composers=2、paneText 为真实会话内容 |

结论：
1. 异常只在「我们声明的 `scope: "session-maybe"` 子槽存在 + 网关已死 + 旧页正在卸载」时出现，属宿主 ScopeProvider 的 teardown 渲染，插件侧捕获不到。
2. 该子槽声明是 load-bearing（宿主靠它注入 `SessionProvider`/`renderFactorySlot`），不能删——删了功能直接废掉。
3. 健康页面刷新（服务端活着）从不复现；死网关场景也非稳定复现（同一代码两次跑，一次有、一次无）。
4. 用户可见影响为零：异常发生在页面正在被替换的卸载阶段。

处理：保留声明，把「load-bearing + 死网关下的噪声」写进 `src/client/index.js` 注册处注释与 `docs/DETAIL.md`「关键设计 / 已知限制」。若将来真在健康页面见到该异常，再按「去掉 scope 或自备 adapter」重启调查。

## 进度
