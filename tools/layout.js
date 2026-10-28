/**
 * 从 tools/toc.json 生成页面里的四个结构数据块：TOC / POS / EDGE / SZ
 *
 * 为什么要生成而不是手写：增删一个知识点要同时改目录、三维坐标、结构边、
 * 尺寸码四处，手改必然漏。这里把目录作为唯一数据源，其余全部推导。
 *
 * 坐标算法：根在原点，模块铺在半径 0.42 的球面上（斐波那契分布），
 * 章与知识点以父节点方向为轴，在锥面上均匀展开。结果确定可复现，
 * 同一份 toc.json 永远生成同样的坐标。
 *
 * 用法：node tools/layout.js [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const PAGE = path.join(ROOT, 'pages', 'physics-graph.html');
const TOC_FILE = path.join(ROOT, 'tools', 'toc.json');

const toc = JSON.parse(fs.readFileSync(TOC_FILE, 'utf8'));

/* ---------- 展平成节点表，同时记下父子关系 ---------- */
const nodes = [];          // [{name, lv, par, mod}]
const edge = [];           // ['A|B']
const seen = new Set();

function add(name, lv, par, mod) {
  if (seen.has(name)) throw new Error('目录里节点重名：' + name);
  seen.add(name);
  nodes.push({ name, lv, par, mod });
  if (par) edge.push(par + '|' + name);
}

add(toc.root, 0, null, null);
toc.modules.forEach(m => {
  add(m.t, 1, toc.root, m.t);
  m.ch.forEach(c => {
    const leaf = !c.i || !c.i.length;
    add(c.t, leaf ? 3 : 2, m.t, m.t);          // 章下没有知识点时，章自己就是第 3 层叶子
    (c.i || []).forEach(k => add(k, 3, c.t, m.t));
  });
});

/* ---------- 三维坐标 ---------- */
const norm = v => {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// 与 d 正交的一对单位向量，用来在锥面上铺开子节点
function basis(d) {
  const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(d, a));
  return [u, cross(d, u)];
}

// 以父方向 d 为轴，把 n 个子节点铺在锥面上，返回半径 len 的方向向量
// len 可以是数字，也可以是长度数组——后者用来让同一层的节点在半径上错开，
// 否则 117 个知识点全落在一层薄壳上，中间空、外面一圈，看着像放射状而不是球。
function spread(d, n, len, cone, phase) {
  const [u, v] = basis(d);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n + phase + 0.45 * Math.sin(i * 2.7 + phase * 3);
    const a = n === 1 ? cone : cone * (0.82 + 0.36 * ((i % 3) / 2));
    const ca = Math.cos(a), sa = Math.sin(a);
    const dir = norm([
      d[0] * ca + (u[0] * Math.cos(t) + v[0] * Math.sin(t)) * sa,
      d[1] * ca + (u[1] * Math.cos(t) + v[1] * Math.sin(t)) * sa,
      d[2] * ca + (u[2] * Math.cos(t) + v[2] * Math.sin(t)) * sa
    ]);
    out.push(dir.map(x => x * (Array.isArray(len) ? len[i] : len)));
  }
  return out;
}

const POS = {};
const posOf = {};
posOf[toc.root] = [0, 0, 0];
POS[toc.root] = [0, 0, 0];

// 模块：球面均匀分布（斐波那契格点）
const M = toc.modules.length;
toc.modules.forEach((m, i) => {
  const y = M === 1 ? 0 : 1 - (i / (M - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * 2.399963229728653;
  const d = [Math.cos(th) * r, y, Math.sin(th) * r];
  posOf[m.t] = d.map(x => x * 0.62);
  POS[m.t] = posOf[m.t];
});

// 章与知识点：沿父方向铺在锥面上
toc.modules.forEach((m, mi) => {
  const md = norm(posOf[m.t]);
  const chPos = spread(md, m.ch.length, 1.08, 0.74, mi * 0.9 + 0.3);
  m.ch.forEach((c, ci) => {
    posOf[c.t] = chPos[ci];
    POS[c.t] = chPos[ci];
    const kids = c.i || [];
    if (!kids.length) return;
    const cd = norm(chPos[ci]);
    // 半径按 1.28 / 1.44 / 1.60 三档错开，让知识点填满外球层而不是贴在一张球面上
    const kl = kids.map((_, ki) => 1.28 + 0.16 * ((ki + ci * 2 + mi) % 3));
    const kPos = spread(cd, kids.length, kl, 0.60, ci * 1.1 + mi * 0.5);
    kids.forEach((k, ki) => {
      posOf[k] = kPos[ki];
      POS[k] = kPos[ki];
    });
  });
});

/* ---------- 尺寸码：0 根 / 1 模块 / 2 章 / 4 知识点 ----------
   知识点用 4（18px）而不是 3（24px），一是层次更分明，
   二是页面里「标签常显」按 SZMAP>=24 判断，知识点不该常显，否则 149 个标签糊成一片。 */
const SZCODE = { 0: '0', 1: '1', 2: '2', 3: '4' };
const SZ = nodes.map(n => SZCODE[n.lv]).join('');

/* ---------- 序列化 ---------- */
const r4 = x => Math.round(x * 10000) / 10000;
const posLit = 'const POS={' + nodes.map(n => JSON.stringify(n.name) + ':[' + POS[n.name].map(r4).join(',') + ']').join(',') + '};';
const edgeLit = 'const EDGE=' + JSON.stringify(edge.join(';')) + ';';
const szLit = 'const SZ=' + JSON.stringify(SZ) + ';';
const tocLit = 'const TOC=' + JSON.stringify(toc.modules.map(m => ({
  t: m.t, c: m.c, n: m.t, ch: m.ch.map(c => ({ t: c.t, i: c.i || [] }))
}))) + ';';

/* ---------- 回填页面 ---------- */
let html = fs.readFileSync(PAGE, 'utf8');

function put(html, tag, prefix, literal) {
  const block = new RegExp('/\\*' + tag + '-BEGIN\\*/[\\s\\S]*?/\\*' + tag + '-END\\*/');
  const wrapped = '/*' + tag + '-BEGIN*/\n' + literal + '\n/*' + tag + '-END*/';
  if (block.test(html)) return html.replace(block, wrapped);
  // 首次：把整行 `const XXX=...;` 换成带标记的块
  const line = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$', 'm');
  if (!line.test(html)) throw new Error('页面里找不到 ' + prefix);
  return html.replace(line, wrapped);
}

const before = html;
html = put(html, 'TOC', 'const TOC=', tocLit);
html = put(html, 'POS', 'const POS=', posLit);
html = put(html, 'EDGE', 'const EDGE=', edgeLit);
html = put(html, 'SZ', 'const SZ=', szLit);

const check = process.argv.includes('--check');
if (check) {
  console.log('节点 %d ｜ 模块 %d ｜ 章 %d ｜ 结构边 %d', nodes.length, M,
    toc.modules.reduce((a, m) => a + m.ch.length, 0), edge.length);
  console.log(before === html ? '页面已是最新' : '页面需要更新（去掉 --check 重跑）');
} else {
  fs.writeFileSync(PAGE, html);
  const lv = { 0: 0, 1: 0, 2: 0, 3: 0 };
  nodes.forEach(n => lv[n.lv]++);
  console.log('节点 %d（根 %d / 模块 %d / 章 %d / 知识点 %d）｜结构边 %d',
    nodes.length, lv[0], lv[1], lv[2], lv[3], edge.length);
  console.log('已写入 pages/physics-graph.html');
}
