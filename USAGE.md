# 研究进度树 · 使用文档

> 面向使用者（你）和未来的 AI 助手。安装方法见 [README.md](README.md)，需求背景见 [REQUIREMENTS.md](REQUIREMENTS.md)。

## 目录

1. [安装（详细）](#1-安装详细)
2. [树数据存储与配置](#2-树数据存储与配置)
3. [快速开始](#3-快速开始)
4. [tree_node 工具参考](#4-tree_node-工具参考)
5. [界面操作指南](#5-界面操作指南)
6. [跨会话续接（重要）](#6-跨会话续接重要)
7. [树的创建机制](#7-树的创建机制)
8. [数据模型与存储格式](#8-数据模型与存储格式)
9. [FAQ](#9-faq)
10. [故障排查](#10-故障排查)

---

## 1. 安装（详细）

### 前提

- DSH 已安装（`dsh` CLI 在 PATH 中），`$DSH_HOME`（Windows 默认 `C:\Users\<你>\.dsh`）下存在 `profiles/web/`
- 插件版本与你的 DSH 版本匹配（开发验证版本：DSH `0.1.0-rc.6`）

### 方式一：官方命令注册（推荐，需要 pnpm）

```bash
git clone https://github.com/CrazeBox/dsh-ExploreTree.git
cd dsh-ExploreTree
npm install                          # 安装 host 依赖
dsh plugin --profile web add file:"$(pwd)"
```

`dsh plugin` 会把依赖安装进 profile 并自动把本插件的 `dsh.bundle.patch` 加入 profile 层。

**重启 dsh web 服务**（停掉再启动），浏览器 **Ctrl+F5 强刷**。

### 方式二：手动注册（无 pnpm）

```bash
git clone https://github.com/CrazeBox/dsh-ExploreTree.git
cd dsh-ExploreTree
npm install
```

1. 编辑 `$DSH_HOME/profiles/web/package.json`，在 `dependencies` 与 `dsh.profile.bundles` 中追加本插件：

```json
{
  "dependencies": {
    "research-tree-plugin": "file:/绝对路径/dsh-ExploreTree"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "research-tree-plugin"
      ]
    }
  }
}
```

2. 在 profile 的 node_modules 中链接插件包：

```bash
# Windows（需要管理员终端或开发者模式）：
mklink /J "C:\Users\<你>\.dsh\profiles\web\node_modules\research-tree-plugin" "D:\绝对路径\dsh-ExploreTree"

# macOS / Linux：
ln -s /绝对路径/dsh-ExploreTree "$HOME/.dsh/profiles/web/node_modules/research-tree-plugin"
```

3. 重启 dsh web 服务，浏览器 Ctrl+F5 强刷。

### 验证安装

- `dsh --profile web --dump-config | grep research-tree` 能看到 `research-tree` 行
- 页面加载后侧边栏底部出现「🌳 研究树」按钮
- 点开按钮弹出面板，显示"还没有研究树"空状态

### 卸载

1. 从 `$DSH_HOME/profiles/web/package.json` 移除 `research-tree-plugin`（dependencies 与 bundles 两处）
2. 删除 `profiles/web/node_modules/research-tree-plugin` 链接
3. （可选）删除树数据目录（默认 `<启动目录>/research-vault/trees/`）以清空历史

---

## 2. 树数据存储与配置

- 默认存储目录：**`<dsh 服务启动目录>/research-vault/trees/`**，每棵树一个 JSON 文件（原子写，跨会话/重启不丢）
- 修改位置：编辑插件包根目录的 `cordis.patch.yml`：

```yaml
- insert:
    - id: research-tree
      name: 'research-tree-plugin'
      config:
        root: '/your/workspace/research-vault/trees'
```

改完重启 dsh web 生效。

---

## 3. 快速开始

1. 新建一个会话（任意模式均可）
2. 对 agent 说：**"用 tree_node 建一棵研究进度树"**；或者直接开始研究，agent 在需要时会自然使用
3. 点侧边栏底部「🌳 研究树」按钮，右侧弹出面板，树实时生长

一个典型的研究过程在树上长这样：

```
🌳 研究主题：跨域迁移 idea 验证
├── 计划 方向A：可行性证据链调研          （虚线 = 计划）
│   └── 探索：方向A                       （实线 = 实际执行）
│       └── 子代理：spawn                 （自动挂载）
├── 计划 方向B：最小可验证实验
│   └── 探索：方向B → 失败：数据集不可用   （红色 = 失败 + 原因）
└── 计划 方向C：迁移分析报告
    └── 探索：方向C → 成功                （绿色 = 成功）
```

---

## 4. tree_node 工具参考

工具名：`tree_node`。所有参数 JSON 格式；每次调用返回 `{ok, treeId, nodeId, currentNodeId, node}`（错误时 `{ok: false, error}`）。

| action | 必填参数 | 可选参数 | 作用 |
|---|---|---|---|
| `plan-root` | `title`（研究主题） | `treeId` | 建根节点（会话没有树时建树） |
| `plan-child` | `title` | `parentId`（默认当前节点）、`treeId` | 画预期分支（计划节点，虚线） |
| `start` | — | `parentId`（默认当前节点）、`title`、`treeId` | 开实际探索分支（decision 节点，实线）；title 缺省时自动"探索：<父标题>" |
| `conclude` | `nodeId`、`status`（success/failed/abandoned/blocked） | `reason`、`files` | 记录分支结论与原因 |
| `annotate` | `nodeId` | `title`、`reason`、`files` | 补充说明/关联产出文件 |
| `plan-mark` | `nodeId`、`relation`（on-track/revised/added） | `title` | 标记计划对照（修订/新增） |
| `list` | — | — | 列出全部树（treeId/主题/节点数/更新时间），供续接检索 |
| `resume` | `treeId` | `parentId`（挂载到指定节点） | 当前会话续接到已有树（跨会话继续同一研究） |

### 使用纪律（工具描述中也已写明）

1. 研究开始时先 `plan-root` + `plan-child` 画计划树（先计划后对照）
2. 分支结束必须 `conclude`（写清失败原因——失败原因比成功更值钱）
3. **并行推进多个分支时，`start`/`plan-child` 必须显式传 `parentId`**，不要依赖"当前节点"默认值
4. `start` 给具体标题（如"尝试方法X"），不要与计划分支标题重复
5. 中途才想起建树？随时 `plan-root`，把已做工作从对话历史**补记**成节点（无需复现对话）
6. 上下文不够换了新会话？见[第 6 节](#6-跨会话续接重要)

---

## 5. 界面操作指南

### 打开 / 关闭

- 侧边栏底部「🌳 研究树」按钮：开关面板
- 面板右上角 ✕：关闭（始终在右上角）

### 画布（思维导图同款交互）

| 操作 | 效果 |
|---|---|
| 按住任意位置拖动（含节点上） | 平移画布 |
| 点击面板内任意处 | **进入焦点模式**（边框高亮）：之后**滚轮 = 缩放**（锚定鼠标位置），不干扰页面缩放 |
| 点击面板外 / Esc | 退出焦点模式；焦点外 Ctrl/Cmd+滚轮仍可缩放 |
| 头部 − / % / + 按钮 | 缩放（25%~250%），点 % 复位 100% |
| 打开面板 / 切换树 | 自动居中；当前节点变化时自动平移到视口中心 |

### 节点

- **颜色** = 状态：绿=成功 / 红=失败 / 橙=阻塞 / 灰=放弃 / 蓝脉冲=进行中 / 浅灰=未开始（右下角图例）
- **虚线边框** = 计划（还没落地）；**黄色虚线** = 修订过的计划；实线 = 实际执行
- 左上角角标：`改`（计划已修正）/ `新`（计划外新增）
- 右上角 +/−：折叠/展开子树
- **悬停**：浮层显示详情（类型/状态/结论/原因/计划对照/轮次/起止时间/产出文件）
- **点击**：固定详情（浮层右上角 ✕ 或点击空白取消；悬停其他节点时固定框变半透明以示区分）
- **双击**：跳转到该节点所属的会话
- 当前节点：加粗虚线边框 + 自动跟随

### 多树

- 顶部下拉切换树（带节点数；长名自动截断，悬停看全名）
- 每棵树的视图（平移/缩放/展开状态）独立记忆

### 面板本身

- 拖标题栏：移动位置
- 鼠标靠近**四边四角**：出现 resize 光标，拖拽调整大小
- 位置/尺寸记忆在浏览器 localStorage，跨会话保持

---

## 6. 跨会话续接（重要）

上下文窗口不够、新建对话继续同一研究时，树不会自动合并——按下面两步显式续接：

```text
你（新会话）：继续上次那个「跨域迁移 idea 验证」的研究
agent：        tree_node list          # 找到旧树（按主题/更新时间辨认）
               tree_node resume treeId=session:xxx   # 续接
```

- `resume` 后，本会话所有 `tree_node` 操作、子代理/工作流自动节点都**继续画在旧树上**
- 可选 `parentId`：从指定节点继续挂载
- 续接的树被标记为共享：之后该会话即使创建 goal，也不会干扰续接绑定
- 想确认树对不对？`resume` 返回树的节点列表，agent 会核对

---

## 7. 树的创建机制

| 场景 | 行为 |
|---|---|
| 会话创建了 goal（长期目标） | **自动建树**（goal 即"长期研究"的显式声明） |
| 无 goal 的会话 | **惰性建树**：agent 第一次调用 `tree_node` 才建树；短对话/一次性问答永不建树 |
| 新会话继续旧研究 | 手动续接（见第 6 节） |
| 中途才想起建树 | 随时补建 + 从对话历史补记，无需复现对话 |

---

## 8. 数据模型与存储格式

一棵树 = 一个研究主题（goalId 键；无 goal 时 `session:<会话id>` 键）。存储为 JSON：

```jsonc
{
  "treeId": "goal-xxx | session:xxx",
  "topic": "研究主题标题",
  "goalId": "... | null",
  "sessionId": "...",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "currentNodeId": "n7",
  "shared": false,          // resume 续接后为 true
  "nodes": [
    {
      "id": "n1",
      "type": "root | plan | decision | subagent | workflow | job | skill | goal-round",
      "parentId": "n0 | null",
      "title": "方向A：尝试X方法",
      "status": "pending | running | ended",        // 自动状态
      "conclusion": "success | failed | abandoned | blocked | null",  // 显式结论
      "reason": "失败原因… | null",
      "planRelation": "on-track | revised | added | null",
      "files": ["research-vault/…"],
      "startedAt": "ISO-8601 | null",
      "endedAt": "ISO-8601 | null",
      "round": 3,
      "actor": "agent | user | auto",
      "anchor": { "sessionId": "...", "ts": "ISO-8601" }   // 双击跳转用
    }
  ],
  "timeline": [ { "ts": "...", "event": "node-decision", "nodeId": "n1" } ]
}
```

- 状态语义：`status` 是机器事实（运行中/已结束）；`conclusion` 是研究判断（成功/失败/放弃/阻塞 + 原因），两者并存
- 文件可直接编辑（改完重启服务或等 agent 下次操作时重新加载——注意：服务运行期间以内存为准，改文件需重启）

---

## 9. FAQ

**Q：树必须用科研模式吗？**
不需要。插件注册在 web profile host 层，任何模式的会话都能用 `tree_node` 和面板。

**Q：某些对话不想建树可以吗？**
可以。不建 goal 也不调用 `tree_node`，就永远没有树，零负担。

**Q：树名太长显示不下？**
显示层自动截断（头部省略号、下拉 26 字符），悬停看全名；存储与检索永远用完整名。

**Q：双击节点跳转后跳到哪？**
跳到该节点所属的会话（打开/切换）。精确滚动到消息（Level 2）暂未实现。

**Q：树的数据能备份吗？**
直接备份树数据目录（默认 `<启动目录>/research-vault/trees/`）下的 JSON 即可。

**Q：面板配色/字号能改吗？**
能。改 `lib/client.js` 顶部的 CSS 常量（浅色暖调主题，硬编码，不跟随 DSH 主题）。

---

## 10. 故障排查

| 现象 | 处理 |
|---|---|
| 引导页报 `Failed to load plugins … research-tree-plugin` | 检查 `lib/client.js` 是否存在；确认依赖已安装（`npm install`）；查看服务日志中的具体错误 |
| 侧边栏没有「研究树」按钮 | 确认 `dsh --profile web --dump-config` 包含 `research-tree` 行；重启 + Ctrl+F5 |
| 面板显示"暂时无法读取研究树" | 检查网关端点：`curl -X POST http://127.0.0.1:3080/api/researchTree/getSnapshot -H "content-type: application/json" -d '{"type":"client-request","rpcId":"t","method":"researchTree/getSnapshot","payload":{"args":{}}}'`，返回 `{ok:true,...}` 即正常 |
| agent 说没有 `tree_node` 工具 | 工具对模型可见是会话级的：**新会话一定可见**；旧会话需另开 |
| 树数据没落盘 | 检查存储目录是否可写（目录权限）；服务日志搜 `[research-tree]` |
| 重启后树不见了 | 存储目录配置变了？默认是"服务启动目录/research-vault/trees"，在 `cordis.patch.yml` 里配 `root` 固定目录 |
| 改了 `lib/client.js` 不生效 | web profile 禁用 HMR，改代码必须**重启服务 + Ctrl+F5 强刷** |
