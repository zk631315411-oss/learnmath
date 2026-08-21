"""Generate a self-contained HTML style-case page for the KG map design,
using REAL data from gaodai_shang chapter 1 (.tmp-qa/gaodai_ch1.json).

Cases:
  1. chapter overview card (real section stats + demo progress)
  2. style A: vertical ordered list + arc edges (section 1.1, dense: 28n/33e)
  3. style B: horizontal subway line + arcs (section 1.2, median: 18n/4e)
  4. style C: type lanes + straight edges (section 1.3, sparse: 11n/4e)
  5. style C adapted: lanes + on-demand edges (1.1 dense stress test)
  6. style D: constellation canvas + index list + detail (1.1, dense)
  7. node detail panel with real RuleCases (KaTeX)
  8. legend + empty-state demo

Output: artifacts/kg-map-mockup/gaodai-ch1.html
Progress statuses are fabricated demo data, clearly labeled in the page.
Positions for case 6 are computed once with a seeded force layout (deterministic).
"""

import json
from collections import Counter
from pathlib import Path

import numpy as np


def seeded_layout(ids, edges, seed=42, iters=900):
    """Tiny deterministic force layout: circle init (teaching order) +
    Fruchterman-Reingold with center gravity; returns {id: [x, y]} in 0..1."""
    n = len(ids)
    idx = {v: i for i, v in enumerate(ids)}
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    pos = np.stack([0.5 + 0.38 * np.cos(ang), 0.5 + 0.38 * np.sin(ang)], axis=1)
    E = [(idx[a], idx[b]) for a, b in edges if a in idx and b in idx]
    k = 1.15 / np.sqrt(max(n, 1))
    t = 0.06
    center = np.array([0.5, 0.5])
    for _ in range(iters):
        diff = pos[:, None, :] - pos[None, :, :]
        dist = np.linalg.norm(diff, axis=2, keepdims=True) + 1e-9
        disp = ((k * k / dist) * (diff / dist)).sum(axis=1)   # repulsion
        for a, b in E:
            d = pos[a] - pos[b]
            dd = np.linalg.norm(d) + 1e-9
            f = (dd * dd / k) * (d / dd)
            disp[a] -= f
            disp[b] += f
        disp -= 0.03 * (pos - center)                        # gravity
        pos = np.clip(pos + np.clip(disp, -t, t), 0.02, 0.98)
        t *= 0.992
    lo, hi = pos.min(axis=0), pos.max(axis=0)
    span = np.maximum(hi - lo, 1e-9)
    pos = (pos - lo) / span
    return {ids[i]: [float(pos[i][0]), float(pos[i][1])] for i in range(n)}

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / ".tmp-qa" / "gaodai_ch1.json").read_text(encoding="utf-8"))
OUT = ROOT / "artifacts" / "kg-map-mockup" / "gaodai-ch1.html"

TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>知识地图样式案例 · 高代上 第1章（真实数据）</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<style>
  :root{
    --bg:#f1f5f9; --card:#ffffff; --line:#e2e8f0; --txt:#1e293b; --txt2:#64748b; --txt3:#94a3b8;
    --accent:#4f46e5; --amber:#d97706; --edge:#c7cedb; --rowhover:#f8fafc;
  }
  html.dark{
    --bg:#0f172a; --card:#1e293b; --line:#334155; --txt:#e2e8f0; --txt2:#94a3b8; --txt3:#64748b;
    --accent:#818cf8; --amber:#fbbf24; --edge:#475569; --rowhover:#273549;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
    font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.6}
  .wrap{max-width:1080px;margin:0 auto;padding:24px 16px 80px}
  h1{font-size:20px;margin:0}
  h2{font-size:16px;margin:0 0 4px}
  .sub{color:var(--txt2);font-size:13px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    box-shadow:0 1px 2px rgba(15,23,42,.05);padding:16px;margin-top:20px}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .chip{font-size:12px;color:var(--txt2);background:var(--bg);border:1px solid var(--line);
    border-radius:999px;padding:1px 10px}
  .caption{color:var(--txt2);font-size:13px;margin:6px 0 12px}
  .caption b{color:var(--txt)}
  .topbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
  .toggle{font-size:13px;border:1px solid var(--line);background:var(--card);color:var(--txt2);
    border-radius:8px;padding:5px 12px;cursor:pointer}
  .btn{font-size:13px;border-radius:8px;padding:6px 14px;cursor:pointer;border:1px solid transparent}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-ghost{background:transparent;color:var(--txt2);border-color:var(--line)}
  /* status dots */
  .st{display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:-1px;margin-right:6px}
  /* overview */
  .secrow{display:flex;align-items:center;gap:12px;padding:12px 4px;border-top:1px solid var(--line);flex-wrap:wrap}
  .secrow:first-of-type{border-top:none}
  .secname{font-weight:600;min-width:260px}
  .bar{display:flex;height:8px;border-radius:4px;overflow:hidden;flex:1;min-width:160px;background:var(--bg)}
  .bar span{display:block;height:100%}
  /* graph commons */
  .graph-scroll{overflow:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
  text{font-family:inherit}
  .nm{fill:var(--txt);font-size:13px}
  .nm-dim{fill:var(--txt3)}
  .edge{fill:none;stroke:var(--edge);stroke-width:1.3;opacity:.85}
  .edge.hidden-edge{display:none}
  .edge.review{stroke-dasharray:5 4;opacity:.6}
  .edge.out{stroke:var(--accent);stroke-width:2.2;opacity:1}
  .edge.in{stroke:var(--amber);stroke-width:2.2;opacity:1}
  .edge.dim{opacity:.1}
  .rowg{cursor:pointer}
  .rowg:hover .nm{font-weight:600}
  .relinfo{margin-top:10px;font-size:12.5px;color:var(--txt2);min-height:22px}
  .relchip{display:inline-block;margin:2px 6px 2px 0;padding:1px 8px;border-radius:6px;font-size:12px;
    border:1px solid var(--line)}
  .relchip.out{border-color:var(--accent);color:var(--accent)}
  .relchip.in{border-color:var(--amber);color:var(--amber)}
  .relchip .rv{color:var(--txt3)}
  /* detail panel */
  .detail{display:grid;grid-template-columns:1fr;gap:12px;max-width:560px}
  .kv{color:var(--txt2);font-size:13px}
  .rule{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px}
  .rule h4{margin:0 0 6px;font-size:13.5px}
  .rule ul{margin:4px 0 4px 18px;padding:0}
  .rule li{font-size:13px;color:var(--txt)}
  .arrow{text-align:center;color:var(--txt3);font-size:12px;margin:2px 0}
  .empty{border:1px dashed var(--line);border-radius:10px;padding:18px;text-align:center;color:var(--txt2);font-size:13px}
  .legend span{margin-right:14px;font-size:12.5px;color:var(--txt2);white-space:nowrap}
  /* style D: star map + index */
  .split{display:flex;gap:12px;align-items:flex-start}
  .index-panel{flex:1;min-width:240px;max-width:370px;max-height:440px;border:1px solid var(--line);border-radius:10px;
    background:var(--card);overflow:auto}
  .idx-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);
    cursor:pointer;font-size:12.5px}
  .idx-row:last-child{border-bottom:none}
  .idx-row:hover,.idx-row.hot{background:var(--rowhover)}
  .idx-row.sel{background:var(--rowhover);box-shadow:inset 3px 0 0 var(--accent)}
  .idx-row .seq{color:var(--txt3);font-size:11px;min-width:18px;text-align:right;flex-shrink:0}
  .idx-row .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .idx-row .tbadge{font-size:10.5px;padding:0 6px;border-radius:4px;flex-shrink:0}
  .glyph{cursor:pointer}
  .glyph .halo{opacity:0}
  .glyph.hot .halo,.glyph.sel .halo{opacity:1}
  .d-label{paint-order:stroke;stroke:var(--card);stroke-width:3.5px;stroke-linejoin:round;font-size:12px;font-weight:600}
  .d-edge{stroke-width:1.2;opacity:.55}
  /* style E: serpentine ladder */
  .ladder-scroll{max-height:560px;overflow-y:auto}
  .spine{stroke:var(--line);stroke-width:9;stroke-linecap:round}
  .twig{stroke:var(--edge);stroke-width:1.4;opacity:.9}
  .focus-wrap{border:1px solid var(--line);border-radius:10px;background:var(--card);margin-bottom:12px}
  .focus-edge{fill:none;stroke:var(--edge);stroke-width:1.6}
  .focus-edge.out{stroke:var(--accent);stroke-width:2.2}
  .focus-edge.in{stroke:var(--amber);stroke-width:2.2}
  .focus-lab{font-size:10.5px;paint-order:stroke;stroke:var(--card);stroke-width:3px;stroke-linejoin:round}
  .isle{border-top:1px solid var(--line);padding:8px 6px;overflow-x:auto}
  .isle:first-child{border-top:none}
  .isle-head{font-size:12px;color:var(--txt2);padding:2px 8px}
  .e-edge{fill:none;stroke:var(--edge);stroke-width:1.2;opacity:.55}
  .e-edge.out{stroke:var(--accent);stroke-width:2.2;opacity:1}
  .e-edge.in{stroke:var(--amber);stroke-width:2.2;opacity:1}
  .e-edge.dim{opacity:.08}
  .xlab{font-size:10px;fill:var(--txt3);letter-spacing:.06em}
  .glyph.nb .halo{opacity:.6;stroke:var(--txt3)}
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div>
      <h1>知识地图样式案例</h1>
      <div class="sub">高等代数（上册）· 第1章 线性方程组的解法 · 节点与边为 Aura 真实数据 · <b style="color:var(--amber)">学习状态为演示数据</b></div>
    </div>
    <button class="toggle" onclick="document.documentElement.classList.toggle('dark')">切换明暗</button>
  </div>

  <!-- ============ 案例 1：章总览 ============ -->
  <div class="card">
    <h2>① 章总览（进入章节首屏）</h2>
    <div class="caption">节列表 + 真实节点统计 + 状态聚合条。<b>不画图</b>，图在点开小节后才出现。</div>
    <div id="overview"></div>
  </div>

  <!-- ============ 案例 2：样式 A ============ -->
  <div class="card">
    <h2>② 小节图 · 样式 A：讲授顺序列 + 右侧弧线（推荐）</h2>
    <div class="caption">1.1 节压力测试：<b>28 节点 / 33 边</b>。节点按教材讲授顺序排列，边为右侧弧线；
      实线 = 已确认（auto_accept），虚线 = 待审核（review）。点击节点高亮一跳邻居。
      「应用题型」默认收起，可用开关展开。</div>
    <div class="chips" id="statsA"></div>
    <div style="margin:10px 0">
      <button class="toggle" id="togglePC">显示应用题型（ProblemClass）</button>
    </div>
    <div class="graph-scroll"><div id="graphA"></div></div>
    <div class="relinfo" id="infoA">点击节点查看关系明细</div>
  </div>

  <!-- ============ 案例 3：样式 B ============ -->
  <div class="card">
    <h2>③ 小节图 · 样式 B：横向地铁图 + 上方弧线</h2>
    <div class="caption">1.2 节中位情形：<b>18 节点 / 4 边</b>。同一数据横向排列、横向滚动，弧线上方跨越。
      适合宽屏/平板横屏；节点多时滚动距离长是其代价。</div>
    <div class="chips" id="statsB"></div>
    <div class="graph-scroll" style="margin-top:10px"><div id="graphB"></div></div>
    <div class="relinfo" id="infoB">点击节点查看关系明细</div>
  </div>

  <!-- ============ 案例 4：样式 C ============ -->
  <div class="card">
    <h2>④ 小节图 · 样式 C：类型泳道 + 直线边（对比项）</h2>
    <div class="caption">1.3 节稀疏情形：<b>11 节点 / 4 边</b>。按类型分泳道、讲授顺序纵向排。
      结构最规整，但跨泳道长直线在稠密小节会互相穿越——作为对比展示。</div>
    <div class="chips" id="statsC"></div>
    <div class="graph-scroll" style="margin-top:10px"><div id="graphC"></div></div>
    <div class="relinfo" id="infoC">点击节点查看关系明细</div>
  </div>

  <!-- ============ 案例 4b：样式 C 稠密压力测试 ============ -->
  <div class="card">
    <h2>⑤ 样式 C 稠密适配版：泳道 + 按需展开（1.1 节压力测试）</h2>
    <div class="caption">同一泳道布局跑最稠密的 1.1 节：<b>28 节点 / 33 边</b>。经验修正：<b>默认不画任何连线</b>——
      33 条边全铺在任何布局下都是噪声；<b>点选节点</b>才画出它的一跳关系（蓝=出边，橙=入边），
      泳道顺序固定为 <b>定理 | 概念 | 公式 | 方法 | 题型</b>，节点前灰色序号是全节讲授顺序。
      「显示全部关系」仅供纵览，稠密小节会乱——这正是默认关闭它的原因。</div>
    <div class="chips" id="statsC2"></div>
    <div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap">
      <button class="toggle" id="togglePC2">显示应用题型（ProblemClass）</button>
      <button class="toggle" id="toggleEdges">显示全部关系（纵览，稠密时较乱）</button>
    </div>
    <div class="graph-scroll"><div id="graphC2"></div></div>
    <div class="relinfo" id="infoC2">点击节点查看关系明细</div>
  </div>

  <!-- ============ 案例 6：样式 D 星图+索引 ============ -->
  <div class="card">
    <h2>⑥ 样式 D：星图 + 索引（新提案，1.1 节 28 节点 / 33 边）</h2>
    <div class="caption">左侧星图：<b>节点是小图形（形状=类型，角标=状态），默认不显示名称、细线全画</b>——
      没有文字就没有打结。右侧索引：同一份数据按讲授顺序排列的全名清单。
      悬停图形 → 索引行高亮并滚动到位；点击（两侧等效）→ 选中节点与邻居显示名称、其一跳边加粗变色，
      下方出现详情面板（关系是可点的链接列表 + 真实规则）。坐标在导出期一次性算好，每次打开完全一致。</div>
    <div class="chips" id="statsD"></div>
    <div style="margin:10px 0">
      <button class="toggle" id="togglePC3">显示应用题型（ProblemClass）</button>
    </div>
    <div class="split">
      <div class="graph-scroll" style="flex:1.25;min-width:0"><div id="graphD"></div></div>
      <div class="index-panel" id="indexD"></div>
    </div>
    <div id="detailD" style="margin-top:12px"></div>
  </div>

  <!-- ============ 案例 7：样式 E 蛇形梯子 ============ -->
  <div class="card">
    <h2>⑦ 样式 E v3：蛇形梯子 + 题型侧枝 + 三栏聚焦子图 + 岛屿总览</h2>
    <div class="caption">主梯只排核心知识点（概念/定理/公式/方法），严格按课本顺序自上而下；<b>应用题型（纸页图形）作为侧枝挂在它「使用」的知识点上</b>。
      路径中性灰，进度只看图形角标。<b>点击任意图形 → 下方展开三栏聚焦子图</b>：左列「来源·入」、右列「去向·出」，关系词写在流上，邻居可继续点选钻取。
      <b>「岛屿总览」按整章连通分量分岛</b>：每座岛是二维小图，但横坐标钉死在教材出现顺序上（隐藏横轴，从左往右读），纵坐标向邻居重心靠拢自然成团；关系画成微微上弯的曲线，点选节点高亮它的出入边。其他小节成员名字前带灰色小节标签；真正无边的孤立点合并成一个面板如实列出（多为待审核边缺失）。</div>
    <div class="chips" id="statsE"></div>
    <div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap">
      <button class="toggle" id="togglePC4">收起应用题型（ProblemClass）</button>
      <button class="toggle" id="toggleEdgesE">岛屿总览（全部关系）</button>
    </div>
    <div class="graph-scroll ladder-scroll"><div id="graphE"></div></div>
    <div id="detailE" style="margin-top:12px"></div>
  </div>

  <!-- ============ 案例 8：节点详情 ============ -->
  <div class="card">
    <h2>⑧ 节点详情面板（规则展开，KaTeX 渲染真实 RuleCase）</h2>
    <div class="caption">示例节点：矩阵消元法解线性方程组（Method，挂 2 条真实规则）。
      条件 → 结论折叠区；无规则的节点显示「暂无规则说明」，不伪造文本。</div>
    <div id="detail"></div>
  </div>

  <!-- ============ 案例 9：图例与空态 ============ -->
  <div class="card">
    <h2>⑨ 图例与空状态</h2>
    <div class="legend" id="legend"></div>
    <div class="empty" style="margin-top:12px">当前小节暂无已确认的知识关系。<br>节点列表仍可浏览，关系会在审核通过后出现。</div>
  </div>
</div>

<script id="kg-data" type="application/json">__DATA__</script>
<script>
const DATA = JSON.parse(document.getElementById('kg-data').textContent);

const STATUS = {
  unexplored:         {label:'未探索',   color:'#94a3b8'},
  learning:           {label:'学习中',   color:'#f59e0b'},
  basically_mastered: {label:'基本掌握', color:'#4ade80'},
  mastered:           {label:'已掌握',   color:'16a34a'.padStart(7,'#')},
  needs_review:       {label:'需要巩固', color:'#ef4444'},
};
const TYPE = {
  Concept:{tag:'概', color:'#64748b', label:'概念'},
  Theorem:{tag:'定', color:'#7c3aed', label:'定理'},
  Formula:{tag:'公', color:'#0d9488', label:'公式'},
  Method:{tag:'方',  color:'#2563eb', label:'方法'},
  ProblemClass:{tag:'题', color:'#d97706', label:'题型'},
};
const REL_CN = {USES:'使用', DERIVES:'推导出', GETS:'得到', HAS_PROPERTY:'具有性质',
  SUPERIOR:'上位于', PART_OF:'组成于', EQUATIVE:'并列于', APPLIES_TO:'应用于', PREREQUISITE_OF:'前置于'};

const byId = {}; DATA.nodes.forEach(n => byId[n.id] = n);
const secNodes = s => DATA.nodes.filter(n => n.section === s);
const secEdges = s => { const ids = new Set(secNodes(s).map(n => n.id));
  return DATA.edges.filter(e => ids.has(e.a) && ids.has(e.b)); };

/* ---------- shared bits ---------- */
function statusGlyph(s, x, y){
  const c = STATUS[s].color;
  if (s === 'unexplored') return `<circle cx="${x}" cy="${y}" r="5.5" fill="none" stroke="${c}" stroke-width="1.6"/>`;
  if (s === 'learning')   return `<circle cx="${x}" cy="${y}" r="5.5" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M ${x} ${y-5.5} A 5.5 5.5 0 0 1 ${x} ${y+5.5} Z" fill="${c}"/>`;
  if (s === 'mastered')   return `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/><path d="M ${x-2.6} ${y} l 1.9 2 l 3.4-3.6" stroke="#fff" stroke-width="1.4" fill="none"/>`;
  if (s === 'needs_review') return `<circle cx="${x}" cy="${y}" r="6" fill="${c}"/><text x="${x}" y="${y+3.2}" text-anchor="middle" font-size="8.5" fill="#fff" font-weight="700">!</text>`;
  return `<circle cx="${x}" cy="${y}" r="5.5" fill="${c}"/>`;
}
function typeBadge(t, x, y){
  const m = TYPE[t];
  return `<rect x="${x}" y="${y-7.5}" width="17" height="15" rx="4" fill="${m.color}1f"/>
          <text x="${x+8.5}" y="${y+3.6}" text-anchor="middle" font-size="9.5" fill="${m.color}" font-weight="600">${m.tag}</text>`;
}
function edgeTitle(e){
  const a = byId[e.a], b = byId[e.b];
  return `${a.name} —${REL_CN[e.type]||e.type}→ ${b.name}${e.status==='review'?'（待审核）':''}`;
}
function infoLine(el, nid, edges){
  if (!nid){ el.textContent = '点击节点查看关系明细'; return; }
  const n = byId[nid]; let html = `<b>${n.name}</b>（${TYPE[n.type].label}） `;
  edges.forEach(e => {
    if (e.a === nid) html += `<span class="relchip out">${REL_CN[e.type]||e.type} → ${byId[e.b].name}${e.status==='review'?'<span class="rv">·待审</span>':''}</span>`;
    if (e.b === nid) html += `<span class="relchip in">${byId[e.a].name} → ${REL_CN[e.type]||e.type}${e.status==='review'?'<span class="rv">·待审</span>':''}</span>`;
  });
  el.innerHTML = html;
}
function statsChips(el, s){
  const st = DATA.section_stats.find(x => x.section === s);
  el.innerHTML = `<span class="chip">节点 ${st.nodes}</span><span class="chip">边 ${st.edges}（实线 ${st.solid} / 虚线 ${st.dashed}）</span>` +
    (st.islands ? `<span class="chip">连通岛 ${st.islands.length}（${st.islands.join(' + ')}）</span>` : '') +
    Object.entries(st.types).map(([t,c]) => `<span class="chip" style="color:${TYPE[t].color}">${TYPE[t].label} ${c}</span>`).join('');
}
function texify(str){
  if (str == null) return '';
  return String(str).split(/(\$[^$]+\$)/g).map(p => {
    if (p.startsWith('$') && p.endsWith('$') && p.length > 2){
      try { return window.katex ? katex.renderToString(p.slice(1,-1), {throwOnError:true}) : p; }
      catch(e){ return p; }
    }
    return p.replace(/</g,'&lt;');
  }).join('');
}
/* 形状=类型：概念圆 / 定理三角 / 公式方 / 方法六边形 / 题型小页（纸页+两行字） */
function shapeAt(t){
  const c = TYPE[t].color;
  if (t === 'Theorem')      return `<path d="M 0 -8 L 7.5 6 L -7.5 6 Z" fill="var(--card)" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`;
  if (t === 'Formula')      return `<rect x="-6.5" y="-6.5" width="13" height="13" rx="2" fill="var(--card)" stroke="${c}" stroke-width="2"/>`;
  if (t === 'Method')       return `<path d="M 7.5 0 L 3.75 6.5 L -3.75 6.5 L -7.5 0 L -3.75 -6.5 L 3.75 -6.5 Z" fill="var(--card)" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`;
  if (t === 'ProblemClass') return `<rect x="-5" y="-6.5" width="10" height="13" rx="1.8" fill="var(--card)" stroke="${c}" stroke-width="2"/>
    <line x1="-2.4" y1="-1.6" x2="2.4" y2="-1.6" stroke="${c}" stroke-width="1.3"/>
    <line x1="-2.4" y1="1.8" x2="2.4" y2="1.8" stroke="${c}" stroke-width="1.3"/>`;
  return `<circle cx="0" cy="0" r="7" fill="var(--card)" stroke="${c}" stroke-width="2"/>`;   // Concept
}
function cornerBadge(s){
  const c = STATUS[s].color;
  if (s === 'unexplored') return `<circle cx="9" cy="-9" r="4" fill="var(--card)" stroke="${c}" stroke-width="1.4"/>`;
  return `<circle cx="9" cy="-9" r="4" fill="${c}" stroke="var(--card)" stroke-width="1.2"/>`;
}

/* ---------- 案例 1：章总览 ---------- */
(function(){
  const el = document.getElementById('overview');
  let html = '';
  DATA.section_stats.forEach(st => {
    const ns = secNodes(st.section);
    const counts = {}; ns.forEach(n => counts[n.demo_status] = (counts[n.demo_status]||0)+1);
    const bar = Object.keys(STATUS).map(k =>
      counts[k] ? `<span style="width:${counts[k]/ns.length*100}%;background:${STATUS[k].color}" title="${STATUS[k].label} ${counts[k]}"></span>` : ''
    ).join('');
    html += `<div class="secrow">
      <div class="secname">${st.section}</div>
      <div class="bar">${bar}</div>
      <div class="sub" style="white-space:nowrap">${st.nodes} 知识点 · ${st.edges} 关系</div>
    </div>`;
  });
  el.innerHTML = html;
})();

/* ---------- 案例 2：样式 A 纵向弧线 ---------- */
(function(){
  const ALL = secNodes(DATA.sections[0]);
  const EDGES = secEdges(DATA.sections[0]);
  const box = document.getElementById('graphA'), info = document.getElementById('infoA');
  const rowH = 33, padT = 12, labelW = 300;
  let showPC = false, selected = null;
  statsChips(document.getElementById('statsA'), DATA.sections[0]);

  function render(){
    const nodes = ALL.filter(n => showPC || n.type !== 'ProblemClass');
    const idx = {}; nodes.forEach((n,i) => idx[n.id] = i);
    const edges = EDGES.filter(e => idx[e.a] !== undefined && idx[e.b] !== undefined);
    const maxSpan = edges.reduce((m,e) => Math.max(m, Math.abs(idx[e.a]-idx[e.b])), 1);
    const arcW = Math.min(30 + maxSpan*13, 330);
    const W = labelW + arcW + 30, H = padT*2 + nodes.length*rowH;
    const y = i => padT + i*rowH + rowH/2;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;display:block">`;
    edges.forEach(e => {
      const i = idx[e.a], j = idx[e.b], b = 14 + Math.abs(j-i)*13;
      const cls = `edge ${e.status==='review'?'review':''}`;
      svg += `<path class="${cls}" data-a="${e.a}" data-b="${e.b}"
        d="M ${labelW} ${y(i)} C ${labelW+b} ${y(i)}, ${labelW+b} ${y(j)}, ${labelW} ${y(j)}"><title>${edgeTitle(e)}</title></path>`;
    });
    nodes.forEach((n,i) => {
      svg += `<g class="rowg" data-id="${n.id}">
        <rect x="0" y="${padT+i*rowH}" width="${labelW}" height="${rowH}" fill="transparent" rx="6"/>
        ${statusGlyph(n.demo_status, 12, y(i))}
        ${typeBadge(n.type, 28, y(i))}
        <text class="nm" x="52" y="${y(i)+4.5}">${n.name}</text>
        <circle cx="${labelW}" cy="${y(i)}" r="2.6" fill="var(--txt3)"/>
      </g>`;
    });
    svg += '</svg>';
    box.innerHTML = svg;

    box.querySelectorAll('.rowg').forEach(g => g.addEventListener('click', () => {
      selected = (selected === g.dataset.id) ? null : g.dataset.id;
      paint(); infoLine(info, selected, EDGES);
    }));
    paint();
  }
  function paint(){
    box.querySelectorAll('.edge').forEach(p => {
      p.classList.remove('out','in','dim');
      if (!selected) return;
      if (p.dataset.a === selected) p.classList.add('out');
      else if (p.dataset.b === selected) p.classList.add('in');
      else p.classList.add('dim');
    });
    box.querySelectorAll('.rowg .nm').forEach(t => {
      const id = t.parentNode.dataset.id;
      t.classList.toggle('nm-dim', !!selected &&
        id !== selected && ![...box.querySelectorAll('.edge.out,.edge.in')].some(p => p.dataset.a === id || p.dataset.b === id));
    });
  }
  document.getElementById('togglePC').addEventListener('click', ev => {
    showPC = !showPC; selected = null; infoLine(info, null, EDGES);
    ev.target.textContent = showPC ? '收起应用题型（ProblemClass）' : '显示应用题型（ProblemClass）';
    render();
  });
  render();
})();

/* ---------- 案例 3：样式 B 横向地铁图 ---------- */
(function(){
  const NODES = secNodes(DATA.sections[1]), EDGES = secEdges(DATA.sections[1]);
  const box = document.getElementById('graphB'), info = document.getElementById('infoB');
  statsChips(document.getElementById('statsB'), DATA.sections[1]);
  const gap = 162, baseY = 150, padL = 40;
  const idx = {}; NODES.forEach((n,i) => idx[n.id] = i);
  const W = padL*2 + (NODES.length-1)*gap, H = 330;
  const x = i => padL + i*gap;
  const clip = (s, n15) => s.length > n15 ? s.slice(0, n15-1) + '…' : s;
  let selected = null;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block">`;
  EDGES.forEach(e => {
    const i = idx[e.a], j = idx[e.b], span = Math.abs(j-i), h = Math.min(24+span*17, 118);
    svg += `<path class="edge ${e.status==='review'?'review':''}" data-a="${e.a}" data-b="${e.b}"
      d="M ${x(i)} ${baseY-8} C ${x(i)} ${baseY-8-h}, ${x(j)} ${baseY-8-h}, ${x(j)} ${baseY-8}"><title>${edgeTitle(e)}</title></path>`;
  });
  svg += `<line x1="${padL-18}" y1="${baseY}" x2="${W-padL+18}" y2="${baseY}" stroke="var(--line)" stroke-width="2"/>`;
  NODES.forEach((n,i) => {
    svg += `<g class="rowg" data-id="${n.id}"><title>${n.name}</title>
      <circle cx="${x(i)}" cy="${baseY}" r="7" fill="var(--card)" stroke="${TYPE[n.type].color}" stroke-width="2.2"/>
      ${statusGlyph(n.demo_status, x(i), baseY-18)}
      <text class="nm" x="${x(i)+2}" y="${baseY+16}" font-size="12"
        transform="rotate(38 ${x(i)+2} ${baseY+16})">${clip(n.name, 16)}</text>
    </g>`;
  });
  svg += '</svg>';
  box.innerHTML = svg;
  box.querySelectorAll('.rowg').forEach(g => g.addEventListener('click', () => {
    selected = (selected === g.dataset.id) ? null : g.dataset.id;
    box.querySelectorAll('.edge').forEach(p => {
      p.classList.remove('out','in','dim');
      if (!selected) return;
      if (p.dataset.a === selected) p.classList.add('out');
      else if (p.dataset.b === selected) p.classList.add('in');
      else p.classList.add('dim');
    });
    infoLine(info, selected, EDGES);
  }));
})();

/* ---------- 案例 4：样式 C 类型泳道 ---------- */
(function(){
  const NODES = secNodes(DATA.sections[2]), EDGES = secEdges(DATA.sections[2]);
  const box = document.getElementById('graphC'), info = document.getElementById('infoC');
  statsChips(document.getElementById('statsC'), DATA.sections[2]);
  const LANES = ['Concept','Theorem','Formula','Method','ProblemClass'].filter(t => NODES.some(n => n.type === t));
  const laneW = 244, rowH = 32, headH = 34, padT = 12;
  const clipC = s => s.length > 12 ? s.slice(0, 11) + '…' : s;
  const pos = {}; let maxRows = 0;
  LANES.forEach((t,li) => {
    NODES.filter(n => n.type === t).forEach((n,ri) => { pos[n.id] = {x: li*laneW + laneW/2, y: padT+headH+ri*rowH+rowH/2, row: ri, lane: li}; });
    maxRows = Math.max(maxRows, NODES.filter(n => n.type === t).length);
  });
  const W = LANES.length*laneW + 16, H = padT*2 + headH + maxRows*rowH;
  let selected = null;

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;display:block">`;
  LANES.forEach((t,li) => {
    const lx = li*laneW + 8;
    svg += `<rect x="${lx}" y="6" width="${laneW-16}" height="${H-12}" rx="10" fill="var(--bg)" opacity=".55"/>
      <text x="${lx+laneW/2-8}" y="${padT+14}" text-anchor="middle" font-size="12" font-weight="700" fill="${TYPE[t].color}">${TYPE[t].label} ${NODES.filter(n=>n.type===t).length}</text>`;
  });
  EDGES.forEach(e => {
    const p = pos[e.a], q = pos[e.b];
    svg += `<line class="edge ${e.status==='review'?'review':''}" data-a="${e.a}" data-b="${e.b}"
      x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"><title>${edgeTitle(e)}</title></line>`;
  });
  NODES.forEach(n => {
    const p = pos[n.id];
    svg += `<g class="rowg" data-id="${n.id}"><title>${n.name}</title>
      ${statusGlyph(n.demo_status, p.x - laneW/2 + 22, p.y)}
      <text class="nm" x="${p.x - laneW/2 + 36}" y="${p.y+4}" font-size="12.5">${clipC(n.name)}</text>
    </g>`;
  });
  svg += '</svg>';
  box.innerHTML = svg;
  box.querySelectorAll('.rowg').forEach(g => g.addEventListener('click', () => {
    selected = (selected === g.dataset.id) ? null : g.dataset.id;
    box.querySelectorAll('.edge').forEach(p => {
      p.classList.remove('out','in','dim');
      if (!selected) return;
      if (p.dataset.a === selected) p.classList.add('out');
      else if (p.dataset.b === selected) p.classList.add('in');
      else p.classList.add('dim');
    });
    infoLine(info, selected, EDGES);
  }));
})();

/* ---------- 案例 5：样式 C 稠密适配版（渠道走线） ---------- */
(function(){
  const ALL = secNodes(DATA.sections[0]);           // 1.1：28 节点 / 33 边
  const EDGES = secEdges(DATA.sections[0]);
  const box = document.getElementById('graphC2'), info = document.getElementById('infoC2');
  const LANE_ORDER = ['Theorem','Concept','Formula','Method','ProblemClass'];
  const laneW = 236, rowH = 31, headH = 36, padT = 12;
  const clipC = s => s.length > 12 ? s.slice(0, 11) + '…' : s;
  let showPC = false, selected = null, showAll = false;
  statsChips(document.getElementById('statsC2'), DATA.sections[0]);

  function render(){
    const NODES = ALL.filter(n => showPC || n.type !== 'ProblemClass');
    const ids = new Set(NODES.map(n => n.id));
    const edges = EDGES.filter(e => ids.has(e.a) && ids.has(e.b));
    const LANES = LANE_ORDER.filter(t => NODES.some(n => n.type === t));
    const seq = {}; ALL.forEach((n,i) => seq[n.id] = i + 1);   // 全节讲授序号
    const pos = {}, laneOf = {};
    let maxRows = 0;
    LANES.forEach((t, li) => {
      const rows = NODES.filter(n => n.type === t);
      rows.forEach((n, ri) => { pos[n.id] = {x: li*laneW + laneW/2, y: padT+headH+ri*rowH+rowH/2}; laneOf[n.id] = li; });
      maxRows = Math.max(maxRows, rows.length);
    });
    const W = LANES.length*laneW + 16, H = padT*2 + headH + maxRows*rowH;

    function edgePath(e){
      const p = pos[e.a], q = pos[e.b], la = laneOf[e.a], lb = laneOf[e.b];
      if (la === lb){                       // 泳道内：向左凸起
        const gx = la*laneW + 30;
        return `M ${p.x} ${p.y} C ${gx} ${p.y}, ${gx} ${q.y}, ${q.x} ${q.y}`;
      }
      const dir = lb > la ? 1 : -1, span = Math.abs(lb-la);
      if (span === 1){                      // 相邻泳道：S 曲线
        return `M ${p.x} ${p.y} C ${p.x + dir*64} ${p.y}, ${q.x - dir*64} ${q.y}, ${q.x} ${q.y}`;
      }                                      // 跨道：走中间渠道
      const midG = ((Math.min(la,lb)+1 + Math.max(la,lb)) / 2) * laneW;
      return `M ${p.x} ${p.y} C ${midG} ${p.y}, ${midG} ${q.y}, ${q.x} ${q.y}`;
    }

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;display:block">`;
    LANES.forEach((t, li) => {
      const lx = li*laneW + 8;
      svg += `<rect x="${lx}" y="6" width="${laneW-16}" height="${H-12}" rx="10" fill="var(--bg)" opacity=".55"/>
        <text x="${lx+laneW/2-8}" y="${padT+14}" text-anchor="middle" font-size="12" font-weight="700" fill="${TYPE[t].color}">${TYPE[t].label} ${NODES.filter(n=>n.type===t).length}</text>`;
    });
    edges.forEach(e => {
      svg += `<path class="edge hidden-edge ${e.status==='review'?'review':''}" data-a="${e.a}" data-b="${e.b}" d="${edgePath(e)}"><title>${edgeTitle(e)}</title></path>`;
    });
    NODES.forEach(n => {
      const p = pos[n.id];
      svg += `<g class="rowg" data-id="${n.id}"><title>${n.name}</title>
        ${statusGlyph(n.demo_status, p.x - laneW/2 + 30, p.y)}
        <text x="${p.x - laneW/2 + 42}" y="${p.y+3.5}" font-size="10" fill="var(--txt3)">${seq[n.id]}</text>
        <text class="nm" x="${p.x - laneW/2 + 58}" y="${p.y+4}" font-size="12.5">${clipC(n.name)}</text>
      </g>`;
    });
    svg += '</svg>';
    box.innerHTML = svg;

    box.querySelectorAll('.rowg').forEach(g => g.addEventListener('click', () => {
      selected = (selected === g.dataset.id) ? null : g.dataset.id;
      paint(); infoLine(info, selected, EDGES);
    }));
    paint();

    function paint(){
      box.querySelectorAll('.edge').forEach(p => {
        const incident = selected && (p.dataset.a === selected || p.dataset.b === selected);
        p.classList.toggle('hidden-edge', !(showAll || incident));
        p.classList.remove('out','in','dim');
        if (!selected) return;
        if (p.dataset.a === selected) p.classList.add('out');
        else if (p.dataset.b === selected) p.classList.add('in');
        else if (showAll) p.classList.add('dim');
      });
      box.querySelectorAll('.rowg .nm').forEach(t => {
        const id = t.parentNode.dataset.id;
        t.classList.toggle('nm-dim', !!selected &&
          id !== selected && !EDGES.some(e => (e.a === selected && e.b === id) || (e.b === selected && e.a === id)));
      });
    }
    document.getElementById('toggleEdges').addEventListener('click', ev => {
      showAll = !showAll;
      ev.target.textContent = showAll ? '收起全部关系（回到按需展开）' : '显示全部关系（纵览，稠密时较乱）';
      paint();
    });
  }
  document.getElementById('togglePC2').addEventListener('click', ev => {
    showPC = !showPC; selected = null; infoLine(info, null, EDGES);
    ev.target.textContent = showPC ? '收起应用题型（ProblemClass）' : '显示应用题型（ProblemClass）';
    render();
  });
  render();
})();

/* ---------- 案例 6：样式 D 星图 + 索引 ---------- */
(function(){
  const ALL = secNodes(DATA.sections[0]);           // 1.1：28 节点（含 4 个 ProblemClass）
  const EDGES = secEdges(DATA.sections[0]);
  const box = document.getElementById('graphD');
  const indexEl = document.getElementById('indexD');
  const detailEl = document.getElementById('detailD');
  statsChips(document.getElementById('statsD'), DATA.sections[0]);
  const seq = {}; ALL.forEach((n,i) => seq[n.id] = i+1);
  const POS = DATA.positions || {};
  const X = id => 40 + POS[id][0]*920, Y = id => 30 + POS[id][1]*620;
  let showPC = false, selected = null;
  let gById = {}, rowById = {};

  function render(){
    const NODES = ALL.filter(n => showPC || n.type !== 'ProblemClass');
    const ids = new Set(NODES.map(n => n.id));
    const edges = EDGES.filter(e => ids.has(e.a) && ids.has(e.b));
    const nb = new Set();
    if (selected) edges.forEach(e => {
      if (e.a === selected) nb.add(e.b);
      if (e.b === selected) nb.add(e.a);
    });

    let svg = `<svg viewBox="0 0 1000 680" style="width:100%;height:auto;display:block">`;
    edges.forEach(e => {
      let cls = 'edge d-edge' + (e.status === 'review' ? ' review' : '');
      if (selected){
        if (e.a === selected) cls += ' out';
        else if (e.b === selected) cls += ' in';
        else cls += ' dim';
      }
      svg += `<line class="${cls}" x1="${X(e.a)}" y1="${Y(e.a)}" x2="${X(e.b)}" y2="${Y(e.b)}"><title>${edgeTitle(e)}</title></line>`;
    });
    NODES.forEach(n => {
      const sel = n.id === selected;
      svg += `<g class="glyph${sel ? ' sel' : ''}" data-id="${n.id}" transform="translate(${X(n.id)} ${Y(n.id)}) scale(${sel ? 1.35 : 1})">
        <title>${n.name}</title>
        <circle class="halo" cx="0" cy="0" r="12" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
        ${shapeAt(n.type)}
        ${cornerBadge(n.demo_status)}
      </g>`;
    });
    NODES.forEach(n => {
      if (n.id === selected || nb.has(n.id))
        svg += `<text class="nm d-label" x="${X(n.id)}" y="${Y(n.id)-16}" text-anchor="middle">${n.name}</text>`;
    });
    svg += '</svg>';
    box.innerHTML = svg;

    indexEl.innerHTML = NODES.map(n => `<div class="idx-row${n.id === selected ? ' sel' : ''}" data-id="${n.id}">
      <span class="st" style="width:9px;height:9px;margin-right:0;background:${n.demo_status === 'unexplored' ? 'var(--card)' : STATUS[n.demo_status].color};border:1.4px solid ${STATUS[n.demo_status].color}"></span>
      <span class="seq">${seq[n.id]}</span>
      <span class="name">${n.name}</span>
      <span class="tbadge" style="color:${TYPE[n.type].color};background:${TYPE[n.type].color}1f">${TYPE[n.type].label}</span>
    </div>`).join('');

    gById = {}; rowById = {};
    box.querySelectorAll('.glyph').forEach(g => {
      gById[g.dataset.id] = g;
      g.addEventListener('click', () => select(g.dataset.id));
      g.addEventListener('mouseover', () => { const r = rowById[g.dataset.id];
        if (r){ r.classList.add('hot'); r.scrollIntoView({block:'nearest'}); } });
      g.addEventListener('mouseout', () => { const r = rowById[g.dataset.id];
        if (r) r.classList.remove('hot'); });
    });
    indexEl.querySelectorAll('.idx-row').forEach(r => {
      rowById[r.dataset.id] = r;
      r.addEventListener('click', () => select(r.dataset.id));
      r.addEventListener('mouseover', () => { const g = gById[r.dataset.id]; if (g) g.classList.add('hot'); });
      r.addEventListener('mouseout', () => { const g = gById[r.dataset.id]; if (g) g.classList.remove('hot'); });
    });
  }

  function select(id){
    selected = (selected === id) ? null : id;
    render(); renderDetail();
  }

  function renderDetail(){
    if (!selected){ detailEl.innerHTML = `<div class="empty">点击星图图形或索引行，查看节点详情与规则</div>`; return; }
    const n = byId[selected];
    const edges = EDGES.filter(e => e.a === selected || e.b === selected);
    const outs = edges.filter(e => e.a === selected), ins = edges.filter(e => e.b === selected);
    const rules = DATA.rules.filter(r => r.node_name === n.name);
    detailEl.innerHTML = `<div class="detail" style="max-width:none">
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <svg width="20" height="20" viewBox="-11 -11 22 22">${shapeAt(n.type)}</svg>
          <span style="font-size:16px;font-weight:700">${n.name}</span>
          <span class="chip" style="color:${TYPE[n.type].color};border-color:${TYPE[n.type].color}55">${TYPE[n.type].label}</span>
          <span class="chip" style="color:${STATUS[n.demo_status].color};border-color:${STATUS[n.demo_status].color}55">${STATUS[n.demo_status].label}（演示）</span>
        </div>
        <div class="kv" style="margin-top:4px">所属：${n.section} · ${outs.length} 条出边 · ${ins.length} 条入边 · ${rules.length} 条规则</div>
      </div>
      <div class="relinfo" style="margin-top:2px">
        ${outs.map(e => `<span class="relchip out" data-go="${e.b}" style="cursor:pointer">${REL_CN[e.type] || e.type} → ${byId[e.b].name}${e.status === 'review' ? '<span class="rv">·待审</span>' : ''}</span>`).join('')}
        ${ins.map(e => `<span class="relchip in" data-go="${e.a}" style="cursor:pointer">${byId[e.a].name} → ${REL_CN[e.type] || e.type}${e.status === 'review' ? '<span class="rv">·待审</span>' : ''}</span>`).join('')}
        ${edges.length ? '' : '<span class="kv">本节点暂无小节内关系</span>'}
      </div>
      ${rules.length ? rules.map(r => `<div class="rule">
          <h4>${r.rule_name}</h4>
          <div class="kv">适用条件${r.logic ? '（' + r.logic + '）' : ''}</div>
          <ul>${r.conditions.filter(Boolean).map(c => `<li>${texify(c)}</li>`).join('')}</ul>
          <div class="arrow">↓ 则</div>
          <ul>${r.outcomes.filter(Boolean).map(o => `<li>${texify(o)}</li>`).join('')}</ul>
        </div>`).join('') : '<div class="empty">暂无规则说明</div>'}
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-primary">继续学习</button>
        <button class="btn btn-ghost">查看来源提问</button>
      </div>
    </div>`;
    detailEl.querySelectorAll('.relchip[data-go]').forEach(c =>
      c.addEventListener('click', () => {
        const t = c.dataset.go;
        if (byId[t].type === 'ProblemClass' && !showPC) return;   // 目标被收起时忽略跳转
        select(t);
      }));
  }

  document.getElementById('togglePC3').addEventListener('click', ev => {
    showPC = !showPC;
    if (selected && byId[selected].type === 'ProblemClass' && !showPC){ selected = null; renderDetail(); }
    ev.target.textContent = showPC ? '收起应用题型（ProblemClass）' : '显示应用题型（ProblemClass）';
    render();
  });
  render(); renderDetail();
})();

/* ---------- 案例 7：样式 E v2 蛇形梯子 + 题型侧枝 + 聚焦子图 ---------- */
(function(){
  const ALL = secNodes(DATA.sections[0]);           // 1.1
  const EDGES = secEdges(DATA.sections[0]);
  const box = document.getElementById('graphE');
  const detailEl = document.getElementById('detailE');
  statsChips(document.getElementById('statsE'), DATA.sections[0]);
  const gapY = 92, amp = 150, cx = 350, padT = 56, W = 700;
  const allSeq = {}; ALL.forEach((n,i) => allSeq[n.id] = i+1);
  let showPC = true, selected = null, showAll = false;
  const POS = DATA.positions || {};

  function render(){
    if (showAll){ renderIslands(); return; }
    const CORE = ALL.filter(n => n.type !== 'ProblemClass');
    const PCS  = ALL.filter(n => n.type === 'ProblemClass');
    const pos = {}, order = {};
    CORE.forEach((n,i) => { pos[n.id] = {x: cx + amp*Math.sin(i*0.92), y: padT + i*gapY}; order[n.id] = i; });

    // 题型侧枝：挂到它在节内「指向/被指向」的核心节点；无关系则挂到讲授序最近的核心节点
    const twigs = [];
    if (showPC){
      const byTarget = {};
      PCS.forEach(pc => {
        const out = EDGES.find(e => e.a === pc.id && order[e.b] !== undefined);
        const inc = EDGES.find(e => e.b === pc.id && order[e.a] !== undefined);
        let target = out ? out.b : (inc ? inc.a : null);
        if (!target){
          let bd = 1e9;
          CORE.forEach(n => { const d = Math.abs(allSeq[n.id] - allSeq[pc.id]); if (d < bd){ bd = d; target = n.id; } });
        }
        (byTarget[target] = byTarget[target] || []).push(pc);
      });
      Object.entries(byTarget).forEach(([tid, list]) => {
        const p = pos[tid], side = p.x >= cx ? 1 : -1;
        list.forEach((pc, k) => {
          pos[pc.id] = {x: p.x + side*(54 + k*58), y: p.y + 30, twigOf: tid};
          twigs.push({pc: pc.id, from: tid});
        });
      });
    }

    const rel = EDGES.filter(e => pos[e.a] && pos[e.b]);
    const nb = new Set();
    if (selected) rel.forEach(e => {
      if (e.a === selected) nb.add(e.b);
      if (e.b === selected) nb.add(e.a);
    });
    const H = padT*2 + (CORE.length-1)*gapY + 30;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;display:block;margin:0 auto">`;
    for (let i = 0; i < CORE.length-1; i++){                          // 主梯：中性灰
      const p = pos[CORE[i].id], q = pos[CORE[i+1].id];
      svg += `<line class="spine" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/>`;
    }
    twigs.forEach(t => {                                              // 侧枝短柄
      const p = pos[t.from], q = pos[t.pc];
      svg += `<line class="twig" x1="${p.x}" y1="${p.y+8}" x2="${q.x}" y2="${q.y-2}"/>`;
    });
    Object.keys(pos).forEach(id => {                                  // 图形
      const n = byId[id], p = pos[id];
      const sel = id === selected;
      svg += `<g class="glyph${sel ? ' sel' : ''}${nb.has(id) ? ' nb' : ''}" data-id="${id}" transform="translate(${p.x} ${p.y}) scale(${sel ? 1.35 : 1})">
        <title>${n.name}</title>
        <circle class="halo" cx="0" cy="0" r="12" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
        ${shapeAt(n.type)}
        ${cornerBadge(n.demo_status)}
      </g>`;
    });
    CORE.forEach(n => {                                               // 核心节点名称全程显示
      const p = pos[n.id], right = p.x >= cx;
      const dim = selected && n.id !== selected && !nb.has(n.id);
      svg += `<text class="nm d-label${dim ? ' nm-dim' : ''}" x="${p.x + (right ? 16 : -16)}" y="${p.y + 4}" text-anchor="${right ? 'start' : 'end'}">${n.name}</text>`;
    });
    if (showPC) PCS.forEach(n => {                                    // 侧枝名称仅自身被选中时显示，朝向梯子一侧防裁边
      const p = pos[n.id];
      if (!p || n.id !== selected) return;
      const anchor = p.x < cx ? 'start' : 'end';
      svg += `<text class="nm d-label" x="${p.x}" y="${p.y + 20}" text-anchor="${anchor}" font-size="11">${n.name}</text>`;
    });
    svg += '</svg>';
    box.innerHTML = svg;
    box.querySelectorAll('.glyph').forEach(g =>
      g.addEventListener('click', () => select(g.dataset.id)));
  }

  /* 岛屿总览：整章连通分量；岛内隐藏横轴=教材顺序，关系画成上方弧线（弧线图） */
  function renderIslands(){
    const VIS = DATA.nodes.filter(n => showPC || n.type !== 'ProblemClass');   // 整章范围
    const ids = new Set(VIS.map(n => n.id));
    const rel = DATA.edges.filter(e => ids.has(e.a) && ids.has(e.b));
    const seqCh = {}; DATA.nodes.forEach((n,i) => seqCh[n.id] = i);
    const parent = {}; VIS.forEach(n => parent[n.id] = n.id);
    const find = x => { while (parent[x] !== x){ parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    rel.forEach(e => { const ra = find(e.a), rb = find(e.b); if (ra !== rb) parent[rb] = ra; });
    const groups = {};
    VIS.forEach(n => { const r = find(n.id); (groups[r] = groups[r] || []).push(n); });
    const islands = Object.values(groups)
      .sort((a,b) => Math.min(...a.map(n => seqCh[n.id])) - Math.min(...b.map(n => seqCh[n.id])));
    const singles = islands.filter(g => g.length === 1);
    const mains = islands.filter(g => g.length > 1);
    const mainSize = Math.max(...mains.map(g => g.length));
    const curSec = DATA.sections[0].slice(0, 3);
    let html = '';

    mains.forEach((g, gi) => {
      const sorted = g.slice().sort((a,b) => seqCh[a.id] - seqCh[b.id]);
      const n = sorted.length;
      const stepX = 106, pad = 52, rowH = 88, padT = 46;
      const perRow = n <= 12 ? n : Math.ceil(n / Math.ceil(n / 12));
      const rows = Math.ceil(n / perRow);
      const PH = padT*2 + (rows-1)*rowH + 24;
      const PW = Math.max(420, pad*2 + (perRow-1)*stepX);
      /* 二维布局：教材序按蛇形分行（每行约 12 个），行内从左往右、行间 S 形衔接 */
      const posI = {};
      sorted.forEach((nd,i) => {
        const r = Math.floor(i / perRow), c = i % perRow;
        const cc = (r % 2 === 0) ? c : (perRow - 1 - c);
        posI[nd.id] = {x: pad + cc*stepX, y: padT + r*rowH, i};
      });
      const inset = new Set(g.map(nd => nd.id));
      const iedges = rel.filter(e => inset.has(e.a) && inset.has(e.b));
      const secs = [...new Set(g.map(nd => nd.section.slice(0,3)))].join('/');
      const sel = (selected && inset.has(selected)) ? selected : null;
      const nb = new Set();
      if (sel) iedges.forEach(e => {
        if (e.a === sel) nb.add(e.b);
        if (e.b === sel) nb.add(e.a);
      });
      let s = `<div class="isle"><div class="isle-head">岛 ${gi+1} · ${n} 节点 · 跨 ${secs}${n === mainSize ? '（本章主干）' : ''} · ${rows > 1 ? '蛇形=教材出现顺序' : '横轴=教材出现顺序'}</div>` +
        `<svg viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}" style="display:block;margin:0 auto">`;
      iedges.forEach(e => {
        const A = posI[e.a], B = posI[e.b], span = Math.abs(A.i-B.i);
        let d;
        if (Math.abs(A.y - B.y) < 1){
          const bow = Math.min(12 + span*5, 42);
          d = `M ${A.x} ${A.y} Q ${(A.x+B.x)/2} ${Math.max(8, A.y - bow)} ${B.x} ${B.y}`;
        } else {
          const dir = A.y < B.y ? 1 : -1;
          d = `M ${A.x} ${A.y} C ${A.x} ${A.y + dir*44}, ${B.x} ${B.y - dir*44}, ${B.x} ${B.y}`;
        }
        let cls = 'e-edge';
        if (sel) cls += e.a === sel ? ' out' : (e.b === sel ? ' in' : ' dim');
        s += `<path class="${cls}" d="${d}"><title>${edgeTitle(e)}</title></path>`;
      });
      sorted.forEach(nd => {
        const p = posI[nd.id];
        const secTag = nd.section.slice(0,3) === curSec ? '' : `${nd.section.slice(0,3)}·`;
        const dim = sel && nd.id !== sel && !nb.has(nd.id);
        s += `<g class="glyph${nd.id===sel?' sel':''}${nb.has(nd.id)?' nb':''}" data-id="${nd.id}" transform="translate(${p.x} ${p.y})"><title>${nd.name}</title>` +
          `<circle class="halo" cx="0" cy="0" r="12" fill="none" stroke="var(--accent)" stroke-width="1.6"/>` +
          `${shapeAt(nd.type)}${cornerBadge(nd.demo_status)}</g>`;
        const lns = nd.name.match(/.{1,8}/g);
        s += `<text class="nm d-label${dim ? ' nm-dim' : ''}" text-anchor="middle" font-size="10.5">` +
          lns.map((ln, li) => `<tspan x="${p.x}" y="${p.y + 16 + li*11}">${li === 0 && secTag ? `<tspan fill="var(--txt3)" font-size="9">${secTag}</tspan>` : ''}${ln}</tspan>`).join('') +
          '</text>';
      });
      s += `<text class="xlab" x="${PW-8}" y="${PH-6}" text-anchor="end">${rows > 1 ? '蛇形排列 · 按教材出现顺序' : '教材出现顺序 →'}</text>`;
      s += '</svg></div>';
      html += s;
    });

    if (singles.length){
      html += `<div class="isle"><div class="isle-head">孤立点 ×${singles.length}（整章暂无已连关系——多为待审核边缺失，见 Q2 分析）</div><div style="padding:4px 10px 10px">` +
        singles.map(g => { const n = g[0];
          return `<span class="glyph-s" data-id="${n.id}" style="display:inline-flex;align-items:center;gap:5px;margin:4px 12px 4px 0;font-size:12px;cursor:pointer">
            <svg width="16" height="16" viewBox="-9 -9 18 18">${shapeAt(n.type)}</svg>${n.name}<span class="sub" style="font-size:10.5px">${n.section.slice(0,3)}</span></span>`;
        }).join('') + '</div></div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('.glyph,.glyph-s').forEach(g =>
      g.addEventListener('click', () => select(g.dataset.id)));
  }

  /* 聚焦子图：左「来源·入」| 中选点 | 右「去向·出」三栏流，关系词写在流上 */
  function wrapName(name, x, y, anchor){
    if (name.length <= 9) return `<text class="nm d-label" x="${x}" y="${y+4}" text-anchor="${anchor}" font-size="11.5">${name}</text>`;
    const mid = Math.ceil(name.length/2);
    return `<text class="nm d-label" text-anchor="${anchor}" font-size="11.5">` +
      `<tspan x="${x}" y="${y-3}">${name.slice(0, mid)}</tspan><tspan x="${x}" y="${y+11}">${name.slice(mid)}</tspan></text>`;
  }
  function focusSvg(n, edges){
    if (!edges.length) return '';
    const curSec = DATA.sections[0].slice(0, 3);
    const secPre = m => m.section.slice(0, 3) === curSec ? '' : m.section.slice(0, 3) + '·';
    const outs = edges.filter(e => e.a === n.id);
    const ins  = edges.filter(e => e.b === n.id);
    const rowH = 46, padT = 40, FW = 680, LX = 130, RX = 550, ccx = 340;
    const rows = Math.max(outs.length, ins.length, 1);
    const FH = padT*2 + rows*rowH, ccy = FH/2;
    let s = `<div class="focus-wrap"><svg viewBox="0 0 ${FW} ${FH}" style="width:100%;height:auto;display:block">`;
    s += `<text class="focus-lab" x="${LX}" y="22" text-anchor="middle" fill="var(--amber)">← 来源（支撑它）</text>`;
    s += `<text class="focus-lab" x="${RX}" y="22" text-anchor="middle" fill="var(--accent)">去向（它支撑）→</text>`;
    const place = (list, x) => list.map((e,i) => ({
      e, id: e.a === n.id ? e.b : e.a, x,
      y: padT + rowH/2 + (i + (rows - list.length)/2) * rowH,
    }));
    place(ins, LX).forEach(({e, id, x, y}) => {
      s += `<path class="focus-edge in" d="M ${x+10} ${y} C ${x+100} ${y}, ${ccx-100} ${ccy}, ${ccx-12} ${ccy}"/>`;
      s += `<text class="focus-lab" x="${(x+ccx)/2}" y="${(y+ccy)/2 - 5}" text-anchor="middle" fill="var(--amber)">${REL_CN[e.type] || e.type}${e.status === 'review' ? '·待审' : ''}</text>`;
      const m = byId[id];
      s += `<g class="glyph" data-id="${id}" transform="translate(${x} ${y})"><title>${m.name}</title><circle class="halo" cx="0" cy="0" r="12" fill="none" stroke="var(--accent)" stroke-width="1.6"/>${shapeAt(m.type)}${cornerBadge(m.demo_status)}</g>`;
      s += wrapName(secPre(m) + m.name, x-13, y, 'end');
    });
    place(outs, RX).forEach(({e, id, x, y}) => {
      s += `<path class="focus-edge out" d="M ${ccx+12} ${ccy} C ${ccx+100} ${ccy}, ${x-100} ${y}, ${x-10} ${y}"/>`;
      s += `<text class="focus-lab" x="${(x+ccx)/2}" y="${(y+ccy)/2 - 5}" text-anchor="middle" fill="var(--accent)">${REL_CN[e.type] || e.type}${e.status === 'review' ? '·待审' : ''}</text>`;
      const m = byId[id];
      s += `<g class="glyph" data-id="${id}" transform="translate(${x} ${y})"><title>${m.name}</title><circle class="halo" cx="0" cy="0" r="12" fill="none" stroke="var(--accent)" stroke-width="1.6"/>${shapeAt(m.type)}${cornerBadge(m.demo_status)}</g>`;
      s += wrapName(secPre(m) + m.name, x+13, y, 'start');
    });
    s += `<g transform="translate(${ccx} ${ccy}) scale(1.5)">${shapeAt(n.type)}${cornerBadge(n.demo_status)}</g>
      <text class="nm d-label" x="${ccx}" y="${ccy + 30}" text-anchor="middle" font-weight="700">${n.name}</text>`;
    return s + '</svg></div>';
  }

  function select(id){
    selected = (selected === id) ? null : id;
    render(); renderDetail();
  }

  function renderDetail(){
    if (!selected){ detailEl.innerHTML = `<div class="empty">点击梯子、侧枝或岛屿中的图形，展开聚焦子图（整章范围）与规则</div>`; return; }
    const n = byId[selected];
    const edges = DATA.edges.filter(e => (e.a === selected || e.b === selected) && byId[e.a] && byId[e.b]);
    const outs = edges.filter(e => e.a === selected), ins = edges.filter(e => e.b === selected);
    const rules = DATA.rules.filter(r => r.node_name === n.name);
    detailEl.innerHTML = `<div class="detail" style="max-width:none">
      ${focusSvg(n, edges)}
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <svg width="20" height="20" viewBox="-11 -11 22 22">${shapeAt(n.type)}</svg>
          <span style="font-size:16px;font-weight:700">${n.name}</span>
          <span class="chip" style="color:${TYPE[n.type].color};border-color:${TYPE[n.type].color}55">${TYPE[n.type].label}</span>
          <span class="chip" style="color:${STATUS[n.demo_status].color};border-color:${STATUS[n.demo_status].color}55">${STATUS[n.demo_status].label}（演示）</span>
        </div>
        <div class="kv" style="margin-top:4px">所属：${n.section} · ${outs.length} 条出边 · ${ins.length} 条入边（整章） · ${rules.length} 条规则</div>
      </div>
      <div class="relinfo" style="margin-top:2px">
        ${outs.map(e => `<span class="relchip out" data-go="${e.b}" style="cursor:pointer">${REL_CN[e.type] || e.type} → ${byId[e.b].name}${e.status === 'review' ? '<span class="rv">·待审</span>' : ''}</span>`).join('')}
        ${ins.map(e => `<span class="relchip in" data-go="${e.a}" style="cursor:pointer">${byId[e.a].name} → ${REL_CN[e.type] || e.type}${e.status === 'review' ? '<span class="rv">·待审</span>' : ''}</span>`).join('')}
        ${edges.length ? '' : '<span class="kv">整章范围内暂无已连关系（孤立点）</span>'}
      </div>
      ${rules.length ? rules.map(r => `<div class="rule">
          <h4>${r.rule_name}</h4>
          <div class="kv">适用条件${r.logic ? '（' + r.logic + '）' : ''}</div>
          <ul>${r.conditions.filter(Boolean).map(c => `<li>${texify(c)}</li>`).join('')}</ul>
          <div class="arrow">↓ 则</div>
          <ul>${r.outcomes.filter(Boolean).map(o => `<li>${texify(o)}</li>`).join('')}</ul>
        </div>`).join('') : '<div class="empty">暂无规则说明</div>'}
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-primary">继续学习</button>
        <button class="btn btn-ghost">查看来源提问</button>
      </div>
    </div>`;
    detailEl.querySelectorAll('.focus-wrap .glyph').forEach(g =>
      g.addEventListener('click', () => select(g.dataset.id)));
    detailEl.querySelectorAll('.relchip[data-go]').forEach(c =>
      c.addEventListener('click', () => {
        const t = c.dataset.go;
        if (byId[t].type === 'ProblemClass' && !showPC) return;
        select(t);
      }));
  }

  document.getElementById('togglePC4').addEventListener('click', ev => {
    showPC = !showPC;
    if (selected && byId[selected].type === 'ProblemClass' && !showPC){ selected = null; renderDetail(); }
    ev.target.textContent = showPC ? '收起应用题型（ProblemClass）' : '显示应用题型（ProblemClass）';
    render();
  });
  document.getElementById('toggleEdgesE').addEventListener('click', ev => {
    showAll = !showAll;
    ev.target.textContent = showAll ? '返回蛇形梯子（隐藏关系）' : '岛屿总览（全部关系）';
    render();
  });
  render(); renderDetail();
})();

/* ---------- 案例 8：节点详情（真实 RuleCase + KaTeX） ---------- */
(function(){
  const NODE_NAME = '矩阵消元法解线性方程组';
  const n = DATA.nodes.find(x => x.name === NODE_NAME);
  const rules = DATA.rules.filter(r => r.node_name === NODE_NAME);
  const el = document.getElementById('detail');
  el.innerHTML = `<div class="detail">
    <div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:17px;font-weight:700">${n.name}</span>
        <span class="chip" style="color:${TYPE[n.type].color};border-color:${TYPE[n.type].color}55">${TYPE[n.type].label}</span>
        <span class="chip" style="color:${STATUS.needs_review.color};border-color:#ef444455">需要巩固（演示）</span>
      </div>
      <div class="kv" style="margin-top:4px">所属：${n.section} · 页码由静态目录提供 · 2 条规则</div>
    </div>
    ${rules.map(r => `<div class="rule">
      <h4>${r.rule_name}</h4>
      <div class="kv">适用条件${r.logic ? '（' + r.logic + '）' : ''}</div>
      <ul>${r.conditions.filter(Boolean).map(c => `<li>${texify(c)}</li>`).join('')}</ul>
      <div class="arrow">↓ 则</div>
      <ul>${r.outcomes.filter(Boolean).map(o => `<li>${texify(o)}</li>`).join('')}</ul>
    </div>`).join('')}
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary">继续学习</button>
      <button class="btn btn-ghost">查看来源提问</button>
    </div>
  </div>`;
})();

/* ---------- 案例 9：图例 ---------- */
(function(){
  const el = document.getElementById('legend');
  let html = '';
  Object.entries(STATUS).forEach(([k,v]) => {
    html += `<span><svg width="14" height="14" style="vertical-align:-2px">${statusGlyph(k,7,7)}</svg> ${v.label}</span>`;
  });
  Object.entries(TYPE).forEach(([k,v]) => {
    html += `<span><svg width="18" height="16" style="vertical-align:-3px">${typeBadge(k,0,8)}</svg> ${v.label}</span>`;
  });
  Object.entries(TYPE).forEach(([k,v]) => {
    html += `<span><svg width="18" height="18" viewBox="-9 -9 18 18" style="vertical-align:-4px">${shapeAt(k)}</svg> ${v.label}图形</span>`;
  });
  html += `<span><svg width="34" height="10" style="vertical-align:-1px"><line x1="0" y1="5" x2="34" y2="5" stroke="var(--edge)" stroke-width="1.6"/></svg> 已确认关系</span>`;
  html += `<span><svg width="34" height="10" style="vertical-align:-1px"><line x1="0" y1="5" x2="34" y2="5" stroke="var(--edge)" stroke-width="1.6" stroke-dasharray="5 4"/></svg> 待审核关系</span>`;
  html += `<span><svg width="34" height="10" style="vertical-align:-1px"><line x1="0" y1="5" x2="34" y2="5" stroke="var(--accent)" stroke-width="2.2"/></svg> 选中节点的出边</span>`;
  html += `<span><svg width="34" height="10" style="vertical-align:-1px"><line x1="0" y1="5" x2="34" y2="5" stroke="var(--amber)" stroke-width="2.2"/></svg> 选中节点的入边</span>`;
  html += `<span><svg width="34" height="10" style="vertical-align:-1px"><line x1="0" y1="5" x2="34" y2="5" stroke="var(--line)" stroke-width="7" stroke-linecap="round"/></svg> 学习路径（课本顺序）</span>`;
  el.innerHTML = html;
})();
</script>
</body>
</html>
"""

SECTIONS = ["1.1 解线性方程组的矩阵消元法", "1.2 线性方程组的解的情况及其判别准则", "1.3 数域"]

# deterministic demo progress (clearly labeled as fake in the page header)
DEMO_PATTERN = ["mastered", "mastered", "basically_mastered", "learning",
                "basically_mastered", "needs_review", "unexplored", "unexplored",
                "unexplored", "unexplored"]

nodes = []
for section in SECTIONS:
    for i, n in enumerate(x for x in DATA["nodes"] if x["section"] == section):
        nodes.append({**n, "demo_status": DEMO_PATTERN[i % len(DEMO_PATTERN)]})
# 1-hop 外部邻居节点（跨节/跨册枢纽）：排在数组末尾，仅供岛屿总览与聚焦子图使用
for n in (x for x in DATA["nodes"] if x.get("external")):
    nodes.append({**n, "demo_status": "unexplored"})

def island_sizes(node_ids, edges):
    """Union-find component sizes (desc) — answers 'can the graph split into subgraphs?'."""
    parent = {i: i for i in node_ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in edges:
        a, b = e["a"], e["b"]
        if a in parent and b in parent:
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra
    return sorted(Counter(find(i) for i in node_ids).values(), reverse=True)


section_stats = []
for section in SECTIONS:
    sn = [n for n in nodes if n["section"] == section]
    ids = {n["id"] for n in sn}
    se = [e for e in DATA["edges"] if e["a"] in ids and e["b"] in ids]
    section_stats.append({
        "section": section,
        "nodes": len(sn),
        "edges": len(se),
        "solid": sum(1 for e in se if e["status"] != "review"),
        "dashed": sum(1 for e in se if e["status"] == "review"),
        "types": dict(Counter(n["type"] for n in sn)),
        "islands": island_sizes(list(ids), se),
    })

# deterministic star-map coordinates for section 1.1 (case 6 / style D);
# computed once here — this mirrors the intended export-time precomputation.
sec11_ids = [n["id"] for n in nodes if n["section"] == SECTIONS[0]]
sec11_set = set(sec11_ids)
sec11_edges = [(e["a"], e["b"]) for e in DATA["edges"] if e["a"] in sec11_set and e["b"] in sec11_set]
positions = seeded_layout(sec11_ids, sec11_edges)

payload = {
    "chapter": "第1章 线性方程组的解法",
    "textbook": "高等代数（上册）· gaodai_shang",
    "sections": SECTIONS,
    "nodes": nodes,
    "edges": DATA["edges"],
    "rules": DATA["rules"],
    "section_stats": section_stats,
    "positions": positions,
}

html = TEMPLATE.replace("__DATA__", json.dumps(payload, ensure_ascii=False))
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"written {OUT} ({len(html)//1024} KB)")
