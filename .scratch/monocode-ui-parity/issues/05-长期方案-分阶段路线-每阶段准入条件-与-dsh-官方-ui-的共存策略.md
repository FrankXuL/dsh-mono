<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:grilling -->
<!-- DSH-IDEMPOTENCY-KEY: deck-693a4ff8-5982761 -->
<!-- DSH-CREATED: 2026-11-16T11:26:31.045Z -->
<!-- DSH-BLOCKED-BY: 03, 04 -->
<!-- DSH-ASSIGNEES: lead -->
# 05: 长期方案：分阶段路线、每阶段准入条件、与 DSH 官方 UI 的共存策略

Type: grilling

Blocked by: 03, 04
Status: resolved
## Question

基于判定表与已立起来的骨架，和用户一起定长期方案：

- 分几个阶段、每阶段交付什么、什么算过关（可验收的判据，不是"做完了"）。
- 哪些交互先做、哪些明确不做；尤其 **和 DSH 官方左侧栏 / 右侧栏 / Conversation 的边界**——是替换还是共存、要不要借 `dsh-better-sidebar`。
- 风险与前置：宿主升级会不会打断、要不要依赖私有接口、要不要 fork。
- 每阶段的工作量级，让人能据此拍板。

## Notes

HITL：一次一个问题地问，不要自答。

## Comments

### local — 2026-11-16T13:18:52.583Z
## Answer

长期方案落在 `.scratch/monocode-ui-parity/plan.md`（145 行）。九项决策、三阶段路线、共存策略、技术要点、风险与工作量。

**九项决策**：①补充件（新增 main key）②包名 dsh-mono ③每栏标签条 ④preview 临时态 ⑤嵌套二分树 ⑥从零写不 copy ⑦布局全存 localStorage ⑧桌面端优先用 Cmd+D ⑨有取舍的一致（挂原生头体，去宽度控制与 hero）。

**三阶段**（每阶段带可验收判据，不是"做完了"）：
- **阶段 1「可用的多栏」L**：树 + 标签条 + 原生头体 + 拖拽分栏 + 持久化。过关 = 两栏对照能各自发消息 / 拖标签能分栏合栏 / 重启完全还原。
- **阶段 2「完整手势」L**：sash 拖动、跨栏拖标签、关栏塌缩、焦点导航、滑入动画。过关 = 不看文档能完成开三栏拖宽关中间 / 动画 60fps / 标签迁移不丢不重。
- **阶段 3「打磨」M**：桌面快捷键、空态、错误兜底、中英文案、设置项。过关 = Web 端注册不抛 unsupported-browser / 单栏崩溃不白屏 / 切语言即时生效。

**共存策略：只加不改。** 新增 main key 不覆盖宿主 conversation（探针实测四条目共存）；侧栏走 sidebar.panellist；栏内渲染宿主原生头体，使其他插件继续有效；去掉宽度控制与 hero（与多栏布局假设冲突）。

**关键技术（探针已验证）**：`SessionProvider + renderFactorySlot("conversation.content")` 拿原生会话；`binding` 每次现取；`retain(id,{source:"mono"})` 必须自定义 source；挂 `conversation.session.header` 才有原生头。

**键位实况**：`Cmd+B`/`Cmd+\\`/`Cmd+Shift+B`/`Cmd+W` 已占；`Cmd+D` 与 `Cmd+Shift+D` 空闲可用。Web 端 `Cmd+D` 注册期抛错，须按 runtime 分流。

**开工前置：无** —— 探针已把最不确定的三条（原生体、原生头、与宿主共存）验证掉。

九项决策已定，三阶段路线与共存策略成文，探针已验证关键前置

## 进度

- 进度：100%（2026-11-16T21:18:52+08:00）：方案成文 plan.md
- 进度：30%（2026-11-16T21:14:45+08:00）：已定 6 项：补充件定位 / 改名 dsh-mono / 每栏标签条 / preview 临时态 / 嵌套树 / 从零写
