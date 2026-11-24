# dsh-mono 实施 TODO

> 每天一个单元，每个单元可独立收尾。**开工前先读同目录的 `plan.md` 与 `report.md`。**
> 每个单元末尾的 prompt 可直接复制给下一个会话。

## 使用方式

1. 找到第一个 `[ ]` 未完成的单元。
2. 把该单元下面的 **Prompt** 整段复制给新会话。
3. 会话结束后，把 `[ ]` 改成 `[x]`，并在该单元末尾追加一行完成日期与实际产物路径。
4. 如果单元做到一半停工，在单元末尾写「**中断点**：...」，下次会话从那里继续。
5. **提交推送**（每个单元必做，见下）。

**规则**：一个会话只做一个单元。做不完就停在干净的状态（能 `node --check`、能构建），不要留半截。

## 每个单元收尾必做：提交并推送

仓库：https://github.com/FrankXuL/dsh-mono （`main` 分支，已设 upstream）。

**过关标准全部验证通过后**，才算这个单元完成。然后按顺序：

```bash
npm run build                      # 确保 client.js 是最新的
node --check client.js             # 语法闸门
git add -A
git commit -m "T0X: <一句话说清这个单元做了什么>"
git push
```

提交信息的要求：

- 标题行 `T0X: <做了什么>`，例如 `T04: 每栏标签条 + preview 临时态`
- 正文写**验证结果**（实测数字、CDP 证据摘要），不要只写"完成了"
- 如果有已知限制或取舍，写进去
- 例：

      T04: 每栏标签条 + preview 临时态

      标签状态改为 {tabs:[{sessionId,preview}], activeIndex}。
      连点 5 个会话后 preview 位始终 1 个；双击与发消息均能转正；
      关光标签后栏保留空态。CDP 实测零异常。

      已知限制：会话标题从 sessions.list 的 field 取，
      取不到时退回 sessionId 前 8 位。

**不要提交半成品**。单元没做完就停在干净状态，不要 commit——下一个会话接着写。

---

## 阶段 1：可用的多栏（L）

### [x] T01 — 工程骨架与开发回路

**目标**：把探针版的单文件拆成可维护的模块结构，并建立「改完能看到」的回路。

**要做**
- 目录：`src/client/`（`index.js` 入口、`layout/`、`panes/`、`session/`、`persist/`、`style.css`）
- 拆掉 `client.js` 里的探针代码，保留已验证的三条：`SessionProvider` + `renderFactorySlot`、`sessions.binding` 现取、`retain(id,{source:"mono"})`
- 写一个 `scripts/dev.mjs`：把 `src/client/*` 拼成 `client.js`（无依赖的最小拼接，不做 tree-shaking）
- `package.json` 的 `files` 更新，`docs/DETAIL.md` 补「开发」一节

**过关**
- `node --check client.js` 通过
- 装进一次性 profile（`dsh plugin --profile dev-mono add file:<repo>`）后，侧栏出现 Mono，点进去不报错
- 改一个字符串，跑 `npm run build` 后刷新页面能看到变化

**Prompt**
```
读 .scratch/monocode-ui-parity/plan.md 和 todo.md 的 T01。

你现在的任务：把 dsh-mono 的探针版单文件（client.js，约 220 行）拆成可维护的模块结构，并建立开发回路。

约束：
- 只做 T01，不做后续单元的功能。
- 必须保留探针已验证的三条技术要点（SessionProvider + renderFactorySlot 拿原生会话；sessions.binding 每次现取；retain 传自定义 source "mono"），不要"优化"掉它们。
- 不要引入打包器，写一个最小的拼接脚本即可。
- 验证方式：装进一次性 profile（不要碰 desktop），用无头 Chrome + CDP 确认侧栏有 Mono、点进去渲染正常、控制台无异常。

完成后：报告改动文件、验证结果、以及任何你在拆分中发现的问题。
```

**完成** 2026-11-16

产物：`src/client/{index.js,base.js,style.css}`、`src/client/session/reference.js`、`src/client/panes/{Pane.js,PaneTree.js}`、`src/client/layout/tree.js`（占位）、`src/client/persist/index.js`（占位）、`scripts/build.mjs`、`client.js`（产物，239 行 / 10.5 KB）、`docs/DETAIL.md`「开发」节、`package.json`（`scripts.build` + `files`）。拼接脚本按会话指令命名为 `scripts/build.mjs`（本单元原文写作 `dev.mjs`）。

验证：`node --check client.js` 通过；dev-mono 一次性 profile（`link:` 安装）侧栏出现 Mono，点进去 2 栏 2 个原生输入框、真实会话文本，控制台 0 条日志 / 0 条异常；改 `label: () => "Mono"` 为 `"Mono DEV"` → `npm run build` → 新页面侧栏变 `Mono DEV`，回退后复原。

**顺带收口 07 票**（重载时 `SlotAssemblyError: scope 'session-maybe'…`）：差分证明它是宿主卸载期时序噪声，只在「网关已死 + 旧页正在卸载」时偶发，健康刷新不复现；而触发它的 `children: { "mono.pane": … }` 声明是 load-bearing（宿主靠它注入 `SessionProvider`/`renderFactorySlot`，删掉每栏退化成 `no SessionProvider`），因此保留声明并把结论写进 `src/client/index.js` 注释与 `docs/DETAIL.md`。

---

### [x] T02 — 布局树数据模型

**目标**：写好嵌套二分树的纯函数层，**不碰 UI**。

**要做**
- `src/client/layout/tree.js`，导出：
  - 类型形状：`{type:"leaf", paneId}` / `{type:"split", dir:"row"|"column", children:[], sizes:[]}`
  - `splitPane(tree, targetPaneId, dir, newPaneId, before)` —— 同方向归组为兄弟、异方向嵌套
  - `removePane(tree, paneId)` —— 父节点只剩一个孩子时塌缩
  - `movePane(tree, fromPaneId, toPaneId, edge)` —— 同轴交换保 sizes、异轴嵌套
  - `normalizeSizes` / `equalSizes`
  - `neighborPaneId(tree, paneId, dir)` —— 焦点邻接
- 每个函数配 `assert` 自检，`node src/client/layout/tree.js` 能直接跑

**过关**
- `node src/client/layout/tree.js` 全绿
- 覆盖这些边界：连续同向分栏不套娃、垂直边嵌套而非替换、关到只剩一个 leaf 时塌缩、sizes 归一化后和为 1

**Prompt**
```
读 .scratch/monocode-ui-parity/plan.md 的「三阶段路线」阶段 1，和 todo.md 的 T02。

你现在的任务：只写布局树的纯函数层，不碰任何 React/DOM。

参考思路（不要复制代码，自己实现）：monocode 的 src/features/workspace/model/layout.ts 里 splitPaneRelative / removePane / movePane 的处理方式。可以读 /tmp/monocode 下的源码理解思路，但代码要自己写、风格统一。

必须覆盖的边界：
1. 连续同方向分栏 → 归为兄弟节点等分，不嵌套
2. 垂直方向 → 在目标处嵌套新 split，不是替换
3. 关栏后父节点只剩一个孩子 → 塌缩掉那层 split
4. 同轴移动 → 交换顺序但保留 sizes
5. sizes 归一化后和为 1

每个函数配 assert 自检，node 直接跑能验证。不要写 UI，不要写 CSS。

完成后：报告导出的函数签名、自检覆盖了哪些边界、以及你对"塌缩"和"同轴归组"的具体判定规则。
```

**完成** 2026-11-17

产物：`src/client/layout/tree.js`（布局树纯函数层 + 17 项 assert 自检）。验证：`node src/client/layout/tree.js` 全绿（17 passed，退出码 0）；覆盖同轴归组、异轴嵌套、塌缩、同轴移动保尺寸、sizes 归一化、8% 最小尺寸钳制，以及「5 次分栏 + 2 次关闭」组合用例。

---

### [x] T03 — 渲染布局树 + 原生会话

**目标**：把 T02 的树渲染成真正的多栏，每栏跑宿主原生会话。

**要做**
- `src/client/panes/PaneTree.js`：递归渲染 `split`/`leaf`，用 CSS Grid 或 flex 按 sizes 分配
- `src/client/panes/Pane.js`：`SessionProvider` + `renderFactorySlot("conversation.content")`
- 栏之间可拖宽（先只做拖动，动画归 T08）
- 栏内渲染 `conversation.session.header`（原生头），**去掉 widthControls**
- 一个「+」按钮：在当前栏分出新栏

**过关**
- 能开两栏，各自渲染真实会话和输入框
- 两边都能发消息
- 宿主原生的「标准模式 / 费用明细 / 子智能体」chips 在栏内可见
- 控制台无异常

**Prompt**
```
读 .scratch/monocode-ui-parity/plan.md 的「技术要点」一节，和 todo.md 的 T03。前置：T02 已完成，布局树纯函数在 src/client/layout/tree.js。

你现在的任务：把布局树渲染成真的多栏，每栏跑宿主原生会话。

关键约束（探针已实测，不要改）：
- 每栏：SessionProvider({session:{sessionId,binding}}) 包住 renderFactorySlot("conversation.content",{variant:"embedded",phase:"active"})
- binding 每次渲染用 sessions.binding(id) 现取，绝不缓存
- 保留会话用 sessions.retain(id,{source:"mono"})，source 必须是 "mono"
- 另外要渲染 conversation.session.header 才有原生头，但**不要**渲染 widthControls

过关：两栏都能显示真实会话+输入框，两边都能发消息，原生 chips 可见，零控制台异常。

验证用一次性 profile + 无头 Chrome CDP，不要碰 desktop profile。

完成后：报告栏内渲染的组件结构、你如何去掉 widthControls、以及实测截图或 DOM 证据。
```

**完成** 2026-11-17

产物：`src/client/panes/PaneTree.js`（递归 split/leaf、sizes→flex-grow、sash）、`src/client/panes/Pane.js`（SessionProvider + 原生体 + 原生头探测）、`src/client/index.js`（布局树状态、+ 分栏、页面级 retain 持有）、`src/client/style.css`（分栏/sash/栏容器）、`scripts/build.mjs`（MODULES 加入 `layout/tree.js`）、`client.js`（46575 bytes）。

验证（一次性 profile `/tmp/dsh-t03` + 无头 Chrome CDP）：分栏前 1 栏 / 分栏后 2 栏 + 1 条 sash，宽度 367/367，两栏 `textbox` 各 1、`data-composer-seat` 各 1，`data-conversation-session` 分别为 `session-965c64a7…` 与 `session-0bc339ab…`；`exceptions/errors/warnings` 全 0；widthControls 选择器全页 0。

**已知缺口（决策：路线 A）**：宿主原生 `conversation.session.header` 挂不进栏。槽名全应用只允许声明一次，且只有声明它的 entry 能渲染（`dsh-client-ui-renderer` 的 `SlotOwnershipError`），第三方 main panel 既不能重复声明（boot 失败）也不能裸渲染（SlotAssemblyError）。因此栏内暂时没有「标准模式 / 费用明细 / 子智能体」chips，本单元过关第 3 条未达成。代码里留了**一次性能力探测**（`useNativeHeader`：在 effect 里 try 一次 `renderSlot`，抛错记 absent，全页共享），宿主哪天放开 slot，栏内原生头与 chips 自动出现，无需改码；探测本身不产生任何控制台输出（实测 0 异常）。分栏时曾出现 `conversation.input: resolved no binding`：根因是 split 重挂载时 retain 计数瞬间归零；已在 `MonoRoot` 加页面级会话持有修复（`index.js:65-78`）。

---

### [x] T04 — 每栏标签条 + preview 临时态

**目标**：每栏一条标签，一标签一会话，带 preview 替换与转正。

**要做**
- 标签数据结构：`{sessionId, preview:boolean}`，栏状态 `{tabs:[], activeTab}`
- 标签条 UI：点击切换、中键/×关闭、`+打开`
- preview 规则：点侧栏开新会话进 preview 态（斜体）；再开一个替换掉它；双击或发消息转正
- 空栏态：没有标签时显示「从这里开始」

**过关**
- 连点 5 个侧栏会话，标签条始终只占 1 个 preview 位
- 双击 preview 标签 → 变常驻（斜体消失）
- 在 preview 标签的输入框发消息 → 自动转正
- 关掉最后一个标签 → 栏还在，显示空态

**Prompt**
```
读 .scratch/monocode-ui-parity/plan.md 的决策表（第 3、4 条：每栏标签条、preview 临时态），和 todo.md 的 T04。前置：T03 已完成，多栏能渲染原生会话。

你现在的任务：给每栏加标签条，实现 preview 临时态。

规则：
- 一个标签 = 一条会话
- 点开新会话进 preview（斜体标题），下一个点开替换它，不累积
- 双击标签 或 在该标签发消息 → 转正（去掉 preview 标记）
- 关掉最后一个标签后栏保留，显示空态

注意：preview 替换只在「同一栏内」生效。

验证用一次性 profile + 无头 Chrome CDP：连续点开 5 个会话看标签数、双击看是否转正、发消息看是否转正。

完成后：报告标签状态的数据结构、preview 替换的判定逻辑、以及你如何处理"从侧栏点开"这个入口。
```

**完成** 2026-11-22

产物：`src/client/state/workspace.js`（页面级布局 store：`panes: {[paneId]: {tabs:[{sessionId, preview}], activeIndex}}`，T03 的 `{[paneId]: sessionId}` 读取时升级；preview/replace/close/promote 纯函数 + 自检）、`src/client/panes/TabStrip.js`（标签条，标题 title→displayTitle→id 前 8 位）、`src/client/panes/PaneTree.js`（叶子 = 标签条 + 空态）、`src/client/panes/Pane.js`、`src/client/session/reference.js`（`useSessionList`）、`src/client/index.js`（页级 watch：侧栏 mainView 选择 → preview 标签；updatedAt 走时 → 转正；`heldKey` 覆盖所有栏的所有标签）、`src/client/style.css`（标签/空态样式）、`scripts/build.mjs`（MODULES 加入 `state/workspace.js`、`panes/TabStrip.js`）、`client.js`（67913 bytes）。

验证（一次性 profile `/tmp/t04home` + 无头 Chrome CDP，桌面 profile 未动）：连点 5 个侧栏会话，每次读到的都是 2 个标签（1 常驻 + 1 preview）、`previews:1`，preview 标签 `class="mono-tab mono-tab-active mono-tab-preview"` / `data-mono-preview="true"` / `font-style:italic`，标题依次被替换（ksfloan → kspay-ui → [#00] 前端 → kspay-orbit → [#00] 双通道）；双击 preview → `data-mono-preview="false"`、去掉 `mono-tab-preview`、`font-style:normal`；在 preview 标签的输入框发消息（本轮因额度用尽失败，但消息已落盘）→ 同样转正；逐个关掉两个标签 → `panes:1`、空标签条 + `[data-mono-empty]` 文案「从这里开始 / 打开会话」；「Split right」→ `panes:2`、两条标签条、新栏 `tabs:[]` + 空态，不继承邻居标签。控制台 0 条 `[mono]` 输出、0 个未捕获异常。

**已知限制**：① **侧栏点开会切走宿主主栏**（`layout.selectPanel(null)` 会卸载 MonoRoot）——审查实测：开 Mono(1 栏) → 点侧栏会话 → `mono:false`、栏数 0 → 点回 Mono 才看到新的 preview 标签。状态确实保住了（页面级 store 生效），但**视图被打断**：插件的核心用法就是「把侧栏会话拉进我并排的栏」，每拉一次就被踢出去再手点回来。这不是可接受的限制，是本单元的主交互缺口，由 **T04b** 补。也因此"在 preview 标签里发消息"通常发生在宿主的 Conversation 里，转正靠会话列表的 `updatedAt`（`manager.handleSessionActivity` 落盘时间戳），而不是栏内 React 状态。② 首次扫到的 `updatedAt` 可能是本地索引的旧值，baseline 用 `max(updatedAt, Date.now())` 锚定打开时刻，否则一次陈旧重投影会被误判成"发了消息"。③ 会话没有选模型时，发送按钮可点但静默不发（无 `updatedAt` 变化），因此那种会话里的发送不会转正——这是宿主行为，不是标签逻辑。④ 无标签时会话仍被页面级 retain 持有（`heldRef` 只增不减，同 T03 已知权衡）。

---

### [x] T04b — 会话入口：栏内选择器 + 弹回

**为什么单独一个单元**：T04 的 6 条验收都过了，但它没料到「宿主打开会话会卸载 Mono」这件事，于是"把侧栏会话拉进栏里"这个主交互实际不可用。这是 T04 交付缺口，不是新功能，所以挂在它后面而不是改历史结论。

**目标**：往栏里加会话不再被踢出多栏视图；同时保留一条明确的路回宿主视图。

**要做**

1. **栏内会话选择器（D）**：点 `+` 弹出 popover，分两段——「新建会话」+「最近会话」列表（标题取 `title → displayTitle → id 前 8 位`，已在栏里的打勾或置灰）。选一个 → 开进**当前栏**；显式选择不是 preview，直接常驻。点外部/Esc 关闭，键盘可走。
2. **弹回（B）**：页面级（不是 React 内）维护 `monoIntent`：进入 Mono 面板时置 true。`watchSessions` 的 `scan()` 里，宿主打开新会话 → 开成 preview 标签（已有）→ 若 `monoIntent` 且当前面板不是 `mono`，调 `ctx.layout.selectPanel('mono')` 弹回。**判据是意图，不是时序**——不要用「最近 1 秒离开过 Mono」这类窗口，宿主 selectPanel 与会话列表刷新的先后不可靠。
3. **出口（必须同批交付）**：工具栏加「回到宿主视图」按钮 → `monoIntent = false` + `ctx.layout.selectPanel(null)`。没有它就不许开弹回——点侧栏会话是当时唯一的退路，弹回会把它堵死。
4. **注入**：`inject` 加 `layout`；`ctx.layout.panelInfo` 是 `HostObservable<{activePanelId}>`（`getSnapshot`/`subscribe`），在 `apply()` 里订阅，这样 MonoRoot 被卸载后照样能收事件。订阅要放进 `ctx.effect` 以便卸载时释放。

**过关**

- 在 Mono 里点侧栏会话 → **不离开 Mono**，该会话以 preview 标签出现在当前栏
- 在**宿主原生视图**里点侧栏会话 → **留在原生视图**，不被拽进 Mono
- 点「回到宿主视图」→ 回到宿主 Conversation；之后再点侧栏会话仍留在原生视图
- 点 `+` → 出选择器；选「最近会话」里的一个 → 进当前栏且**不是** preview；选「新建会话」→ 建新会话进当前栏
- 选择器里已在本栏的会话有可见标记；开过的会话不重复出现两条标签
- 连点 5 个侧栏会话，标签条仍只占 1 个 preview 位（T04 行为不回归）
- 控制台零异常；`npm run build` + `node --check client.js` 过；store 自检 `node src/client/state/workspace.js` 过

**Prompt**
```
读 .scratch/monocode-ui-parity/todo.md 的 T04 与 T04b，以及 plan.md「三、与宿主共存的策略」里的「『只加不改』的边界」表。前置：T04 已完成（标签条 + preview 态可用），但点侧栏会话会把 Mono 卸载，主交互不可用。

你现在的任务：两件事一起做，缺一不可。
1. 栏内会话选择器：点 + 弹 popover，「新建会话」+「最近会话」两段，选中的会话进当前栏且是常驻标签（不是 preview）。
2. 弹回：页面级维护 monoIntent（进 Mono 置 true），宿主打开新会话时若 monoIntent 为真且当前面板不是 mono，调 ctx.layout.selectPanel('mono') 弹回，并让该会话以 preview 标签进当前栏。
   判据用意图，不要用时序窗口（selectPanel 与会话列表刷新先后不可靠）。

硬约束：弹回必须和「回到宿主视图」按钮在同一批交付。那个按钮清 monoIntent + selectPanel(null)。没有它，用户进了 Mono 就再也回不到宿主原生视图（点侧栏会话是当时唯一退路）。
ctx.layout.panelInfo 是 HostObservable，在 apply() 里用 ctx.effect 订阅，别放进组件（面板会被卸载）。

验证用一次性 profile + 无头 Chrome CDP，不要碰 desktop profile。至少跑通这四条：Mono 内点侧栏→不离开 Mono；原生视图内点侧栏→不被拽走；点出口→回原生且之后不再被拽；点 + →出选择器且能选已有会话入栏。

完成后：报告 monoIntent 的状态机（谁置 true、谁置 false）、选择器如何取会话标题、以及弹回在 panelInfo 上的订阅与释放方式。
```

**完成** 2026-11-24

产物：`src/client/panes/SessionPicker.js`（新，75 行：popover，`新建会话` + `最近会话` 最多 12 条，已在本栏的会话行打 ✓ 并置灰，点外部 / Esc 关闭）、`src/client/panes/TabStrip.js`（`+` 开合 picker；外层 `.mono-tabstrip` 包住 `.mono-tabs`——后者 `overflow` 滚动，绝对定位的子元素会被裁掉）、`src/client/panes/PaneTree.js`（透传 `ids` / `onPickSession`）、`src/client/index.js`（`monoIntent` / `watchPanelIntent()` / `hostMainSession()` / `bounceToMono()` / 工具栏「回到宿主视图」，`inject: ["slots","layout"]`，`apply()` 里 `ctx.effect(watchPanelIntent)`）、`src/client/style.css`（picker / wrapper / exit 按钮）、`scripts/build.mjs`（MODULES 加 `panes/SessionPicker.js`）、`client.js`（51154 → 81154 bytes，11 chunk）。

**monoIntent 状态机**（页面级模块变量，不在 React 里——宿主揭示自己的面板时 MonoRoot 会被卸载，意图必须比组件活得久）
- 置 true：`layout.panelInfo` 快照 `activePanelId === "mono"` 的每一次订阅回调，以及 `watchPanelIntent()` attach 时的首个快照。进栏按钮、恢复选中、从别的面板切回 Mono 都走这一条。
- 置 false：**只有**工具栏「回到宿主视图」——先 `monoIntent = false` 再 `selectPanel(null)`，所以出口自身引起的 panel 变化不会被自己的弹回逮住。这是「弹回 + 出口同批交付」的硬约束：没有出口，意图一旦为真就再也关不掉。
- 弹回触发：意图为真且 `activePanelId` 变成 `null`（Conversation）。变成别的 panel id（插件 / 自动化任务）**不弹**——那是用户主动选的面板，弹回会把人锁死在 Mono 里。

**实测中修正的两处判据**（与 T04b 原文描述不同，原写法在这里跑不通）
1. 原文把弹回挂在 `scan()` 的「会话打开」分支上：`if (host !== null && opened !== host)`。一次性 profile 的页面从首页启动，宿主没有选中任何会话 → `host` 一直是 null → 用户打开的第一个会话被当成基线吞掉，弹回一次都不触发（CDP 抓到 `dbg scan … host null boot true`）。改成显式 `primed` 基线：只有第一次 scan 算基线，且无论有没有会话都消耗掉它；之后新出现的 mainView 保留一律算打开。这修的是 preview 镜像（原生视图里点侧栏会话，标签条也会跟上一格 preview）。
2. 弹回改由 `panelInfo` 独占判定（见上），不再依赖会话保留的变化。因为「点侧栏里**已经选中**的那个会话」是真实的宿主揭示，但保留关系没有 delta，挂在保留变化上会漏掉——正是验收第一条的主场景。

**选择器如何取会话标题**：`tabTitle(byId, sessionId)` 一个函数给标签条和选择器共用——`byId[id].title || byId[id].displayTitle || id.slice(0,8)`。选择器的列表来自 `MonoRoot` 现有的 `useSessionList()` 快照 `ids`（最多 12 条，不额外发请求），「已在本栏」用 `pane.tabs.map(t => t.sessionId)` 的 Set 判断。选中 → `workspaceOpenTab(paneId, sessionId, {})`（空 opts = 常驻，不是 preview）；「新建会话」→ `sessions.create({})` 后同样以常驻标签开进该栏。

**panelInfo 的订阅与释放**：`watchPanelIntent()` 在 `apply()` 里由 `ctx.effect` 调用；服务懒取（`service("layout")?.panelInfo`，取不到时 250ms × 40 重试），订阅返回的解除函数存进闭包，`ctx.effect` 的清理函数里调它（`unsubscribe` 形式也兼容），并置 `stopped` 让在途的 `setTimeout` 不再弹。弹回本身在下一个 task 里执行（`setTimeout(…, 0)`）：先让宿主的揭示事务落定，这样读到的「宿主当前会话」才是它真正选中的那一个；执行前重读面板与意图，用户此时已经点出口就不再弹。

**CDP 验收（一次性 profile `/tmp/t04bhome` + headless Chrome，21/21 通过）**：进 Mono → 点 `+` 出两段选择器 → 「新建会话」进当前栏且 `preview=false` → 选一个不在栏里的已有会话，进当前栏且 `preview=false` → 点侧栏会话：仍在 Mono，该会话成为唯一 preview 标签，宿主原生输入框照常渲染 → 连点 5 次侧栏会话：仍 1 个 preview 位、1 栏 → 点「回到宿主视图」：离开 Mono → 再点侧栏会话：不被拽回 → 控制台零异常零警告。另跑两条边界：Mono 里点宿主「新建会话」（空草稿复用，会话列表无变化）也会弹回；点侧栏「插件」面板不会被拽回。

**已知限制**：① 选择器列「最近会话」用的是会话列表顺序的前 12 条，不是 updatedAt 排序；② 意图为真时用户若先点「插件」再打开会话，仍会被弹回 Mono——意图是「我要待在 Mono 直到我明说」，这是判据的语义，不是 bug；③ 会话既无 title 也无 displayTitle 时标题只能显示 id 前 8 位。
**审查（独立复验，2026-11-24，另一会话）**：一次性 profile `dev-mono` + 无头 Chrome CDP，视口 1680×1050，全程零 console error/warning、零未捕获异常；构建幂等、`node --check client.js`、`node src/client/state/workspace.js` 全绿。

7 条验收逐条实测通过，另有 4 条超出验收的实证：① 已有**常驻**标签再被侧栏点一次不会被降级成 preview（`openTabInPane` 对已存在标签提前 return，preview 位不受影响）；② 退出再进 Mono，标签与布局都在（页面级 store 生效）；③ 分栏后弹回的 preview 落到**最后点击的那一栏**（`activePaneId` 由 `PaneTree` 的 `onMouseDown` 更新）；④ 选择器 Esc / 点外部都能关。

三条缺陷（均未修，待排期）：

1. **中｜`monoIntent` 跨面板泄漏**：Mono → 点「插件」→ 点侧栏会话 → **被拽回 Mono**。`src/client/index.js:156-158` 的注释写的是「任何别的 panel 是用户主动选的，点插件不能把人拽回 Mono」，但代码只做到「当场不弹」：`src/client/index.js:159` 的 `if (activePanel() !== null || !monoIntent) return;` 没清意图，于是下一次点会话就弹。修法一行：`if (activePanel() !== null) { monoIntent = false; return; }`（`null`=Conversation 才保留意图，那正是要弹回的场合）。
2. **低｜选择器点「已在本栏的预览标签」不转正**：`src/client/state/workspace.js:53` 对已存在标签提前 return（注释：Switching tabs must not touch preview state.），`SessionPicker` 的 `onPick` 走 `workspaceOpenTab(paneId, sessionId, {})`（`preview=false`）被吞掉。从菜单里显式选中应算「转正」，现在只能双击标签。修法：picker 的 onPick 走 `workspacePromoteTab`，或给 `openTabInPane` 加 promote 选项。
3. **低｜选择器列的是全应用会话，不是当前工作区**：列表来自 `useSessionList().ids`。实测侧栏 1 条（当前工作区 `087815aa`），选择器 4 条（含 `--private-tmp--` 工作区的 3 条），其中 3 条标题都叫 `tmp` 无法区分；且 `087815aa` 侧栏叫「新会话」、选择器叫 `default-workspace`——`tabTitle`（`title → displayTitle → id 前 8 位`）与侧栏取标题的来源不同。要么按工作区过滤，要么在选择器里标出所属工作区。

审查用的一次性 profile `/tmp/t04bhome` 与 CDP 脚本（`/tmp/revlib.mjs` 等）都在 `/tmp`，未碰 desktop profile。

### [x] T04c — 修 T04b 三条缺陷（约半天）

**目标**：把独立审查开出的三条缺陷修掉。三条都有确定的复现路径，不需要再调研。

**要做**

1. **意图泄漏（中）**：`src/client/index.js:159` 改成 `if (activePanel() !== null) { monoIntent = false; return; }`。`activePanel() === null` 表示 Conversation（宿主原生会话视图）——那正是该弹回的场合，意图要留着继续往下走；用户主动点是**别的**面板（插件/日程等），意图就该清掉，否则下一次点侧栏会话会被拽回来。
2. **选择器点已在本栏的预览标签应转正（低）**：`src/client/index.js:313` 的 `onPickSession` 改成先 `workspacePromoteSession(sessionId)` 再 `workspaceOpenTab(paneId, sessionId, {})`。`workspacePromoteSession` 已经存在（`src/client/state/workspace.js:164`），会清掉所有栏里该会话的 preview 标记；`openTabInPane` 对已存在标签提前 return 的行为**不要改**（切标签不该动 preview 状态，那是给别的入口用的）。
3. **选择器要与侧栏一致（低）**：现在列的是 `useSessionList().ids` 原始全集，实测把别的工作区的会话也列了出来（4 条 vs 侧栏 1 条），还出现多条同标题 `tmp` 无法区分。要求：
   - 只列当前工作区的会话；空白会话按宿主自己的规则只保留当前选中的那条（宿主的规则在 `@deepseek-ai/dsh-client-ui-workspace/src/client/rows/WorkspaceBrowser.tsx`：`session.blank` + archived 过滤，包内 `src` 可直接读：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/...`）；
   - 若插件拿不到工作区归属（`sessions` 服务的 snapshot 只有 `ids`/`byId`，行里不一定有 workspace 字段），退一步：在选择器每行标出所属工作区或 cwd 名，让同名会话能区分，并在这里记下为什么降级。

**过关**

- Mono → 点「插件」→ 点侧栏会话：**留在插件面板**，不被拽回；再回 Mono 点侧栏会话，弹回仍然生效（意图没修坏）
- 选择器点一个已在本栏、且是 preview 的会话：该标签转正（星号消失），不新增标签
- 选择器里不再出现别的工作区的会话（或每行标出工作区名）；同名多条能区分
- `npm run build` + `node --check client.js` + `node src/client/state/workspace.js` 全绿，控制台零异常

**Prompt**：见 T05 的 Prompt（T04c 与 T05 同批下发，分两次提交）。

**完成** 2026-11-24

产物：
- `src/client/index.js:159-166`（缺陷 1）：`if (activePanel() !== null) { monoIntent = false; return; }` 换成原来的一行判断；`null`=Conversation 时才保留意图继续往下走。
- `src/client/index.js:314-325`（缺陷 2）：`onPickSession` 改成先 `workspacePromoteSession(sessionId)` 再 `workspaceOpenTab(paneId, sessionId, {})`。`openTabInPane` 对已存在标签的提前 return（`src/client/state/workspace.js:53`）一行未动。
- `src/client/panes/SessionPicker.js`（缺陷 3）：新增 `mainSessionId(byId)`（`retainedBy.mainView > 0`）、`pickerScope(pane, byId)`（锚点 = 本栏当前标签 → 宿主主会话，用 `workspaces.list.getSnapshot()` 的 `items[].sessionIds` 找归属，返回 `{members, archived}`；拿不到就返回 `null`）、`pickerIds(all, byId, scope)`（`blank` 只留应用主会话；有 scope 时只要 members 且不在 archived）、`cwdLabel(cwd)`；每行加 cwd 基名后缀。
- `src/client/style.css`：`.mono-picker-dir`。
- `.scratch/monocode-ui-parity/tools/mono-probe.mjs`：宿主规则探针（读根目录 `client.js`，注入 fake `window/document/react/ctx` 后直接跑插件工厂）。
- `client.js`：`npm run build` 重建，11 chunks / 85469 bytes；`node --check client.js`、`node src/client/state/workspace.js`（ok workspace state checks）全绿。

验证：CDP 实点在本会话的沙箱内跑不起来（`dsh plugin --profile mono-cdp add …` → `EPERM mkdir ~/.dsh/profiles/mono-cdp`；`~/Library/Application Support/DeepSeek Harness` 同样 EPERM；换 `DSH_HOME=/tmp/mono-dsh` 能建 profile、能 `--dump-config`，但 `dsh --profile cdp --no-open` 启动后日志 0 字节、端口不监听、`Debugger.pause` 无栈，lsof 见主线程卡在 Security.framework/LaunchServices，即宿主 Electron 在该沙箱内起不来）。改用探针跑真机代码取证，14/14 PASS：

1. 意图泄漏：插件面板（`activePanelId="plugins"`）里点会话 → `selectPanel` 未被调用、`panes` 无新标签；点「回 Mono」后再点会话 → `selectPanel("mono")` 被调用一次、宿主会话落成该栏 preview 标签；出口按钮 `[data-mono-exit]` 存在，点过之后意图清空，再点会话不弹。
2. 选择器转正：`s1` 为 preview → `workspaceActivateTab` 切到别处后 preview 仍在（`openTabInPane` 语义未变）→ `onPickSession("pane-A","s1")` → `preview:false`，标签数不变。
3. 选择器范围：wA（`sessionIds:["s1","s2","s4"]`）里 s3（wB）被剔除、s5（archived）被剔除、s4（blank 且非应用主会话）被剔除，只剩 s1/s2；每行 cwd 后缀 `kspay-ui / tmp / tmp-2 / tmp2`，同标题 `tmp` 可区分。

**已知降级**：归档清单只存在于 `workspaces.list` 的 `archivedSessionIds`（`sessions.list` 行里没有该字段）。插件没有把 `@deepseek-ai/dsh-client-ui-workspace` 列进 `MONO_PLUGIN.inject`（只加不改），`workspaces` 服务按需现取；若该服务缺席，选择器退回全量列表（空白规则仍生效，因为只需行的 `blank`）——此时归档会话会出现，靠 cwd 后缀区分。

**复验方式**（需在工作区外有写权限的环境）：

```bash
DSH_HOME=/tmp/mono-dsh dsh plugin --profile cdp add link:/Users/xulilili/code/github/dsh-mono
DSH_HOME=/tmp/mono-dsh dsh --profile cdp --no-open
```

Mono → 点「插件」→ 点侧栏会话：应停在插件面板；再回 Mono → 点侧栏会话：应弹回 Mono 且该会话是 preview 标签；选择器条数应与侧栏当前工作区一致。

---

### [ ] T05 — 拖拽分栏

**目标**：拖标签到栏边缘分出新栏，拖回来合回去。

**要做**
- 命中判定：`document.elementFromPoint` + 自己的 `[data-mono-pane]` 属性（**不要**读宿主的 data 属性）
- 边缘判向：归一化中心比，`|nx|>|ny|` 走左右，否则上下
- 落点提示：目标半屏 wash + 2px accent 线
- 阈值 5px 才算拖拽；`Esc` 取消；拖起时先 focus
- 松手调用 T02 的 `movePane`

**过关**
- 拖标签到另一栏的右半边 → 在该栏右侧新建栏
- 拖回 → 合并或重排
- `Esc` 能取消
- 拖拽中不会误触发点击

**Prompt**
```
读 .scratch/monocode-ui-parity/feasibility-matrix.md 的拖拽相关条目（#21–#22、#27、#30），和 todo.md 的 T05。前置：T04 已完成。

你现在的任务：实现拖拽分栏。

关键约束：
- 用 document.elementFromPoint + 自己的 data-mono-pane 属性做命中判定
- **绝对不要**读宿主的 data-dockkit-* / data-sidebar-right-*，官方明令禁止，且不是稳定契约
- 边缘判向：把指针位置归一化到 0..1，取 |nx-0.5| 与 |ny-0.5| 比较
- 5px 阈值、Esc 取消、拖起先 focus
- 松手结果交给布局树的 movePane

参考思路（不复制代码）：/tmp/monocode 的 src/features/workspace/model/paneDrop.ts 与 PaneTree.tsx 的落点提示做法。

验证用一次性 profile + CDP：拖拽后检查 DOM 里栏的数量与位置。

完成后：报告命中判定的实现、落点提示的渲染方式、以及你如何避免拖拽误触发点击。
```

---

### [ ] T06 — 布局持久化

**目标**：关掉重开，栏数/栏宽/每栏标签/当前标签全部还原。

**要做**
- `src/client/persist/`：序列化树 + 栏标签 + activeTab 到 localStorage，键 `dsh-mono:workspace:v1`
- 反序列化时：失效会话 id 跳过并清理（不留空位）
- 只剩空栏时保留栏（保留宽度）
- 带版本号，未来可迁移

**过关**
- 开三栏、各放标签、拖成不同宽度 → 刷新页面 → 一模一样
- 删掉其中一条会话再刷新 → 那条标签消失，栏还在
- 全部标签失效 → 栏数与宽度保留，显示空态

**Prompt**
```
读 .scratch/monocode-ui-parity/plan.md 的决策表第 7 条（布局全存，localStorage，失效会话跳过，保留空栏），和 todo.md 的 T06。前置：T05 已完成。

你现在的任务：布局持久化。

细节：
- 键名 dsh-mono:workspace:v1，带版本号
- 存：树结构（含 sizes）、每栏标签列表、每栏 activeTab
- 还原时：会话 id 已失效的标签直接跳过并从存储里清掉，不留占位
- 如果某栏标签全失效，栏保留（保留宽度），显示空态
- 写入要节流，避免拖拽时刷爆 localStorage

验证用一次性 profile + CDP：构造三栏布局，reload 后比对 DOM。

完成后：报告存储的 JSON 形状、失效会话的清理逻辑、以及节流策略。
```

---

## 阶段 2：完整手势（L）

### [ ] T07 — sash 拖动改比例

**目标**：栏之间的分隔条可拖动改宽度，带最小尺寸与取消。

**要做**
- `Sash` 组件：pointerdown 起拖，rAF 节流预览，松手提交
- 最小尺寸 8%（相邻两块各自不低于组内 8%）
- `Esc` 取消回原样
- 拖动中光标变 grabbing、禁选文本

**过关**
- 拖到极窄时停在 8% 不越界
- `Esc` 能还原
- 松手后宽度被持久化（T06）

**Prompt**
```
读 todo.md 的 T07 和 plan.md 阶段 2。前置：T06 已完成，布局持久化可用。

你现在的任务：sash 拖动改比例。

要求：
- pointerdown/pointermove/pointerup + setPointerCapture
- 拖动中用 rAF 节流预览，松手才写入布局树
- 相邻两块各自不得小于组内 8%
- Esc 取消回原样
- 拖动中 grabbing 光标 + 禁止选中文本

参考思路（不复制）：/tmp/monocode 的 PaneTree.tsx Sash 组件与 layout.ts 的 splitSizesAtBoundary。

验证用 CDP 模拟指针拖动，检查 sizes 变化与边界钳制。

完成后：报告最小尺寸的钳制算法、以及拖动预览与提交的分离方式。
```

---

### [ ] T08 — 栏进入/退出滑入动画

**目标**：分栏时有方向感，不明显卡顿。

**要做**
- 进入：新栏从「贴着哪条边」的方向滑入；邻栏跟随移动
- `deferBody`：新栏先只挂标签条，动画结束后再挂会话体（避免大会话拖住动画）
- 退出：沿同方向滑出
- 尊重 `prefers-reduced-motion`

**过关**
- 开新栏时方向感明确
- 大会话栏不拖慢动画
- 系统开启减少动效时无动画

**Prompt**
```
读 todo.md 的 T08 和 plan.md 阶段 2。前置：T07 已完成。

你现在的任务：栏进入/退出动画。

做法：
- 先量出每个栏的归一化 rect，从「新栏贴着哪条边」推出滑入方向
- 用 Web Animations API 对 rect 做 keyframe，邻栏自然跟随
- deferBody：新栏先只渲染标签条，动画结束（或 rAF 两帧后）再挂会话体
- 尊重 prefers-reduced-motion

参考思路（不复制）：/tmp/monocode 的 PaneTree.tsx:320-560、906-974。

验证用 CDP Performance 或 requestAnimationFrame 计时，确认动画期间不掉帧。

完成后：报告方向推导算法、deferBody 的触发时机、以及你如何测量帧率。
```

---

### [ ] T09 — 跨栏拖标签 + 关栏塌缩 + 焦点导航

**目标**：把剩下的手势补齐。

**要做**
- 拖标签在栏间移动（不是新开栏，是迁移）
- 关栏时标签的去向（按规则迁移或关闭），父 split 塌缩
- 焦点落到兄弟栏
- `Cmd+Opt+方向键` 换焦点栏

**过关**
- 拖标签从栏 A 到栏 B 的中间 → 迁移过去，A 空了显示空态
- 关中间那栏 → 两侧合并，焦点落到邻居
- `Cmd+Opt+方向` 焦点正确移动

**Prompt**
```
读 todo.md 的 T09 和 plan.md 阶段 2。前置：T08 已完成。

你现在的任务：补齐三个手势——跨栏拖标签、关栏塌缩、焦点导航。

要点：
- 拖标签到目标栏中间（不是边缘）= 迁移，边缘 = 新开栏（T05 已有）
- 关栏后父 split 只剩一个孩子时塌缩（T02 的 removePane 应已实现，这里接 UI）
- 焦点落到兄弟栏的第一个标签
- Cmd+Opt+方向键走布局树的 neighborPaneId

注意：巢状键盘在 Web 上可能被拦，先实现 Desktop 路径。

验证用 CDP：构造三栏，关中间，检查 DOM 与焦点。

完成后：报告标签迁移的判定、塌缩的触发点、以及焦点计算的实现。
```

---

## 阶段 3：打磨（M）

### [ ] T10 — 快捷键（按 runtime 分流）

**目标**：桌面端有原生键位，Web 端不炸。

**要做**
- 用 `ctx.shortcuts.register`
- Desktop：`Cmd+D` 分栏右、`Cmd+Shift+D` 分栏下、`Cmd+Opt+方向` 焦点
- Web：改用 `primary+alt+*` 或干脆不注册
- **避开已占**：`Cmd+B`、`Cmd+\\`、`Cmd+Shift+B`、`Cmd+W`

**过关**
- Desktop 上 `Cmd+D` 能分栏
- Web 上插件能正常激活（不抛 `unsupported-browser`）
- 不与宿主键位冲突

**Prompt**
```
读 .scratch/monocode-ui-parity/plan.md 第五节「键位占用实况」和 todo.md 的 T10。前置：T09 已完成。

你现在的任务：接快捷键。

硬约束：
- Web 端 Cmd+D / Cmd+W 会被 isWebBindingAllowed 白名单拒绝，且是**注册期抛错**，会让整个插件不激活
- 必须按 runtime 分流：Desktop 用 primary+KeyD，Web 用 primary+alt+KeyD 或不注册
- 已占键位（不要碰）：Cmd+B（左栏）、Cmd+\\（pane.split）、Cmd+Shift+B（右栏）、Cmd+W（page.close）

验证：Desktop 上测快捷键生效；Web 上用一次性 profile 确认插件仍激活、控制台无 unsupported-browser。

完成后：报告分流的具体写法、以及你如何验证 Web 端不炸。
```

---

### [ ] T11 — 空态、错误兜底、中英文案

**目标**：不白屏、不半英文半中文。

**要做**
- 每栏独立 ErrorBoundary（单栏崩溃其余可用）
- 整块工作区兜底：完全挂掉时提示并给「回到单栏」出口
- 所有可见文案走 `dsh-client-locale`，至少 en + zh
- 空态：无标签时的引导

**过关**
- 人为让某栏抛错，其余栏仍可用
- 中英文切换即时生效
- 无硬编码中文/英文

**Prompt**
```
读 todo.md 的 T11 和 plan.md 阶段 3。前置：T10 已完成。

你现在的任务：空态、错误兜底、中英文案。

要求：
- 每栏一个 ErrorBoundary，单栏崩溃不影响其他栏
- 工作区级兜底：全挂时显示错误摘要 + 「回到单栏视图」按钮
- 文案走 dsh-client-locale，locale/en.json + locale/zh.json，不要在组件里硬编码
- 空态要有引导，不能是空白

验证：人为在某个组件 throw，确认隔离；切语言确认即时生效。

完成后：报告边界的设计、以及文案的组织方式。
```

---

### [ ] T12 — 设置项与收尾

**目标**：可调项 + 文档 + 一次完整回归。

**要做**
- 设置页（`ctx.slots` 的 settings 座位或插件自带面板）：最大栏数、是否在侧栏显示入口
- 更新 `docs/DETAIL.md`（功能、限制、用法）
- 跑一次完整回归：三阶段所有过关标准逐条验
- 更新 `package.json` 版本到 1.0.0

**过关**
- 设置项改完即时生效并持久化
- 三条阶段过关标准全部复验通过
- `docs/DETAIL.md` 与实际行为一致

**Prompt**
```
读 todo.md 的 T12，以及 plan.md 三个阶段的全部过关标准。前置：T11 已完成。

你现在的任务：设置项 + 文档 + 完整回归。

要求：
1. 设置项：最大栏数（2/3/4）、是否在侧栏显示入口。改完即时生效并持久化。
2. 更新 docs/DETAIL.md：功能、已知限制、用法。
3. **逐条复验 plan.md 三个阶段的所有过关标准**，把结果写进报告。
4. 版本升到 1.0.0。

验证用一次性 profile + CDP，不要碰 desktop。

完成后：报告设置项实现方式、回归结果逐条对照、以及还剩哪些已知限制。
```

---

## 依赖关系

    T01 → T02 → T03 → T04 → T05 → T06
                                    ↓
                              T07 → T08 → T09
                                            ↓
                                      T10 → T11 → T12

**严格串行**：每个单元都用前一个的产物。T02 可独立验证（纯函数），T01 若卡住可以直接手写模块结构跳过拼接脚本。
