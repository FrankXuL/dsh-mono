<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-a8aa03cc-5982761 -->
<!-- DSH-CREATED: 2026-11-16T11:26:30.962Z -->
<!-- DSH-BLOCKED-BY: 01, 02 -->
<!-- DSH-ASSIGNEES: lead -->
# 03: 交互对交互：每个 monocode 交互在 DSH 里映射成什么、判可做与否

Type: task

Blocked by: 01, 02
Status: resolved
## Question

把「monocode 交互全清单」逐条对到「DSH 插件能力边界」上，产出判定表：每条交互标 **可做 / 需降级（写降级成什么）/ 不可做（写卡在哪）**，并给出落点（哪个 slot、哪个服务、要不要自建容器）。

这张表就是用户要的"可行性调研"正文。

## Notes

两条前置票都 resolved 才开工。判定只引用前两张票的条目，不新开调查；真的发现空白，回写进 map 的 Not yet specified。

## Comments

### local — 2026-11-16T12:23:22.217Z
## Answer

判定表落在 `.scratch/monocode-ui-parity/feasibility-matrix.md`（187 行）：**84 条交互逐条判定**，四档（已存在 / 可做 / 需降级 / 不可做）+ 成本档（S/M/L/XL）+ 依据（引回两份调查的条目与行号）。

**结论摘要**

1. **DSH 已经覆盖 monocode 大约一半的外围面**——权限四档、`@` 文件引用、逐文件 diff 审阅（含 undo）、自动化定时、子代理协作、终端、归档、会话搜索/过滤/右键菜单、模型切换、附件、停止轮次。这些不用搬。**真正缺的是空间层**：分栏树、拖拽、tab 管理。
2. **多会话并排能做，但容器必须自建**（#49，XL）。落点二选一：新的 `main` key 面板（干净但离开宿主会话壳）或右栏 tab（贴着会话但产品上限写死 2 个横向 pane）。
3. **跨插件拖拽没有官方契约**（#30 不可做且官方禁止读别家 DOM），必须自造命中测试；monocode 的 `elementFromPoint` 那半套可搬，属性换成自己的。
4. **`Cmd+D`/`Cmd+W` 在 Web 上注册即抛错**（#19）：白名单外只能 `primary+alt+<key>`；Desktop 可声明 `primary+KeyD`，但 `primary+KeyW` 已被 `page.close` 占。
5. **官方文件面全只读**（#31–#35）：`sidebar-files` 只列目录、`documentpreview` 只预览、`workspace-files` 明确 no mutation。要编辑器只能自建保存通道（`ctx.fs` + Host 路由）或买 `dsh-better-sidebar` 契约。

**第一梯队（便宜、不碰禁区、立刻有感）**：preview 临时 tab（#9，S）→ tab 访问历史（#20，S）→ 选区 Add to chat（#45，M）→ 权限常驻 pill 增强（#58，S）。
**第二梯队**：自建分栏树 + 拖拽 + 滑入动画（#1–#7、#13、#21–#22，XL）→ 一个 pane 内切会话（#48）→ 布局持久化（#15）。
**明确不做**：Chrome 式 tab 组（#16，monocode 自己都没接线）、会话多选（#53）、会话文件夹（#56）、title tab 条改造（#14/#29/#66）、依赖 `data-dockkit-*`（#30）、notes/inbox/monos/agent-app/providers/connections。

**遗留空白（已写回 map 的雾）**：自建容器落点未定（产品决策）；多会话并排的性能/retain/粘贴路由全为「未验证」，做 #49 前必须真机点验；可编辑文件面是"自建通道 vs 绑第三方"的岔路；Web 键位降级的接受度。

未新开调查，只做对齐；两处存疑（会话内查找确实无 host 实现、file-review-tab 确有 undo）已回源码核实。

84 条交互判定表已交付，分四档并给出优先级与遗留空白

## 进度
