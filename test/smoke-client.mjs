// research-tree-plugin Client 半端冒烟测试（Node 环境）：
// 1. 工厂可正常物化（fake require + window.__ModuleLoader__）；
// 2. 布局算法：根在左、父节点垂直居中于子节点、折叠生效、画布尺寸正确；
// 3. 状态颜色映射、副标题、截断函数。
import { readFileSync } from "node:fs";

globalThis.window = { __ModuleLoader__: { load() {} } };
globalThis.document = void 0; // 工厂里有 typeof document 守卫

// fake require：react / react/jsx-runtime 返回桩（物化阶段只取值，不调用）
const reactStub = {
	useState: () => [],
	useEffect: () => {},
	useMemo: (fn) => fn(),
	useRef: () => ({ current: null }),
	useSyncExternalStore: () => null
};
const jsxStub = { jsx: () => null, jsxs: () => null, Fragment: Symbol("Fragment") };
const fakeRequire = (spec) => {
	if (spec === "react") return reactStub;
	if (spec === "react/jsx-runtime") return jsxStub;
	throw new Error(`unexpected require: ${spec}`);
};

const results = [];
function check(name, cond, extra = "") {
	results.push([name, cond]);
	console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
}

// 把工厂的 `return module.exports` 改为同时暴露到全局，从而拿到 exports；
// 再手动物化工厂（等价于客户端模块系统的 materialize）。
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const patched = source.replace(
	"return module.exports;",
	"globalThis.__RT_EXPORTS__ = module.exports; return module.exports;"
);
let registered = null;
globalThis.window = {
	__ModuleLoader__: {
		load(handoff) {
			registered = handoff;
		}
	}
};
globalThis.__RT_EXPORTS__ = null;
eval(patched);
check("工厂已注册", registered !== null && typeof registered.factory === "function");
if (registered !== null) registered.factory(fakeRequire);

const api = globalThis.__RT_EXPORTS__;
check("工厂物化成功并导出", api !== null && typeof api === "object", api === null ? "exports 缺失" : "ok");
check("inject = slots + connection + sessions（无 remote.researchTree）", Array.isArray(api?.inject) && api.inject.length === 3 && api.inject.includes("slots") && api.inject.includes("connection") && api.inject.includes("sessions"), JSON.stringify(api?.inject));
check("apply 已导出", typeof api?.apply === "function");
const D = api.__debug;
check("debug 导出（布局/连线/状态）", D !== void 0 && typeof D.computeLayout === "function" && typeof D.edgePath === "function" && typeof D.nodeState === "function");

// ── 布局算法 ─────────────────────────────────────────────────────────────────
const nodes = [
	{ id: "root-1", type: "root", parentId: null, title: "研究主题", status: "running", conclusion: null, reason: null, planRelation: null },
	{ id: "plan-1", type: "plan", parentId: "root-1", title: "方向A", status: "pending", conclusion: null, reason: null, planRelation: "on-track" },
	{ id: "plan-2", type: "plan", parentId: "root-1", title: "方向B", status: "pending", conclusion: null, reason: null, planRelation: "added" },
	{ id: "step-1", type: "decision", parentId: "plan-1", title: "尝试方法X", status: "ended", conclusion: "failed", reason: "收敛性差", planRelation: null },
	{ id: "step-2", type: "decision", parentId: "plan-2", title: "尝试方法Y", status: "running", conclusion: null, reason: null, planRelation: null }
];

const layout = D.computeLayout(nodes, new Set());
const pos = layout.pos;
check("全部节点有布局", nodes.every((n) => pos.has(n.id)));
check("根在最左（x 最小）", Math.min(...nodes.map((n) => pos.get(n.id).x)) === pos.get("root-1").x);
check("父节点垂直居中于子节点", (() => {
	const rootY = pos.get("root-1").y;
	const ys = [pos.get("plan-1").y, pos.get("plan-2").y];
	return Math.abs(rootY - (ys[0] + ys[1]) / 2) < 0.001;
})());
check("画布尺寸容纳层级", layout.width > 300 && layout.height > 100, `w=${layout.width} h=${layout.height}`);

const collapsedLayout = D.computeLayout(nodes, new Set(["plan-1"]));
check("折叠后子节点不再布局", !collapsedLayout.pos.has("step-1") && collapsedLayout.pos.has("step-2"));

// 竖向布局：根在顶（y 最小），深度方向向下
const vLayout = D.computeLayout(nodes, new Set(), "v");
check("竖向布局：根在最顶（y 最小）", Math.min(...nodes.map((n) => vLayout.pos.get(n.id).y)) === vLayout.pos.get("root-1").y);
check("竖向布局：子节点在父下方", vLayout.pos.get("plan-1").y > vLayout.pos.get("root-1").y);
check("竖向布局：父节点水平居中于子节点", (() => {
	const rootX = vLayout.pos.get("root-1").x + vLayout.pos.get("root-1").w / 2;
	const xs = [vLayout.pos.get("plan-1").x, vLayout.pos.get("plan-2").x].map((x) => x + 156 / 2);
	return Math.abs(rootX - (xs[0] + xs[1]) / 2) < 1;
})());
const vEdge = D.edgePath(vLayout.pos.get("root-1"), vLayout.pos.get("plan-1"), true);
check("竖向布局连线为垂直贝塞尔", typeof vEdge === "string" && vEdge.startsWith("M ") && vEdge.includes(" C "), vEdge);

// ── 连线 ─────────────────────────────────────────────────────────────────────
const edge = D.edgePath(pos.get("root-1"), pos.get("plan-1"));
check("连线为贝塞尔路径", typeof edge === "string" && edge.startsWith("M ") && edge.includes(" C "), edge);

// ── 状态与文案 ───────────────────────────────────────────────────────────────
const step1 = nodes.find((n) => n.id === "step-1");
check("失败节点状态映射", D.nodeState(step1) === "failed");
check("失败节点副标题 = 原因", D.nodeDesc(step1) === "收敛性差");
const step2 = nodes.find((n) => n.id === "step-2");
check("进行中节点副标题", D.nodeDesc(step2) === "进行中…");
check("截断函数", D.truncate("一二三四五六七八九十", 6) === "一二三四五…");
check("六种状态色齐全", Object.keys(D.STATE_COLORS).length === 6 && Object.keys(D.STATE_LABELS).length === 6);

// ── 面板矩形 clamp ───────────────────────────────────────────────────────────
const vw = globalThis.window?.innerWidth || 1280;
const clamped = D.clampPanelRect({ x: -500, y: -500, w: 50, h: 50 });
check("面板矩形：最小尺寸与边界 clamp", clamped.w >= 320 && clamped.h >= 240 && clamped.x >= 0 && clamped.y >= 0, JSON.stringify(clamped));
const clampedBig = D.clampPanelRect({ x: 0, y: 0, w: 99999, h: 99999 });
check("面板矩形：最大不超过视口", clampedBig.w <= vw - 32 && clampedBig.h <= (globalThis.window?.innerHeight || 800) - 32, JSON.stringify(clampedBig));

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
