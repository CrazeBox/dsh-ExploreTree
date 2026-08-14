// research-tree-plugin Host 半端冒烟测试：
// 用真实 cordis 运行时走 loader 同款路径（ctx.plugin）加载插件，
// 验证：构造 / 工具注册 / 事件订阅 / Remote 标记 / 快照 / 工具操作 / 自动骨架 / 持久化。
import { Context } from "@deepseek-ai/cordis";
import { Service } from "@deepseek-ai/cordis";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { mkdtempSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results = [];
function check(name, cond, extra = "") {
	results.push([name, cond]);
	console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
}

// ── 最小宿主依赖（tools / goals） ───────────────────────────────────────────
class MockTools extends Service {
	tools = [];
	constructor(ctx) {
		super(ctx, "tools");
	}
	register(tool) {
		this.tools.push(tool);
	}
}
class MockGoals extends Service {
	view = null;
	constructor(ctx) {
		super(ctx, "goals");
	}
	get() {
		return this.view;
	}
}

// ── 真实 cordis 上下文 ───────────────────────────────────────────────────────
const ctx = new Context();
await ctx.plugin(MockTools);
await ctx.plugin(MockGoals);

// ── 加载插件（loader 同款：默认导出类 + static inject） ─────────────────────
const root = mkdtempSync(join(tmpdir(), "rt-test-"));
const { default: ResearchTreePlugin } = await import("../lib/index.js");
const fiber = ctx.plugin(ResearchTreePlugin, { root });
await fiber;
check("插件激活（inject tools/goals 解析）", ctx.get("researchTree") !== void 0);

const plugin = ctx.get("researchTree");
check("Remote 标记：getSnapshot + annotateNode", (() => {
	const methods = remoteMethods(plugin).map((m) => m.method).sort();
	return methods.length === 2 && methods[0] === "annotateNode" && methods[1] === "getSnapshot";
})(), JSON.stringify(remoteMethods(plugin).map((m) => m.method)));

const tools = ctx.get("tools");
check("tree_node 工具已注册", tools.tools.some((t) => t.name === "tree_node"));

// ── 模拟 agent 执行 tree_node（plan-root / plan-child / start / conclude） ───
const fakeAgent = { id: "session-smoke", session: { header: { id: "session-smoke" } } };
const exec = { agent: fakeAgent };
const tool = tools.tools.find((t) => t.name === "tree_node");

let r = await tool.execute({ action: "plan-root", title: "冒烟测试研究" }, exec);
check("plan-root 建根", r.ok === true && r.nodeId.startsWith("root-"), JSON.stringify(r));
check("节点锚点（会话+时间）已记录", r.ok === true && r.node.anchor !== null && r.node.anchor.sessionId === "session-smoke" && typeof r.node.anchor.ts === "string", JSON.stringify(r.node?.anchor));
const rootId = r.nodeId;

r = await tool.execute({ action: "plan-child", parentId: rootId, title: "方向A：方法X" }, exec);
check("plan-child 建计划分支", r.ok === true && r.nodeId.startsWith("plan-"));
const planId = r.nodeId;

r = await tool.execute({ action: "start", parentId: planId, title: "尝试方法X" }, exec);
check("start 开实际分支", r.ok === true && r.node.status === "running" && r.currentNodeId === r.nodeId);
const stepId = r.nodeId;

r = await tool.execute({ action: "conclude", nodeId: stepId, status: "failed", reason: "收敛性差", files: ["research-vault/x.md"] }, exec);
check("conclude 记失败结论", r.ok === true && r.node.conclusion === "failed" && r.node.status === "ended" && r.node.reason === "收敛性差");
check("conclude 关联文件", Array.isArray(r.node.files) && r.node.files.length === 1);

let threw = false;
try {
	await tool.execute({ action: "conclude", nodeId: stepId, status: "maybe" }, exec);
} catch (error) {
	threw = true;
}
check("conclude 非法 status 被参数校验拒绝", threw);

r = await tool.execute({ action: "start", parentId: planId, title: "尝试方法Y" }, exec);
check("第二条分支", r.ok === true);
const step2 = r.nodeId;

r = await tool.execute({ action: "plan-mark", nodeId: planId, relation: "revised", title: "方向A：改用方法Z" }, exec);
check("plan-mark 标记修订", r.ok === true && r.node.planRelation === "revised" && r.node.title === "方向A：改用方法Z");

r = await tool.execute({ action: "start", parentId: planId }, exec);
check("start 无标题时默认带『探索：』前缀（与计划分支区分）", r.ok === true && r.node.type === "decision" && r.node.title === "探索：方向A：改用方法Z", JSON.stringify(r.node?.title));

// ── 自动骨架：goal / subagent / workflow 事件 ────────────────────────────────
ctx.emit("agent/created", { agent: fakeAgent });
ctx.emit("goal/changed", {
	agent: fakeAgent,
	change: { operation: "create", ref: { id: "goal-1", revision: 1 }, goal: { id: "goal-1", objective: "目标：验证树插件", roundsStarted: 1 } }
});
ctx.emit("goal/changed", {
	agent: fakeAgent,
	change: { operation: "complete", ref: { id: "goal-1", revision: 2 }, goal: { id: "goal-1", objective: "目标：验证树插件", roundsStarted: 2 } }
});

let snap = plugin.getSnapshot();
check("goal 事件建树（goalId 键）", snap.trees.some((t) => t.treeId === "goal-1"));
const goalTree = snap.trees.find((t) => t.treeId === "goal-1");
check("goal 根节点已完结（complete）", goalTree.nodes.some((n) => n.type === "root" && n.conclusion === "success"));

// subagent 挂到当前节点：先让会话树有 current（用工具在会话树里 start，parentId 省略=当前节点）
r = await tool.execute({ action: "start", title: "子代理宿主分支" }, exec);
// 注意：MockGoals.get 返回 null -> goalId=null -> session 树
ctx.emit("agent/created", { agent: { id: "child-1", session: { header: { id: "child-1", parentSession: "session-smoke" } } } });
ctx.emit("subagent/start", { id: "child-1", provider: "spawn", runId: "run-1", local: true });
ctx.emit("subagent/end", { id: "child-1", provider: "spawn", runId: "run-1", local: true, stopReason: "failed: boom" });

snap = plugin.getSnapshot();
// 会话当前树 = goal-1（goal 事件把会话绑定到 goal 树；resolveTree 以绑定为准，
// 工具操作与自动节点归属一致）
const autoTree = snap.trees.find((t) => t.treeId === "goal-1");
check("subagent 自动节点生成（挂在会话当前树）", autoTree !== void 0 && autoTree.nodes.some((n) => n.type === "subagent"));
const subNode = autoTree?.nodes.find((n) => n.type === "subagent");
check("subagent 失败自动结论", subNode !== void 0 && subNode.conclusion === "failed" && subNode.reason.includes("failed: boom"));

// ── 跨会话续接：list / resume ────────────────────────────────────────────────
r = await tool.execute({ action: "list" }, exec);
check("list 列出全部树", r.ok === true && Array.isArray(r.trees) && r.trees.some((t) => t.treeId === "session:session-smoke"), JSON.stringify(r.trees?.length));

const exec2 = { agent: { id: "session-smoke-2", session: { header: { id: "session-smoke-2" } } } };
r = await tool.execute({ action: "resume", treeId: "session:session-smoke" }, exec2);
check("resume 续接旧树", r.ok === true && r.treeId === "session:session-smoke" && Array.isArray(r.nodes) && r.nodes.length > 0);
check("resume 树标记共享", plugin.store.trees.get("session:session-smoke").shared === true);

r = await tool.execute({ action: "start", title: "续接后的新探索" }, exec2);
check("续接后 start 落在旧树", r.ok === true && r.treeId === "session:session-smoke");
const snapResume = plugin.getSnapshot();
const resumedTree = snapResume.trees.find((t) => t.treeId === "session:session-smoke");
check("续接树含新节点（跨会话继续绘制）", resumedTree.nodes.some((n) => n.title === "续接后的新探索"));

// 续接后 goal 事件不覆盖绑定
ctx.emit("goal/changed", {
	agent: exec2.agent,
	change: { operation: "create", ref: { id: "goal-2", revision: 1 }, goal: { id: "goal-2", objective: "新会话的新目标", roundsStarted: 1 } }
});
check("续接后 goal 事件不覆盖树绑定", plugin.store.sessionTree.get("session-smoke-2") === "session:session-smoke");

// ── 自动收尾 ─────────────────────────────────────────────────────────────────
// plan 自动收尾：plan 下所有 decision 结束后 plan 变 ended（不再残留"进行中"）
// 注意：session-smoke 的绑定此刻是 goal-1，显式用 treeId 指回 session 树
r = await tool.execute({ action: "plan-child", treeId: "session:session-smoke", parentId: rootId, title: "收尾测试计划" }, exec);
const settlePlanId = r.nodeId;
r = await tool.execute({ action: "start", treeId: "session:session-smoke", parentId: settlePlanId, title: "收尾测试执行" }, exec);
const settleStepId = r.nodeId;
check("收尾前 plan 为 running", plugin.store.nodeById(plugin.store.trees.get("session:session-smoke"), settlePlanId).status === "running");
r = await tool.execute({ action: "conclude", treeId: "session:session-smoke", nodeId: settleStepId, status: "success" }, exec);
const settleTree = plugin.store.trees.get("session:session-smoke");
check("全部子节点结束后 plan 自动收尾为 ended", plugin.store.nodeById(settleTree, settlePlanId).status === "ended");

// 无 goal 会话 root 自动收尾：新建 newTree 后全 conclude → root 自动收尾
r = await tool.execute({ action: "plan-root", title: "收尾测试主题", newTree: true }, exec);
const settleTreeId = r.treeId;
check("newTree 在同一会话开新树（旧树保留）", settleTreeId !== "session:session-smoke" && plugin.store.trees.has("session:session-smoke"), settleTreeId);
r = await tool.execute({ action: "start", title: "唯一分支" }, exec);
r = await tool.execute({ action: "conclude", nodeId: r.nodeId, status: "success" }, exec);
const settleNewTree = plugin.store.trees.get(settleTreeId);
check("无 goal 会话：全部子节点静止后 root 自动收尾", plugin.store.rootNode(settleNewTree).status === "ended");

// goal 完成 → 整树收尾（先在 goal 树上留一个 running 节点）
ctx.emit("goal/changed", {
	agent: { id: "session-g", session: { header: { id: "session-g" } } },
	change: { operation: "create", ref: { id: "goal-g", revision: 1 }, goal: { id: "goal-g", objective: "goal 收尾测试", roundsStarted: 1 } }
});
r = await tool.execute({ action: "start", title: "goal 收尾分支" }, { agent: { id: "session-g", session: { header: { id: "session-g" } } } });
check("goal 收尾前存在 running 节点", plugin.store.trees.get("goal-g").nodes.some((n) => n.status === "running"));
ctx.emit("goal/changed", {
	agent: { id: "session-g", session: { header: { id: "session-g" } } },
	change: { operation: "complete", ref: { id: "goal-g", revision: 2 }, goal: { id: "goal-g", objective: "goal 收尾测试", roundsStarted: 2 } }
});
const goalGTree = plugin.store.trees.get("goal-g");
check("goal 完成后整树收尾（running 节点全部 ended）", goalGTree.nodes.every((n) => n.status !== "running"), JSON.stringify(goalGTree.nodes.map((n) => n.status)));

// ── subagent 配对持久化 ───────────────────────────────────────────────────────
// 先把会话切回 session 树（绑定此刻是 goal-1）
await tool.execute({ action: "resume", treeId: "session:session-smoke" }, exec);
ctx.emit("agent/created", { agent: { id: "child-p", session: { header: { id: "child-p", parentSession: "session-smoke" } } } });
ctx.emit("subagent/start", { id: "child-p", provider: "spawn", runId: "run-p", local: true });
const settleSubTree = plugin.store.trees.get("session:session-smoke");
const pendingRecBefore = (settleSubTree.pendingSubagents ?? []).find((r) => r.childId === "child-p");
check("subagent 配对记录已持久化到树", pendingRecBefore !== void 0);
const subNodeId = pendingRecBefore?.nodeId;
// 模拟进程重启后内存配对丢失 → 仅靠树的持久化表兜底
plugin.activeSubagent.clear();
ctx.emit("subagent/end", { id: "child-p", provider: "spawn", runId: "run-p", local: true, stopReason: "completed" });
const subP = plugin.store.trees.get("session:session-smoke").nodes.find((n) => n.id === subNodeId);
check("重启后 end 事件经持久化表兜底配对", subP !== void 0 && subP.status === "ended");
check("配对记录已清理", !(plugin.store.trees.get("session:session-smoke").pendingSubagents ?? []).some((r) => r.childId === "child-p"));

// ── 快照内容与持久化 ─────────────────────────────────────────────────────────
snap = plugin.getSnapshot();
check("getSnapshot 返回树数组", Array.isArray(snap.trees) && snap.trees.length >= 2);
// persist 是异步串行链，等它 flush 再检查落盘
await new Promise((resolve) => setTimeout(resolve, 100));
const files = readdirSync(root).filter((f) => f.endsWith(".json"));
check("持久化落盘（每树一文件）", files.length >= 2, files.join(","));

// ── 重新加载（模拟跨会话恢复） ───────────────────────────────────────────────
await fiber.dispose();
delete ctx.stop;
const ctx2 = new Context();
await ctx2.plugin(MockTools);
await ctx2.plugin(MockGoals);
const fiber2 = ctx2.plugin(ResearchTreePlugin, { root });
await fiber2;
const plugin2 = ctx2.get("researchTree");
const snap2 = plugin2.getSnapshot();
check("重启后树完整恢复", snap2.trees.length === snap.trees.length && snap2.trees.some((t) => t.treeId === "goal-1"));

// ── 清理 ────────────────────────────────────────────────────────────────────
await fiber2.dispose();
delete ctx2.stop;

const failed = results.filter(([, ok]) => !ok);
rmSync(root, { recursive: true, force: true });
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
