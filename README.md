# dsh-mono

把 DeepSeek Harness 的主区变成多栏多会话工作区。

**状态**：早期开发中（0.0.1）。T01–T03 已完成，T04 起见 [实施 TODO](.scratch/monocode-ui-parity/todo.md)。

## 这是什么

DSH 默认一次只能看一个会话。dsh-mono 让你把多个会话并排在同一屏上，每栏一条，各自独立输入。

它**不替换**宿主的会话视图——用新增的 `main` key 并存，宿主 UI 一行不动。点侧栏的 Mono 入口进入，随时点回宿主原生的会话页。

## 当前能力

- 分栏（嵌套二分树，支持任意切分）
- 每栏独立会话与输入框（宿主原生，不重画）
- 栏间分隔条可见（拖动是 T07）

## 已知限制

- 多栏下**没有**宿主的会话头（「标准模式 / 费用明细 / 子智能体」chips 与视图条）。槽名全应用只能声明一次，第三方面板拿不到。代码里留了探测，宿主若放开会自动出现。
- 标签条、preview 临时态、布局持久化、拖拽分栏尚未实现（T04–T06）。

## 安装

先确保 DSH 桌面端或 web 端在跑，然后：

    dsh plugin --profile <你的profile> add github:FrankXuL/dsh-mono

装完重启 DSH，侧栏会出现 **Mono**。

开发时用 `link:` 而不是 `file:`，这样改完源码 `npm run build` 刷新页面就能看到变化：

    dsh plugin --profile <你的profile> add link:/path/to/dsh-mono

## 开发

只改 `src/client/` 下的文件。根目录的 `client.js` 是构建产物。

    npm run build       # src/client/ → client.js
    node --check client.js

没有任何依赖，不需要装包。拼接脚本 `scripts/build.mjs` 按写死的顺序把模块拼在一起。

## 文档

- [长期方案](.scratch/monocode-ui-parity/plan.md) —— 九项决策、三阶段路线
- [实施 TODO](.scratch/monocode-ui-parity/todo.md) —— 12 个日单元，每个带启动 prompt
- [可行性调研](.scratch/monocode-ui-parity/report.md) —— 84 条交互判定

## 许可

MIT
