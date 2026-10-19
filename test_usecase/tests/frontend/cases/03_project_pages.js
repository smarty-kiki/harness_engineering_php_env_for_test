const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, expectVisible,
  expectHidden, clickAndWaitLoad, selectOption, api, assertApiOk, expectStatus, text,
} = require('../lib/core');

/**
 * 项目概览 / 流水线 / 知识 / 系统仓库 / 初版版本页 / 空项目空状态。
 */
module.exports = async function projectPages(ctx) {
  const { page, state, t } = ctx;
  const p1 = state.projects.p1;
  const p2 = state.projects.p2;
  const p3 = state.projects.p3;
  const p1s = state.p1;

  await t.step('项目概览：长期资产与工作项统计', async () => {
    await goto(ctx, '/project/' + p1.id);
    await expectText(ctx, '.page-title', p1.name);
    await expectBodyText(ctx, '初版阶段：用于需求/缺陷流转与初版发布测试');
    await expectBodyText(ctx, '初版', '初版徽标');

    const statNums = await page.locator('.stat-num').allInnerTexts();
    assert.deepEqual(statNums.map((v) => v.trim()), ['3', '1', '2'], '资产统计：角色/流程/系统');

    await expectBodyText(ctx, '业务流程（3 节点）');
    await expectBodyText(ctx, '系统（3 模块）');

    const workTable = await page.locator('.card', { hasText: '工作项' }).first().innerText();
    assert.ok(workTable.includes('需求') && workTable.includes('开发 BUG') && workTable.includes('生产缺陷'));
    await expectBodyText(ctx, '去提需求');
    await expectBodyText(ctx, '版本与发布');
    await t.screenshot('09-project-overview');
  });

  await t.step('初版项目的顶部版本下拉提示初版阶段', async () => {
    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await expectVisible(ctx, '#version-dropdown.open');
    await expectBodyText(ctx, '初版（未发布）');
    await expectBodyText(ctx, '初版阶段不建版本');
    await page.locator('.page-title').click();
  });

  await t.step('项目知识：角色 / 业务流程 / 系统三个页签', async () => {
    await goto(ctx, '/project/' + p1.id + '/knowledge');
    await expectBodyText(ctx, '项目知识');
    await expectBodyText(ctx, '店长');
    await expectBodyText(ctx, '仓管');

    await page.locator('.tabs .tab[data-tab=processes]').click();
    await expectVisible(ctx, '[data-panel=processes]');
    await expectHidden(ctx, '[data-panel=roles]');
    await expectBodyText(ctx, '订单履约');
    await expectBodyText(ctx, '主数据/单据：订单');
    await expectBodyText(ctx, '自动支付');
    assert.ok(new URL(page.url()).search.includes('tab=processes'), '切换页签应更新 URL');

    await page.locator('.tabs .tab[data-tab=systems]').click();
    await expectVisible(ctx, '[data-panel=systems]');
    await expectBodyText(ctx, '门店系统');
    await expectBodyText(ctx, '网页端');
    await expectBodyText(ctx, '收银管理');
    await expectBodyText(ctx, '收银台');
    await expectBodyText(ctx, '/cashier');
    await expectBodyText(ctx, 'POST');
    await expectBodyText(ctx, '/api/order/create');
    await expectBodyText(ctx, '开放');
    await expectBodyText(ctx, '日结汇总');
    await expectBodyText(ctx, '库存服务');
    await expectBodyText(ctx, '微服务接口');
    await t.screenshot('10-project-knowledge');

    await page.locator('.tabs .tab[data-tab=roles]').click();
    await expectVisible(ctx, '[data-panel=roles]');
  });

  await t.step('旧版知识路径重定向到知识页对应页签', async () => {
    await goto(ctx, '/project/' + p1.id + '/roles');
    await expectPath(ctx, '/project/' + p1.id + '/knowledge?tab=roles', '角色旧路径');

    await goto(ctx, '/project/' + p1.id + '/processes');
    await expectPath(ctx, '/project/' + p1.id + '/knowledge?tab=processes', '流程旧路径');

    await goto(ctx, '/project/' + p1.id + '/systems');
    await expectPath(ctx, '/project/' + p1.id + '/knowledge?tab=systems', '系统旧路径');
  });

  await t.step('未知知识页签回退到角色页签', async () => {
    await goto(ctx, '/project/' + p1.id + '/knowledge?tab=unknown');
    await expectVisible(ctx, '[data-panel=roles]');
    await expectHidden(ctx, '[data-panel=systems]');
  });

  await t.step('流水线统计随工作项状态展示', async () => {
    await goto(ctx, '/project/' + p1.id + '/pipeline');
    await expectText(ctx, '.page-title', '流水线');
    await expectBodyText(ctx, '开发阶段');
    await expectBodyText(ctx, '测试阶段');
    await expectBodyText(ctx, '发布阶段');

    const stats = {};
    for (const el of await page.locator('[data-stat]').all()) {
      stats[await el.getAttribute('data-stat')] = (await el.innerText()).trim();
    }

    assert.equal(stats.requirement_total, '6', '需求总数');
    assert.equal(stats.prod_defect_total, '0', '生产缺陷总数');
    assert.equal(stats.to_dev, '1', '待开发需求数');
    assert.equal(stats.developing, '1', '需求开发中');
    assert.equal(stats.to_review, '1', '需求待验收');
    assert.equal(stats.accepted, '3', '需求已验收');
    assert.equal(stats.bug_to_fix, '1');
    assert.equal(stats.bug_fixing, '1');
    assert.equal(stats.bug_accepted, '1');
    assert.equal(stats.test_total, '2', '测试用例总数');
    await t.screenshot('11-pipeline');
  });

  await t.step('系统仓库：编辑、取消、保存', async () => {
    await goto(ctx, '/project/' + p1.id + '/system_repos');
    await expectBodyText(ctx, '共 2 个系统');
    await expectBodyText(ctx, '未配置');

    const mainSystemId = p1s.systems.main.id;
    const stockSystemId = p1s.systems.stock.id;
    const devBranch = await text(ctx, '.repo-dev-branch');
    assert.equal(devBranch, '初版-dev', '初版项目开发分支');

    await page.locator('.repo-btn-edit-all').click();
    await expectVisible(ctx, '.repo-url-' + mainSystemId, '编辑模式仓库输入框');
    assert.equal(await page.locator('.repo-btn-save-all').isVisible(), true, '保存按钮出现');
    assert.equal(await page.locator('.repo-btn-cancel-all').isVisible(), true, '取消按钮出现');

    await page.locator('.repo-url-' + mainSystemId).fill('https://example.com/temp.git');
    await page.locator('.repo-test-branch-' + mainSystemId).fill('temp-test');
    await page.locator('.repo-prod-branch-' + mainSystemId).fill('temp-main');
    await page.locator('.repo-btn-cancel-all').click();
    await expectVisible(ctx, '.repo-btn-edit-all');
    await expectBodyText(ctx, '未配置', '取消后仍为未配置');

    await page.locator('.repo-btn-edit-all').click();
    await page.locator('.repo-url-' + mainSystemId).fill('https://github.com/pw-demo/store.git');
    await page.locator('.repo-test-branch-' + mainSystemId).fill('test');
    await page.locator('.repo-prod-branch-' + mainSystemId).fill('main');
    await page.locator('.repo-url-' + stockSystemId).fill('git@github.com:pw-demo/stock.git');
    await page.locator('.repo-test-branch-' + stockSystemId).fill('qa');
    await page.locator('.repo-prod-branch-' + stockSystemId).fill('release');

    await page.locator('.repo-btn-save-all').click();
    await waitToast(ctx, '仓库配置已保存', '保存仓库配置');
    await expectBodyText(ctx, 'https://github.com/pw-demo/store.git');
    await expectBodyText(ctx, 'git@github.com:pw-demo/stock.git');
    await expectBodyText(ctx, 'qa');
    await expectBodyText(ctx, 'release');
    await t.screenshot('12-system-repos');
  });

  await t.step('系统仓库接口校验：地址/分支过长与非法数据', async () => {
    const longUrl = await api(ctx, '/api/project/' + p1.id + '/system/' + p1s.systems.main.id + '/repo', {
      method: 'POST',
      data: { repo_url: 'x'.repeat(501), test_branch: '', prod_branch: '' },
    });
    assert.equal(longUrl.body.code, 'REPO_URL_TOO_LONG');

    const longBranch = await api(ctx, '/api/project/' + p1.id + '/system/' + p1s.systems.main.id + '/repo', {
      method: 'POST',
      data: { repo_url: '', test_branch: 'b'.repeat(129), prod_branch: '' },
    });
    assert.equal(longBranch.body.code, 'REPO_BRANCH_TOO_LONG');

    const invalid = await api(ctx, '/api/project/' + p1.id + '/system/repos', {
      method: 'POST',
      data: { repos: 'not-array' },
    });
    assert.equal(invalid.body.code, 'REPOS_INVALID');

    // 单系统保存接口
    const single = await api(ctx, '/api/project/' + p1.id + '/system/' + p1s.systems.stock.id + '/repo', {
      method: 'POST',
      data: { repo_url: 'git@github.com:pw-demo/stock.git', test_branch: 'qa', prod_branch: 'release' },
    });
    assertApiOk(single, '单系统仓库保存');
  });

  await t.step('初版项目版本页空状态与发布提示', async () => {
    await goto(ctx, '/project/' + p1.id + '/versions');
    await expectBodyText(ctx, '初版阶段');
    await expectBodyText(ctx, '初版尚未发布');
    await expectVisible(ctx, '#initial-release-form', '拥有者可见初版发布表单');
    await expectBodyText(ctx, '版本列表');
    assert.equal(await page.locator('[data-release-version]').count(), 0, '暂无版本可发布');
    await t.screenshot('13-versions-initial');
  });

  await t.step('空项目：概览与全部子页面空状态', async () => {
    await goto(ctx, '/project/' + p3.id);
    await expectBodyText(ctx, '初版开发中');
    const statNums = await page.locator('.stat-num').allInnerTexts();
    assert.deepEqual(statNums.map((v) => v.trim()), ['0', '0', '0']);

    await goto(ctx, '/project/' + p3.id + '/knowledge');
    await expectBodyText(ctx, '还没有角色');
    await page.locator('.tabs .tab[data-tab=processes]').click();
    await expectBodyText(ctx, '还没有业务流程');
    await page.locator('.tabs .tab[data-tab=systems]').click();
    await expectBodyText(ctx, '还没有系统');

    await goto(ctx, '/project/' + p3.id + '/test_cases');
    await expectBodyText(ctx, '在左侧树中点击一条用例');

    await goto(ctx, '/project/' + p3.id + '/requirements');
    await expectBodyText(ctx, '还没有需求');

    await goto(ctx, '/project/' + p3.id + '/bugs');
    await expectBodyText(ctx, '还没有开发 BUG');

    await goto(ctx, '/project/' + p3.id + '/prod_defects');
    await expectBodyText(ctx, '初版阶段不支持提交生产缺陷');

    await goto(ctx, '/project/' + p3.id + '/system_repos');
    await expectBodyText(ctx, '还没有系统');

    await goto(ctx, '/project/' + p3.id + '/pipeline');
    await expectBodyText(ctx, '流水线');

    await goto(ctx, '/project/' + p3.id + '/agent');
    await expectBodyText(ctx, '还没有方案');
    await expectBodyText(ctx, '新对话：提交后会创建一份方案');
    await t.screenshot('14-empty-project');
  });

  await t.step('系统仓库：无系统空态不产生前端运行时错误', async () => {
    const errors = [];
    const onPageError = (err) => errors.push(err.message);

    page.on('pageerror', onPageError);

    try {
      await goto(ctx, '/project/' + p3.id + '/system_repos');
      await expectBodyText(ctx, '还没有系统');
    } finally {
      page.off('pageerror', onPageError);
    }

    assert.deepEqual(
      errors,
      [],
      '无系统空态页面：期望没有前端运行时错误，实际 ' + (errors.join('；') || '无')
    );
  });

  await t.step('版本项目：初版发布后页面入口保持可访问', async () => {
    await goto(ctx, '/project/' + p2.id);
    await expectBodyText(ctx, '已发布 初版 v1.0.0');
    await t.screenshot('15-released-overview');
  });
};
