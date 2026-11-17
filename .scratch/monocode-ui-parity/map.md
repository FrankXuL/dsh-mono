<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 把 monocode 的交互搬进 DSH：可行性与长期方案 -->
<!-- DSH-STATUS: ready-for-agent -->
<!-- DSH-LABELS: wayfinder, wayfinder:map -->
<!-- DSH-IDEMPOTENCY-KEY: deck-2def8e40-5982761 -->
<!-- DSH-CREATED: 2026-11-16T11:25:32.246Z -->

## Destination

拿到一份能直接开工的长期方案：monocode 的每个交互（多会话拖拽、分栏、tab 组、文件查看等）在 DSH Web 插件模型下的可行性判定——可做 / 需降级 / 不可做，各带理由与落点——配上分阶段路线；`dsh-monob` 插件工程骨架已初始化并能被 GUI 加载。

## Notes

- 域：DSH Web GUI 插件（Cordis bundle + `dsh.client` 模块 + Slots）。
- 对标对象：hardbeat920/monocode 的 **React/Tauri 生产版**源码。README 明确 Rust/GPUI 的 native 版是实验预览，React/Tauri 才是 production app。
- 工作区不是 git 仓库，research 结论落在 `.scratch/monocode-ui-parity/research/`，不走 `research/<name>` 分支。
- **本次 carry execution**：用户明确要求"以及初始化"，所以「先立起 dsh-monob 插件骨架」是本 map 内的活；除此之外仍只产出决策，不产出成品功能。
- 每个会话先读 DSH 装包文档，路径在 app.asar 里（`read` 工具能直接读）：
  `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/dsh-doc/` 下的 `references/ui-plugin.md`、`practices.md`、`composition-reference.md`、`host-plugin.md`。
  外壳命令读不了 app.asar，用仓库内 helper：`node .scratch/monocode-ui-parity/tools/asar-read.cjs <asar 内路径>`。
- 版面对齐基线：DSH 0.2.2-rc.3（dsh-plugin-guide 记的 host baseline）。

## Decisions so far
- [monocode 交互全清单：它到底让用户做了什么](issues/01-monocode-交互全清单-它到底让用户做了什么.md): 调查完成，结论落在 `.scratch/monocode-ui-parity/research/monocode-interactions.md`（362 行 / 63 KB / 205 行表格）。基线 commit `09d04436`（…
- [DSH 插件能力边界：拖拽分栏、多会话同屏、文件面板能不能做](issues/02-dsh-插件能力边界-拖拽分栏-多会话同屏-文件面板能不能做.md): 调查完成：`.scratch/monocode-ui-parity/research/dsh-capability-matrix.md`（490 行 / 37 KB），原始摘录在 `research/_dump/` 供复核行号。对象是本机装…
- [交互对交互：每个 monocode 交互在 DSH 里映射成什么、判可做与否](issues/03-交互对交互-每个-monocode-交互在-dsh-里映射成什么-判可做与否.md): 判定表落在 `.scratch/monocode-ui-parity/feasibility-matrix.md`（187 行）：**84 条交互逐条判定**，四档（已存在 / 可做 / 需降级 / 不可做）+ 成本档（S/M/L/XL）+…
- [初始化 dsh-monob 插件骨架，并在本机 GUI 里加载成功](issues/04-初始化-dsh-monob-插件骨架-并在本机-gui-里加载成功.md): 初始化已完成，并且在**隔离环境**里实测通过（未触碰用户的 desktop profile）。
- [长期方案：分阶段路线、每阶段准入条件、与 DSH 官方 UI 的共存策略](issues/05-长期方案-分阶段路线-每阶段准入条件-与-dsh-官方-ui-的共存策略.md): 长期方案落在 `.scratch/monocode-ui-parity/plan.md`（145 行）。九项决策、三阶段路线、共存策略、技术要点、风险与工作量。
- [收口：可行性结论 + 长期方案 + 骨架现状，写成给用户的一份报告](issues/06-收口-可行性结论-长期方案-骨架现状-写成给用户的一份报告.md): 收口报告落在 `.scratch/monocode-ui-parity/report.md`（115 行），汇总六张票：做了什么、可行性分布、探针实测证据、方案要点、明确不做、未定项、文件索引。
- [刷新/重载时 SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter](issues/07-刷新-重载时-slotassemblyerror-scope-session-m.md): 归因为宿主卸载期时序噪声（死网关 + session 作用域子槽 teardown 渲染），健康页面不复现、非稳定复现、用户可见影响为零；必需的子槽声明保留并写进代码注释与 DETAIL。

## Not yet specified

<!-- 六张票全部收口，无待解决策。以下是实现期才需要定的，不阻塞开工。 -->

- **多栏并跑的性能上限**：4 栏同时持有 transcript 与 composer 的开销未实测，阶段 2 量过后再决定默认栏数上限。
- **文档级粘贴路由仲裁**：多个 composer 并存时，粘贴可能发错栏，阶段 2 验证并决定是否需要聚焦态拦截。
- **`keepMounted` 下 retain 释放时机**：多栏共享会话时的引用计数与未读状态，阶段 2 专项验证。

## Out of scope## Out of scope

<!-- 已划到目的地之外的工作，永远不会毕业 -->

- Tauri 桌面外壳与原生窗口行为（菜单栏、窗口控制、多窗口转移、GlassBackdrop 之类桌面质感）。
- Rust/GPUI 的 monocode native 版交互（`docs/native/parity.md` 自认是实验预览）。
- monocode 移动端（`mobile/` 的 Expo 项目）。
- 发版、签名、分发渠道。

## 进度
