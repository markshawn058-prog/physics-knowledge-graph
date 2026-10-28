/* 把 src/*.json 的内容合并进 pages/physics-graph.html
 * 用法：node tools/build.js [--check]
 *   --check 只校验不写文件
 *
 * src/*.json 结构：
 * {
 *   "节点名": {
 *     "rel": [["目标节点", "关系类型", "关系描述"], ...],
 *     "ex":  [{"t":"考法名","f":"考查形式","k":"破题关键",
 *              "q":[{"q":"题干","s":["步骤1","步骤2"],"a":"答案","c":"核心解法","x":"特殊解法"}]}]
 *   }
 * }
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'pages', 'physics-graph.html');
const SRC = path.join(ROOT, 'src');
const TYPES = ['前置', '延伸', '对比', '同源', '应用', '组成', '迁移'];
const REV = {'前置': '延伸', '延伸': '前置'};   // 同一关系的反向读法
const CHECK_ONLY = process.argv.includes('--check');

/* ---------- 读页面里的既有数据，用于校验 ---------- */
const html = fs.readFileSync(HTML, 'utf8');
function grab(name) {
  const key = 'const ' + name + '=';
  const i = html.indexOf(key);
  if (i < 0) throw new Error('页面里找不到 ' + name);
  const j = html.indexOf('\n', i);
  return eval('(' + html.slice(i + key.length, j).replace(/;\s*$/, '') + ')');
}
const POS = grab('POS'), TOC = grab('TOC');
const NODES = Object.keys(POS);
const LV = {}, PAR = {};
LV['高中物理'] = 0;
TOC.forEach(m => {
  if (m.n) { LV[m.n] = 1; PAR[m.n] = '高中物理'; }
  m.ch.forEach(c => {
    LV[c.t] = c.i.length ? 2 : 3; PAR[c.t] = m.n || '高中物理';
    c.i.forEach(k => { LV[k] = 3; PAR[k] = c.t; });
  });
});

/* ---------- 读源文件 ---------- */
if (!fs.existsSync(SRC)) { console.error('缺少 src/ 目录'); process.exit(1); }
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.json')).sort();
const errs = [], warns = [];
const REL = {}, EX = {}, owner = {};
let nRel = 0, nEx = 0, nQ = 0;

for (const f of files) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8')); }
  catch (e) { errs.push(`${f} JSON 解析失败：${e.message}`); continue; }

  for (const [name, item] of Object.entries(data)) {
    if (!POS[name]) { errs.push(`${f} 出现未知节点「${name}」`); continue; }

    /* 关系 */
    (item.rel || []).forEach((r, i) => {
      const [to, type, desc] = r;
      const tag = `${name} → ${to}（第 ${i + 1} 条）`;
      if (!POS[to]) return errs.push(`${tag}：目标节点不存在`);
      if (to === name) return errs.push(`${tag}：不能指向自己`);
      if (to === PAR[name]) return errs.push(`${tag}：这是父级概念，不该出现在关联里`);
      if (LV[to] < LV[name]) return errs.push(`${tag}：上级概念（层级 ${LV[to]} < ${LV[name]}）`);
      if (!TYPES.includes(type)) return errs.push(`${tag}：关系类型「${type}」不在允许列表`);
      if (!desc || desc.length > 64) return errs.push(`${tag}：描述为空或超过 64 字`);
      const k = name < to ? name + '|' + to : to + '|' + name;
      if (REL[k]) {
        if (REL[k][0] !== type && REV[type] !== REL[k][0]) warns.push(`${tag}：与「${owner[k]}」重复且类型冲突，保留先出现的`);
        return;
      }
      REL[k] = [type, desc, name]; owner[k] = name; nRel++;
    });

    /* 考法 */
    if (item.ex) {
      if (EX[name]) { errs.push(`${name}：考法在多个文件里重复定义`); continue; }
      item.ex.forEach((x, i) => {
        const tag = `${name} 考法${i + 1}`;
        if (!x.t) errs.push(`${tag}：缺考法名`);
        if (!x.f) errs.push(`${tag}：缺「考查形式」`);
        if (!x.k) errs.push(`${tag}：缺「破题关键」`);
        if (x.v !== undefined) {
          if (!Array.isArray(x.v) || !x.v.length) errs.push(`${tag}：「具体问法」必须是非空数组`);
          else {
            if (x.v.length > 5) errs.push(`${tag}：「具体问法」最多 5 条，现有 ${x.v.length} 条`);
            x.v.forEach((s, j) => {
              if (!s || !s.trim()) errs.push(`${tag} 问法${j + 1}：为空`);
              else if (s.length > 44) errs.push(`${tag} 问法${j + 1}：超过 44 字（${s.length}）`);
            });
            if (new Set(x.v).size !== x.v.length) errs.push(`${tag}：「具体问法」有重复条目`);
          }
        }
        if (!Array.isArray(x.q) || !x.q.length) errs.push(`${tag}：没有例题`);
        (x.q || []).forEach((q, j) => {
          const t2 = `${tag} 例${j + 1}`;
          if (!q.q) errs.push(`${t2}：缺题干`);
          if (!Array.isArray(q.s) || q.s.length < 2) errs.push(`${t2}：解析步骤少于 2 步`);
          if (!q.a) errs.push(`${t2}：缺答案`);
          if (!q.c) errs.push(`${t2}：缺核心解法`);
          if (!q.x) errs.push(`${t2}：缺特殊解法`);
        });
      });
      EX[name] = item.ex; nEx++; nQ += item.ex.reduce((a, x) => a + (x.q || []).length, 0);
    }
  }
}

/* ---------- 覆盖率 ---------- */
const noRel = NODES.filter(n => n !== '高中物理' && !NODES.some(m => REL[m + '|' + n] || REL[n + '|' + m]));
const noEx = NODES.filter(n => !EX[n]);
const thin = NODES.filter(n => { const c = NODES.filter(m => REL[m + '|' + n] || REL[n + '|' + m]).length; return c && c < 2; });

/* 结构边（EDGE）里还没有语义描述的对：详情面板不展示，只在 3D 里连线 */
const ekey = 'const EDGE=';
const ei = html.indexOf(ekey);
const EDGE = eval('(' + html.slice(ei + ekey.length, html.indexOf('\n', ei)).replace(/;\s*$/, '') + ')');
const bare = [];
EDGE.split(';').forEach(e => {
  const [a, b] = e.split('|');
  if (!a || !b || a === b || a === '高中物理' || b === '高中物理') return;
  if (PAR[a] === b || PAR[b] === a) return;
  const k = a < b ? a + '|' + b : b + '|' + a;
  if (!REL[k] && !bare.includes(k)) bare.push(k);
});

console.log(`源文件 ${files.length} 个｜关系 ${nRel} 条｜考法节点 ${nEx} 个 / ${nEx ? (nEx) : 0} 个节点｜例题 ${nQ} 道`);
if (noEx.length) console.log(`尚未写考法的节点 (${noEx.length})：${noEx.join('、')}`);
if (noRel.length) console.log(`没有任何关系的节点 (${noRel.length})：${noRel.join('、')}`);
if (thin.length) console.log(`只有 1 条关系的节点 (${thin.length})：${thin.join('、')}`);
if (bare.length) console.log(`结构边缺语义描述 (${bare.length})：${bare.join('、')}`);
if (warns.length) console.log('\n提示：\n  ' + warns.join('\n  '));
if (errs.length) {
  console.error(`\n校验失败 ${errs.length} 处：\n  ` + errs.join('\n  '));
  process.exit(1);
}
console.log('校验通过');

if (CHECK_ONLY) process.exit(0);

/* ---------- 写回页面 ---------- */
const sortKeys = o => Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {});
const relJson = JSON.stringify(sortKeys(REL));
const exJson = JSON.stringify(sortKeys(EX));
const put = (src, mark, body) => {
  const re = new RegExp(`/\\*${mark}-BEGIN\\*/[\\s\\S]*?/\\*${mark}-END\\*/`);
  if (!re.test(src)) throw new Error('页面里缺少 ' + mark + ' 标记');
  return src.replace(re, `/*${mark}-BEGIN*/\nconst ${mark}=${body};\n/*${mark}-END*/`);
};
let out = put(put(html, 'REL', relJson), 'EX', exJson);
fs.writeFileSync(HTML, out, 'utf8');
console.log(`已写入 pages/physics-graph.html，${Buffer.byteLength(out)} 字节（关系 ${(relJson.length / 1024).toFixed(1)}KB，题库 ${(exJson.length / 1024).toFixed(1)}KB）`);
