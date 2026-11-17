# 三条路线的区别与取舍

> 前提修正：本会话跑在 **desktop profile**（`DSH_PROFILE=desktop`），已装 **`dsh-multipane` 1.0.53（多栏视图）** 并正在运行。
> 这改写了判定表里「自建分栏树 = XL」的那一行——**已经有人做完了，而且装在你机器上**。

## 先说结论

**推荐：不写分栏，写文件；分栏直接用 `dsh-multipane`。**

判定表里最贵的那块（XL 的自建分栏树 + 拖拽 + 滑入动画 + 持久化，判定表 #1–#7、#13、#21–#22、#27）现在是**已经解决的问题**。`dsh-monob` 只剩一处真正值得做的：**可编辑文件面**。而这一处，正好也是判定表里唯一还悬着的岔路（#32–#35）。

---

## 三条路线摆在一起

| | **A. 自建分栏树** | **B. 复用 multipane + 自建文件面** | **C. 复用 multipane + 绑 better-sidebar** |
|---|---|---|---|
| 分栏/拖拽/多会话 | 自己写 XL | 已装、能用、零成本 | 已装、能用、零成本 |
| 文件编辑器 | 自己写（L） | 自己写（L） | 立刻可用（S） |
| 文件保存 | 自己写通道（M） | 自己写通道（M） | 现成 `fs.write`（原子 tmp+rename） |
| git gutter/stage | 自己接（L） | 自己接（L） | 现成整套 `git.*` |
| **总工作量** | **XL+L+M+L** | **L+M** | **S**（但绑第三方） |
| 断裂风险 | 低（自己的） | 中（依赖宿主 slot 契约） | **高**（第三方 API + 版本门控） |
| 谁维护 | 你 | 你 + multipane 作者 | 你 + multipane + better-sidebar 作者 |
| 现在能用吗 | 不能 | 不能（要先写） | 能，但 better-sidebar 当前被禁用 |

---

## 关键差异逐条说

### 差异 1：分栏这件事，已经不用你做了

我原以为要先自建容器，因为能力矩阵说 `main.conversation` 是 single、切不动。**`dsh-multipane` 的源码证明它能切**，做法：

    ctx.slots.register({
      name: "main",
      key: "conversation",     // 用同一个 key
      priority: -1,            // 用更低优先级盖掉宿主那条
      children: { "split-view.pane": { kind: "list", scope: "session-maybe" } }
    }, WorkspaceRoot)

然后每栏里 `renderFactorySlot("conversation.content", { variant: "embedded" })` + `SessionProvider` 显式绑 `reference`。

**这证伪了能力矩阵的一条推断**：矩阵说「`conversation.content` factory 输入里没有 sessionId → 主列切不了」。事实是 **factory 拿不到 sessionId，但外面套一层 `SessionProvider` 就能给它**。宿主自己在右栏就是这么干的（矩阵自己记了这条，只是没推到主列）。

它踩过的坑也写在源码注释里，很值钱：

- 保留来源必须用 `"splitView"` 而不是 `"mainView"`——用了 `mainView` 会和宿主抢，导致侧栏「新会话」行时有时无。
- 用 `priority: -1` 盖掉宿主条目后，`activePanelId` 恒为 `null`，宿主右栏/底部面板才正常。
- 原生会话头挂不进自己的栏（`main.conversation` 属主只能是 `conversation` 条目），所以每栏自己画了一个头。

### 差异 2：能力矩阵有一条要翻案

| 矩阵原话 | 实际 |
|---|---|
| 「把宿主会话主列本身切成分栏 = **不能**」 | **能**。`main` keyed 槽用 `priority` 覆盖 + `SessionProvider` 显式绑定。已装插件在跑。 |
| 「`conversation.content` factory 输入里没有 sessionId」 | 属实，但**不构成阻碍**——外面套 `SessionProvider` 即可。 |

这不是小错：它把整个 map 的路线从「先自建容器」扭到了「容器已有人做」。

### 差异 3：可编辑文件面，三个选择其实是两种

- **官方路径彻底不通**：`dsh-api-workspace-files` 无 mutation、`sidebar-files` 只列目录、`documentpreview` 只预览。这三条没有商量余地。
- **剩下的两条**：
  - **B（自建）**：Host 侧 `ctx.fs` + 自己的路由/Remote 端点。工作量 L~M，但每一行都是你的。
  - **C（绑 better-sidebar）**：它的 `service.d.ts` 已有 `fs.write`（原子 tmp+rename）、`git.*` 全套、`DiffTab`、CodeMirror 编辑器。工作量 S，但**它的 `editor` descriptor 已经抢占 `dsh-resource://file/**`**——你再注册同类 viewer 会被它的 `extension` band 压住。

### 差异 4：better-sidebar 现在是被禁用的

`~/.dsh/profiles/web/disabled-plugins.json` 里有 `dsh-better-sidebar: {disabledAt: ..., reason: "user"}`——**你自己关的**。而 desktop profile 里根本没装它。

这条很关键：**C 路线的前提（better-sidebar 可用）当前不成立**。要走 C，得先把它请回来，并确认它的终端/路由/`fs.write` 在 desktop profile 真能用（能力矩阵把这几点都列为「未验证」）。

---

## 推荐

### 分栏：用 `dsh-multipane`，不要自己写

理由不是省事，是**它已经踩完了你还没踩的坑**（保留来源、priority 覆盖、会话头归属、窄栏导航条死锁、更新时目录空窗导致全插件不激活……README 更新记录里是一整串血泪）。你自己写一遍，会把同样的坑再踩一次。

而且它跟你这次目标不冲突：它管**空间**，`dsh-monob` 该管**文件**。

### 文件：先走 B，把 C 留作加速选项

**为什么是 B**

1. C 依赖的 better-sidebar 现在是禁用状态，且它已霸占文件地址与 `files` kind——你做的 viewer 会被压住，等于在你的插件里给它的插件打工。
2. 它的契约靠 `service.version` / `features` 门控（11 项 features），DSH 再改右栏 API 就可能断。你的插件会被别人的发版节奏绑架。
3. 判定表已确认：官方 `documentpreview` 的**预览侧够用**（图片/视频/Office/PDF 只读），你真正缺的只有**编辑 + 保存 + git gutter**三样，是有限工作量。

**加速开关**：先花半天做一次 better-sidebar 复活验证（从 disabled 放出来，确认 `fs.write`/`git.*`/`/sidebar` 路由真能用）。验证通过且 L 的工期不能接受，再退到 C——那时候你是**知情地**选 C。

### 不建议：A

除非你想 fork 整个工作区体验。A 的每一块都是 XL~L，而且做完会得到一个和 `dsh-multipane` 打架的东西——它的 README 已警告：**两个都往 `cordis.patch.yml` 插 loader entry，entry id 撞车会让主区渲染错乱**。

---

## 这对地图意味着什么

1. **判定表要改**：#1–#7、#13、#21–#22、#27 从「可做 XL」改成「已存在（dsh-multipane）」。
2. **能力矩阵要改**：总表「把宿主会话主列本身切成分栏」与「明确做不到的事」第 1 条，都要翻案。
3. **长期方案（票 05）范围收窄**：不再讨论「要不要自建分栏」，只剩「文件面走 B 还是 C」。
4. **初始化（票 04）只做文件面骨架**，不碰布局。

---

## 一句话

**空间已经有人做完了（还装在你机器上），你去把文件那半做掉。**
