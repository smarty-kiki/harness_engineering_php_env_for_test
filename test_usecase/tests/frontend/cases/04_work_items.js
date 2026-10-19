const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, expectVisible,
  expectHidden, clickAndWaitLoad, selectOption, api, assertApiError, waitReload,
  confirmPmsModal,
} = require('../lib/core');

/**
 * 需求 / 开发 BUG / 生产缺陷的列表、详情、状态流转、版本分配与变更历史。
 */
module.exports = async function workItems(ctx) {
  const { page, state, t } = ctx;
  const p1 = state.projects.p1;
  const p2 = state.projects.p2;
  const p1w = state.p1;
  const p2w = state.p2;

  await t.step('需求列表展示编号、标题、系统、状态、创建时间', async () => {
    await goto(ctx, '/project/' + p1.id + '/requirements');
    await expectText(ctx, '.page-title', '需求');
    await expectBodyText(ctx, '由项目助手基于对话创建');

    const rows = page.locator('tbody tr[data-href]');
    assert.equal(await rows.count(), 6, '需求列表行数');
    await expectBodyText(ctx, p1w.requirements.new.no);
    await expectBodyText(ctx, p1w.requirements.new.title);
    await expectBodyText(ctx, '门店系统');
    await expectBodyText(ctx, '待开发');
    await expectBodyText(ctx, '开发中');
    await expectBodyText(ctx, '待验收');
    await expectBodyText(ctx, '已验收');
    assert.equal(await page.locator('th:has-text("版本")').count(), 0, '初版项目需求列表不展示版本列');
    await t.screenshot('16-requirements-list');
  });

  await t.step('需求详情：信息、关联资产、状态按钮与复制编号', async () => {
    await goto(ctx, '/project/' + p1.id + '/requirements/' + p1w.requirements.new.id);
    await expectText(ctx, '.page-title', p1w.requirements.new.title);
    await expectBodyText(ctx, p1w.requirements.new.no);
    await expectBodyText(ctx, '创建人');
    await expectBodyText(ctx, 'PW 拥有者');
    await expectBodyText(ctx, '待开发');

    await expectBodyText(ctx, '关联资产');
    await expectBodyText(ctx, '门店系统');
    await expectBodyText(ctx, '收银管理');
    await expectBodyText(ctx, '收银台');
    await expectBodyText(ctx, '订单列表');
    await expectBodyText(ctx, '店长');
    await expectBodyText(ctx, '订单履约');
    await expectBodyText(ctx, '系统仓库');
    await expectBodyText(ctx, '测试用例数');
    await expectBodyText(ctx, '1 个');

    assert.equal(await page.locator('[data-status-action=start_dev]').isEnabled(), true, '待开发可开始开发');
    assert.equal(await page.locator('[data-status-action=finish_dev]').isDisabled(), true, '待开发不可完成开发');
    assert.equal(await page.locator('[data-status-action=finish_review]').isDisabled(), true, '待开发不可验收');
    assert.equal(await page.locator('[data-status-action=re_dev]').isDisabled(), true, '待开发不可重新开发');

    await page.locator('[data-copy-text]').first().click();
    await waitToast(ctx, '编号已复制', '复制需求编号');
    await t.screenshot('17-requirement-detail');
  });

  await t.step('需求状态流转：开始开发 → 重新开发 → 完成开发 → 完成验收', async () => {
    // 待开发 → 开发中
    await waitReload(ctx, () => page.locator('[data-status-action=start_dev]').click(), '开始开发');
    await waitToast(ctx, '开发中', '开始开发提示').catch(() => {});
    await expectBodyText(ctx, '开发中');
    assert.equal(await page.locator('[data-status-action=finish_dev]').isEnabled(), true, '开发中可完成开发');
    assert.equal(await page.locator('[data-status-action=re_dev]').isEnabled(), true, '开发中可重新开发');

    // 开发中 → 待开发
    await waitReload(ctx, () => page.locator('[data-status-action=re_dev]').click(), '重新开发');
    await expectBodyText(ctx, '待开发');

    // 开发中 → 待验收
    await waitReload(ctx, () => page.locator('[data-status-action=start_dev]').click(), '再次开始开发');
    await waitReload(ctx, () => page.locator('[data-status-action=finish_dev]').click(), '完成开发');
    await expectBodyText(ctx, '待验收');
    await expectBodyText(ctx, '完成开发时间');

    // 待验收 → 已验收
    await waitReload(ctx, () => page.locator('[data-status-action=finish_review]').click(), '完成验收');
    await expectBodyText(ctx, '已验收');
    await expectBodyText(ctx, '完成验收时间');
    assert.equal(await page.locator('[data-status-action=re_dev]').isEnabled(), true, '已验收可重新开发');
  });

  await t.step('需求详情变更历史：滚动加载分页', async () => {
    await goto(ctx, '/project/' + p1.id + '/requirements/' + p1w.requirements.history.id);
    await expectBodyText(ctx, '变更历史');

    const rows = page.locator('#history-body tr');
    await rows.first().waitFor({ state: 'visible' });

    // 页面首屏 8 行；滚动哨兵接近视口时会自动继续加载，最终展示全部 12 条
    await page.waitForFunction(() => document.querySelectorAll('#history-body tr').length === 12, { timeout: 10000 });
    await expectBodyText(ctx, '没有更多了', '加载完剩余历史');
    assert.equal(await rows.count(), 12, '变更历史总行数');
    await t.screenshot('18-work-history');
  });

  await t.step('开发 BUG 列表与详情状态流转', async () => {
    await goto(ctx, '/project/' + p1.id + '/bugs');
    await expectText(ctx, '.page-title', '开发 BUG');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 3, 'BUG 列表行数');
    await expectBodyText(ctx, p1w.bugs.new.title);
    await expectBodyText(ctx, p1w.bugs.dev.title);
    await expectBodyText(ctx, p1w.bugs.accepted.title);

    await goto(ctx, '/project/' + p1.id + '/bugs/' + p1w.bugs.new.id);
    await expectText(ctx, '.page-title', p1w.bugs.new.title);
    await expectBodyText(ctx, '创建人');
    await expectBodyText(ctx, '待开发');
    await expectBodyText(ctx, '暂无状态变更记录').catch(() => {});

    await waitReload(ctx, () => page.locator('[data-status-action=start_dev]').click(), 'BUG 开始开发');
    await expectBodyText(ctx, '开发中');
    await waitReload(ctx, () => page.locator('[data-status-action=finish_dev]').click(), 'BUG 完成开发');
    await expectBodyText(ctx, '待验收');
    await waitReload(ctx, () => page.locator('[data-status-action=finish_review]').click(), 'BUG 完成验收');
    await expectBodyText(ctx, '已验收');
    await t.screenshot('19-bug-detail');
  });

  await t.step('初版项目生产缺陷页提示暂不支持', async () => {
    await goto(ctx, '/project/' + p1.id + '/prod_defects');
    await expectText(ctx, '.page-title', '生产缺陷');
    await expectBodyText(ctx, '初版阶段不支持提交生产缺陷');
    assert.equal(await page.locator('#agent-form').count(), 0, '初版阶段不展示生产缺陷助手表单');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 0);
    await t.screenshot('20-prod-defects-initial');
  });

  await t.step('错误工作项与跨项目工作项被拦截', async () => {
    await goto(ctx, '/project/' + p1.id + '/requirements/999999999');
    await expectBodyText(ctx, '工作项不存在');

    await goto(ctx, '/project/' + p1.id + '/requirements/' + p2w.requirements.accepted.id);
    await expectBodyText(ctx, '工作项不存在');
  });

  await t.step('版本项目需求列表：版本筛选全部 / 池 / 各版本', async () => {
    await goto(ctx, '/project/' + p2.id + '/requirements');
    await expectBodyText(ctx, '按版本或需求池筛选');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 5, '版本项目需求总数');
    assert.equal(await page.locator('th:has-text("版本")').count(), 0, '需求列表不展示版本列（版本筛选在顶部下拉）');

    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await expectBodyText(ctx, '全部版本');
    await expectBodyText(ctx, '需求池');
    await page.locator('#version-dropdown .dropdown-item', { hasText: '需求池' }).click();
    await expectPath(ctx, '/project/' + p2.id + '/requirements?version=pool', '需求池筛选');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 1, '需求池只有 1 条');
    await expectBodyText(ctx, p2w.requirements.pool.title);

    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await page.locator('#version-dropdown .dropdown-item', { hasText: 'v1.1.0' }).click();
    await expectPath(ctx, '/project/' + p2.id + '/requirements?version=' + p2w.versions.v110.id, 'v1.1.0 筛选');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 2, 'v1.1.0 有 2 条需求');
    await expectBodyText(ctx, p2w.requirements.new.title);
    await expectBodyText(ctx, p2w.requirements.dev.title);
    await t.screenshot('21-requirements-filter');
  });

  await t.step('需求详情：来源对话弹层与变更清单', async () => {
    await goto(ctx, '/project/' + p2.id + '/requirements/' + p2w.requirements.accepted.id);
    await expectBodyText(ctx, 'v1.0.0');
    await expectBodyText(ctx, '已验收');
    await expectBodyText(ctx, '来源：项目助手对话');
    await expectBodyText(ctx, 'https://github.com/pw-demo/admin.git');
    await expectBodyText(ctx, 'feature/REQ-1');
    await expectBodyText(ctx, '+120');
    await expectBodyText(ctx, '-30');

    await page.locator('a', { hasText: '来源：项目助手对话' }).click();
    await expectVisible(ctx, '#agent-history-modal.open', '来源对话弹层');
    await page.locator('#agent-history-body .agent-history-detail').waitFor({ state: 'visible', timeout: 10000 });
    await expectBodyText(ctx, '新增 1 条');
    await expectBodyText(ctx, '替换删除');
    await expectBodyText(ctx, p2w.requirements.accepted.no);

    await page.locator('#agent-history-body [data-history-back]').click();
    await page.locator('#agent-history-body .agent-history-item').first().waitFor({ state: 'visible' });
    await expectBodyText(ctx, '新增 1 条');

    await page.locator('#agent-history-body [data-run-id="' + p2w.runs.changed.id + '"]').click();
    await page.locator('#agent-history-body .agent-history-detail').waitFor({ state: 'visible' });
    await expectBodyText(ctx, '新增 1 条');
    await page.locator('#agent-history-modal [data-close]').click();
    await expectHidden(ctx, '#agent-history-modal.open', '关闭来源对话弹层');
    await t.screenshot('22-agent-source-modal');
  });

  await t.step('版本分配：池 → 需求版本 → 回池，已发布版本不可修改', async () => {
    await goto(ctx, '/project/' + p2.id + '/requirements/' + p2w.requirements.pool.id);
    await expectBodyText(ctx, '需求池');

    await selectOption(ctx, '#version-select', String(p2w.versions.v110.id));
    await waitReload(ctx, () => page.locator('#version-btn').click(), '指派到 v1.1.0');
    await expectBodyText(ctx, 'v1.1.0');

    await selectOption(ctx, '#version-select', 'pool');
    await waitReload(ctx, () => page.locator('#version-btn').click(), '移出到需求池');
    await expectBodyText(ctx, '需求池');

    await selectOption(ctx, '#version-select', String(p2w.versions.v100.id));
    await page.locator('#version-btn').click();
    await waitToast(ctx, '版本已发布，不可再修改', '指派到已发布版本');
  });

  await t.step('版本项目开发 BUG：版本筛选不含池，详情可指派版本', async () => {
    await goto(ctx, '/project/' + p2.id + '/bugs');
    await expectText(ctx, '.page-title', '开发 BUG');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 3, 'BUG 总数');
    await expectBodyText(ctx, '缺陷池');

    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await expectBodyText(ctx, '全部版本');
    assert.equal(await page.locator('#version-dropdown .dropdown-item', { hasText: '缺陷池' }).count(), 0, 'BUG 筛选器不提供池选项');
    await page.locator('#version-dropdown .dropdown-item', { hasText: 'v1.1.0' }).click();
    await expectPath(ctx, '/project/' + p2.id + '/bugs?version=' + p2w.versions.v110.id, 'BUG v1.1.0 筛选');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 1, 'v1.1.0 有 1 条 BUG');
    await expectBodyText(ctx, p2w.bugs.new.title);

    await goto(ctx, '/project/' + p2.id + '/bugs/' + p2w.bugs.new.id);
    assert.equal(await page.locator('#version-select option[value=pool]').count(), 0, 'BUG 版本下拉无池选项');
    await selectOption(ctx, '#version-select', String(p2w.versions.v100.id));
    await page.locator('#version-btn').click();
    await waitToast(ctx, '版本已发布，不可再修改', 'BUG 指派到已发布版本');
    await t.screenshot('23-bug-version');
  });

  await t.step('版本项目生产缺陷：影响面展示与版本分配', async () => {
    await goto(ctx, '/project/' + p2.id + '/prod_defects');
    await expectText(ctx, '.page-title', '生产缺陷');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 3, '生产缺陷总数');
    await expectBodyText(ctx, '影响运营查看经营数据');
    await expectBodyText(ctx, '生产缺陷池');

    await goto(ctx, '/project/' + p2.id + '/prod_defects/' + p2w.prod_defects.pool.id);
    await expectBodyText(ctx, '影响面');
    await expectBodyText(ctx, '影响新用户登录');
    await expectBodyText(ctx, '生产缺陷池');

    await selectOption(ctx, '#version-select', String(p2w.versions.v110.id));
    await waitReload(ctx, () => page.locator('#version-btn').click(), '生产缺陷指派到版本');
    await expectBodyText(ctx, 'v1.1.0');

    await selectOption(ctx, '#version-select', 'pool');
    await waitReload(ctx, () => page.locator('#version-btn').click(), '生产缺陷移回池');
    await expectBodyText(ctx, '生产缺陷池');
    await t.screenshot('24-prod-defect-detail');
  });

  await t.step('状态接口非法动作与跨项目校验', async () => {
    const bad = await api(ctx, '/api/project/' + p1.id + '/requirement/' + p1w.requirements.accepted1.id + '/status', {
      method: 'POST',
      data: { action: 'unknown_action' },
    });
    assert.equal(bad.body.code, 'STATUS_ACTION_INVALID');

    const cross = await api(ctx, '/api/project/' + p1.id + '/requirement/' + p2w.requirements.pool.id + '/status', {
      method: 'POST',
      data: { action: 'start_dev' },
    });
    assert.equal(cross.body.code, 'WORK_NOT_FOUND');

    const logs = await api(ctx, '/api/project/' + p1.id + '/requirement/' + p1w.requirements.history.id + '/status_logs?start_id=0&limit=3');
    assert.equal(logs.body.code, 0);
    assert.equal(logs.body.data.logs.length, 3, '变更历史接口 limit');

    const logs2 = await api(ctx, '/api/project/' + p1.id + '/requirement/' + p1w.requirements.history.id + '/status_logs?start_id=' + logs.body.data.next_start_id + '&limit=50');
    assert.equal(logs2.body.code, 0);
    assert.ok(logs2.body.data.logs.length > 0);
  });
};
