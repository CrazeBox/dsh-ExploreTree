// research-tree-plugin — Host 半端。
// 职责：
//   1. 注册模型工具 tree_node：计划树、开分支、记结论（成功/失败/放弃/阻塞 + 原因）。
//   2. 订阅 goal / agent / subagent / workflow 事件，自动生成骨架节点。
//   3. 持久化到 <root>/<treeId>.json（原子写），跨会话留存。
//   4. 注册 Typert Remote 服务 researchTree，供 Web 客户端拉取快照。
//
// 遵循约束：只读取事件/服务对象的标量叶子字段；所有副作用随插件生命周期清理；
// 任何内部错误只记日志，不影响宿主运行。
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { defineTool } from "@deepseek-ai/dsh-tools";

const CONCLUSIONS = new Set(["success", "failed", "abandoned", "blocked"]);
const ACTIONS = new Set(["plan-root", "plan-child", "start", "conclude", "annotate", "plan-mark", "list", "resume", "archive", "remove"]);
const RELATIONS = new Set(["on-track", "revised", "added"]);

/** 当前时间 ISO 字符串。 */
function nowIso() {
	return new Date().toISOString();
}

/** 短 id：类型前缀 + 8 位随机。 */
function shortId(prefix) {
	return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** 只取节点的标量叶子字段，返回给模型/客户端（不泄漏内部对象）。 */
function nodeView(node) {
	if (node === null || typeof node !== "object") return null;
	return {
		id: node.id,
		type: node.type,
		parentId: node.parentId ?? null,
		title: node.title ?? "",
		status: node.status ?? "pending",
		conclusion: node.conclusion ?? null,
		reason: node.reason ?? null,
		planRelation: node.planRelation ?? null,
		files: Array.isArray(node.files) ? node.files.slice() : [],
		startedAt: node.startedAt ?? null,
		endedAt: node.endedAt ?? null,
		round: node.round ?? null,
		actor: node.actor ?? "agent",
		anchor: node.anchor ?? null
	};
}

function treeView(tree) {
	return {
		treeId: tree.treeId,
		topic: tree.topic ?? "",
		goalId: tree.goalId ?? null,
		sessionId: tree.sessionId ?? null,
		createdAt: tree.createdAt ?? null,
		updatedAt: tree.updatedAt ?? null,
		currentNodeId: tree.currentNodeId ?? null,
		archived: tree.archived === true,
		nodes: tree.nodes.map(nodeView)
	};
}

/** 内存 + 磁盘的树存储。一个树 = 一个研究主题（goal；无 goal 时按会话）。 */
class TreeStore {
	constructor(rootDir) {
		this.rootDir = rootDir;
		this.trees = new Map(); // treeId -> tree
		this.sessionTree = new Map(); // ownerSessionId -> treeId
		this.writeChain = Promise.resolve();
		try {
			mkdirSync(rootDir, { recursive: true });
		} catch (error) {
			console.error("[research-tree] cannot create store dir", rootDir, String(error));
		}
		this.loadAll();
		this.reconcileAll(); // 启动静态收尾：纠正历史残留的"进行中"
	}

	loadAll() {
		let files = [];
		try {
			files = readdirSync(this.rootDir).filter((name) => name.endsWith(".json"));
		} catch {
			return;
		}
		for (const name of files) {
			try {
				const raw = JSON.parse(readFileSync(join(this.rootDir, name), "utf8"));
				if (raw === null || typeof raw !== "object" || typeof raw.treeId !== "string" || !Array.isArray(raw.nodes)) continue;
				this.trees.set(raw.treeId, raw);
				if (typeof raw.sessionId === "string") this.sessionTree.set(raw.sessionId, raw.treeId);
			} catch (error) {
				console.error("[research-tree] skip unreadable tree file", name, String(error));
			}
		}
	}

	/** 启动静态收尾：修正历史数据里"任务已完成但节点仍进行中"的残留。
	 *  规则与运行时一致：goal 已完结的树整树收尾；否则 plan/root 的直接子节点
	 *  全部静止（含跟随收尾的子代理）时收尾。迭代至稳定。 */
	reconcileAll() {
		for (const tree of this.trees.values()) {
			const root = this.rootNode(tree);
			if (root !== null && root.conclusion !== null) {
				if (this.settleTree(tree)) this.persist(tree);
				continue;
			}
			let modified = false;
			let changed = true;
			while (changed) {
				changed = false;
				for (const node of tree.nodes) {
					if (node.status !== "running" || (node.type !== "plan" && node.type !== "root")) continue;
					const kids = tree.nodes.filter((n) => n.parentId === node.id);
					// 跟随收尾：仍 running 的子代理/工作流/任务子节点一并结束（与运行时一致）
					for (const kid of kids) {
						if (kid.status === "running" && (kid.type === "subagent" || kid.type === "workflow" || kid.type === "job" || kid.type === "skill")) {
							kid.status = "ended";
							kid.endedAt = kid.endedAt ?? nowIso();
							changed = true;
							modified = true;
						}
					}
					if (!kids.every((n) => n.status !== "running")) continue;
					node.status = "ended";
					node.endedAt = node.endedAt ?? nowIso();
					if (node.type === "plan") this.summarizePlan(tree, node);
					changed = true;
					modified = true;
				}
			}
			if (modified) this.persist(tree);
		}
	}

	/** 串行原子写盘；失败只记日志。 */
	persist(tree) {
		// Windows 文件名不允许 : / \ 等字符（session:xxx 这类 treeId 需转义）
		const safeName = tree.treeId.replace(/[<>:"/\\|?*]/g, "_");
		const file = join(this.rootDir, `${safeName}.json`);
		const tmp = `${file}.tmp`;
		this.writeChain = this.writeChain.then(() => {
			writeFileSync(tmp, JSON.stringify(tree, null, 2), "utf8");
			renameSync(tmp, file);
		}).catch((error) => {
			console.error("[research-tree] persist failed", tree.treeId, String(error));
		});
	}

	/** 会话（或其祖先）已有的树；无则 null。 */
	treeForSession(sessionId, goalId = null) {
		if (goalId !== null) {
			const byGoal = this.trees.get(goalId);
			if (byGoal !== void 0) return byGoal;
		}
		const key = this.sessionTree.get(sessionId);
		return key === void 0 ? null : this.trees.get(key) ?? null;
	}

	/** 确保会话存在一棵树（按 goalId / session 键 / keyOverride），并让会话指向它。 */
	ensureTree({ sessionId, goalId = null, topic = "", keyOverride = null, force = false }) {
		const key = keyOverride !== null ? keyOverride : goalId !== null ? goalId : `session:${sessionId}`;
		let tree = this.trees.get(key);
		if (tree === void 0) {
			tree = {
				treeId: key,
				topic: topic || "未命名研究",
				goalId,
				sessionId,
				createdAt: nowIso(),
				updatedAt: nowIso(),
				nodes: [],
				currentNodeId: null,
				timeline: [],
				shared: false,
				pendingSubagents: []
			};
			this.trees.set(key, tree);
		}
		// 会话的当前树跟随最近一次操作；但若会话已 resume 续接到共享树
		// （跨会话继续同一研究），保持绑定不被覆盖（force 用于显式开新树）。
		const bound = this.sessionTree.get(sessionId);
		const boundTree = bound === void 0 ? null : this.trees.get(bound) ?? null;
		if (!force && boundTree !== null && boundTree.shared === true && bound !== key) {
			return boundTree;
		}
		this.sessionTree.set(sessionId, key);
		return tree;
	}

	/** 解析本次操作的目标树：显式 treeId > 会话续接绑定 > goal 树 > 会话树。 */
	resolveTree({ sessionId, goalId = null, treeIdArg = null, topic = "" }) {
		if (treeIdArg !== null && treeIdArg !== "") {
			const explicit = this.trees.get(String(treeIdArg));
			if (explicit !== void 0) {
				this.sessionTree.set(sessionId, explicit.treeId);
				return explicit;
			}
			return null; // 显式指定但不存在 → 报错
		}
		const bound = this.sessionTree.get(sessionId);
		if (bound !== void 0) {
			const boundTree = this.trees.get(bound);
			if (boundTree !== void 0) return boundTree;
		}
		return this.ensureTree({ sessionId, goalId, topic });
	}

	/** 把会话续接到一棵已有树（跨会话继续同一研究）。 */
	resumeTree({ sessionId, treeId, parentId = null }) {
		const tree = this.trees.get(String(treeId));
		if (tree === void 0) return { ok: false, error: `tree not found: ${String(treeId)}` };
		if (parentId !== null) {
			const parent = this.nodeById(tree, String(parentId));
			if (parent === null) return { ok: false, error: `parent node not found: ${String(parentId)}` };
			tree.currentNodeId = parent.id;
		}
		tree.shared = true;
		this.sessionTree.set(sessionId, tree.treeId);
		this.persist(tree);
		return {
			ok: true,
			treeId: tree.treeId,
			topic: tree.topic,
			currentNodeId: tree.currentNodeId,
			nodes: tree.nodes.map((n) => ({
				id: n.id,
				type: n.type,
				title: n.title,
				status: n.status,
				conclusion: n.conclusion
			}))
		};
	}

	/** 列出全部树（供续接检索）。 */
	listTrees() {
		return [...this.trees.values()]
			.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
			.map((t) => ({
				treeId: t.treeId,
				topic: t.topic,
				goalId: t.goalId,
				sessionId: t.sessionId,
				updatedAt: t.updatedAt,
				nodeCount: t.nodes.length,
				currentNodeId: t.currentNodeId,
				archived: t.archived === true
			}));
	}

	/** 归档/恢复一棵树（数据保留，仅标记；面板分组显示）。 */
	archiveTree(treeId, archived) {
		const tree = this.trees.get(String(treeId));
		if (tree === void 0) return { ok: false, error: `tree not found: ${String(treeId)}` };
		tree.archived = archived === true;
		this.touch(tree);
		this.persist(tree);
		return { ok: true, treeId: tree.treeId, archived: tree.archived };
	}

	/** 永久删除一棵树（内存 + 文件 + 所有会话绑定清理）。 */
	removeTree(treeId) {
		const id = String(treeId);
		const tree = this.trees.get(id);
		if (tree === void 0) return { ok: false, error: `tree not found: ${id}` };
		this.trees.delete(id);
		for (const [sessionKey, boundTreeId] of this.sessionTree) {
			if (boundTreeId === id) this.sessionTree.delete(sessionKey);
		}
		// 软删除必须排在写链末尾：先让队列里未完成的写入落盘，再移走文件
		// （否则排队中的 persist 会把已删除的树重新写回磁盘）
		const safeName = id.replace(/[<>:"/\\|?*]/g, "_");
		const file = join(this.rootDir, `${safeName}.json`);
		this.writeChain = this.writeChain.then(() => {
			try {
				renameSync(file, `${file}.deleted-${Date.now()}`);
			} catch {
				/* 文件不存在等：忽略 */
			}
		}).catch((error) => {
			console.error("[research-tree] remove failed", id, String(error));
		});
		return { ok: true, treeId: id };
	}

	/** 解析自动挂载父节点：当前节点是已结束的决策节点时挂回其父级
	 *  （避免"完成一个任务 → 新任务链式挂它下面"形成的线性长链）。 */
	attachParent(tree) {
		let parent = tree.currentNodeId === null ? null : this.nodeById(tree, tree.currentNodeId);
		if (parent !== null && parent.type === "decision" && parent.status === "ended" && parent.parentId !== null) {
			parent = this.nodeById(tree, parent.parentId) ?? parent;
		}
		if (parent === null) parent = this.rootNode(tree);
		return parent;
	}

	/** 计划节点自动汇总结论：统计直接 decision 子节点的结论，写入 plan.reason。
	 *  让完成的计划有信息量（如"子任务完成：2 成功、1 失败"）。 */
	summarizePlan(tree, planNode) {
		if (planNode.type !== "plan") return;
		const kids = tree.nodes.filter((n) => n.parentId === planNode.id && n.type === "decision");
		if (kids.length === 0) {
			planNode.reason = null;
			return;
		}
		const counts = { success: 0, failed: 0, abandoned: 0, blocked: 0, none: 0 };
		for (const kid of kids) {
			if (kid.conclusion !== null && kid.conclusion in counts) counts[kid.conclusion]++;
			else counts.none++;
		}
		const parts = [];
		if (counts.success > 0) parts.push(`${counts.success} 成功`);
		if (counts.failed > 0) parts.push(`${counts.failed} 失败`);
		if (counts.abandoned > 0) parts.push(`${counts.abandoned} 放弃`);
		if (counts.blocked > 0) parts.push(`${counts.blocked} 阻塞`);
		if (counts.none > 0) parts.push(`${counts.none} 未标注`);
		planNode.reason = parts.length > 0 ? `子任务完成：${parts.join("、")}` : null;
	}

	/** 沿父链自动收尾：plan/root 的全部子节点静止（非 running）时收尾；
	 *  顺带把仍 running 的子代理/工作流子节点一并结束（跟随父收尾）。 */
	settleAncestors(tree, fromNode) {
		let cursor = fromNode.parentId ?? null;
		while (cursor !== null) {
			const parent = this.nodeById(tree, cursor);
			if (parent === null) break;
			if (parent.type !== "plan" && parent.type !== "root") break;
			const kids = tree.nodes.filter((n) => n.parentId === parent.id);
			for (const kid of kids) {
				if (kid.status === "running" && (kid.type === "subagent" || kid.type === "workflow" || kid.type === "job" || kid.type === "skill")) {
					kid.status = "ended";
					kid.endedAt = kid.endedAt ?? nowIso();
				}
			}
			if (!kids.every((n) => n.status !== "running")) break;
			if (parent.status === "running") {
				parent.status = "ended";
				parent.endedAt = parent.endedAt ?? nowIso();
				if (parent.type === "plan") this.summarizePlan(tree, parent);
				this.touch(tree);
			}
			cursor = parent.parentId ?? null;
		}
	}

	/** 整树收尾（goal 完成/阻塞时）：所有 running 节点 → ended；计划节点生成汇总。 */
	settleTree(tree) {
		let changed = false;
		for (const node of tree.nodes) {
			if (node.status === "running") {
				node.status = "ended";
				node.endedAt = node.endedAt ?? nowIso();
				changed = true;
			}
		}
		if (changed) {
			for (const node of tree.nodes) {
				if (node.type === "plan") this.summarizePlan(tree, node);
			}
			this.touch(tree);
		}
		return changed;
	}

	/** 按子代理 childId 在全部树的持久化待配对表里查找。 */
	findPendingSubagent(childId) {
		for (const tree of this.trees.values()) {
			const records = Array.isArray(tree.pendingSubagents) ? tree.pendingSubagents : [];
			const record = records.find((r) => r.childId === childId);
			if (record !== void 0) return { tree, record };
		}
		return null;
	}

	rootNode(tree) {
		return tree.nodes.find((node) => node.parentId === null) ?? null;
	}

	nodeById(tree, id) {
		return tree.nodes.find((node) => node.id === id) ?? null;
	}

	addNode(tree, node) {
		tree.nodes.push(node);
		tree.updatedAt = nowIso();
		tree.timeline.push({ ts: nowIso(), event: `node-${node.type}`, nodeId: node.id });
	}

	touch(tree) {
		tree.updatedAt = nowIso();
	}
}

/** 插件本体：既是 Service（注册 researchTree Remote），也是插件 apply 载体。 */
class ResearchTreePlugin extends TypertRemoteService {
	static inject = ["tools", "goals"];

	constructor(ctx, config = {}) {
		super(ctx, "researchTree");
		const cfg = typeof config === "object" && config !== null ? config : {};
		const rootDir = typeof cfg.root === "string" && cfg.root.length > 0
			? cfg.root
			: join(process.cwd(), "research-vault", "trees");
		this.store = new TreeStore(rootDir);
		this.parents = new Map(); // childSessionId -> parentSessionId | null
		this.activeSubagent = new Map(); // childSessionId -> { treeId, nodeId }
		this.activeWorkflow = new Map(); // workflowId -> { treeId, nodeId }
		this.recentSessionId = null; // 最近见过且有树的会话（workflow 事件无会话，尽力归属）
		this.log = (error) => {
			try {
				ctx.logger?.warn(`[research-tree] ${String(error)}`);
			} catch {
				/* 日志失败不影响主流程 */
			}
		};
		this.installTool(ctx);
		this.subscribe(ctx);
		this.markRemote("getSnapshot");
		this.markRemote("annotateNode");
		this.markRemote("archiveTree");
		this.markRemote("removeTree");
	}

	/** 等价于装饰器 @Remote(name)：把方法标成 Remote 端点（原型表）。 */
	markRemote(method, exportName = method) {
		const decorate = Remote(exportName);
		decorate(null, {
			kind: "method",
			name: method,
			private: false,
			static: false,
			addInitializer: (fn) => {
				fn.call(this);
			}
		});
	}

	// ── Remote 方法 ───────────────────────────────────────────────────────────

	/** Web 端快照：全部树（按更新时间倒序），节点为标量视图。 */
	getSnapshot() {
		const trees = [...this.store.trees.values()]
			.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
			.map(treeView);
		return { trees, storeRoot: this.store.rootDir };
	}

	/** 用户手动补充/修正一个节点的结论或原因（网关 SRC 契约：方法参数名 = 请求字段名）。 */
	annotateNode(treeId, nodeId, conclusion, reason) {
		const tree = this.store.trees.get(String(treeId ?? ""));
		if (tree === void 0) return { ok: false, error: `tree not found: ${String(treeId)}` };
		const node = this.store.nodeById(tree, String(nodeId ?? ""));
		if (node === null) return { ok: false, error: `node not found: ${String(nodeId)}` };
		if (conclusion !== void 0 && conclusion !== null) {
			if (!CONCLUSIONS.has(String(conclusion))) return { ok: false, error: `invalid conclusion: ${String(conclusion)}` };
			node.conclusion = String(conclusion);
			if (reason !== void 0) node.reason = String(reason ?? "");
			node.endedAt = node.endedAt ?? nowIso();
			node.status = "ended";
		} else if (typeof reason === "string") {
			node.reason = reason;
		}
		this.store.touch(tree);
		this.store.persist(tree);
		return { ok: true, node: nodeView(node) };
	}

	/** 面板操作：归档/恢复一棵树（网关 SRC 契约：方法参数名 = 请求字段名）。 */
	archiveTree(treeId, archived) {
		return this.store.archiveTree(String(treeId ?? ""), archived === true);
	}

	/** 面板操作：永久删除一棵树。 */
	removeTree(treeId) {
		return this.store.removeTree(String(treeId ?? ""));
	}

	// ── tree_node 工具 ─────────────────────────────────────────────────────────

	installTool(ctx) {
		ctx.tools.register(defineTool({
			name: "tree_node",
			description: [
				"维护「研究进度树」：把长期探究过程可视化成树（计划分支 → 实际推进 → 结论）。",
				"一个研究主题一棵树（根 = 当前 goal；无 goal 时按会话）。",
				"用法：",
				"1. 研究开始时 plan-root（建根）+ plan-child（画预期分支树，先计划后对照）；",
				"2. 开始探索一个分支用 start（自动成为当前节点，子代理/后台任务会自动挂到当前节点下）；",
				"3. 分支结束用 conclude 记录结论（success/failed/abandoned/blocked + 原因，尽量写清失败原因）；",
				"4. 计划偏离用 plan-mark 标 relation=revised 或 added；",
				"5. annotate 补充原因或产出文件；",
				"6. 中途补建：会话进行到一半也可以随时 plan-root 建树，并把已做的工作",
				"   用 plan-child/start/conclude 补记成节点（树从创建时刻开始记录，无需复现对话）。",
				"7. 跨会话续接：上下文不够开了新对话继续同一研究时，先 list 找到旧树",
				"   （按主题/更新时间辨认），再 resume treeId=旧树id [parentId=挂载节点]；",
				"   之后本会话所有操作（含子代理自动节点）都继续画在旧树上。",
				"8. 转换研究主题：中途不想研究当前主题时，用 plan-root title=新主题 newTree=true",
				"   在同一会话开一棵新树（旧树保留，面板下拉可随时切回查看/继续）。",
				"纪律：并行推进多个分支时，start/plan-child 必须显式传 parentId 指定挂载分支；",
				"start 时给具体标题（如“尝试方法X”），不要与计划分支标题重复。",
				"每次调用返回树 id 与节点 id，供后续操作引用。"
			].join("\n"),
			parameters: {
				action: {
					type: "string",
					required: true,
					enum: [...ACTIONS],
					description: "操作：plan-root 建根(主题)；plan-child 加计划分支；start 开实际分支；conclude 记结论；annotate 补充说明；plan-mark 标记计划对照；list 列出全部树（续接检索用）；resume 把当前会话续接到已有树（新会话继续同一研究时用）；archive 归档/恢复一棵树（archived=true 归档，数据保留）；remove 永久删除一棵树（不可恢复，谨慎）。"
				},
				title: {
					type: "string",
					description: "节点标题（plan-root / plan-child / start 必填）。"
				},
				parentId: {
					type: "string",
					description: "父节点 id（plan-child / start / resume；省略时挂到当前节点下）。"
				},
				treeId: {
					type: "string",
					description: "目标树 id（resume / archive / remove 必填；其他操作可选：显式指定本次操作作用在哪棵树）。"
				},
				archived: {
					type: "boolean",
					description: "archive 专用：true=归档（折叠隐藏，数据保留），false=恢复。"
				},
				newTree: {
					type: "boolean",
					description: "plan-root 专用：true 时在同一会话开一棵新树（转换研究主题时用，旧树保留，面板下拉可随时切回）。"
				},
				nodeId: {
					type: "string",
					description: "目标节点 id（conclude / annotate / plan-mark 必填）。"
				},
				status: {
					type: "string",
					enum: [...CONCLUSIONS],
					description: "conclude 的结论：success 成功 / failed 失败 / abandoned 放弃 / blocked 阻塞。"
				},
				reason: {
					type: "string",
					description: "结论原因（conclude / annotate）。"
				},
				files: {
					type: "array",
					items: { type: "string" },
					description: "关联产出文件路径列表（conclude / annotate）。"
				},
				relation: {
					type: "string",
					enum: [...RELATIONS],
					description: "计划对照：on-track 按计划 / revised 已修正 / added 计划外新增（plan-mark）。"
				}
			},
			output: {
				schema: { type: "json" },
				render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]
			},
			execute: (args, exec) => this.handleTool(ctx, args, exec)
		}));
	}

	handleTool(ctx, args, exec) {
		if (exec === null || typeof exec !== "object" || exec.agent === void 0) {
			return { ok: false, error: "tree_node 需要 agent 会话上下文" };
		}
		const agent = exec.agent;
		const sessionId = String(agent.session?.header?.id ?? agent.id ?? "");
		if (sessionId === "") return { ok: false, error: "无法确定会话 id" };
		let goal = null;
		try {
			goal = ctx.goals?.get?.(agent) ?? null;
		} catch {
			goal = null;
		}
		const goalId = goal?.id ?? null;
		this.recentSessionId = sessionId;
		const action = String(args?.action ?? "");
		if (!ACTIONS.has(action)) return { ok: false, error: `unknown action: ${action}` };

		let tree;
		const treeIdArg = typeof args?.treeId === "string" && args.treeId !== "" ? args.treeId : null;
		try {
			// list / resume 不依赖目标树解析
			if (action === "list") {
				return { ok: true, trees: this.store.listTrees() };
			}
			if (action === "resume") {
				if (treeIdArg === null) return { ok: false, error: "resume 需要 treeId（先用 list 找到目标树）" };
				return this.store.resumeTree({ sessionId, treeId: treeIdArg, parentId: args?.parentId ?? null });
			}
			if (action === "archive") {
				if (treeIdArg === null) return { ok: false, error: "archive 需要 treeId" };
				return this.store.archiveTree(treeIdArg, args.archived === true);
			}
			if (action === "remove") {
				if (treeIdArg === null) return { ok: false, error: "remove 需要 treeId" };
				return this.store.removeTree(treeIdArg);
			}
			switch (action) {
				case "plan-root": {
					// newTree=true：同一会话开一棵新树（转换研究主题时用，旧树保留可切回）
					if (args.newTree === true) {
						const count = [...this.store.trees.values()].filter((t) => t.sessionId === sessionId).length;
						tree = this.store.ensureTree({
							sessionId,
							goalId: null,
							keyOverride: `session:${sessionId}#${count + 1}`,
							force: true,
							topic: typeof args.title === "string" && args.title.trim() !== "" ? args.title.trim() : "新研究主题"
						});
						// 独立树：绑定稳定（后续 goal 事件不把它拉回旧树；resume 续接同样适用）
						if (tree.shared !== true) {
							tree.shared = true;
							this.store.persist(tree);
						}
					} else {
						tree = this.store.resolveTree({
							sessionId,
							goalId,
							treeIdArg,
							topic: typeof args.title === "string" && args.title.trim() !== "" ? args.title.trim() : goal?.objective ?? ""
						});
					}
					if (tree === null) return { ok: false, error: `tree not found: ${treeIdArg}` };
					let root = this.store.rootNode(tree);
					if (root === null) {
						root = {
							id: shortId("root"),
							type: "root",
							parentId: null,
							title: tree.topic,
							status: "pending",
							conclusion: null,
							reason: null,
							planRelation: null,
							files: [],
							startedAt: nowIso(),
							endedAt: null,
							round: goal?.roundsStarted ?? null,
							actor: "agent",
							anchor: { sessionId, ts: nowIso() }
						};
						this.store.addNode(tree, root);
					} else if (typeof args.title === "string" && args.title.trim() !== "") {
						root.title = args.title.trim();
					}
					tree.currentNodeId = root.id;
					this.store.persist(tree);
					return { ok: true, treeId: tree.treeId, nodeId: root.id, currentNodeId: tree.currentNodeId, node: nodeView(root) };
				}
				case "plan-child": {
					tree = this.store.resolveTree({ sessionId, goalId, treeIdArg, topic: goal?.objective ?? "" });
					if (tree === null) return { ok: false, error: `tree not found: ${treeIdArg}` };
					const parentId = String(args.parentId ?? tree.currentNodeId ?? "");
					const parent = parentId === "" ? this.store.rootNode(tree) : this.store.nodeById(tree, parentId);
					if (parent === null) return { ok: false, error: `parent node not found: ${parentId}` };
					const title = typeof args.title === "string" ? args.title.trim() : "";
					if (title === "") return { ok: false, error: "title 必填" };
					const node = {
						id: shortId("plan"),
						type: "plan",
						parentId: parent.id,
						title,
						status: "pending",
						conclusion: null,
						reason: null,
						planRelation: "on-track",
						files: [],
						startedAt: null,
						endedAt: null,
						round: goal?.roundsStarted ?? null,
						actor: "agent",
						anchor: { sessionId, ts: nowIso() }
					};
					this.store.addNode(tree, node);
					this.store.persist(tree);
					return { ok: true, treeId: tree.treeId, nodeId: node.id, currentNodeId: tree.currentNodeId, node: nodeView(node) };
				}
				case "start": {
					tree = this.store.resolveTree({ sessionId, goalId, treeIdArg, topic: goal?.objective ?? "" });
					if (tree === null) return { ok: false, error: `tree not found: ${treeIdArg}` };
					const explicitParent = typeof args.parentId === "string" && args.parentId !== "";
					const parent = explicitParent
						? this.store.nodeById(tree, String(args.parentId))
						: this.store.attachParent(tree);
					if (parent === null) return { ok: false, error: `parent node not found: ${String(args.parentId)}` };
					const title = typeof args.title === "string" && args.title.trim() !== "" ? args.title.trim() : parent.type === "plan" ? `探索：${parent.title}` : "探索分支";
					const node = {
						id: shortId("step"),
						type: "decision",
						parentId: parent.id,
						title,
						status: "running",
						conclusion: null,
						reason: null,
						planRelation: parent.type === "plan" ? "on-track" : null,
						files: [],
						startedAt: nowIso(),
						endedAt: null,
						round: goal?.roundsStarted ?? null,
						actor: "agent",
						anchor: { sessionId, ts: nowIso() }
					};
					this.store.addNode(tree, node);
					if (parent.status === "pending") parent.status = "running";
					tree.currentNodeId = node.id;
					this.store.persist(tree);
					return { ok: true, treeId: tree.treeId, nodeId: node.id, currentNodeId: tree.currentNodeId, node: nodeView(node) };
				}
				case "conclude": {
					tree = this.store.resolveTree({ sessionId, goalId, treeIdArg, topic: goal?.objective ?? "" });
					if (tree === null) return { ok: false, error: `tree not found: ${treeIdArg}` };
					const node = this.store.nodeById(tree, String(args.nodeId ?? ""));
					if (node === null) return { ok: false, error: `node not found: ${String(args.nodeId)}` };
					const status = String(args.status ?? "");
					if (!CONCLUSIONS.has(status)) return { ok: false, error: `conclude 需要 status ∈ ${[...CONCLUSIONS].join("/")}` };
					node.conclusion = status;
					node.reason = typeof args.reason === "string" ? args.reason : node.reason ?? null;
					if (Array.isArray(args.files)) node.files = args.files.map(String).filter((item) => item.length > 0);
					node.status = "ended";
					node.endedAt = node.endedAt ?? nowIso();
					this.store.touch(tree);
					tree.timeline.push({ ts: nowIso(), event: "node-concluded", nodeId: node.id });
					// 自动收尾父链：plan/root 的全部子节点静止后自动结束（不再残留"进行中"）
					this.store.settleAncestors(tree, node);
					this.store.persist(tree);
					return { ok: true, treeId: tree.treeId, nodeId: node.id, currentNodeId: tree.currentNodeId, node: nodeView(node) };
				}
				case "annotate": {
					tree = this.store.resolveTree({ sessionId, goalId, treeIdArg, topic: goal?.objective ?? "" });
					if (tree === null) return { ok: false, error: `tree not found: ${treeIdArg}` };
					const node = this.store.nodeById(tree, String(args.nodeId ?? ""));
					if (node === null) return { ok: false, error: `node not found: ${String(args.nodeId)}` };
					if (typeof args.title === "string" && args.title.trim() !== "") node.title = args.title.trim();
					if (typeof args.reason === "string") node.reason = args.reason;
					if (Array.isArray(args.files)) node.files = args.files.map(String).filter((item) => item.length > 0);
					this.store.touch(tree);
					this.store.persist(tree);
					return { ok: true, treeId: tree.treeId, nodeId: node.id, currentNodeId: tree.currentNodeId, node: nodeView(node) };
				}
				case "plan-mark": {
					tree = this.store.resolveTree({ sessionId, goalId, treeIdArg, topic: goal?.objective ?? "" });
					if (tree === null) return { ok: false, error: `tree not found: ${treeIdArg}` };
					const node = this.store.nodeById(tree, String(args.nodeId ?? ""));
					if (node === null) return { ok: false, error: `node not found: ${String(args.nodeId)}` };
					const relation = String(args.relation ?? "");
					if (!RELATIONS.has(relation)) return { ok: false, error: `plan-mark 需要 relation ∈ ${[...RELATIONS].join("/")}` };
					node.planRelation = relation;
					if (relation === "revised" && typeof args.title === "string" && args.title.trim() !== "") node.title = args.title.trim();
					this.store.touch(tree);
					this.store.persist(tree);
					return { ok: true, treeId: tree.treeId, nodeId: node.id, currentNodeId: tree.currentNodeId, node: nodeView(node) };
				}
				default:
					return { ok: false, error: `unknown action: ${action}` };
			}
		} catch (error) {
			this.log(error);
			return { ok: false, error: `tree_node 内部错误: ${String(error)}` };
		}
	}

	// ── 事件订阅（自动骨架） ───────────────────────────────────────────────────

	/** 沿 parent 链找到第一个拥有树的会话；找不到返回 null。 */
	ownerSession(childSessionId) {
		let cursor = childSessionId;
		const seen = new Set();
		while (cursor !== null && cursor !== void 0 && !seen.has(cursor)) {
			seen.add(cursor);
			if (this.store.treeForSession(cursor) !== null) return cursor;
			cursor = this.parents.get(cursor) ?? null;
		}
		return null;
	}

	subscribe(ctx) {
		// goal 生命周期 → 树的根节点
		ctx.on("goal/changed", (payload) => {
			try {
				const agent = payload?.agent;
				if (agent === void 0) return;
				const sessionId = String(agent.session?.header?.id ?? agent.id ?? "");
				const change = payload.change;
				if (change === void 0) return;
				// 会话已 resume 续接到共享树（跨会话继续同一研究）→ goal 事件不再影响续接树
				const bound = this.store.sessionTree.get(sessionId);
				const boundTree = bound === void 0 ? null : this.store.trees.get(bound) ?? null;
				if (boundTree !== null && boundTree.shared === true) return;
				this.recentSessionId = sessionId;
				const goal = change.goal ?? null;
				const tree = this.store.ensureTree({
					sessionId,
					goalId: change.ref?.id ?? null,
					topic: goal?.objective ?? ""
				});
				let root = this.store.rootNode(tree);
				if (root === null) {
					root = {
						id: shortId("root"),
						type: "root",
						parentId: null,
						title: tree.topic,
						status: "pending",
						conclusion: null,
						reason: null,
						planRelation: null,
						files: [],
						startedAt: nowIso(),
						endedAt: null,
						round: goal?.roundsStarted ?? null,
						actor: "auto",
						anchor: { sessionId, ts: nowIso() }
					};
					this.store.addNode(tree, root);
				}
				if (goal !== null && typeof goal.objective === "string" && goal.objective.length > 0) root.title = goal.objective;
				root.round = goal?.roundsStarted ?? root.round ?? null;
				if (change.operation === "complete") {
					root.conclusion = "success";
					root.reason = "目标完成";
					root.status = "ended";
					root.endedAt = root.endedAt ?? nowIso();
					// 目标完成 → 整树收尾：残留的"进行中"节点一并结束
					this.store.settleTree(tree);
				} else if (change.operation === "block") {
					root.conclusion = "blocked";
					root.reason = goal?.blockedReason?.message ?? "目标阻塞";
					root.status = "ended";
					root.endedAt = root.endedAt ?? nowIso();
					this.store.settleTree(tree);
				} else if (change.operation === "pause") {
					root.status = "pending";
				} else if (change.operation === "resume") {
					root.status = "running";
					root.startedAt = root.startedAt ?? nowIso();
				} else if (root.status === "pending" && (change.operation === "create" || change.operation === "edit")) {
					root.status = "running";
					root.startedAt = root.startedAt ?? nowIso();
				}
				if (tree.currentNodeId === null || this.store.nodeById(tree, tree.currentNodeId) === null) {
					tree.currentNodeId = root.id;
				}
				this.store.persist(tree);
			} catch (error) {
				this.log(error);
			}
		});

		// agent 发布 → 记录会话父子链（供子代理归属）
		ctx.on("agent/created", (payload) => {
			try {
				const agent = payload?.agent;
				const header = agent?.session?.header;
				if (header === void 0) return;
				this.parents.set(String(header.id), header.parentSession === void 0 ? null : String(header.parentSession));
			} catch (error) {
				this.log(error);
			}
		});

		// 子代理启动 → 自动节点，挂到所在树当前节点下
		ctx.on("subagent/start", (info) => {
			try {
				const childId = String(info?.id ?? "");
				if (childId === "") return;
				const owner = this.ownerSession(childId);
				const tree = owner === null ? null : this.store.treeForSession(owner);
				if (tree === null) return;
				const parent = this.store.attachParent(tree);
				const parentId = parent === null ? null : parent.id;
				const node = {
					id: shortId("sub"),
					type: "subagent",
					parentId,
					title: `子代理：${String(info.provider ?? "?")}`,
					status: "running",
					conclusion: null,
					reason: null,
					planRelation: null,
					files: [],
					startedAt: nowIso(),
					endedAt: null,
					round: null,
					actor: "auto",
					anchor: { sessionId: owner, ts: nowIso() }
				};
				this.store.addNode(tree, node);
				// 配对记录持久化到树里（重启后 end 事件仍能对上号）
				if (!Array.isArray(tree.pendingSubagents)) tree.pendingSubagents = [];
				tree.pendingSubagents.push({ childId, nodeId: node.id });
				this.store.persist(tree);
				this.activeSubagent.set(childId, { treeId: tree.treeId, nodeId: node.id });
			} catch (error) {
				this.log(error);
			}
		});

		// 子代理结束 → 自动状态 + 机器失败结论
		ctx.on("subagent/end", (info) => {
			try {
				const childId = String(info?.id ?? "");
				let record = this.activeSubagent.get(childId);
				let pending = null;
				if (record === void 0) {
					// 内存配对丢失（如进程重启）→ 从树的持久化配对表兜底
					const found = this.store.findPendingSubagent(childId);
					if (found !== null) {
						record = { treeId: found.tree.treeId, nodeId: found.record.nodeId };
						pending = found;
					}
				}
				if (record === void 0) return;
				const tree = this.store.trees.get(record.treeId);
				const node = tree === void 0 ? null : this.store.nodeById(tree, record.nodeId);
				if (node !== null) {
					node.status = "ended";
					node.endedAt = node.endedAt ?? nowIso();
					const stop = String(info?.stopReason ?? "");
					if (/fail|error/.test(stop)) {
						node.conclusion = "failed";
						node.reason = `子代理失败：${stop}`;
					} else if (/cancel|kill|abort|interrupt/.test(stop)) {
						node.conclusion = "abandoned";
						node.reason = `子代理中止：${stop}`;
					}
					this.store.touch(tree);
					// 收尾父链（子代理结束后，父 plan/root 可能自动收尾）
					this.store.settleAncestors(tree, node);
					this.store.persist(tree);
				}
				this.activeSubagent.delete(childId);
				if (pending !== null && Array.isArray(pending.tree.pendingSubagents)) {
					pending.tree.pendingSubagents = pending.tree.pendingSubagents.filter((r) => r.childId !== childId);
					this.store.persist(pending.tree);
				}
			} catch (error) {
				this.log(error);
			}
		});

		// 工作流 → 自动节点（事件不带会话，按最近见过树的会话尽力归属）
		ctx.on("workflow/start", (info) => {
			try {
				const runId = String(info?.id ?? "");
				if (runId === "") return;
				const owner = this.recentSessionId === null ? null : this.ownerSession(this.recentSessionId);
				// workflow 事件不带会话；只在有可归属会话时记录（尽力而为）
				const tree = owner === null ? null : this.store.treeForSession(owner);
				if (tree === null) return;
				const parent = this.store.attachParent(tree);
				const parentId = parent === null ? null : parent.id;
				const node = {
					id: shortId("wf"),
					type: "workflow",
					parentId,
					title: `工作流：${String(info.meta?.name ?? "?")}`,
					status: "running",
					conclusion: null,
					reason: null,
					planRelation: null,
					files: [],
					startedAt: nowIso(),
					endedAt: null,
					round: null,
					actor: "auto",
					anchor: { sessionId: owner, ts: nowIso() }
				};
				this.store.addNode(tree, node);
				this.store.persist(tree);
				this.activeWorkflow.set(runId, { treeId: tree.treeId, nodeId: node.id });
			} catch (error) {
				this.log(error);
			}
		});

		ctx.on("workflow/end", (info) => {
			try {
				const runId = String(info?.id ?? "");
				const record = this.activeWorkflow.get(runId);
				if (record === void 0) return;
				const tree = this.store.trees.get(record.treeId);
				const node = tree === void 0 ? null : this.store.nodeById(tree, record.nodeId);
				if (node !== null) {
					node.status = "ended";
					node.endedAt = node.endedAt ?? nowIso();
					if (info?.result?.error !== void 0) {
						node.conclusion = "failed";
						node.reason = `工作流失败：${String(info.result.error)}`;
					}
					this.store.touch(tree);
					this.store.persist(tree);
				}
				this.activeWorkflow.delete(runId);
			} catch (error) {
				this.log(error);
			}
		});
	}
}

export { ResearchTreePlugin, ResearchTreePlugin as default };
