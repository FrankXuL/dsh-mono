# dsh-mono 调研与方案总报告

> 本次交付：**分析 + 方案**（不含功能实现）。对应探索地图「把 monocode 的交互搬进 DSH」六张子票。

---

## 一、做了什么

| 票 | 内容 | 产物 |
|---|---|---|
| 01 | monocode 交互全清单 | `research/monocode-interactions.md`（362 行 / 205 行表格，基线 commit `09d04436`） |
| 02 | DSH 插件能力边界 | `research/dsh-capability-matrix.md`（490 行，21 行总表 + 12 条未验证） |
| 03 | 交互对交互判定表 | `feasibility-matrix.md`（**84 条**逐条判定） |
| 04 | 插件工程初始化 | 仓库根目录的 `dsh-mono` 工程 + 探针实测通过 |
| 05 | 长期方案 | `plan.md`（九项决策 + 三阶段路线） |
| 06 | 本报告 | `report.md` |

---

## 二、可行性结论

84 条交互四档分布：

| 判定 | 条数 | 含义 |
|---|---|---|
| 已存在 | 26 | DSH 装包已有，不用搬 |
| 可做 | 26 | 缺，但插件能做 |
| 需降级 | 20 | 能做，形状必须改 |
| 不可做 | 12 | 卡在宿主契约层 |

**一句话**：DSH 已覆盖约一半外围面（权限四档、@文件引用、逐文件 diff 审阅、自动化、子代理、终端、归档、会话搜索、模型切换、附件、停止轮次）。**真正缺的是空间层**——分栏树、拖拽、标签管理。

### 三个绕不过去的硬约束

1. **宿主会话主列切不了分栏**（`main.conversation` 是 single）。多会话同屏必须自建容器。
2. **跨 slot 拖拽没有官方契约**。`ctx.sidebarRight` 只有命令式操作；dockkit 不是安装包，官方禁止读别家 DOM。必须自造命中测试。
3. **`Cmd+D`/`Cmd+W` 在 Web 上注册期即抛错**（白名单），Desktop 可声明 `Cmd+D`，但 `Cmd+W` 被 `page.close` 占用。

### 被推翻的两条原假设

- 「Chrome 式 tab 组」在 monocode React 版**根本没接线**（`groupId` 零写入点），不必复刻。
- 「主列切不了分栏」被探针**推翻**：用新增 `main` key + `SessionProvider` 可并存并渲染原生会话。

---

## 三、探针实测结果（本次关键证据）

在**一次性 profile** 中安装并加载，用无头 Chrome 走 CDP 验证；验证后已清理，用户 desktop profile 未受影响。

| 验证项 | 结果 |
|---|---|
| 插件加载 | ✅ boot payload application 阶段含 `dsh-mono` |
| 侧栏入口 | ✅ 出现并可切换 |
| `main` 槽共存 | ✅ `["mono","plugins","conversation","schedules"]`，宿主条目未被动 |
| 原生会话体 | ✅ 两栏各自渲染出真实 transcript 与 composer |
| 运行时异常 | ✅ 0 |

**这证明了**：不用重画 UI 也能多栏。`SessionProvider` + `renderFactorySlot("conversation.content")` 拿到的就是宿主原生会话——这是「不与宿主脱节」的关键。

---

## 四、方案要点

**定位**：补充件。新增 `main` key，宿主 UI 一行不动。

**三阶段**（每阶段带可验收判据）：
1. **可用的多栏**（L）：树 + 标签条 + 原生头体 + 拖拽 + 持久化。过关 = 两栏能各自发消息 / 拖标签能分合栏 / 重启还原。
2. **完整手势**（L）：sash、跨栏拖标签、塌缩、焦点导航、滑入动画。过关 = 不看文档能操作 / 60fps / 标签不丢不重。
3. **打磨**（M）：桌面快捷键、空态、错误兜底、中英文案。

**开工前置：无。** 最不确定的三条已被探针验证。

---

## 五、明确不做

- 文件查看 / 编辑器 / git gutter（本轮已放弃）
- Chrome 式 tab 组（monocode 自己都没接线）
- 会话多选、会话文件夹（宿主组件，无契约）
- 依赖 `data-dockkit-*` 等宿主内部 DOM 标记
- Web 端声明 `Cmd+D`/`Cmd+W`

---

## 六、还没定的

无阻塞项。以下属实现期决策，不影响开工：

- 多栏并跑的性能上限（阶段 2 实测后决定默认栏数）
- 文档级粘贴路由在多 composer 下的仲裁（阶段 2 验证）
- `keepMounted` 下 retain 释放时机（阶段 2 专项）

---

## 七、文件索引

    .scratch/monocode-ui-parity/
    ├── map.md                      探索地图
    ├── plan.md                     长期方案（票 05）
    ├── todo.md                     实施 TODO：12 个日单元 + 启动 prompt
    ├── report.md                   本报告（票 06）
    ├── feasibility-matrix.md       84 条判定表（票 03）
    ├── feasibility-summary.md      一页速查
    ├── route-decision.md           三条路线对比（已被 05 取代，留档）
    ├── grilling-05.md              九项决策记录
    ├── research/
    │   ├── monocode-interactions.md    票 01
    │   ├── dsh-capability-matrix.md    票 02
    │   └── _dump/                      130 份原始摘录，供复核行号
    ├── tools/                      asar 读取工具（5 个）
    └── issues/                     六张子票

    仓库根目录：
    ├── package.json / cordis.patch.yml / index.js / client.js
    ├── locale/en.json / icon.svg / docs/DETAIL.md
    └── （即 dsh-mono 插件工程，探针版）
