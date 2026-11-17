# monocode → DSH 可行性速查（一页版）

> 完整 84 条判定见 `feasibility-matrix.md`；调查原文见 `research/`。

## 判定的分布

| 判定 | 条数 | 意思 |
|---|---|---|
| 已存在 | 26 | DSH 装包已有，不用搬 |
| 可做 | 26 | 缺，但插件能做 |
| 需降级 | 20 | 能做，形状必须改 |
| 不可做 | 12 | 卡在宿主契约层 |

**一句话**：DSH 已经覆盖约一半外围面；真正缺的是**空间层**——分栏树、拖拽、tab 管理。

## 三个硬约束（绕不过去）

1. **宿主会话主列切不了分栏。** `main.conversation` 是 single，`conversation.content` factory 输入里没有 sessionId。多会话同屏只能自建容器。
2. **跨 slot 拖拽没有官方契约。** `ctx.sidebarRight` 只有命令式操作，`fileDrag` 只认文件且"内部 token 只在 composer 被接受"，dockkit 不是安装包、官方禁止读别家 DOM。
3. **`Cmd+D`/`Cmd+W` 在 Web 上注册期内抛错。** 白名单外只能 `primary+alt+<key>`；Desktop 可用 `primary+KeyD`，但 `primary+KeyW` 已被 `page.close` 占。

## 该先做的四件（都不碰禁区）

| 顺序 | 交互 | 成本 | 为什么先做 |
|---|---|---|---|
| 1 | preview 斜体临时 tab + 双击转正 | S | 一个布尔 + 一次替换 + 双击；文件浏览体验的分水岭 |
| 2 | tab 访问历史 `cmd-[ / cmd-]` | S | 90 行纯函数，零 UI |
| 3 | 编辑器选区 → Add to chat（`@path (lines a-b)`） | M | DSH 已有 `@` 消费端，只缺产出入 |
| 4 | 权限常驻 pill（在已有 `conversation.input.permission` 上增强） | S | DSH 已有四档选择器，只缺常驻形态 |

## 明确不做

- Chrome 式 tab 组 —— monocode 自己都没接线（`groupId` 零写入点）
- 会话多选、会话文件夹、title tab 条改造 —— 宿主组件，无契约
- 依赖 `data-dockkit-*` —— 不是契约
- notes / inbox / monos / agent-app / providers / connections —— 无对等概念

## 两个决策点（要人拍）

1. **自建容器放哪**：`main` 新 key 全局面板（干净、离开会话视图）vs 右栏 tab（贴会话、上限 2 横向 pane）。
2. **可编辑文件面**：自建保存通道（`ctx.fs` + Host 路由，L~XL）vs 绑 `dsh-better-sidebar` 契约（立刻可用、有断裂风险）。
