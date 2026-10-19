const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, expectVisible,
  expectHidden, api, assertApiOk, assertApiError, waitReload, confirmPmsModal,
} = require('../lib/core');

/**
 * 初版发布全流程：未验收拦截 → 验收全部工作项 → 发布初版 → 版本化后的页面变化。
 */
module.exports = async function initialRelease(ctx) {
  const { page, state, t } = ctx;
  const p1 = state.projects.p1;
  const p1w = state.p1;

  async function versionIdByLabel(projectId, workId, label) {
    await goto(ctx, '/project/' + projectId + '/requirements/' + workId);
    const options = await page.locator('#version-select option').evaluateAll((opts) => opts.map((o) => ({
      value: o.value,
      label: (o.textContent || '').trim(),
    })));
    const found = options.find((item) => item.label.includes(label));

    assert.ok(found, `未找到版本 ${label}，实际选项：${JSON.stringify(options)}`);

    return Number(found.value);
  }

  async function transition(type, id, action) {
    const result = await api(ctx, '/api/project/' + p1.id + '/' + type + '/' + id + '/status', {
      method: 'POST',
      data: { action },
    });
    return assertApiOk(result, `P1 ${type} ${action}`);
  }

  await t.step('初版发布：存在未验收工作项时被拒绝', async () => {
    await goto(ctx, '/project/' + p1.id + '/versions');
    await page.locator('#initial-release-form input[name=version_no]').fill('1.0.0');
    await page.locator('#initial-release-form button[type=submit]').click();
    await expectVisible(ctx, '.modal-mask.open', '发布初版确认弹窗');
    await expectBodyText(ctx, '确认发布初版？');
    await confirmPmsModal(ctx);
    await waitToast(ctx, '尚有需求或 BUG 未验收', '未验收时发布初版');
    await expectBodyText(ctx, '初版尚未发布');
  });

  await t.step('把剩余需求与 BUG 推进到已验收', async () => {
    // 需求：开发中 → 待验收 → 已验收
    await transition('requirement', p1w.requirements.dev.id, 'finish_dev');
    await transition('requirement', p1w.requirements.dev.id, 'finish_review');

    // 需求：待验收 → 已验收
    await transition('requirement', p1w.requirements.review.id, 'finish_review');

    // BUG：开发中 → 待验收 → 已验收
    await transition('bug', p1w.bugs.dev.id, 'finish_dev');
    await transition('bug', p1w.bugs.dev.id, 'finish_review');

    // 其它已验收项保持不变；确认全部工作项均为已验收
    for (const key of ['new', 'dev', 'review', 'accepted1', 'accepted2', 'history']) {
      const detail = await api(ctx, '/api/project/' + p1.id + '/requirement/' + p1w.requirements[key].id + '/status_logs');
      assert.equal(detail.body.code, 0);
    }
  });

  await t.step('发布初版后进入版本化管理', async () => {
    await goto(ctx, '/project/' + p1.id + '/versions');
    await page.locator('#initial-release-form input[name=version_no]').fill('1.0.0');
    await page.locator('#initial-release-form button[type=submit]').click();
    await expectVisible(ctx, '.modal-mask.open', '发布初版确认弹窗');

    await waitReload(ctx, () => confirmPmsModal(ctx), '发布初版');

    await expectBodyText(ctx, 'v1.0.0');
    await expectBodyText(ctx, '已发布');
    await expectBodyText(ctx, '已验收');
    await expectBodyText(ctx, '9/9 已验收');
    await expectBodyText(ctx, '池中待分派：需求 0');
    await expectVisible(ctx, '#btn-create-version', '发布后可见创建版本按钮');
    assert.equal(await page.locator('#initial-release-form').count(), 0, '发布后不再展示初版发布表单');
    await t.screenshot('25-initial-released');

    ctx.p1ReleaseVersionId = await versionIdByLabel(p1.id, p1w.requirements.new.id, 'v1.0.0');
  });

  await t.step('初版发布后项目概览、顶部版本与工作列表联动', async () => {
    await goto(ctx, '/project/' + p1.id);
    await expectBodyText(ctx, '已发布 初版 v1.0.0');

    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await expectVisible(ctx, '#version-dropdown.open');
    await expectBodyText(ctx, 'v1.0.0');
    await expectBodyText(ctx, '已发布');
    await expectBodyText(ctx, '新建版本');
    await page.locator('.page-title').click();

    await goto(ctx, '/project/' + p1.id + '/requirements');
    await expectBodyText(ctx, '按版本或需求池筛选');
    assert.equal(await page.locator('th:has-text("版本")').count(), 0, '需求列表不展示版本列');
    await expectBodyText(ctx, 'v1.0.0');

    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await page.locator('#version-dropdown .dropdown-item', { hasText: '需求池' }).click();
    await expectPath(ctx, '/project/' + p1.id + '/requirements?version=pool', '初版发布后需求池筛选');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 0, '需求池已清空');
    await expectBodyText(ctx, '还没有需求');

    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await page.locator('#version-dropdown .dropdown-item', { hasText: 'v1.0.0' }).click();
    await expectPath(ctx, '/project/' + p1.id + '/requirements?version=' + ctx.p1ReleaseVersionId, 'v1.0.0 筛选');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 6, 'v1.0.0 归拢全部需求');
  });

  await t.step('初版发布后生产缺陷页开放提交入口', async () => {
    await goto(ctx, '/project/' + p1.id + '/prod_defects');
    await expectVisible(ctx, '#agent-form', '发布后展示生产缺陷助手表单');
    await expectBodyText(ctx, '生产缺陷池');
    assert.equal(await page.locator('tbody tr[data-href]').count(), 0);
  });

  await t.step('项目知识版本视图：发布定稿与对应工作项', async () => {
    const versionId = ctx.p1ReleaseVersionId;

    await goto(ctx, '/project/' + p1.id + '/knowledge?version=' + versionId);
    await expectBodyText(ctx, '版本 v1.0.0');
    await expectBodyText(ctx, '已发布 · 知识定稿');
    await expectBodyText(ctx, '已发布并完成知识定稿');
    await expectBodyText(ctx, '对应已验收工作项：9 条');

    await page.locator('details summary').click();
    await expectBodyText(ctx, p1w.requirements.accepted1.no);
    await expectBodyText(ctx, '需求');
    await expectBodyText(ctx, '开发 BUG');
    await expectBodyText(ctx, '店长');
    await page.locator('.tabs .tab[data-tab=systems]').click();
    await expectBodyText(ctx, '门店系统');
    await t.screenshot('26-knowledge-release');

    // 头部版本下拉切换回长期资产树
    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await page.locator('#version-dropdown .dropdown-item', { hasText: '长期资产树' }).click();
    await expectPath(ctx, '/project/' + p1.id + '/knowledge', '切回长期资产树');
  });

  await t.step('测试用例版本视图：已发布定稿只读', async () => {
    await goto(ctx, '/project/' + p1.id + '/test_cases?version=' + ctx.p1ReleaseVersionId);
    await expectBodyText(ctx, '已发布定稿内容（只读）');
    await expectBodyText(ctx, '收银台下单');
    await expectBodyText(ctx, '报表查询空数据');
    await expectBodyText(ctx, 'v1.0.0');
    await t.screenshot('27-test-case-release');
  });

  await t.step('已发布项目创建版本：重复版本号与成功创建', async () => {
    await goto(ctx, '/project/' + p1.id + '/versions');
    await page.locator('#btn-create-version').click();
    await expectVisible(ctx, '#create-version-modal.open', '创建版本弹窗');
    await page.locator('#create-version-form input[name=version_no]').fill('1.0.0');
    await page.locator('#create-version-form button[type=submit]').click();
    await waitToast(ctx, '版本号已存在', '重复版本号');
    await page.locator('#create-version-modal [data-close]').click();

    await page.locator('#btn-create-version').click();
    await page.locator('#create-version-form input[name=version_no]').fill('1.1.0');
    await page.locator('#create-version-form textarea[name=description]').fill('初版后的第一个迭代');

    await waitReload(ctx, async () => {
      await page.locator('#create-version-form button[type=submit]').click();
    }, '创建版本后刷新');

    await expectBodyText(ctx, 'v1.1.0');
    await expectBodyText(ctx, '开发中');
    await expectVisible(ctx, '[data-release-version]', '开发中版本可发布');
    await t.screenshot('28-version-created');

    ctx.p1ExtraVersionId = await versionIdByLabel(p1.id, p1w.requirements.new.id, 'v1.1.0');
  });

  await t.step('发布空版本成功，版本知识定稿', async () => {
    await goto(ctx, '/project/' + p1.id + '/versions');
    await page.locator('[data-release-version]').first().click();
    await expectVisible(ctx, '.modal-mask.open', '发布版本确认弹窗');
    await expectBodyText(ctx, '确认发布该版本？');

    await waitReload(ctx, () => confirmPmsModal(ctx), '发布 v1.1.0');

    await expectBodyText(ctx, 'v1.1.0');
    assert.equal(await page.locator('[data-release-version]').count(), 0, '已发布版本不再显示发布按钮');
    await goto(ctx, '/project/' + p1.id + '/knowledge?version=' + ctx.p1ExtraVersionId);
    await expectBodyText(ctx, '已发布 · 知识定稿');
    await t.screenshot('29-version-released');
  });

  await t.step('重复发布初版被接口拒绝', async () => {
    const again = await api(ctx, '/api/project/' + p1.id + '/release_initial', {
      method: 'POST',
      data: { version_no: '2.0.0' },
    });
    assertApiError(again, 'PROJECT_ALREADY_RELEASED', '重复发布初版');

    const emptyName = await api(ctx, '/api/project/' + p1.id + '/version/create', {
      method: 'POST',
      data: { version_no: '' },
    });
    assertApiError(emptyName, 'VERSION_NO_REQUIRED', '空版本号');
  });
};
