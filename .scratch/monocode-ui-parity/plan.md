# dsh-mono 长期方案（票 05）

> 输入：`.scratch/monocode-ui-parity/` 下的两份调查、判定表（`feasibility-matrix.md`）、六项 grilling 决策、以及探针实测结果。
> 本文件是**方案**，不是实现。过关标准是可验收的判据，不是「做完了」。
>
> **实施请看 [todo.md](todo.md)** ——12 个每天一个的单元，每单元带可直接复制的启动 prompt。

---

## 一、已定的九项决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 插件定位 | **补充件**：新增 `main` key，宿主 UI 一行不动 |
| 2 | 包名 | **dsh-mono**（原 dsh-monob 已全仓改名并回归验证） |
| 3 | 标签模型 | **每栏一条标签条**，一个标签 = 一条会话 |
| 4 | preview 临时态 | **做**：点开进临时态、下一个替换、双击/发消息转正 |
| 5 | 分栏模型 | **嵌套二分树**，支持任意切分 |
| 6 | 代码来源 | **从零写**，风格统一；monocode 仅作思路参考，不复制 |
| 7 | 布局持久化 | **全存**（localStorage，失效会话跳过，保留空栏） |
| 8 | 快捷键 | **桌面端优先**，用原生 `Cmd+D`；避开 `Cmd+B`/`Cmd+\\`/`Cmd+W` |
| 9 | 与宿主一致性 | **有取舍的一致**：体挂原生；头**探测式预留**（宿主当前拒绝，见下）；去掉宽度控制与 hero 页 |

### 决策 9 的实施更正（T03 实测）

原计划「头体都挂原生」。T03 实测发现**头挂不上**：`conversation.session.header` 的槽名全应用只允许声明一次，
且只有声明它的 entry 能渲染（`SlotOwnershipError` / `SlotAssemblyError`）。第三方 main panel 既不能重复声明，
也不能裸渲染。

**采取路线 A（接受限制）**，不改成抢占主列——那会丢掉「补充件」定位，正是 multipane 被诟病的做法。

后果与应对：

- 多栏下暂无「标准模式 / 费用明细 / 子智能体」chips 与「对话/轨迹/上下文/编队」视图条。
- 代码保留一次性能力探测：宿主若开放该槽，栏内原生头自动出现，无需改码。
- 会话识别性由 T04 的标签条承担（显示会话标题）。
- T12 收尾时若仍未开放，在 `docs/DETAIL.md` 明确写「多栏下部分宿主 chips 不可用，需切回单栏」。

---

## 二、三阶段路线

### 阶段 1：可用的多栏

**交付**
- 嵌套二分树（split/leaf，同轴归组，垂直边嵌套）
- 每栏标签条（preview 临时态 + 转正）
- 宿主原生头 + 体 + 输入框（去掉宽度控制与 hero）
- 拖拽分栏（`elementFromPoint` + 自有的 `data-mono-pane`）
- 布局持久化

**过关标准（三条全绿才算过）**
1. 能开两栏并同时对照两个真实会话，两边输入框都能发消息
2. 拖标签到栏边缘能分出新栏；拖回去能合回
3. 关掉 DSH 重开，栏数/栏宽/每栏标签/当前标签全部还原

**明确不做**：sash 拖动、滑入动画、跨栏拖标签排序、快捷键

### 阶段 2：完整手势

**交付**
- sash 拖动改比例（8% 最小、rAF 预览、Esc 取消）
- 跨栏拖标签（重排 + 迁移）
- 关栏塌缩 + 焦点落到兄弟
- `Cmd+Opt+方向键` 焦点导航
- 栏进入/退出滑入动画（deferBody：先挂标签条再挂会话体）

**过关标准**
1. 不看文档能完成「开三栏 → 拖宽 → 关中间那栏 → 焦点自动落到邻居」
2. 滑入动画不掉帧（60fps）、大文件会话也不拖住动画
3. 关栏后标签正确迁移，不丢也不重复

### 阶段 3：打磨

**交付**
- 桌面快捷键（`Cmd+D` / `Cmd+Shift+D` / `Cmd+Opt+方向`）
- 空态、错误兜底（单栏崩溃不白屏）
- 中英文案（走 `dsh-client-locale`）
- 设置项（最大栏数、是否显示在侧栏）

**过关标准**
1. Web 端注册不抛 `unsupported-browser`（快捷键按 runtime 分流）
2. 单栏渲染失败时其余栏仍可用
3. 中英文切换即时生效，不需重启

---

## 三、与宿主共存的策略

**原则：只加不改。**

- 用**新增 `main` key**（`mono`），绝不覆盖宿主的 `conversation` 条目。探针实测 `main` 槽条目为 `["mono","plugins","conversation","schedules"]`，四条共存。
- 侧栏入口走 `sidebar.panellist`，与宿主的插件页、自动化页并列。
- 栏内渲染**宿主原生**的头与体，不重画——这样宿主其他插件（费用明细、子智能体、上下文、轨迹）在栏里继续有效。
- **去掉**两样确实与多栏冲突的：宽度控制（按主区宽度算）、hero 页（单栏居中的空态假设）。
- 不读宿主的 `data-dockkit-*` / `data-sidebar-right-*`，那些是内部实现细节。

---

## 四、技术要点（探针验证过的）

| 要点 | 做法 | 为什么 |
|---|---|---|
| 拿原生会话体 | `SessionProvider({session:{sessionId,binding}}) + renderFactorySlot("conversation.content",{variant:"embedded",phase})` | 实测能渲染出完整会话与输入框 |
| 拿会话 binding | 每次渲染调 `sessions.binding(id)` **现取** | 缓存会在 scope 重建后留下过期 owner token |
| 保留会话 | `sessions.retain(id,{source:"mono"})`，**自定义 source** | 用 `mainView` 会与宿主抢，导致侧栏"新会话"行时有时无 |
| 挂原生头 | 在栏内 session scope 里渲染 `conversation.session.header` | 头是 `main.conversation` 的子条目，只有声明它的条目才渲染它 |
| 侧栏入口 | `sidebar.panellist` 注册 `{name,id,order,label}` | 不注册则面板无处可达 |

**宿主注入的 slot props（实测全清单）**：
`useContextMenu, usePanelInfo, useSessions, useSessionStatus, useWorkspaces, useResource, useRemoteAccess, useSessionRetainInfo, useSessionAccess, useWorkspaceAccess, renderFactorySlot, renderSlot, SessionProvider, children`

---

## 五、键位占用实况（Desktop）

| 键位 | 状态 | 归属 |
|---|---|---|
| `Cmd+B` | 已占 | `sidebar.left.toggle` |
| `Cmd+\\` | 已占 | `pane.split` |
| `Cmd+Shift+B` | 已占 | `sidebar.right.toggle` |
| `Cmd+W` | 已占 | `page.close`（必须避开） |
| `Cmd+D` | **空闲** | 可分给「分栏右」 |
| `Cmd+Shift+D` | **空闲** | 可分给「分栏下」 |

**Web 端注意**：`Cmd+D`/`Cmd+W` 在 Web 会被 `isWebBindingAllowed` 白名单拒绝，且是**注册期抛错**（会让整个插件不激活）。快捷键必须按 runtime 分流：Desktop 用原生组合，Web 用 `primary+alt+*` 或不注册。

---

## 六、风险与前置

| 风险 | 影响 | 应对 |
|---|---|---|
| 多实例性能 | 4 栏并跑时 transcript 与输入框的开销 | 阶段 2 实测；必要时限制默认栏数 |
| `keepMounted` 下 retain 释放时机 | 未读绿点不清除 / 会话被提前释放 | 探针已验证基本路径；阶段 2 专项验证 |
| 宿主升级改 slot 契约 | 插件可能整个失效 | 只依赖已实测的公开契约；不碰 dockkit 内部标记 |
| 文档级粘贴路由仲裁 | 多栏同时持有 composer 时，粘贴可能发错栏 | 阶段 2 验证，必要时聚焦态拦截 |
| Web 端快捷键限制 | 浏览器用户无快捷键 | 阶段 3 做 runtime 分流 |

**开工前置**：无。探针已经把最不确定的三条（原生体、原生头、与宿主共存）验证掉了。

---

## 七、工作量

| 阶段 | 量级 | 说明 |
|---|---|---|
| 阶段 1 | **L** | 树操作、拖拽、标签条、持久化、原生头体接入 |
| 阶段 2 | **L** | 动画与手势最耗时间，且必须上手调 |
| 阶段 3 | **M** | 快捷键、文案、兜底 |

从零写（决策 6）比搬运方案多约 3~5 天，换来的是风格统一。

---

## 八、明确不做

- 文件查看 / 编辑器 / git gutter（本轮已放弃，判定表 #31–#47）
- Chrome 式 tab 组（monocode 自己都没接线）
- 会话多选、会话文件夹（宿主组件，无契约）
- 依赖 `data-dockkit-*` 或任何宿主内部 DOM 标记
- Web 端声明 `Cmd+D`/`Cmd+W`（注册期抛错）
