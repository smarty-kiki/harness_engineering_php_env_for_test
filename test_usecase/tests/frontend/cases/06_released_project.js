const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, expectVisible,
  expectHidden, selectOption, api, assertApiOk, assertApiError, waitReload,
  confirmPmsModal, text,
} = require('../lib/core');

/**
 * 已发布项目（P2）：版本页、流水线筛选与轮询、测试用例多版本视图与增删改、
 * 系统仓库、版本发布与版本知识/用例定稿。
 */
module.exports = async function releasedProject(ctx) {
  const { page, state, t } = ctx;
  const p2 = state.projects.p2;
  const w = state.p2;
  const v100 = w.versions.v100.id;
  const v110 = w.versions.v110.id;

  async function transition(type, id, action) {
    const result = await api(ctx, '/api/project/' + p2.id + '/' + type + '/' + id + '/status', {
      method: 'POST',
      data: { action },
    });
    return assertApiOk(result, `P2 ${type} ${action}`);
  }

  await t.step('版本列表：已发布 / 开发中统计与池数量', async () => {
    await goto(ctx, '/project/' + p2.id + '/versions');
    await expectText(ctx, '.page-title', '版本');
    await expectBodyText(ctx, '池中待分派：需求 1 ｜ 开发 BUG 1 ｜ 生产缺陷 1');
    await expectBodyText(ctx, 'v1.0.0');
    await expectBodyText(ctx, 'v1.1.0');
    await expectBodyText(ctx, '4/4 已验收', 'v1.0.0 验收进度');
    await expectBodyText(ctx, '0/4 已验收', 'v1.1.0 验收进度');
    assert.equal(await page.locator('[data-release-version]').count(), 1, '只有开发中版本可发布');
    await t.screenshot('30-versions-released');
  });

  await t.step('流水线：版本范围筛选', async () => {
    await goto(ctx, '/project/' + p2.id + '/pipeline');
    await expectVisible(ctx, 'select[name=version]', '流水线版本筛选');

    // 全部范围
    let stats = {};
    for (const el of await page.locator('[data-stat]').all()) {
      stats[await el.getAttribute('data-stat')] = (await el.innerText()).trim();
    }
    assert.equal(stats.requirement_total, '5');
    assert.equal(stats.prod_defect_total, '3');
    assert.equal(stats.accepted, '2', '全部范围：已验收需求 2 条');
    assert.equal(stats.bug_accepted, '1');

    // 切到 v1.1.0
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.selectOption('select[name=version]', String(v110)),
    ]);
    await expectBodyText(ctx, 'v1.1.0');
    stats = {};
    for (const el of await page.locator('[data-stat]').all()) {
      stats[await el.getAttribute('data-stat')] = (await el.innerText()).trim();
    }
    assert.equal(stats.requirement_total, '2', 'v1.1.0 需求数');
    assert.equal(stats.prod_defect_total, '1', 'v1.1.0 生产缺陷数');
    assert.equal(stats.bug_to_fix, '1');

    // 切到未分配（池）
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.selectOption('select[name=version]', 'pool'),
    ]);
    stats = {};
    for (const el of await page.locator('[data-stat]').all()) {
      stats[await el.getAttribute('data-stat')] = (await el.innerText()).trim();
    }
    assert.equal(stats.requirement_total, '1');
    assert.equal(stats.prod_defect_total, '1');
    assert.equal(stats.bug_to_fix, '1');
  });

  await t.step('流水线每 5 秒轮询刷新统计', async () => {
    await goto(ctx, '/project/' + p2.id + '/pipeline?version=' + v110);

    const before = Number(await text(ctx, '[data-stat=developing]'));
    assert.equal(before, 1, '轮询前开发中需求为 1');

    // 触发状态变化，等待下一次轮询把数字更新
    await api(ctx, '/api/project/' + p2.id + '/requirement/' + w.requirements.new.id + '/status', {
      method: 'POST',
      data: { action: 'start_dev' },
    });

    await page.waitForFunction(
      (oldValue) => Number(document.querySelector('[data-stat=developing]').textContent) !== oldValue,
      before,
      { timeout: 12000 }
    );

    assert.equal(Number(await text(ctx, '[data-stat=developing]')), 2, '轮询后开发中需求为 2');
  });

  await t.step('测试用例：全部版本视图与左侧树', async () => {
    await goto(ctx, '/project/' + p2.id + '/test_cases');
    await expectText(ctx, '.page-title', '测试用例');
    await expectBodyText(ctx, '测试用例挂在「系统 → 模块」结构下');
    await expectBodyText(ctx, w.test_cases.v100.name);
    await expectBodyText(ctx, w.test_cases.modified.name);
    await expectBodyText(ctx, w.test_cases.v110.name);
    await expectBodyText(ctx, w.test_cases.pool.name);
    assert.equal(await page.locator('.test-case-tree a').count(), 4, '全部版本视图中现存用例 4 条');

    await page.locator('.test-case-tree a', { hasText: w.test_cases.v110.name }).click();
    await expectPath(ctx, '/project/' + p2.id + '/test_cases?case=' + w.test_cases.v110.id, '打开用例详情');
    await expectBodyText(ctx, w.test_cases.v110.name);
    await expectBodyText(ctx, '步骤：');
    await expectBodyText(ctx, '测试点');
    await expectBodyText(ctx, '正常流程');
    await t.screenshot('31-test-cases');
  });

  await t.step('测试用例详情：系统 / 需求 / 伪代码页签', async () => {
    await expectVisible(ctx, '[data-case-body=case]', '用例页签内容');

    await page.locator('.case-view-tabs .tab[data-case-panel=assets]').click();
    await expectVisible(ctx, '[data-case-body=assets]');
    await expectHidden(ctx, '[data-case-body=case]');
    await expectBodyText(ctx, '相关页面（1）');
    await expectBodyText(ctx, w.pages.user.name);
    await expectBodyText(ctx, '相关服务端接口（1）');
    await expectBodyText(ctx, '/api/admin/user/list');
    await expectBodyText(ctx, '相关开放接口（1）');
    await expectBodyText(ctx, '/api/open/user/sync');
    await expectBodyText(ctx, '相关定时任务（1）');
    await expectBodyText(ctx, '用户同步任务');

    await page.locator('.case-view-tabs .tab[data-case-panel=req]').click();
    await expectVisible(ctx, '[data-case-body=req]');
    await expectBodyText(ctx, '用户列表查询');
    await expectBodyText(ctx, '用户详情查看');

    await page.locator('.case-view-tabs .tab[data-case-panel=script]').click();
    await expectVisible(ctx, '[data-case-body=script]');
    await expectVisible(ctx, '.tc-detail-body.tc-script-mode', '伪代码浅灰底');
    await expectBodyText(ctx, '打开页面');

    await page.locator('.case-view-tabs .tab[data-case-panel=case]').click();
    await expectHidden(ctx, '.tc-detail-body.tc-script-mode', '切回用例页签恢复白底');
    await t.screenshot('32-test-case-tabs');
  });

  await t.step('测试用例：用例池与版本视图（新增 / 修改 / 删除徽标）', async () => {
    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await page.locator('#version-dropdown .dropdown-item', { hasText: '用例池' }).click();
    await expectPath(ctx, '/project/' + p2.id + '/test_cases?version=pool', '用例池筛选');
    assert.equal(await page.locator('.test-case-tree a').count(), 1, '用例池 1 条');
    await expectBodyText(ctx, w.test_cases.pool.name);

    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await page.locator('#version-dropdown .dropdown-item', { hasText: 'v1.1.0' }).click();
    await expectPath(ctx, '/project/' + p2.id + '/test_cases?version=' + v110, 'v1.1.0 用例视图');
    await expectBodyText(ctx, 'v1.1.0 为实时合成');
    await expectBodyText(ctx, '本版已删除 1 条');
    await expectBodyText(ctx, w.test_cases.deleted.name);
    await expectBodyText(ctx, '新增');
    await expectBodyText(ctx, '修改');
    assert.equal(await page.locator('.test-case-tree a').count(), 3, 'v1.1.0 生效用例 3 条');

    // 已发布版本的用例为定稿快照
    await page.locator('#version-dropdown [data-dropdown-toggle]').click();
    await page.locator('#version-dropdown .dropdown-item', { hasText: 'v1.0.0' }).click();
    await expectPath(ctx, '/project/' + p2.id + '/test_cases?version=' + v100, 'v1.0.0 用例视图');
    await expectBodyText(ctx, 'v1.0.0 为已发布定稿内容（只读）');
    assert.equal(await page.locator('.test-case-tree a').count(), 2, 'v1.0.0 定稿用例 2 条');

    // 非法版本参数：范围文案回退「全部版本」时，列表也应回退全部（或明确报错）
    await goto(ctx, '/project/' + p2.id + '/test_cases?version=999999');
    const invalidCount = await page.locator('.test-case-tree a').count();
    const invalidBody = await page.locator('body').innerText();
    assert.ok(invalidBody.includes('全部') || invalidBody.includes('版本不存在'), '非法版本应有明确的范围或错误提示');
    assert.ok(!invalidBody.includes('版本不存在') || invalidCount === 0, '版本不存在时应展示错误而不是空树');

    await goto(ctx, '/project/' + p2.id + '/test_cases');
    const allCount = await page.locator('.test-case-tree a').count();
    assert.equal(allCount, 4, '全部视图用例 4 条');
    if (!invalidBody.includes('版本不存在')) {
      assert.equal(invalidCount, allCount, '范围回退全部时列表也应展示全部用例');
    }

    // 无效 case 参数显示空状态
    await goto(ctx, '/project/' + p2.id + '/test_cases?case=999999');
    await expectBodyText(ctx, '在左侧树中点击一条用例');
    await t.screenshot('33-test-case-versions');
  });

  await t.step('测试用例接口：选项、详情与参数校验', async () => {
    const options = await api(ctx, '/api/project/' + p2.id + '/test_case/options?system_id=' + w.systems.main.id);
    assertApiOk(options, '用例选项（系统模块）');
    assert.ok(options.body.data.modules.length >= 2);

    const optionsModule = await api(ctx, '/api/project/' + p2.id + '/test_case/options?system_id=' + w.systems.main.id + '&module_id=' + w.modules.user.id);
    const moduleData = assertApiOk(optionsModule, '用例选项（模块资产）');
    assert.ok(moduleData.assets.page.length >= 1, '模块内应返回页面资产');

    const badSystem = await api(ctx, '/api/project/' + p2.id + '/test_case/options?system_id=999999999');
    assertApiError(badSystem, 'SYSTEM_NOT_FOUND', '用例选项：系统不存在');

    const badModule = await api(ctx, '/api/project/' + p2.id + '/test_case/options?system_id=' + w.systems.main.id + '&module_id=999999999');
    assertApiError(badModule, 'TEST_MODULE_NOT_FOUND', '用例选项：模块不存在');

    const detail = await api(ctx, '/api/project/' + p2.id + '/test_case/' + w.test_cases.v110.id + '/detail');
    const detailData = assertApiOk(detail, '用例详情');
    assert.equal(detailData.name, w.test_cases.v110.name);
    assert.ok(detailData.points.length >= 1);
    assert.ok(detailData.assets.page.length >= 1);

    const missing = await api(ctx, '/api/project/' + p2.id + '/test_case/999999999/detail');
    assertApiError(missing, 'TEST_CASE_NOT_FOUND', '用例详情：不存在');
  });

  await t.step('测试用例接口：创建 / 更新 / 删除（池草稿与版本上下文）', async () => {
    const created = await api(ctx, '/api/project/' + p2.id + '/test_case/create', {
      method: 'POST',
      data: {
        system_id: w.systems.main.id,
        module_id: w.modules.user.id,
        version_id: v110,
        name: 'PW 自动化新增用例',
        description: '自动化创建',
        precondition: '已登录',
        script: '打开页面\n点击按钮',
        assets: [{ type: 'page', id: w.pages.user.id }],
        points: [{ name: '测试点一', expected: '成功' }, { name: '', expected: '忽略' }],
      },
    });
    const caseId = assertApiOk(created, '创建用例').id;
    assert.ok(caseId > 0);

    const afterCreate = await api(ctx, '/api/project/' + p2.id + '/test_case/' + caseId + '/detail');
    const afterCreateData = assertApiOk(afterCreate, '创建后详情');
    assert.equal(afterCreateData.name, 'PW 自动化新增用例');
    assert.equal(afterCreateData.points.length, 1, '空测试点被忽略');

    const updated = await api(ctx, '/api/project/' + p2.id + '/test_case/' + caseId + '/update', {
      method: 'POST',
      data: {
        system_id: w.systems.main.id,
        module_id: w.modules.user.id,
        version_id: v110,
        name: 'PW 自动化修改用例',
        description: '修改后描述',
        precondition: '',
        script: '修改后的伪代码',
        assets: [{ type: 'server_api', id: w.apis.user_list.id }],
        points: [{ name: '修改后的测试点', expected: '仍然成功' }],
      },
    });
    assertApiOk(updated, '更新用例');

    const afterUpdate = await api(ctx, '/api/project/' + p2.id + '/test_case/' + caseId + '/detail');
    const afterUpdateData = assertApiOk(afterUpdate, '更新后详情');
    assert.equal(afterUpdateData.name, 'PW 自动化修改用例');
    assert.equal(afterUpdateData.assets.server_api.length, 1, '关联服务端接口更新');
    assert.equal(afterUpdateData.assets.page.length, 0, '旧关联被替换');

    // 池草稿：可删除、可回池；入版本后禁止回池
    const poolCreated = await api(ctx, '/api/project/' + p2.id + '/test_case/create', {
      method: 'POST',
      data: {
        system_id: w.systems.main.id,
        module_id: w.modules.user.id,
        version_id: '',
        name: 'PW 池草稿用例',
        points: [],
        assets: [],
      },
    });
    const poolId = assertApiOk(poolCreated, '创建池草稿用例').id;

    const moveToVersion = await api(ctx, '/api/project/' + p2.id + '/test_case/' + poolId + '/update', {
      method: 'POST',
      data: {
        system_id: w.systems.main.id,
        module_id: w.modules.user.id,
        version_id: v110,
        name: 'PW 池草稿用例（入版本）',
      },
    });
    assertApiOk(moveToVersion, '池草稿入版本');

    const backToPool = await api(ctx, '/api/project/' + p2.id + '/test_case/' + poolId + '/update', {
      method: 'POST',
      data: {
        system_id: w.systems.main.id,
        module_id: w.modules.user.id,
        version_id: '',
        name: 'PW 池草稿用例（回池）',
      },
    });
    assertApiError(backToPool, 'TEST_CASE_ALREADY_VERSIONED', '已入版本用例回池');

    const deleted = await api(ctx, '/api/project/' + p2.id + '/test_case/' + caseId + '/delete', {
      method: 'POST',
      data: { version_id: v110 },
    });
    assertApiOk(deleted, '删除用例');

    const afterDelete = await api(ctx, '/api/project/' + p2.id + '/test_case/' + caseId + '/detail');
    assertApiError(afterDelete, 'TEST_CASE_NOT_FOUND', '删除后详情');
  });

  await t.step('测试用例接口：错误参数校验', async () => {
    const base = {
      system_id: w.systems.main.id,
      module_id: w.modules.user.id,
      version_id: v110,
      name: '校验用例',
      points: [],
      assets: [],
    };

    const noName = await api(ctx, '/api/project/' + p2.id + '/test_case/create', { method: 'POST', data: { ...base, name: '' } });
    assertApiError(noName, 'TEST_CASE_NAME_REQUIRED', '用例名必填');

    const longName = await api(ctx, '/api/project/' + p2.id + '/test_case/create', { method: 'POST', data: { ...base, name: 'x'.repeat(101) } });
    assertApiError(longName, 'TEST_CASE_NAME_TOO_LONG', '用例名过长');

    const wrongSystem = await api(ctx, '/api/project/' + p2.id + '/test_case/create', { method: 'POST', data: { ...base, system_id: state.p1.systems.main.id } });
    assertApiError(wrongSystem, 'SYSTEM_NOT_FOUND', '跨项目系统');

    const wrongModule = await api(ctx, '/api/project/' + p2.id + '/test_case/create', { method: 'POST', data: { ...base, module_id: state.p1.modules.cashier.id } });
    assertApiError(wrongModule, 'TEST_MODULE_NOT_FOUND', '模块不属于系统');

    const wrongAsset = await api(ctx, '/api/project/' + p2.id + '/test_case/create', {
      method: 'POST',
      data: { ...base, assets: [{ type: 'page', id: w.pages.report.id }] },
    });
    assertApiError(wrongAsset, 'TEST_ASSET_NOT_IN_MODULE', '关联资产不属于模块');

    const longPoint = await api(ctx, '/api/project/' + p2.id + '/test_case/create', {
      method: 'POST',
      data: { ...base, points: [{ name: 'p'.repeat(256), expected: '' }] },
    });
    assertApiError(longPoint, 'TEST_POINT_NAME_TOO_LONG', '测试点过长');

    const releasedVersion = await api(ctx, '/api/project/' + p2.id + '/test_case/create', { method: 'POST', data: { ...base, version_id: v100 } });
    assertApiError(releasedVersion, 'VERSION_ALREADY_RELEASED', '已发布版本不能新增用例');

    const unknownVersion = await api(ctx, '/api/project/' + p2.id + '/test_case/create', { method: 'POST', data: { ...base, version_id: 999999999 } });
    assertApiError(unknownVersion, 'VERSION_NOT_FOUND', '版本不存在');
  });

  await t.step('系统仓库：版本项目分支与批量保存', async () => {
    await goto(ctx, '/project/' + p2.id + '/system_repos');
    await expectBodyText(ctx, '共 2 个系统');
    await expectBodyText(ctx, 'https://github.com/pw-demo/admin.git');
    const branches = await page.locator('.repo-dev-branch').allInnerTexts();
    assert.ok(branches.some((b) => b.trim() === 'v1.1.0-dev'), '已发布项目开发分支按最新版本生成');

    await page.locator('.repo-btn-edit-all').click();
    await page.locator('.repo-test-branch-' + w.systems.main.id).fill('qa-auto');
    await page.locator('.repo-btn-save-all').click();
    await waitToast(ctx, '仓库配置已保存', '版本项目保存仓库');
    await expectBodyText(ctx, 'qa-auto');
    await t.screenshot('34-system-repos-released');
  });

  await t.step('发布版本：未验收拦截', async () => {
    await goto(ctx, '/project/' + p2.id + '/versions');
    await page.locator('[data-release-version]').first().click();
    await expectVisible(ctx, '.modal-mask.open', '发布版本确认');
    await confirmPmsModal(ctx);
    await waitToast(ctx, '版本内尚有需求或 BUG 未验收', '未验收版本发布');
    await expectBodyText(ctx, 'v1.1.0');
    await expectBodyText(ctx, '0/4 已验收');
  });

  await t.step('验收 v1.1.0 全部工作项并发布版本', async () => {
    // 需求：new（已被流水线轮询改为 developing）→ to_review → accepted
    await transition('requirement', w.requirements.new.id, 'finish_dev');
    await transition('requirement', w.requirements.new.id, 'finish_review');
    await transition('requirement', w.requirements.dev.id, 'finish_dev');
    await transition('requirement', w.requirements.dev.id, 'finish_review');

    // 开发 BUG
    await transition('bug', w.bugs.new.id, 'start_dev');
    await transition('bug', w.bugs.new.id, 'finish_dev');
    await transition('bug', w.bugs.new.id, 'finish_review');

    // 生产缺陷（developing）
    await transition('prod_defect', w.prod_defects.dev.id, 'finish_dev');
    await transition('prod_defect', w.prod_defects.dev.id, 'finish_review');

    await goto(ctx, '/project/' + p2.id + '/versions');
    await expectBodyText(ctx, '4/4 已验收');
    await page.locator('[data-release-version]').first().click();
    await expectVisible(ctx, '.modal-mask.open', '发布版本确认');

    await waitReload(ctx, () => confirmPmsModal(ctx), '发布 v1.1.0');

    await expectBodyText(ctx, 'v1.1.0');
    assert.equal(await page.locator('[data-release-version]').count(), 0, '发布后无待发布版本');
    await t.screenshot('35-version-released');
  });

  await t.step('版本发布后：版本知识与用例定稿', async () => {
    await goto(ctx, '/project/' + p2.id + '/knowledge?version=' + v110);
    await expectBodyText(ctx, '版本 v1.1.0');
    await expectBodyText(ctx, '已发布 · 知识定稿');
    await expectBodyText(ctx, '对应已验收工作项：4 条');
    await page.locator('details summary').click();
    await expectBodyText(ctx, w.requirements.new.no);
    await expectBodyText(ctx, w.prod_defects.dev.no);

    await goto(ctx, '/project/' + p2.id + '/test_cases?version=' + v110);
    await expectBodyText(ctx, 'v1.1.0 为已发布定稿内容（只读）');
    assert.equal(await page.locator('.test-case-tree a').count(), 4, '定稿时生效用例数（含本次新增）');
    await t.screenshot('36-version-frozen');
  });

  await t.step('项目知识：非法版本报错、无版本展示长期资产树', async () => {
    await goto(ctx, '/project/' + p2.id + '/knowledge?version=999999');
    await expectBodyText(ctx, '版本不存在');

    await goto(ctx, '/project/' + p2.id + '/knowledge');
    await expectBodyText(ctx, '项目的长期资产');
    await page.locator('.tabs .tab[data-tab=systems]').click();
    await expectBodyText(ctx, '管理后台');
    await expectBodyText(ctx, '开放服务');
  });

  await t.step('版本接口：已发布版本不可指派/移出，未知版本报错', async () => {
    const assign = await api(ctx, '/api/project/' + p2.id + '/version/' + v110 + '/assign', {
      method: 'POST',
      data: { work_type: 'requirement', work_id: w.requirements.pool.id },
    });
    assertApiError(assign, 'VERSION_ALREADY_RELEASED', '已发布版本指派');

    const unassign = await api(ctx, '/api/project/' + p2.id + '/version/' + v110 + '/unassign', {
      method: 'POST',
      data: { work_type: 'requirement', work_id: w.requirements.pool.id },
    });
    assertApiError(unassign, 'VERSION_ALREADY_RELEASED', '已发布版本移出');

    const notFound = await api(ctx, '/api/project/' + p2.id + '/version/999999999/assign', {
      method: 'POST',
      data: { work_type: 'requirement', work_id: w.requirements.pool.id },
    });
    assertApiError(notFound, 'VERSION_NOT_FOUND', '版本不存在');

  });
};
