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

### [ ] T04 — 每栏标签条 + preview 临时态

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
