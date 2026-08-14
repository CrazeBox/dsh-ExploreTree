// research-tree-plugin — Client 半端（浏览器 bundle）。
// 手写 CJS bundle：window.__ModuleLoader__.load({id, factory}) 契约。
// 只 require 内核 seed 模块（react / react/jsx-runtime），零构建依赖。
// UI：侧边栏底部按钮（sidebar.footer.action）切换右侧悬浮面板（shell.overlay）；
// 思维导图式渲染（SVG 手写分层布局：根在左、分支向右）；
// 交互：空白处拖动平移画布、Ctrl+滚轮或按钮缩放、标题栏拖动面板、右下角缩放面板
// （位置/尺寸记忆到 localStorage）、悬停看详情（点击固定，固定框可取消/半透明区分）、
// 计划节点虚线边框、角落图例、当前节点高亮自动滚动；1.5s 轮询网关 RPC 实时刷新。
window.__ModuleLoader__.load({
	id: "research-tree-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		const { jsx, jsxs, Fragment } = react_jsx_runtime;

		// ── 样式（Claude 浅色主题：暖米白底 + 暖棕文字 + 铜橙强调） ──────────────
		const CSS = `
.rt-toggle{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;line-height:1;white-space:nowrap}
.rt-toggle:hover{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover,transparent)}
.rt-toggle[data-active=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.rt-panel{position:fixed;display:flex;flex-direction:column;background:#fcfbf8;border:1px solid #e3e1da;border-radius:12px;box-shadow:0 8px 28px rgba(60,55,45,.16);pointer-events:auto;overflow:hidden;font-size:13px;color:#4a4638}
.rt-panel.focused{border-color:#d97757;box-shadow:0 0 0 2px rgba(217,119,87,.25),0 8px 28px rgba(60,55,45,.16)}
.rt-panel *{box-sizing:border-box}
.rt-head{position:relative;flex:none;display:flex;align-items:center;gap:6px;padding:8px 38px 8px 10px;border-bottom:1px solid #ece9e2;cursor:move;user-select:none;background:#f7f5f0}
.rt-head button,.rt-head select{cursor:pointer}
.rt-head-title{flex:1;min-width:0;font-weight:600;font-size:13px;color:#3d3929;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-head select{flex:1;min-width:0;max-width:240px;font-size:12px;color:#5c574a;background:#ffffff;border:1px solid #ddd9d0;border-radius:6px;padding:3px 6px}
.rt-hbtn{flex:none;min-width:22px;height:22px;padding:0 5px;border:1px solid #ddd9d0;border-radius:6px;background:transparent;color:#6f6a5c;font-size:12px;line-height:1}
.rt-hbtn:hover{background:#f0ede6;color:#3d3929}
.rt-hbtn.zoom{min-width:44px;font-size:11px;color:#9b968a}
.rt-close{position:absolute;top:8px;right:10px;width:22px;height:22px;border:none;background:transparent;color:#9b968a;cursor:pointer;font-size:14px;line-height:1;border-radius:6px}
.rt-close:hover{background:#f0ede6;color:#3d3929}
.rt-body{flex:1;overflow:hidden;padding:0;position:relative;cursor:grab}
.rt-body.panning{cursor:grabbing}
.rt-svg{display:block;width:100%;height:100%}
.rt-empty{color:#9b968a;padding:16px 10px;line-height:1.6;font-size:12px}
.rt-edge{fill:none;stroke:#ddd9d0;stroke-width:1.5}
.rt-node-rect{transition:filter .12s ease}
.rt-node:hover .rt-node-rect{filter:brightness(1.03)}
.rt-node-pulse .rt-node-rect{animation:rt-pulse 1.3s ease-in-out infinite}
@keyframes rt-pulse{0%,100%{opacity:1}50%{opacity:.45}}
.rt-node-title{fill:#3d3929;font-size:12px;font-weight:600}
.rt-node-desc{fill:#8a8578;font-size:10px}
.rt-node-tag{fill:#ffffff}
.rt-node-tag-text{fill:#8a8578;font-size:9px;font-weight:700}
.rt-fold{fill:#ffffff;stroke:#ddd9d0;stroke-width:1;cursor:pointer}
.rt-fold-text{fill:#6f6a5c;font-size:10px;font-weight:700;pointer-events:none}
.rt-tooltip{position:absolute;z-index:10;width:264px;max-height:250px;overflow:auto;padding:8px 10px;background:#ffffff;border:1px solid #e3e1da;border-radius:10px;box-shadow:0 6px 22px rgba(60,55,45,.18);font-size:12px;line-height:1.55;color:#5c574a;pointer-events:none}
.rt-tooltip.pinned{pointer-events:auto;border-color:#d97757;box-shadow:0 6px 22px rgba(60,55,45,.22)}
.rt-tooltip.dim{opacity:.4}
.rt-tooltip h5{margin:0 0 4px;font-size:12px;color:#3d3929;padding-right:16px}
.rt-tooltip .rt-k{color:#9b968a;margin-right:4px}
.rt-tooltip .rt-file{display:block;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#b05a35;word-break:break-all}
.rt-tooltip .rt-jump{display:inline-block;margin-top:6px;font-size:10px;color:#9b968a}
.rt-unpin{position:absolute;top:4px;right:6px;width:18px;height:18px;border:none;background:transparent;color:#9b968a;cursor:pointer;font-size:11px;line-height:1;border-radius:5px;padding:0}
.rt-unpin:hover{background:#f0ede6;color:#3d3929}
.rt-legend{position:absolute;right:10px;bottom:34px;display:flex;flex-direction:column;gap:4px;max-width:250px;padding:6px 9px;background:rgba(247,245,240,.92);border:1px solid #e3e1da;border-radius:8px;font-size:10px;color:#8a8578;backdrop-filter:blur(2px);pointer-events:none}
.rt-legend .lg{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px}
.rt-legend .lg b{font-weight:600;color:#6f6a5c;margin-right:2px}
.rt-legend .sep{width:100%;height:1px;background:#e3e1da}
.rt-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.rt-legend .ln{display:inline-block;width:16px;height:0;border-top:2px solid #9b968a;margin-right:4px;vertical-align:middle}
.rt-legend .ln.dash{border-top-style:dashed}
.rt-legend .ln.yellow{border-color:#d97706}
.rt-resize{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:5}
.rt-resize::after{content:"";position:absolute;right:4px;bottom:4px;width:8px;height:8px;border-right:2px solid #c4c0b6;border-bottom:2px solid #c4c0b6;border-bottom-right-radius:3px}
.rt-foot{flex:none;padding:6px 12px;border-top:1px solid #ece9e2;color:#9b968a;font-size:11px;display:flex;justify-content:space-between;align-items:center;gap:8px;background:#f7f5f0}
.rt-fbtn{flex:none;border:1px solid #ddd9d0;border-radius:6px;background:transparent;color:#8a8578;font-size:10px;line-height:1;padding:3px 7px;cursor:pointer}
.rt-fbtn:hover{background:#f0ede6;color:#3d3929}
.rt-fbtn.danger{color:#c0392b}
.rt-fbtn.danger:hover{border-color:#c0392b;color:#c0392b}
`;
		const tagId = "research-tree-plugin/style";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "research-tree-plugin";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		// ── 轻量外部 store（面板开关 / 选中树） ─────────────────────────────────
		function makeStore(initial) {
			let value = initial;
			const listeners = new Set();
			return {
				get: () => value,
				set: (next) => {
					value = next;
					for (const fn of listeners) fn();
				},
				subscribe: (fn) => {
					listeners.add(fn);
					return () => {
						listeners.delete(fn);
					};
				}
			};
		}
		const panelOpen = makeStore(false);
		const selectedTreeId = makeStore(null); // null = 最新更新的树

		// ── 面板位置/尺寸（localStorage 记忆） ─────────────────────────────────
		const RECT_KEY = "research-tree-panel-rect";
		function loadPanelRect() {
			try {
				const raw = localStorage.getItem(RECT_KEY);
				if (raw !== null) {
					const r = JSON.parse(raw);
					if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") return r;
				}
			} catch { /* localStorage 不可用时用默认 */ }
			const vw = window.innerWidth || 1280;
			const vh = window.innerHeight || 800;
			const w = Math.min(440, vw - 32);
			return { x: vw - 16 - w, y: 56, w, h: vh - 112 };
		}
		function clampPanelRect(r) {
			const vw = window.innerWidth || 1280;
			const vh = window.innerHeight || 800;
			const w = Math.min(Math.max(320, r.w), vw - 32);
			const h = Math.min(Math.max(240, r.h), vh - 32);
			return {
				x: Math.min(Math.max(0, r.x), vw - w - 8),
				y: Math.min(Math.max(0, r.y), vh - h - 8),
				w,
				h
			};
		}

		// ── 数据 hook：轮询网关 RPC 快照 ───────────────────────────────────────
		// 不走 ctx.remote.<ns>（该面需要构建期生成的 Typert 描述符，本插件的
		// namespace 不在其中），改用 connection.rpc 直调网关 /api；服务端对
		// 本 namespace 走 SRC 兜底解析（typertRemote 绑定服务）。
		function useTreeSnapshot(rpc) {
			const [state, setState] = react.useState({ status: "loading", trees: [], error: null });
			react.useEffect(() => {
				let alive = true;
				const refresh = () => {
					Promise.resolve()
						.then(() => rpc.call("/api", "researchTree/getSnapshot", { args: {} }))
						.then((result) => {
							if (!alive) return;
							if (result !== null && typeof result === "object" && result.ok === true && Array.isArray(result.value?.trees)) {
								setState({ status: "ready", trees: result.value.trees, error: null });
							} else {
								setState((s) => ({ ...s, status: "error", error: "remote error" }));
							}
						}, (error) => {
							if (alive) setState((s) => ({ ...s, status: "error", error: String(error) }));
						});
				};
				refresh();
				const timer = setInterval(refresh, 1500);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [rpc]);
			return state;
		}

		// ── 节点状态 / 颜色 ─────────────────────────────────────────────────────
		const STATE_COLORS = {
			success: "#16a34a",
			failed: "#dc2626",
			blocked: "#d97706",
			abandoned: "#9ca3af",
			running: "#2563eb",
			pending: "#c0bdb6"
		};
		const STATE_LABELS = {
			success: "成功",
			failed: "失败",
			blocked: "阻塞",
			abandoned: "放弃",
			running: "进行中",
			pending: "未开始"
		};

		function nodeState(node) {
			if (node.conclusion === "success") return "success";
			if (node.conclusion === "failed") return "failed";
			if (node.conclusion === "blocked") return "blocked";
			if (node.conclusion === "abandoned") return "abandoned";
			if (node.status === "running") return "running";
			return "pending";
		}

		function typeLabel(node) {
			switch (node.type) {
				case "root": return "主题";
				case "plan": return "计划";
				case "decision": return "探索";
				case "subagent": return "子代理";
				case "workflow": return "工作流";
				case "job": return "任务";
				case "skill": return "技能";
				case "goal-round": return "轮次";
				default: return node.type;
			}
		}

		/** 节点副标题：这个节点在干什么。 */
		function nodeDesc(node) {
			if (node.conclusion !== null && node.reason !== null && node.reason !== "") return node.reason;
			if (node.status === "running") return "进行中…";
			if (node.status === "ended" && node.conclusion === null) return "已结束";
			if (node.type === "root") return "研究主题";
			if (node.type === "plan") return node.planRelation === "revised" ? "计划已修正" : "计划分支";
			if (node.type === "decision") return "探索分支";
			if (node.type === "subagent") return "子代理任务";
			if (node.type === "workflow") return "工作流任务";
			return typeLabel(node);
		}

		/** SVG text 不支持省略号，手动截断。 */
		function truncate(value, max) {
			const text = String(value ?? "");
			return text.length > max ? text.slice(0, max - 1) + "…" : text;
		}

		// ── 分层树布局（根在左，向右展开） ─────────────────────────────────────
		const NODE_W = 156;
		const NODE_H = 46;
		const LEVEL_GAP = 200;
		const V_GAP = 26;
		const PAD = 14;

		function computeLayout(nodes, collapsed) {
			const childrenOf = new Map();
			for (const node of nodes) {
				const list = childrenOf.get(node.parentId ?? null) ?? [];
				list.push(node);
				childrenOf.set(node.parentId ?? null, list);
			}
			const roots = nodes.filter((n) => n.parentId === null);
			const pos = new Map();
			let yCursor = PAD;
			let maxDepth = 0;
			const walk = (node, depth) => {
				if (depth > maxDepth) maxDepth = depth;
				const kids = collapsed.has(node.id) ? [] : childrenOf.get(node.id) ?? [];
				const x = PAD + depth * LEVEL_GAP;
				if (kids.length === 0) {
					pos.set(node.id, { x, y: yCursor, w: NODE_W, h: NODE_H });
					yCursor += NODE_H + V_GAP;
					return;
				}
				for (const kid of kids) walk(kid, depth + 1);
				const ys = kids.map((kid) => pos.get(kid.id).y);
				pos.set(node.id, { x, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: NODE_W, h: NODE_H });
			};
			for (const root of roots) walk(root, 0);
			const width = PAD * 2 + maxDepth * LEVEL_GAP + NODE_W;
			const height = Math.max(yCursor + PAD, PAD * 2 + NODE_H);
			return { pos, width, height, roots };
		}

		function edgePath(parent, child) {
			const px = parent.x + parent.w;
			const py = parent.y + parent.h / 2;
			const cx = child.x;
			const cy = child.y + child.h / 2;
			const bend = Math.max(24, (cx - px) / 2);
			return `M ${px} ${py} C ${px + bend} ${py}, ${cx - bend} ${cy}, ${cx} ${cy}`;
		}

		// ── 详情浮层内容 ───────────────────────────────────────────────────────
		function detailRows(node) {
			const rows = [];
			rows.push(["类型", typeLabel(node)]);
			rows.push(["状态", STATE_LABELS[nodeState(node)] ?? node.status]);
			if (node.conclusion !== null) rows.push(["结论", STATE_LABELS[node.conclusion]]);
			if (node.reason !== null && node.reason !== "") rows.push(["原因", node.reason]);
			if (node.planRelation !== null) rows.push(["计划对照", node.planRelation === "on-track" ? "按计划" : node.planRelation === "revised" ? "已修正" : "新增"]);
			if (node.round !== null) rows.push(["轮次", String(node.round)]);
			if (node.startedAt !== null) rows.push(["开始", new Date(node.startedAt).toLocaleString()]);
			if (node.endedAt !== null) rows.push(["结束", new Date(node.endedAt).toLocaleString()]);
			return rows;
		}

		function DetailCard({ node, x, y, pinned, dim, onUnpin, innerRef }) {
			if (node === null) return null;
			const cls = `rt-tooltip${pinned ? " pinned" : ""}${dim ? " dim" : ""}`;
			return jsxs("div", {
				className: cls,
				style: { left: x, top: y },
				ref: innerRef,
				children: [
					pinned ? jsx("button", {
						className: "rt-unpin",
						type: "button",
						"aria-label": "取消固定",
						title: "取消固定（点击空白处也可取消）",
						onClick: (event) => {
							event.stopPropagation();
							onUnpin?.();
						},
						children: "✕"
					}) : null,
					jsx("h5", { children: node.title }),
					detailRows(node).map(([key, value]) => jsxs("div", {
						children: [jsx("span", { className: "rt-k", children: key }), value]
					}, key)),
					Array.isArray(node.files) && node.files.length > 0
						? jsxs("div", {
							children: [
								jsx("span", { className: "rt-k", children: "产出文件" }),
								node.files.map((file) => jsx("span", { className: "rt-file", children: file }, file))
							]
						})
						: null,
					node.anchor !== null && node.anchor !== void 0
						? jsx("span", { className: "rt-jump", children: "双击节点跳转到所属会话" })
						: null
				]
			});
		}

		// ── 面板 ───────────────────────────────────────────────────────────────
		function TreePanel({ rpc, sessions }) {
			const snapshot = useTreeSnapshot(rpc);
			const open = react.useSyncExternalStore(panelOpen.subscribe, panelOpen.get);
			const selectedId = react.useSyncExternalStore(selectedTreeId.subscribe, selectedTreeId.get);
			const [rect, setRect] = react.useState(loadPanelRect);
			const [zoom, setZoom] = react.useState(1);
			const [collapsed, setCollapsed] = react.useState(() => new Set());
			const [hover, setHover] = react.useState(null); // { node } | null（位置直写 DOM，避免每帧渲染）
			const [pinned, setPinned] = react.useState(null); // { node, x, y } | null
			const [panning, setPanning] = react.useState(false);
			const [focused, setFocused] = react.useState(false);
			const bodyRef = react.useRef(null);
			const panelRef = react.useRef(null);
			const hoverTipRef = react.useRef(null);
			const svgRef = react.useRef(null); // SVG 元素（viewBox 驱动平移/缩放，矢量原生缩放不模糊）
			const panRef = react.useRef({ x: 0, y: 0 }); // 画布偏移（屏幕像素）
			const zoomRef = react.useRef(1); // 与 state zoom 同步（事件闭包里读）
			const dragActiveRef = react.useRef(false); // 画布拖动进行中（挂起 hover）
			const lastPanMovedRef = react.useRef(false); // 拖动后抑制 click
			const dragRef = react.useRef(null); // 面板移动/缩放 {mode,startX,startY,rect}
			const resizeModeRef = react.useRef(null); // 边缘 hover 检测结果 n/s/e/w/组合
			const focusedRef = react.useRef(false); // wheel 监听里读取（避免重挂）

			// 面板位置/尺寸记忆
			react.useEffect(() => {
				try {
					localStorage.setItem(RECT_KEY, JSON.stringify(rect));
				} catch { /* 忽略 */ }
			}, [rect]);

			// 焦点模式：点击面板内获得焦点；点击外部 / Esc 释放
			react.useEffect(() => {
				focusedRef.current = focused;
			}, [focused]);
			react.useEffect(() => {
				const onDocMouseDown = (event) => {
					if (panelRef.current !== null && !panelRef.current.contains(event.target)) setFocused(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setFocused(false);
				};
				document.addEventListener("mousedown", onDocMouseDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("mousedown", onDocMouseDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, []);

			const trees = snapshot.status === "ready" ? snapshot.trees : [];
			const current = selectedId !== null && trees.some((t) => t.treeId === selectedId)
				? trees.find((t) => t.treeId === selectedId)
				: trees[0] ?? null;
			const nodes = current !== null ? current.nodes : [];
			const currentId = current !== null ? current.currentNodeId : null;

			const layout = react.useMemo(() => computeLayout(nodes, collapsed), [nodes, collapsed]);
			const nodeById = react.useMemo(() => {
				const map = new Map();
				for (const node of nodes) map.set(node.id, node);
				return map;
			}, [nodes]);

			// ── 无限画布：平移/缩放全部走 SVG viewBox（矢量原生缩放，
			// 任意倍率文字都清晰；内容多小都能自由移动） ──
			const applyTransform = () => {
				const svg = svgRef.current;
				if (svg === null) return;
				const rect = svg.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return;
				const z = zoomRef.current;
				const pan = panRef.current;
				svg.setAttribute("viewBox", `${(-pan.x / z).toFixed(2)} ${(-pan.y / z).toFixed(2)} ${(rect.width / z).toFixed(2)} ${(rect.height / z).toFixed(2)}`);
			};

			const clampZoom = (z) => Math.min(2.5, Math.max(0.25, z));

			// 以视口中心为锚设置缩放级别（按钮用）
			const setZoomLevel = (next) => {
				const el = bodyRef.current;
				const cx = (el?.clientWidth ?? 0) / 2;
				const cy = (el?.clientHeight ?? 0) / 2;
				const pan = panRef.current;
				const wx = (cx - pan.x) / zoomRef.current;
				const wy = (cy - pan.y) / zoomRef.current;
				const z = clampZoom(next);
				panRef.current = { x: cx - wx * z, y: cy - wy * z };
				zoomRef.current = z;
				setZoom(z);
				applyTransform();
			};

			// 以鼠标位置为锚缩放（滚轮用，市面思维导图标准体验）
			const zoomWheel = (event) => {
				const el = bodyRef.current;
				if (el === null) return;
				const rect = el.getBoundingClientRect();
				const mx = event.clientX - rect.left;
				const my = event.clientY - rect.top;
				const pan = panRef.current;
				const wx = (mx - pan.x) / zoomRef.current;
				const wy = (my - pan.y) / zoomRef.current;
				const z = clampZoom(zoomRef.current * (event.deltaY < 0 ? 1.12 : 0.9));
				panRef.current = { x: mx - wx * z, y: my - wy * z };
				zoomRef.current = z;
				setZoom(z);
				applyTransform();
			};

			// 滚轮：焦点模式下直接缩放；否则 Ctrl/Cmd+滚轮缩放。
			// wheel 在 React 上是 passive，需原生监听；面板打开时才挂（否则 body 不存在）。
			react.useEffect(() => {
				if (!open) return;
				const el = bodyRef.current;
				if (el === null) return;
				const onWheel = (event) => {
					if (!focusedRef.current && !event.ctrlKey && !event.metaKey) return;
					event.preventDefault();
					zoomWheel(event);
				};
				el.addEventListener("wheel", onWheel, { passive: false });
				return () => el.removeEventListener("wheel", onWheel);
			}, [open]);

			// 打开面板 / 切换树时：内容居中（仅这两件事触发，不随节点更新打扰）
			react.useEffect(() => {
				if (!open || current === null) return;
				const el = bodyRef.current;
				if (el === null) return;
				panRef.current = {
					x: el.clientWidth / 2 - (layout.width * zoom) / 2,
					y: el.clientHeight / 2 - (layout.height * zoom) / 2
				};
				applyTransform();
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [open, current?.treeId]);

			// 当前节点变化时：把当前节点平移到视口中心（不随 zoom/节点数变化打扰）
			react.useEffect(() => {
				if (!open || currentId === null) return;
				const self = layout.pos.get(currentId);
				if (self === void 0) return;
				const el = bodyRef.current;
				if (el === null) return;
				panRef.current = {
					x: el.clientWidth / 2 - (self.x + self.w / 2) * zoom,
					y: el.clientHeight / 2 - (self.y + self.h / 2) * zoom
				};
				applyTransform();
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [open, currentId]);

			if (!open) return null;

			const relPos = (event) => {
				const rectNow = panelRef.current?.getBoundingClientRect();
				if (rectNow === void 0) return { x: 8, y: 8 };
				const maxX = Math.max(8, rectNow.width - 280);
				const maxY = Math.max(8, rectNow.height - 260);
				return {
					x: Math.min(Math.max(8, event.clientX - rectNow.left + 12), maxX),
					y: Math.min(Math.max(8, event.clientY - rectNow.top + 10), maxY)
				};
			};

			// 悬停时直接写 tooltip DOM 位置（不触发 React 渲染）；仅节点变化才 setState
			const moveHoverTip = (event) => {
				const el = hoverTipRef.current;
				if (el === null) return;
				const p = relPos(event);
				el.style.left = `${p.x}px`;
				el.style.top = `${p.y}px`;
			};

			// 面板拖动（标题栏移动 / 四边四角缩放）
			const startPanelDrag = (mode, event) => {
				if (event.target?.closest?.("button,select") !== null && event.target?.closest?.("button,select") !== void 0) return;
				event.preventDefault();
				const start = { mode, startX: event.clientX, startY: event.clientY, rect: { ...rect } };
				dragRef.current = start;
				const onMove = (ev) => {
					const dx = ev.clientX - start.startX;
					const dy = ev.clientY - start.startY;
					if (start.mode === "move") {
						setRect(clampPanelRect({ x: start.rect.x + dx, y: start.rect.y + dy, w: start.rect.w, h: start.rect.h }));
						return;
					}
					const m = start.mode;
					let x = start.rect.x;
					let y = start.rect.y;
					let w = start.rect.w;
					let h = start.rect.h;
					if (m.includes("e")) w = start.rect.w + dx;
					if (m.includes("s")) h = start.rect.h + dy;
					if (m.includes("w")) {
						w = start.rect.w - dx;
						x = start.rect.x + dx;
					}
					if (m.includes("n")) {
						h = start.rect.h - dy;
						y = start.rect.y + dy;
					}
					setRect(clampPanelRect({ x, y, w, h }));
				};
				const onUp = () => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
					dragRef.current = null;
					resizeModeRef.current = null;
					if (bodyRef.current !== null) bodyRef.current.style.cursor = "";
					applyTransform(); // 面板尺寸变化后按新视口重算 viewBox
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			};

			// 画布平移：任意位置按住拖动（含节点上），mousemove/mouseup 挂到
			// window 全局跟踪——无限画布模型，内容多小都能自由移动。
			const onBodyMouseDown = (event) => {
				// 边缘优先：进入 resize 拖拽
				if (resizeModeRef.current !== null) {
					startPanelDrag(resizeModeRef.current, event);
					return;
				}
				event.preventDefault();
				const start = { x: event.clientX, y: event.clientY, pan: { ...panRef.current }, moved: false };
				dragActiveRef.current = true;
				lastPanMovedRef.current = false;
				const onMove = (ev) => {
					const dx = ev.clientX - start.x;
					const dy = ev.clientY - start.y;
					if (Math.abs(dx) + Math.abs(dy) > 3) {
						start.moved = true;
						lastPanMovedRef.current = true;
						setPanning(true);
					}
					panRef.current = { x: start.pan.x + dx, y: start.pan.y + dy };
					applyTransform();
				};
				const onUp = () => {
					dragActiveRef.current = false;
					setPanning(false);
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			};
			// 边缘 resize 检测：鼠标距面板边缘 < 8px 时给出模式与光标
			const updateResizeMode = (event) => {
				const rectNow = panelRef.current?.getBoundingClientRect();
				if (rectNow === void 0) return;
				const x = event.clientX - rectNow.left;
				const y = event.clientY - rectNow.top;
				const near = 8;
				const west = x < near;
				const east = x > rectNow.width - near;
				const north = y < near;
				const south = y > rectNow.height - near;
				const edge = (north ? "n" : south ? "s" : "") + (west ? "w" : east ? "e" : "");
				const body = bodyRef.current;
				if (edge === "") {
					if (resizeModeRef.current !== null) {
						resizeModeRef.current = null;
						if (body !== null) body.style.cursor = "";
					}
					return;
				}
				resizeModeRef.current = edge;
				if (body !== null) {
					body.style.cursor = edge.includes("n") && edge.includes("s") ? "ns-resize"
						: edge.includes("e") && edge.includes("w") ? "ew-resize"
							: (edge.includes("n") && edge.includes("w")) || (edge.includes("s") && edge.includes("e")) ? "nwse-resize"
								: "nesw-resize";
				}
			};
			const onBodyMouseMove = (event) => {
				if (dragRef.current === null) updateResizeMode(event);
				if (dragActiveRef.current) return; // 平移由 window 级监听处理
				const target = event.target?.closest?.("[data-node-id]");
				if (target !== null && target !== void 0) {
					const node = nodeById.get(String(target.dataset.nodeId));
					if (node !== void 0) {
						moveHoverTip(event);
						if (hover === null || hover.node.id !== node.id) setHover({ node });
					}
				} else if (pinned === null) {
					setHover(null);
				}
			};
			const onBodyClick = (event) => {
				if (lastPanMovedRef.current) {
					lastPanMovedRef.current = false;
					return;
				}
				const target = event.target?.closest?.("[data-node-id]");
				if (target === null || target === void 0) {
					setPinned(null);
					return;
				}
				const node = nodeById.get(String(target.dataset.nodeId));
				if (node === void 0) return;
				if (pinned !== null && pinned.node.id === node.id) {
					setPinned(null);
				} else {
					setPinned({ node, ...relPos(event) });
				}
			};
			// 双击节点 → 跳转到其所属会话（Level 1）
			const onBodyDoubleClick = (event) => {
				if (lastPanMovedRef.current) return;
				const target = event.target?.closest?.("[data-node-id]");
				if (target === null || target === void 0) return;
				const node = nodeById.get(String(target.dataset.nodeId));
				if (node === void 0) return;
				// 优先节点锚点（精确到创建它的会话）；老数据无锚点时回退到树所属会话
				const sessionId = node.anchor?.sessionId ?? current?.sessionId ?? null;
				if (typeof sessionId === "string" && sessionId !== "" && sessions !== void 0) {
					try {
						sessions.open(sessionId);
					} catch (error) {
						console.error("[research-tree] jump to session failed:", String(error));
					}
				}
			};

			const edges = nodes.filter((n) => n.parentId !== null && layout.pos.has(n.parentId) && layout.pos.has(n.id));
			const relationTag = (node) => {
				if (node.planRelation === "revised") return { text: "改", color: STATE_COLORS.blocked };
				if (node.planRelation === "added") return { text: "新", color: STATE_COLORS.running };
				return null;
			};
			const showHoverCard = hover !== null && (pinned === null || hover.node.id !== pinned.node.id);

			// 面板操作：归档/恢复、删除当前树
			const archiveCurrent = (archived) => {
				if (current === null) return;
				Promise.resolve()
					.then(() => rpc.call("/api", "researchTree/archiveTree", { args: { treeId: current.treeId, archived } }))
					.then((result) => {
						if (result !== null && typeof result === "object" && result.ok !== true) {
							console.error("[research-tree] archive failed:", JSON.stringify(result.error));
						}
					}, (error) => console.error("[research-tree] archive failed:", String(error)));
			};
			const removeCurrent = () => {
				if (current === null) return;
				if (typeof window !== "undefined" && !window.confirm(`永久删除研究树「${truncate(current.topic, 30)}」？\n节点数据与历史将无法恢复。`)) return;
				Promise.resolve()
					.then(() => rpc.call("/api", "researchTree/removeTree", { args: { treeId: current.treeId } }))
					.then((result) => {
						if (result !== null && typeof result === "object" && result.ok !== true) {
							console.error("[research-tree] remove failed:", JSON.stringify(result.error));
						} else {
							selectedTreeId.set(null);
						}
					}, (error) => console.error("[research-tree] remove failed:", String(error)));
			};

			return jsxs("div", {
				className: `rt-panel${focused ? " focused" : ""}`,
				role: "region",
				"aria-label": "研究进度树",
				ref: panelRef,
				style: { left: rect.x, top: rect.y, width: rect.w, height: rect.h },
				onMouseDown: () => setFocused(true),
				children: [
					jsxs("div", {
						className: "rt-head",
						onMouseDown: (event) => startPanelDrag("move", event),
						children: [
							trees.length > 1
								? jsx("select", {
									value: current !== null ? current.treeId : "",
									onChange: (event) => {
										selectedTreeId.set(event.target.value);
									},
									children: (() => {
										const active = trees.filter((t) => t.archived !== true);
										const archived = trees.filter((t) => t.archived === true);
										return [
											...active.map((tree) => jsx("option", {
												value: tree.treeId,
												title: `${tree.topic}\ntreeId: ${tree.treeId}`,
												children: `${truncate(tree.topic, 26)}（${tree.nodes.length}）`
											}, tree.treeId)),
											archived.length > 0 ? jsx("optgroup", {
												label: "已归档",
												children: archived.map((tree) => jsx("option", {
													value: tree.treeId,
													title: `${tree.topic}\ntreeId: ${tree.treeId}`,
													children: `${truncate(tree.topic, 26)}（${tree.nodes.length}）`
												}, tree.treeId))
											}, "archived") : null
										];
									})()
								})
								: jsx("span", { className: "rt-head-title", title: current !== null ? `${current.topic}\ntreeId: ${current.treeId}` : "", children: current !== null ? current.topic : "研究进度树" }),
							jsx("button", {
								className: "rt-hbtn",
								type: "button",
								title: "缩小（也可 Ctrl+滚轮）",
								"aria-label": "缩小画布",
								onClick: () => setZoomLevel(zoomRef.current / 1.15),
								children: "−"
							}),
							jsx("button", {
								className: "rt-hbtn zoom",
								type: "button",
								title: `缩放 ${Math.round(zoom * 100)}%（Ctrl+滚轮）`,
								onClick: () => setZoomLevel(1),
								children: `${Math.round(zoom * 100)}%`
							}),
							jsx("button", {
								className: "rt-hbtn",
								type: "button",
								title: "放大（也可 Ctrl+滚轮）",
								"aria-label": "放大画布",
								onClick: () => setZoomLevel(zoomRef.current * 1.15),
								children: "+"
							}),
							jsx("button", {
								className: "rt-close",
								type: "button",
								"aria-label": "关闭研究进度树",
								onClick: () => panelOpen.set(false),
								children: "✕"
							})
						]
					}),
					jsx("div", {
						className: `rt-body${panning ? " panning" : ""}`,
						ref: bodyRef,
						onMouseDown: onBodyMouseDown,
						onMouseMove: onBodyMouseMove,
						onMouseLeave: () => {
							if (pinned === null) setHover(null);
						},
						onClick: onBodyClick,
						onDoubleClick: onBodyDoubleClick,
						children: snapshot.status === "error"
							? jsx("div", { className: "rt-empty", children: "暂时无法读取研究树（连接异常）。" })
							: snapshot.status === "loading" && trees.length === 0
								? jsx("div", { className: "rt-empty", children: "加载中…" })
								: current === null
									? jsx("div", { className: "rt-empty", children: "还没有研究树。\n让 agent 在研究开始时调用 tree_node 工具（plan-root 建根），或先创建目标（goal）。" })
									: jsxs("svg", {
										className: "rt-svg",
										ref: svgRef,
										viewBox: "0 0 100 100",
										children: [
											edges.map((node) => {
												const parent = layout.pos.get(node.parentId);
												const self = layout.pos.get(node.id);
												return jsx("path", { className: "rt-edge", d: edgePath(parent, self) }, `e-${node.id}`);
											}),
											[...layout.pos.keys()].map((id) => renderNode(nodeById.get(id)))
										]
									})
					}),
					jsx("div", {
						className: "rt-legend",
						"aria-label": "图例",
						children: [
							jsx("div", {
								className: "lg",
								key: "states",
								children: [
									jsx("b", { children: "状态" }),
									Object.entries(STATE_LABELS).map(([state, label]) => jsxs("span", {
										children: [jsx("i", { style: { background: STATE_COLORS[state] } }), label]
									}, state))
								]
							}),
							jsx("div", { className: "sep", key: "sep" }),
							jsx("div", {
								className: "lg",
								key: "lines",
								children: [
									jsx("b", { children: "线型" }),
									jsxs("span", { children: [jsx("i", { className: "ln" }), "执行/探索"] }, "ln-solid"),
									jsxs("span", { children: [jsx("i", { className: "ln dash" }), "计划"] }, "ln-dash"),
									jsxs("span", { children: [jsx("i", { className: "ln dash yellow" }), "修订计划"] }, "ln-yellow")
								]
							})
						]
					}),
					pinned !== null ? jsx(DetailCard, {
						node: pinned.node,
						x: pinned.x,
						y: pinned.y,
						pinned: true,
						dim: hover !== null && hover.node.id !== pinned.node.id,
						onUnpin: () => setPinned(null)
					}) : null,
					showHoverCard ? jsx(DetailCard, {
						node: hover.node,
						x: 8,
						y: 8,
						innerRef: hoverTipRef
					}) : null,
					jsx("div", { className: "rt-resize", onMouseDown: (event) => startPanelDrag("se", event) }),
					jsxs("div", {
						className: "rt-foot",
						children: [
							jsx("span", { children: current !== null ? `更新于 ${new Date(current.updatedAt).toLocaleTimeString()}` : "" }),
							jsxs("span", {
								children: [
									nodes.length > 0 ? `${nodes.length} 个节点${focused ? " · 滚轮缩放中" : ""} · ` : "",
									current !== null
										? jsxs(Fragment, {
											children: [
												jsx("button", {
													className: "rt-fbtn",
													type: "button",
													title: current.archived === true ? "恢复这棵树" : "归档这棵树（数据保留，折叠隐藏）",
													onClick: () => archiveCurrent(!(current.archived === true)),
													children: current.archived === true ? "恢复" : "归档"
												}),
												jsx("button", {
													className: "rt-fbtn danger",
													type: "button",
													title: "永久删除这棵树（不可恢复）",
													onClick: () => removeCurrent(),
													children: "删除"
												})
											]
										})
										: null
								]
							})
						]
					})
				]
			});

			// 渲染一个节点
			function renderNode(node) {
				const self = layout.pos.get(node.id);
				if (self === void 0) return null;
				const state = nodeState(node);
				const color = STATE_COLORS[state];
				const kids = nodes.filter((n) => n.parentId === node.id);
				const isCurrent = node.id === currentId;
				const isPinned = pinned !== null && pinned.node.id === node.id;
				const isPlan = node.type === "plan";
				const isRoot = node.type === "root";
				const isAuto = node.type === "subagent" || node.type === "workflow" || node.type === "job" || node.type === "skill";
				// 修订过的计划节点：黄色虚线（区别于普通计划的灰蓝虚线）
				const isRevised = isPlan && node.planRelation === "revised";
				const strokeColor = isRevised ? "#f5a623" : color;
				const tag = relationTag(node);
				return jsxs("g", {
					className: `rt-node${state === "running" ? " rt-node-pulse" : ""}`,
					transform: `translate(${self.x}, ${self.y})`,
					"data-node-id": node.id,
					"data-current": isCurrent ? "true" : undefined,
					style: { cursor: "pointer" },
					children: [
						jsx("rect", {
							className: "rt-node-rect",
							x: 0,
							y: 0,
							width: self.w,
							height: self.h,
							rx: isRoot ? 12 : isAuto ? 14 : 10,
							fill: `color-mix(in srgb, ${strokeColor} ${isPlan ? 8 : 13}%, transparent)`,
							stroke: strokeColor,
							strokeWidth: isCurrent ? 3 : isPinned ? 2.5 : isRoot ? 2 : 1.5,
							// 计划节点虚线（"还没落地"）；当前节点也虚线（高亮，比计划更粗的段）
							strokeDasharray: isPlan || isCurrent ? (isCurrent && !isPlan ? "7 3" : "5 4") : void 0
						}),
						jsx("text", {
							className: "rt-node-title",
							x: self.w / 2,
							y: 20,
							textAnchor: "middle",
							children: truncate(node.title, 11)
						}),
						jsx("text", {
							className: "rt-node-desc",
							x: self.w / 2,
							y: 36,
							textAnchor: "middle",
							children: truncate(nodeDesc(node), 14)
						}),
						tag !== null
							? jsxs(Fragment, {
								children: [
									jsx("circle", { className: "rt-node-tag", cx: 12, cy: 12, r: 8, stroke: tag.color, strokeWidth: 1 }),
									jsx("text", { className: "rt-node-tag-text", x: 12, y: 15, textAnchor: "middle", children: tag.text })
								]
							})
							: null,
						kids.length > 0
							? jsxs(Fragment, {
								children: [
									jsx("circle", {
										className: "rt-fold",
										cx: self.w - 12,
										cy: 12,
										r: 8,
										onClick: (event) => {
											event.stopPropagation();
											setCollapsed((prev) => {
												const next = new Set(prev);
												if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
												return next;
											});
										}
									}),
									jsx("text", {
										className: "rt-fold-text",
										x: self.w - 12,
										y: 15.5,
										textAnchor: "middle",
										children: collapsed.has(node.id) ? "+" : "−"
									})
								]
							})
							: null
					]
				}, node.id);
			}
		}

		function TreeToggle() {
			const open = react.useSyncExternalStore(panelOpen.subscribe, panelOpen.get);
			return jsx("button", {
				className: "rt-toggle",
				type: "button",
				"data-active": open ? "true" : undefined,
				title: open ? "收起研究进度树" : "打开研究进度树",
				"aria-label": "研究进度树",
				onClick: () => panelOpen.set(!open),
				children: [jsx("span", { key: "icon", "aria-hidden": "true", children: "🌳" }), jsx("span", { key: "label", children: "研究树" })]
			});
		}

		// ── 插件声明 ───────────────────────────────────────────────────────────
		// 注入 connection（网关 RPC 通道）而非 remote.researchTree（需构建期生成的
		// Typert 描述符，本插件的 namespace 不存在——曾导致引导期 pending 卡死）；
		// sessions 用于双击节点跳转到所属会话（ctx.sessions.open）。
		const inject = ["slots", "connection", "sessions"];

		function apply(ctx) {
			const rpc = ctx.connection.rpc;
			const sessions = ctx.sessions;
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "research-tree",
				order: 100,
				label: "研究树"
			}, TreeToggle));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "research-tree-panel",
				order: 100
			}, () => jsx(TreePanel, { rpc, sessions })));
		}

		exports.inject = inject;
		exports.apply = apply;
		// 供 Node 冒烟测试直接验证纯函数（布局/连线/状态/面板矩形），浏览器端无影响
		exports.__debug = { computeLayout, edgePath, nodeState, nodeDesc, truncate, clampPanelRect, STATE_COLORS, STATE_LABELS };
		return module.exports;
	}
});
