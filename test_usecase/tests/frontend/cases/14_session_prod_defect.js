const {
  assert, goto, expectVisible, expectBodyText, confirmPmsModal, php,
} = require('../lib/core');

/**
 * 大而全助手会话的「新建会话 → 模拟一轮 → 注入含生产缺陷的方案 → 确认落库」：
 * 覆盖 agent_session::create、prod_defect::create 与方案确认的生产缺陷分支。
 */
module.exports = async function sessionProdDefect(ctx) {
  const { page, state, t } = ctx;
  const p3 = state.projects.p3;
  let sessionId = 0;
  let runId = 0;

  await t.step('大而全助手：新建会话并模拟一轮', async () => {
    php('pause_queue.php', ['90']);

    await goto(ctx, '/project/' + p3.id + '/agent');
    await page.locator('#agent-session-input').fill('补充生产环境库存同步超时的缺陷方案');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/agent/session/message') && r.request().method() === 'POST'),
      page.locator('#agent-session-submit').click(),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 0, '提交会话消息：code=' + json.code + ' msg=' + json.msg);
    runId = json.data.run_id;
    assert.ok(runId > 0);

    const ids = JSON.parse(php('latest_session_run.php', [String(p3.id), String(state.users.owner.id)]));
    sessionId = ids.session_id;
    assert.ok(sessionId > 0, '新建会话');
    assert.equal(ids.run_id, runId);

    php('simulate_run.php', ['--run_id=' + runId, '--outcome=done', '--session_id=' + sessionId]);
    await page.waitForTimeout(1500);
  });

  await t.step('注入生产缺陷方案并确认落库', async () => {
    php('set_session_plan.php', ['--session_id=' + sessionId]);

    await goto(ctx, '/project/' + p3.id + '/agent');
    await expectVisible(ctx, '.agent-plan-card[data-session-id="' + sessionId + '"]');
    await page.locator('.agent-plan-card .tabs .tab[data-tab=prod_defects]').click();
    await expectBodyText(ctx, '库存同步超时');
    await expectBodyText(ctx, '仓库管理员看到过期库存');

    await page.locator('#agent-plan-confirm').click();
    await expectVisible(ctx, '.modal-mask.open');

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/agent/session/' + sessionId + '/confirm')),
      confirmPmsModal(ctx),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 0, '确认方案接口');
    const result = json.data;

    assert.equal(result.works.length, 1, '落库 1 条生产缺陷');
    assert.equal(result.works[0].work_type, 'prod_defect');
    assert.equal(result.works[0].action, 'created');
    ctx.prodDefectWork = result.works[0];
    ctx.apiFixtures.p3_prod_defect_id = result.works[0].id;

    await expectBodyText(ctx, '方案已确认并写入项目');
    await expectBodyText(ctx, '库存同步超时');

    await t.takeCoverage('session-prod-defect-confirmed').catch(() => {});
  });

  await t.step('生产缺陷列表与详情', async () => {
    const work = ctx.prodDefectWork;
    assert.ok(work, '确认结果中的缺陷');

    await goto(ctx, '/project/' + p3.id + '/prod_defects');
    await expectBodyText(ctx, '库存同步超时');
    await expectBodyText(ctx, work.no);

    await goto(ctx, '/project/' + p3.id + '/prod_defects/' + work.id);
    await expectBodyText(ctx, '库存同步超时');
    await expectBodyText(ctx, '仓库管理员看到过期库存');
    await expectBodyText(ctx, '仓储系统');
    await t.screenshot('64-session-prod-defect');
  });
};
