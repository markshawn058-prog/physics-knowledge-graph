/*
 * 页面自检脚本
 *
 * 用法：
 *   1) 先起本地服务：python -m http.server 8000
 *   2) 跑：NODE_PATH=<node_modules 路径> node tools/check.js
 *
 * 检查内容 = AGENTS.md 里的「完成标准」：控制台无报错、主要交互跑得通、
 * 目录与 3D 场景的节点完全对齐。改完 pages/physics-graph.html 就跑一遍。
 */
const { chromium } = require('playwright-core');

const EXE = process.env.CHROME_PATH ||
  'C:/Users/天河壹号/AppData/Local/ms-playwright/chromium-1148/chrome-win/chrome.exe';
const URL = process.env.PAGE_URL || 'http://127.0.0.1:8000/pages/physics-graph.html';

const ok = [], bad = [];
const T = (name, cond, extra = '') => (cond ? ok : bad).push(name + (extra ? ' → ' + extra : ''));

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

  await page.goto(URL);
  await page.waitForTimeout(2600);

  const h3 = () => page.evaluate(() => document.querySelector('#sidebar h3')?.textContent || null);

  /* 1. 基本渲染 */
  const base = await page.evaluate(() => ({
    n: kg.NODES.length, canvas: document.querySelectorAll('canvas').length
  }));
  T('节点数 149', base.n === 149, base.n);
  T('canvas 已挂载', base.canvas === 1);

  /* 2. 目录覆盖：每个节点都在目录里，目录里也没有野节点 */
  const cover = await page.evaluate(() => {
    const inToc = [...new Set([...document.querySelectorAll('#toc-body [data-n]')]
      .map(e => e.dataset.n).filter(Boolean))];
    const nodes = kg.NODES.filter(n => n !== '高中物理');
    return {
      miss: inToc.filter(n => kg.NODES.indexOf(n) < 0),
      lost: nodes.filter(n => !inToc.includes(n)),
      inToc: inToc.length, nodes: nodes.length
    };
  });
  T('目录无野节点', cover.miss.length === 0, cover.miss.join(','));
  T('无遗漏知识点', cover.lost.length === 0, cover.lost.join(','));
  T('目录覆盖数与节点数一致', cover.inToc === cover.nodes, `${cover.inToc}/${cover.nodes}`);

  /* 3. 点 3D 节点（投影坐标后真点）
     注意两点，否则会假失败：
     ① 每次点击后相机有 ~600ms 的飞行动画，必须等它停稳再取下一个投影坐标，
        否则拿到的是动画中途的旧坐标；
     ② 投影点可能落在左侧目录或右侧详情面板上，那种点根本到不了 canvas，直接跳过。 */
  let hit = 0, tried = 0;
  for (const nm of ['静电场', '洛伦兹力', '牛顿第二定律', '双缝干涉', '核反应方程']) {
    await page.evaluate(() => kg.clearSel && kg.clearSel());
    await page.waitForTimeout(750);
    const q = await page.evaluate(n => {
      const s = kg.project(kg.P[kg.NODES.indexOf(n)]);
      if (!s) return null;
      const el = document.elementFromPoint(s.x, s.y);
      if (!el || el.tagName !== 'CANVAS') return null;    // 被面板挡住
      return { x: s.x, y: s.y };
    }, nm);
    if (!q) continue;
    tried++;
    await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(700);
    if (await h3() === nm) hit++;
  }
  T('点 3D 节点可选中', tried >= 3 && hit === tried, `${hit}/${tried}`);

  /* 4. 拖拽不误选 */
  await page.evaluate(() => kg.select('静电场'));
  await page.waitForTimeout(800);
  const q = await page.evaluate(() => {
    const s = kg.project(kg.P[kg.NODES.indexOf('静电场')]);
    return s && { x: s.x, y: s.y };
  });
  await page.mouse.move(q.x, q.y); await page.mouse.down();
  await page.mouse.move(q.x + 45, q.y + 12, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(500);
  T('拖拽不误选', (await h3()) === '静电场', await h3());

  /* 5. 点空白取消 */
  const blank = await page.evaluate(() => {
    for (let y = 160; y < 760; y += 30)
      for (let x = 360; x < 880; x += 30)
        if (document.elementFromPoint(x, y)?.tagName === 'CANVAS' && kg.pick(x, y) < 0) return { x, y };
    return null;
  });
  if (blank) {
    await page.mouse.click(blank.x, blank.y); await page.waitForTimeout(450);
    T('点空白取消选择', await page.evaluate(() => !document.querySelector('#sidebar h3')));
  } else T('点空白取消选择', false, '找不到空白点');

  /* 6. 搜索 */
  await page.fill('#search', '电磁');
  await page.waitForTimeout(300);
  const nRes = await page.evaluate(() => document.querySelectorAll('#results div[data-n]').length);
  T('搜索有结果', nRes > 0, nRes + ' 条');
  if (nRes) {
    await page.click('#results div[data-n]');
    await page.waitForTimeout(700);
    T('搜索结果可选中', !!await h3(), await h3());
  }

  /* 7. 目录双向同步 + 聚焦居中 */
  await page.click('#btn-toc'); await page.waitForTimeout(350);
  await page.evaluate(() => kg.select('洛伦兹力'));
  await page.waitForTimeout(1300);
  const sync = await page.evaluate(() => {
    const e = document.querySelector('#toc .sel');
    const st = getComputedStyle(document.getElementById('toc')).display !== 'none';
    const want = ((st ? 320 : 0) + innerWidth - 372) / 2;
    const s = kg.project(kg.P[kg.NODES.indexOf('洛伦兹力')]);
    return {
      n: e?.dataset.n, ch: !!e?.closest('.ch')?.classList.contains('on'),
      mod: !!e?.closest('.mod')?.classList.contains('on'),
      dx: Math.round(Math.abs(s.x - want))
    };
  });
  T('3D→目录高亮并展开层级', sync.n === '洛伦兹力' && sync.ch && sync.mod, JSON.stringify(sync));
  T('聚焦落在空白区中心（±40px）', sync.dx <= 40, sync.dx + 'px');

  // 章节默认折叠，先点章标题展开（顺带验证「点标题展开并选中」）
  const ch = await page.evaluate(() => {
    const e = document.querySelector('.ch-t[data-n="电磁感应"]');
    e.scrollIntoView({ block: 'center' });
    const b = e.getBoundingClientRect();
    return { x: b.left + 60, y: b.top + b.height / 2 };
  });
  await page.mouse.click(ch.x, ch.y); await page.waitForTimeout(700);
  T('点章标题展开并选中', (await h3()) === '电磁感应' &&
    await page.evaluate(() => document.querySelector('.ch-t[data-n="电磁感应"]').parentElement.classList.contains('on')), await h3());

  const it = await page.evaluate(() => {
    const e = document.querySelector('.it[data-n="楞次定律"]');
    e.scrollIntoView({ block: 'center' });
    const b = e.getBoundingClientRect();
    return { x: b.left + 60, y: b.top + b.height / 2 };
  });
  await page.mouse.click(it.x, it.y); await page.waitForTimeout(800);
  T('目录→3D 选中', (await h3()) === '楞次定律', await h3());

  /* 8. 标签开关 */
  const cnt = () => page.evaluate(() => [...document.querySelectorAll('.lbl')].filter(e => e.style.display !== 'none').length);
  const l0 = await cnt();
  await page.click('#btn-label'); await page.waitForTimeout(450);
  const l1 = await cnt();
  await page.click('#btn-label'); await page.waitForTimeout(450);
  T('标签可开关', l0 > 0 && l1 === 0 && (await cnt()) === l0, `${l0}→${l1}→${await cnt()}`);

  /* 9. 控制台 */
  T('控制台无报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();

  console.log('通过 ' + ok.length + ' 项');
  ok.forEach(x => console.log('  OK  ' + x));
  if (bad.length) {
    console.log('失败 ' + bad.length + ' 项');
    bad.forEach(x => console.log('  FAIL ' + x));
  }
  process.exit(bad.length ? 1 : 0);
})();
