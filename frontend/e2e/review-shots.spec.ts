import { test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// 临时审查脚本：用富 mock 数据截取地图首页 / 章内梯子 / 列表 / 关系面板的真实渲染效果。
// 跑法：npx playwright test e2e/review-shots.spec.ts

const artifactDir = resolve(process.cwd(), '..', 'artifacts', 'visual-review-0821');

type NodeSpec = [id: string, name: string, type: string, status: string, blocked?: boolean];

function mkChapter(chapter: string, sections: Array<[section: string, nodes: NodeSpec[]]>) {
  const nodes = sections.flatMap(([section, list]) => list.map(([id, name, type, status, blocked]) => ({
    node_id: id, name, type, section, status, closed_evidence_count: status === 'unexplored' ? 0 : 2, blocked: Boolean(blocked), chat: { id: null, available: false },
  })));
  const counts = { unexplored: 0, learning: 0, basically_mastered: 0, mastered: 0, needs_review: 0 } as Record<string, number>;
  nodes.forEach(node => { counts[node.status] += 1; });
  return {
    summary: {
      chapter,
      node_count: nodes.length,
      status_counts: counts,
      exploration_progress: { explored: nodes.length - counts.unexplored, total: nodes.length },
    },
    response: {
      textbook_id: 'gaodai_shang', chapter,
      sections: sections.map(([section]) => ({ section, nodes: nodes.filter(node => node.section === section) })),
    },
  };
}

const CH1 = mkChapter('第1章 线性方程组', [
  ['1.1 消元法', [['n101', '线性方程组', 'concept', 'mastered'], ['n102', '高斯消元法', 'method', 'mastered'], ['n103', '阶梯形矩阵', 'concept', 'mastered']]],
  ['1.2 解的判定', [['n104', '解的存在性', 'theorem', 'mastered'], ['n105', '解的个数判别', 'theorem', 'mastered'], ['n106', '齐次方程组', 'concept', 'mastered']]],
]);
const CH2 = mkChapter('第2章 行列式', [
  ['2.1 行列式的定义', [['n201', 'n 阶行列式', 'concept', 'mastered'], ['n202', '余子式与代数余子式', 'concept', 'mastered'], ['n203', '按行展开定理', 'theorem', 'mastered']]],
  ['2.2 行列式的性质', [['n204', '行列式的基本性质', 'theorem', 'basically_mastered'], ['n205', '行列式的计算', 'method', 'needs_review'], ['n206', '克拉默法则', 'theorem', 'needs_review']]],
  ['2.3 行列式的应用', [['n207', '范德蒙德行列式', 'formula', 'basically_mastered'], ['n208', '伴随矩阵', 'concept', 'mastered']]],
]);
const CH3 = mkChapter('第3章 线性空间', [
  ['3.1 线性空间的定义与性质', Array.from({ length: 27 }, (_, i): NodeSpec => [
    `n3a${i}`, i % 7 === 3 ? `线性表出的判定与等价条件组 ${i}` : `概念${i + 1}`, ['concept', 'theorem', 'formula', 'method'][i % 4],
    i < 14 ? 'mastered' : i < 18 ? 'basically_mastered' : i < 21 ? 'learning' : 'unexplored',
  ])],
  ['3.2 基、维数与坐标', Array.from({ length: 24 }, (_, i): NodeSpec => [
    `n3b${i}`, i === 10 ? '维数公式 $\\dim V_1+\\dim V_2$' : `性质${i + 1}`, ['concept', 'theorem', 'method'][i % 3],
    i < 6 ? 'basically_mastered' : 'unexplored',
  ])],
  ['3.3 子空间与直和', Array.from({ length: 9 }, (_, i): NodeSpec => [
    `n3c${i}`, `子空间${i + 1}`, 'concept', 'unexplored',
  ])],
]);
const CH4 = mkChapter('第4章 矩阵的运算', [
  ['4.1 矩阵运算', [['n401', '矩阵乘法', 'concept', 'mastered'], ['n402', '逆矩阵', 'concept', 'basically_mastered'], ['n403', '矩阵的秩', 'concept', 'basically_mastered'], ['n404', '初等矩阵', 'concept', 'basically_mastered']]],
  ['4.2 分块矩阵', [['n405', '分块乘法', 'method', 'basically_mastered'], ['n406', '分块求逆', 'method', 'unexplored'], ['n407', '秩的不等式', 'theorem', 'basically_mastered'], ['n408', '矩阵方程', 'problemclass', 'unexplored'], ['n409', '广义逆', 'concept', 'unexplored']]],
]);
const CH5 = mkChapter('第5章 一元多项式环', [
  ['5.1 多项式基础', [['n501', '一元多项式', 'concept', 'unexplored'], ['n502', '整除', 'concept', 'unexplored'], ['n503', '最大公因式', 'concept', 'unexplored'], ['n504', '辗转相除法', 'method', 'unexplored'], ['n505', '因式分解定理', 'theorem', 'unexplored']]],
  ['5.2 根与判别', [['n506', '重因式', 'concept', 'unexplored'], ['n507', '多项式函数', 'concept', 'unexplored'], ['n508', '复系数多项式', 'theorem', 'unexplored'], ['n509', '实系数多项式', 'theorem', 'unexplored'], ['n510', '有理系数多项式', 'theorem', 'unexplored'], ['n511', '艾森斯坦判别法', 'method', 'unexplored'], ['n512', '有理根判定', 'method', 'unexplored'], ['n513', '对称多项式', 'concept', 'unexplored'], ['n514', '结式', 'formula', 'unexplored'], ['n515', '判别式', 'formula', 'unexplored']]],
]);
const CH6 = mkChapter('第6章 线性映射', [
  ['6.1 映射与变换', [['n601', '线性映射', 'concept', 'unexplored'], ['n602', '核与像', 'concept', 'unexplored'], ['n603', '线性变换的矩阵', 'concept', 'unexplored'], ['n604', '特征值', 'concept', 'unexplored'], ['n605', '特征向量', 'concept', 'unexplored'], ['n606', '对角化', 'method', 'unexplored']]],
  ['6.2 不变子空间', [['n607', '不变子空间', 'concept', 'unexplored'], ['n608', '最小多项式', 'concept', 'unexplored'], ['n609', '若尔当标准形', 'theorem', 'unexplored'], ['n610', '幂零变换', 'concept', 'unexplored'], ['n611', '循环子空间', 'concept', 'unexplored']]],
]);
const CH7 = mkChapter('第7章 双线性函数与二次型', [
  ['7.1 双线性函数', [['n701', '双线性函数', 'concept', 'unexplored'], ['n702', '对称双线性函数', 'concept', 'unexplored'], ['n703', '二次型', 'concept', 'unexplored']]],
  ['7.2 二次型的标准形', [['n704', '配方法', 'method', 'unexplored'], ['n705', '惯性定理', 'theorem', 'unexplored'], ['n706', '正定二次型', 'concept', 'unexplored'], ['n707', '正交变换化简', 'method', 'unexplored']]],
]);

const ALL = [CH1, CH2, CH3, CH4, CH5, CH6, CH7];
const chapters = ALL.map(item => item.summary);
const nodesByChapter: Record<string, unknown> = Object.fromEntries(ALL.map(item => [item.summary.chapter, item.response]));

const edges = [
  { source: 'n3a0', target: 'n3a1', type: 'PREREQUISITE_OF' },
  { source: 'n3a1', target: 'n3a2', type: 'PREREQUISITE_OF' },
  { source: 'n3a2', target: 'n3a9', type: 'DERIVES' },
  { source: 'n3a14', target: 'n3a15', type: 'EQUATIVE' },
  { source: 'n3a4', target: 'n3a13', type: 'USES' },
  { source: 'n3a5', target: 'n3a6', type: 'SUPERIOR' },
  { source: 'n3b10', target: 'n3b11', type: 'USES' },
  { source: 'n3c0', target: 'n3c1', type: 'PREREQUISITE_OF' },
  { source: 'n3a20', target: 'n401', type: 'PREREQUISITE_OF', sourceChapter: '第3章 线性空间', targetChapter: '第4章 矩阵的运算' },
];

const textbookNames: Record<string, string> = {
  gaodai_shang: '高等代数（上册）丘维声',
  gaodai_xia: '高等代数（下册）丘维声',
  gaoshu_shang: '高等数学（上册）',
  gaoshu_xia: '高等数学（下册）',
};

async function mockApp(page: Page) {
  await page.route('**/api/**', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'unmocked' }) }));
  await page.route('**/api/auth/anonymous?*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ access_token: 'review-token', token_type: 'bearer', user_id: 'review-user', username: 'anonymous', is_anonymous: true }),
  }));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'review-user', username: 'anonymous', is_anonymous: true }),
  }));
  const nodeRecords = () => Object.values(nodesByChapter).flatMap((response: any) =>
    (response.sections || []).flatMap((section: any, s: number) => (section.nodes || []).map((node: any, n: number) => ({
      node_id: node.node_id, name: node.name, type: node.type, chapter: response.chapter,
      section: node.section, section_node_id: null, prerequisite_ids: [], order: s * 100 + n,
    }))));
  const catalogFor = () => ({
    textbook_id: 'gaodai_shang', display_name: textbookNames.gaodai_shang, catalog_version: 'gaodai_shang-review',
    chapters: chapters.map((item: any, order: number) => {
      const response: any = nodesByChapter[item.chapter] || { sections: [] };
      return {
        id: `gaodai_shang:chapter:${order + 1}`, name: item.chapter, number: order + 1, order,
        node_count: item.node_count, first_page: 20 + order * 10,
        sections: (response.sections || []).map((section: any, s: number) => ({
          id: `gaodai_shang:section:${order + 1}.${s + 1}`, name: section.section, page: 20 + order * 10 + s,
          nodes: (section.nodes || []).map((node: any, n: number) => ({
            node_id: node.node_id, name: node.name, type: node.type, chapter: item.chapter,
            section: node.section, section_node_id: null, prerequisite_ids: [], order: n,
          })),
        })),
      };
    }),
    edges,
  });
  await page.route('**/map-catalog/manifest.json*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      schema_version: 1,
      catalogs: Object.keys(textbookNames).map(id => ({
        textbook_id: id, display_name: textbookNames[id], catalog_version: `${id}-review`,
        index_path: `/map-catalog/${id}.index.json`, catalog_path: `/map-catalog/${id}.json`,
        chapters: id === 'gaodai_shang' ? chapters.map((item: any, order: number) => ({
          id: `${id}:chapter:${order + 1}`, name: item.chapter, number: order + 1, order, node_count: item.node_count, first_page: 20 + order * 10,
        })) : [],
      })),
      node_index: { gaodai_shang: nodeRecords() },
    }),
  }));
  await page.route('**/map-catalog/*.index.json*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ textbook_id: 'gaodai_shang', catalog_version: 'gaodai_shang-review', node_index: nodeRecords() }),
  }));
  await page.route('**/map-catalog/*.json*', route => {
    const url = route.request().url().replace(/\?.*$/, '');
    if (url.endsWith('/map-catalog/manifest.json')) return route.fallback();
    if (url.endsWith('/map-catalog/gaodai_shang.index.json')) return route.fallback();
    if (url.endsWith('/map-catalog/gaodai_shang.json')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogFor()) });
    return route.continue();
  });
  await page.route('**/api/learning-progress?*', route => {
    const nodes: Record<string, unknown> = {};
    Object.values(nodesByChapter).forEach((response: any) => (response.sections || []).forEach((section: any) => (section.nodes || []).forEach((node: any) => {
      if (node.status !== 'unexplored') nodes[node.node_id] = { status: node.status, closed_evidence_count: node.closed_evidence_count, last_activity_at: null, source_chat_id: null };
    })));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ textbook_id: 'gaodai_shang', catalog_version: 'gaodai_shang-review', revision: 1, nodes }) });
  });
  await page.route('**/api/textbook/section-page?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ page: 26, confidence: 1, matched_text: '3.1' }) }));
  await page.route('**/api/manim/artifacts**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
  await page.route('**/api/chat/history**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.waitForTimeout(350);
}

test.describe('视觉审查截图', () => {
  test('desktop shots', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop');
    await mkdir(artifactDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockApp(page);

    // 1. 地图首页 · 亮色
    await page.goto('/');
    await page.getByText('学习地图', { exact: true }).first().waitFor();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'maphome-desktop-light.png') });

    // 2. 地图首页 · 暗色
    await page.evaluate(() => localStorage.setItem('learnmath_dark', '1'));
    await page.reload();
    await page.getByText('学习地图', { exact: true }).first().waitFor();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'maphome-desktop-dark.png') });
    await page.evaluate(() => localStorage.setItem('learnmath_dark', '0'));
    await page.reload();
    await page.getByText('学习地图', { exact: true }).first().waitFor();

    // 3. 章总览首屏 · 亮色（点第3章的「地图」）
    await page.locator('main li').filter({ hasText: /^第 3 章/ }).getByTestId('chapter-map-button').first().click();
    await page.getByTestId('chapter-ladder-view').waitFor();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'chapter-overview-light.png') });

    // 4. 节梯子 · 亮色（点 3.1 节行，就地展开）
    await page.getByTestId(/^overview-section-3\.1 /).first().click();
    await page.getByTestId(/^ladder-section-3\.1 /).first().waitFor();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'ladder-desktop-light.png') });

    // 5. 节点详情卡（聚焦子图）
    await page.getByRole('button', { name: /概念19，学习中/ }).click();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'ladder-detail-light.png') });
    await page.getByRole('button', { name: '关闭详情' }).click();

    // 6. 岛屿总览 · 亮色（入口在章总览底部的文字链接）
    await page.getByTestId('open-islands').click();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'islands-desktop-light.png') });
    await page.getByRole('button', { name: '返回总览' }).click();

    // 7. 梯子 · 暗色
    await page.evaluate(() => localStorage.setItem('learnmath_dark', '1'));
    await page.reload();
    await page.getByTestId('chapter-ladder-view').waitFor();
    await page.getByTestId(/^overview-section-3\.1 /).first().click();
    await page.getByTestId(/^ladder-section-3\.1 /).first().waitFor();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'ladder-desktop-dark.png') });
    await page.evaluate(() => localStorage.setItem('learnmath_dark', '0'));

    // 8. 章内列表视图 · 亮色
    await page.reload();
    await page.getByTestId('chapter-ladder-view').waitFor();
    await page.getByRole('button', { name: '列表', exact: true }).click();
    await page.getByRole('button', { name: /3\.1 / }).first().click();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'chapter-list-light.png') });
  });

  test('mobile shots', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile');
    await mkdir(artifactDir, { recursive: true });
    await mockApp(page);

    await page.goto('/');
    await page.getByText('学习地图', { exact: true }).first().waitFor();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'maphome-mobile-light.png') });

    await page.locator('main li').filter({ hasText: /^第 3 章/ }).getByTestId('chapter-map-button').first().click();
    await page.getByTestId('chapter-ladder-view').waitFor();
    await settle(page);
    await page.screenshot({ path: resolve(artifactDir, 'chapter-mobile-light.png') });
  });
});
