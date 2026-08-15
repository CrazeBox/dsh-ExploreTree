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
3. （可选）删除树数据目录（默认 `$DSH_HOME/research-tree/`）以清空历史

---

## 2. 树数据存储与配置

- 默认存储目录：**`$DSH_HOME/research-tree/`**（DSH 数据根目录下，不依赖服务启动目录，
  任何机器上行为一致；每棵树一个 JSON 文件，原子写，跨会话/重启不丢）
- **固定到其他目录**（推荐，避免"换启动位置树不见了"）：在本机 profile 的用户层
  `$DSH_HOME/profiles/web/cordis.patch.yml` 按 id 覆盖 `root`：

```yaml
- id: research-tree
  config:
    root: 'D:/your/workspace/research-vault/trees'
```

- 改完重启 dsh web 生效。迁移历史数据：把旧目录下的 JSON 文件拷到新目录即可
- 面板空状态会显示**当前存储目录**——发现"树不见了"时先看它

**自动记录员（scribe）配置**（可选，默认开启）：树更新落后对话活动超过阈值时，
插件自动调 LLM 补记。可在 profile 用户层覆盖：

```yaml
- id: research-tree
  config:
    scribeEnabled: true      # false 关闭自动补记
    scribeLagMs: 600000      # 树落后阈值（默认 10 分钟）
    scribeCooldownMs: 300000 # 两次补记最小间隔（默认 5 分钟）
```

---

## 3. 快速开始

1. 新建一个会话（任意模式均可）
2. 对 agent 说：**"用 tree_node 建一棵研究进度树"**；或者直接开始研究，agent 在需要时会自然使用
3. 点侧边栏底部「🌳 研究树」按钮，右侧弹出面板，树实时生长

一个典型的研究过程在树上长这样：

```
🌳 研究主题：跨域迁移 idea 验证
├── 计划 方向A：可行性证据链调研          （虚线 = 计划，未定局）
│   └── 探索：方向A                       （实线 = 有结论/进行中）
│       └── 子代理：spawn                 （自动挂载）
├── 计划 方向B：最小可验证实验
│   └── 探索：方向B → 走不通：数据集不可用 （红色 = 走不通 + 原因）
└── 计划 方向C：迁移分析报告
    └── 探索：方向C → 走通                （绿色 = 走通）
```

---

## 4. tree_node 工具参考

工具名：`tree_node`。所有参数 JSON 格式；每次调用返回 `{ok, treeId, nodeId, currentNodeId, node}`（错误时 `{ok: false, error}`）。

| action | 必填参数 | 可选参数 | 作用 |
|---|---|---|---|
| `plan-root` | `title`（研究主题） | `treeId`、`newTree` | 建根节点（会话没有树时建树）；`newTree=true` 在同一会话**开一棵新树**（转换研究主题用，旧树保留可切回） |
| `plan-child` | `title`（短标签 ≤12 字） | `parentId`（默认当前节点）、`treeId`、`desc` | 画预期分支（计划节点，虚线） |
| `start` | — | `parentId`（默认当前节点）、`title`（短标签）、`treeId`、`desc` | 开实际探索分支（decision 节点，实线）；title 缺省时自动"探索：<父标题>" |
| `conclude` | `nodeId`、`status`（success/failed/abandoned/blocked） | `reason`、`files` | 记录分支结论（线的命运：走通/走不通/没走完/卡住）与原因 |
| `annotate` | `nodeId` | `title`、`desc`、`reason`、`files` | 补充说明（标题/描述/原因/关联产出文件） |
| `plan-mark` | `nodeId`、`relation`（on-track/revised/added） | `title` | 标记计划对照（修订/新增） |
| `list` | — | — | 列出全部树（treeId/主题/节点数/更新时间/是否归档），供续接检索 |
| `resume` | `treeId` | `parentId`（挂载到指定节点） | 当前会话续接到已有树（跨会话继续同一研究） |
| `archive` | `treeId` | `archived`（true=归档/false=恢复） | 归档/恢复一棵树（数据保留，从正常列表隐藏） |
| `remove` | `treeId` | — | **永久删除**一棵树（文件移出为备份，不可从界面恢复；谨慎） |

### 使用纪律（工具描述中也已写明）

1. 研究开始时先 `plan-root` + `plan-child` 画计划树（先计划后对照）
2. 分支结束必须 `conclude`（写清原因——「走不通」的原因比「走通」更值钱）
3. **并行推进多个分支时，`start`/`plan-child` 必须显式传 `parentId`**，不要依赖"当前节点"默认值
4. `start` 给具体标题（如"尝试方法X"），不要与计划分支标题重复
5. 中途才想起建树？随时 `plan-root`，把已做工作从对话历史**补记**成节点（无需复现对话）
6. 上下文不够换了新会话？见[第 6 节](#6-跨会话续接重要)
7. **中途转换研究主题**：`tree_node plan-root title=新主题 newTree=true`——在同一会话开一棵新树，
   旧树保留在面板下拉里可随时切回查看/继续
8. **标题与描述分层**：`title` 写短标签（≤12 字，节点上截断显示）；「在这个节点干了什么」写 `desc`
   （长文本，悬停/点击详情看全文）；结论原因写 `reason`——三件事分开写，别都塞进标题

### 自动收尾与自动记录员（不需要手动做的部分）

- 一个 plan 分支下的**全部子节点结束后，plan 自动结束**（不再残留"进行中"）
- **计划自动汇总结论**：plan 收尾时自动统计子任务结论显示在节点上，
  如"子任务完成：2 走通、1 走不通"（无结论的计入"未标注"，不替你下判断）
- 无 goal 会话：全部子节点静止后 **root 自动结束**
- **goal 完成/阻塞时：整树收尾**——所有"进行中"节点自动结束（显示"已结束"）
- **启动静态收尾**：每次 DSH 重启时自动修正历史数据里"任务已完成但节点仍进行中"的残留
- **自动记录员（scribe）**：插件监听会话事件，当树的更新时间落后对话活动超过 10 分钟时，
  后台自动调用 LLM 把新事件压缩成树操作并补记（start/conclude/annotate/plan-child，
  节点标记 `auto-scribe`）——即使 agent 忘了记录，树也会自动跟上；
  手动记录优先，自动补记只填空白（可在 `cordis.patch.yml` 配 `scribeEnabled: false` 关闭）
- 子代理结束事件**持久化配对**：即使中途重启 DSH，子代理节点的结束状态也不会丢
- **防线性链**：在不指定 `parentId` 且当前节点是"已结束的决策"时，新分支自动挂回它的父级
  （计划/主题），避免任务一条线串下去

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
| 头部 **⇄ / ⇅** 按钮 | **布局方向切换**：横向（根在左，宽分支友好）/ 竖向（根在顶，深链直观）；选择记忆，跨会话保持 |
| 打开面板 / 切换树 | 自动居中；当前节点变化时自动平移到视口中心 |

### 节点

- **颜色 = 线的命运**：绿=走通 / 红=走不通 / 橙=卡住 / 灰=没走完 / 蓝脉冲=进行中 / 浅灰=未开始
- **线型 = 是否定局**（右下角图例）：**实线** = 有结论/进行中（走通和走不通都是"有结论"）；
  **虚线** = 未定局（计划还没落地、卡住、没走完、未开始）；**黄色虚线** = 修订过的计划
- 左上角角标：✕（此路不通）/ `改`（计划已修正）/ `新`（计划外新增）
- **标题与描述分层**：卡片第一行 = 短标题（截断 11 字）；第二行 = `desc`（在这个节点干了什么，
  截断显示；无 desc 时回退显示原因/状态文案）；完整内容在悬停/点击详情里看全文
- 右上角 +/−：折叠/展开子树
- **悬停**：浮层显示详情（类型/状态/说明/结论/汇总/原因/计划对照/轮次/起止时间/产出文件）
- **点击**：固定详情（浮层右上角 ✕ 或点击空白取消；悬停其他节点时固定框变半透明以示区分）
- **编辑**：固定卡片右上角 **✎** → 直接改标题/描述文本框 → 保存写回后端（乐观更新，失败自动回滚并提示）；
  只提交有变化的字段；说明清空 = 删除描述
- **双击**：跳转到该节点所属的会话
- 当前节点：加粗虚线边框 + 自动跟随

### 多树与归档

- 顶部下拉切换树（带节点数；长名自动截断，悬停看全名 + treeId）
- 每棵树的视图（平移/缩放/展开状态）独立记忆
- 面板底部「**归档**」：把当前树从正常列表**隐藏**（数据保留）；下拉中出现
  「**已归档(N)**」按钮 → 点击进入归档视图（高亮为「正常」可切回），
  归档树在这里查看/恢复
- 面板底部「**删除**」：确认后**永久删除**当前树（文件移出为备份，可从存储目录找回）
- 归档/删除后自动选中列表中的**相邻树**；该视图没有树时显示默认空状态页
- 树的**生命周期独立于对话**：对话归档/删除不影响树；树的归档/删除由你在面板里主动决定

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

**treeId 从哪看？** 正常使用**不需要你手动查**——告诉 agent 研究主题即可，
它会 `list` 自动辨认。手动查看途径：
1. 面板下拉/头部**悬停**：显示完整树名 + treeId
2. 树数据目录下的 JSON **文件名**就是 treeId（如 `session:xxx#2.json`、`goal-xxxx.json`）
3. 直接问 agent："列出我的研究树"

---

## 7. 树的创建机制与生命周期

| 场景 | 行为 |
|---|---|
| 会话创建了 goal（长期目标） | **自动建树**（goal 即"长期研究"的显式声明） |
| 无 goal 的会话 | **惰性建树**：agent 第一次调用 `tree_node` 才建树；短对话/一次性问答永不建树 |
| 新会话继续旧研究 | 手动续接（见第 6 节） |
| 中途才想起建树 | 随时补建 + 从对话历史补记，无需复现对话 |
| 中途转换研究主题 | `plan-root title=新主题 newTree=true` 开新树（旧树保留可切回） |
| 对话归档 / 对话删除 | **不影响树**——树的生命周期独立，由你在面板里归档/删除（见第 5 节） |
| **研究中断（进程关闭）后恢复** | **树保持原样，继续画在原树上（不建新树）**：同会话恢复或新会话 `resume` 原树均可；中断时挂着的子代理会被自动标记"进程中断（未完成）"；仍 running 的决策节点就是中断点，让 agent 先汇报进度、对未完成节点 `conclude` 标记，再从该节点或父级继续 |

---

## 8. 数据模型与存储格式

一棵树 = 一个研究主题（goalId 键；无 goal 时 `session:<会话id>` 键）。存储为 JSON：

```jsonc
{
  "treeId": "goal-xxx | session:xxx | session:xxx#N",
  "topic": "研究主题标题",
  "goalId": "... | null",
  "sessionId": "...",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "currentNodeId": "n7",
  "shared": false,          // resume 续接 / newTree 独立树后为 true
  "archived": false,        // 面板归档后为 true（数据保留，正常列表隐藏）
  "pendingSubagents": [],   // 子代理结束事件的持久化配对表（重启不丢）
  "nodes": [
    {
      "id": "n1",
      "type": "root | plan | decision | subagent | workflow | job | skill | goal-round",
      "parentId": "n0 | null",
      "title": "方向A：尝试X方法",
      "desc": "在这个节点干了什么（长文本，可选）| null",
      "status": "pending | running | ended",        // 自动状态
      "conclusion": "success | failed | abandoned | blocked | null",  // 显式结论（线的命运：走通/走不通/没走完/卡住）
      "reason": "走不通的原因… | 计划汇总（子任务完成：N 走通）| null",
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

- 状态语义：`status` 是机器事实（运行中/已结束）；`conclusion` 是**研究判断（线的命运）**——
  走通（success）/ 走不通（failed）/ 没走完（abandoned）/ 卡住（blocked）+ 原因，两者并存。
  注意：这是**这条探索线的结局**，不是对"猜想是否成立"的判定——走通和走不通都是
  "有结论"（科研产出，UI 实线），没走完和卡住是"未定局"（UI 虚线）
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
直接备份树数据目录（默认 `$DSH_HOME/research-tree/`）下的 JSON 即可。

**Q：归档的树去哪了？怎么找回？**
归档 = 从正常列表隐藏（数据保留）。点面板头部「已归档(N)」按钮进入归档视图，
选中后底部「恢复」即可取消归档。

**Q：删除的树还能找回吗？**
删除是软删除：树文件被改名为 `.deleted-<时间戳>` 留在存储目录，可从那里手动恢复；
界面内不可恢复，删除前有确认弹窗。

**Q：研究做一半关了 DSH，重启后怎么继续？**
树数据不丢、结构不变。恢复方式：同一会话直接继续；新会话 `list` + `resume` 原树。
重启时插件会自动把中断时挂着的子代理标记为"进程中断（未完成）"；
仍显示"进行中"的决策节点就是上次的中断点——让 agent 先汇报上次进度，
对未完成节点补 `conclude` 标记，再继续。**继续研究永远不新建树**。

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
| 重启后树不见了 | 存储目录配置变了？默认是 `$DSH_HOME/research-tree/`；面板空状态会显示当前存储目录——确认与实际数据目录一致，或在 profile 用户层配 `root` 固定目录（见第 2 节） |
| 改了 `lib/client.js` 不生效 | web profile 禁用 HMR，改代码必须**重启服务 + Ctrl+F5 强刷** |
