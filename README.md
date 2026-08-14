# dsh-ExploreTree — 研究进度树（Research Progress Tree）

> 仓库地址：<https://github.com/CrazeBox/dsh-ExploreTree>

把长期探究过程（科研、调研、迁移分析、写作、代码探索……）可视化成树状图：
**做了什么、做到哪、哪个分支成功/失败（含原因）**，跨会话留存，实时跟随 agent 工作进度。

> 形态：Web 界面侧边栏按钮 + 右侧思维导图式悬浮面板（SVG 树、状态色节点、
> 焦点模式缩放、悬停详情、双击跳转会话），界面预览见 USAGE.md 的「界面操作指南」。

## ⚠️ Vibe Coding 产物声明

本项目是 **vibe coding** 的产物：需求由使用者与 AI 助手在对话中逐轮明确（见
[REQUIREMENTS.md](REQUIREMENTS.md)），代码由 AI 生成并经多轮迭代调试。它：

- ✅ 在本机 DSH 环境（0.1.0-rc.6，web profile）上通过了冒烟测试（host 26 项 / client 18 项）并实际运行验证
- ❌ **未经**传统意义上的工程化评审（code review、测试矩阵、安全审计、跨版本兼容性测试）
- ⚠️ 请自行评估使用风险；欢迎 fork 改进；遇到问题欢迎提 issue

## 这是什么

- **一个 DSH 插件**（Cordis 动态插件，Host + Client 双端），注册在 web profile 的 host 层：
  - `tree_node` 工具对**所有模式**的会话可见（standard / code / minimal / 自定义 preset）
  - Web 界面侧边栏底部出现「🌳 研究树」按钮，点击弹出思维导图式悬浮面板
- **一个研究主题一棵树**：有 goal 的会话自动建树；无 goal 的会话惰性建树（agent 第一次调用 `tree_node` 才建）
- **跨会话续接**：上下文不够时开新对话，`tree_node list` → `tree_node resume` 继续画同一棵树

## 特性一览

- **思维导图式渲染**：SVG 分层布局，根在左、分支向右；节点 = 标题 + 简短说明
- **状态可视化**：节点颜色表达成功/失败/阻塞/放弃/进行中/未开始，角落有图例；
  计划节点虚线、修订过的计划节点黄色虚线
- **画布交互**（市面思维导图同款）：任意位置拖动平移、滚轮缩放锚定鼠标、
  焦点模式（点击面板后滚轮直接缩放，不干扰页面）
- **面板自由**：拖标题栏移动、四边四角拉伸、位置/尺寸记忆（localStorage）
- **详情**：悬停节点看详细说明（结论/原因/时间/产出文件），点击固定
- **跳转**：双击节点跳转到其所属会话
- **自动骨架**：goal 轮次、子代理、工作流自动挂到树上
- 树数据持久化到本地 JSON（跨会话、重启不丢）

## 安装

> 详细安装步骤见 [USAGE.md](USAGE.md)（含 Windows / macOS / Linux 的差异）。

前提：已安装 DSH（`dsh` CLI 可用，web profile 存在），并已准备好 pnpm（方式一）或 Node.js（方式二）。

### 方式一：官方命令注册（推荐，需要 pnpm）

```bash
git clone https://github.com/CrazeBox/dsh-ExploreTree.git
cd dsh-ExploreTree
npm install                      # 安装 host 依赖（@deepseek-ai 包，版本与 DSH 匹配）
dsh plugin --profile web add file:"$(pwd)"   # 注册进 web profile
# 重启 dsh web 服务，浏览器强刷（Ctrl+F5）
```

### 方式二：手动注册（无 pnpm 时）

```bash
git clone https://github.com/CrazeBox/dsh-ExploreTree.git
cd dsh-ExploreTree
npm install
```

然后编辑 `$DSH_HOME/profiles/web/package.json`：

```json
{
  "dependencies": {
    "research-tree-plugin": "file:/绝对路径/dsh-ExploreTree"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "research-tree-plugin"]
    }
  }
}
```

并在 `$DSH_HOME/profiles/web/node_modules/` 下把插件目录链接进来：

```bash
# Windows（管理员或开发者模式）：
mklink /J "$env:USERPROFILE\.dsh\profiles\web\node_modules\research-tree-plugin" "D:\绝对路径\dsh-ExploreTree"
# macOS / Linux：
ln -s /绝对路径/dsh-ExploreTree "$HOME/.dsh/profiles/web/node_modules/research-tree-plugin"
```

重启 dsh web 服务，浏览器强刷。成功后侧边栏底部出现「🌳 研究树」按钮。

> **验证**：`dsh --profile web --dump-config | grep research-tree` 能看到 `research-tree` 行。

## 快速开始

1. 新建一个会话（任意模式）
2. 对 agent 说：**"用 tree_node 建一棵研究进度树"**（或直接开始研究，agent 会自然使用）
3. 点侧边栏底部「🌳 研究树」按钮，看树实时生长

agent 侧工具用法、UI 操作指南、跨会话续接、FAQ 见 **[USAGE.md](USAGE.md)**。

## 树数据存储

默认存于 **`<dsh 服务启动目录>/research-vault/trees/`**（每棵树一个 JSON 文件）。
可在插件包的 `cordis.patch.yml` 中配置 `config.root` 指定其他目录：

```yaml
- insert:
    - id: research-tree
      name: 'research-tree-plugin'
      config:
        root: '/your/workspace/research-vault/trees'
```

## 仓库结构

```
dsh-ExploreTree/
├── README.md            # 本文件（介绍 + 安装）
├── USAGE.md             # 使用文档（工具参考 / UI 指南 / FAQ）
├── REQUIREMENTS.md      # 需求规格（vibe coding 的需求对话记录）
├── cordis.patch.yml     # DSH 组合行（host 注册）
├── package.json         # 插件包声明（dsh.bundle / dsh.client / 依赖）
├── lib/
│   ├── index.js         # Host 半端：tree_node 工具 + 事件订阅 + 持久化 + 网关端点
│   └── client.js        # 浏览器半端：思维导图面板（手写 bundle，零构建依赖）
└── test/
    ├── smoke-host.mjs   # Host 冒烟测试（真实 cordis 运行时）
    └── smoke-client.mjs # Client 冒烟测试（布局/状态/纯函数）
```

## 兼容性

- 开发验证环境：DSH `0.1.0-rc.6`（web profile），Windows
- 依赖 `@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-tools`（rc 版本，建议与你的 DSH 安装版本一致）
- 客户端 bundle 仅依赖浏览器内核提供的 seed 模块（react），无需构建工具

## License

[MIT](LICENSE) © 2026 CrazeBox
