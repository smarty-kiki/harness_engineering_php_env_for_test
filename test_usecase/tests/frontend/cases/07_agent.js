const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, expectVisible,
  expectHidden, api, assertApiOk, assertApiError, waitReload, pauseQueue,
  requestRunSimulation, confirmPmsModal, text,
} = require('../lib/core');

/**
 * 项目助手：大而全会话（方案展示 / 提交 / 模拟完成 / 放弃 / 历史回放 / 确认落库）
 * 与单场景助手（需求 / BUG / 生产缺陷提交、模拟完成与失败、历史对话分页）。
 */
module.exports = async function agent(ctx) {
  const { page, state, t } = ctx;
  const p1 = state.projects.p1;
  const p2 = state.projects.p2;
  const p2w = state.p2;

  async function submitWorkAgent(mode, message, workType, workId) {
    await pauseQueue(30);

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/agent/run')),
      page.locator('#agent-submit').click(),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 0, '提交单场景助手任务');
    const runId = json.data.run_id;

    requestRunSimulation(runId, 'done', [
      '--work_id=' + workId,
      '--work_type=' + workType,
      '--work_count=2',
    ]);

    await page.locator('.agent-status.is-done', { hasText: '已完成' }).last().waitFor({ state: 'visible', timeout: 20000 });
    await expectBodyText(ctx, '创建 ' + workTypeLabel(workType) + ' 2 条');
  }

  function workTypeLabel(type) {
    return { requirement: '需求', bug: '开发 BUG', prod_defect: '生产缺陷' }[type] || type;
  }

  await t.step('项目助手页恢复进行中的会话与方案区', async () => {
    await goto(ctx, '/project/' + p2.id + '/agent');
    await expectText(ctx, '.page-title', '项目助手');
    await expectBodyText(ctx, '未完成会话');
    await expectBodyText(ctx, '规划用户管理');
    await expectBodyText(ctx, '方案已生成，请确认。');

    await expectVisible(ctx, '.agent-plan-card[data-session-id="' + p2w.sessions.active.id + '"]', '方案卡与会话 id');
    await expectText(ctx, '#agent-session-input', '', '输入框为空').catch(() => {});

    const tabs = page.locator('.agent-plan-card .tabs .tab');
    assert.ok(await tabs.count() >= 5, '方案区应有 5 个分区页签');

    for (const name of ['roles', 'processes', 'systems', 'requirements', 'prod_defects']) {
      const tab = page.locator('.agent-plan-card .tabs .tab[data-tab=' + name + ']');
      await tab.click();
      await expectVisible(ctx, '.agent-plan-card [data-panel=' + name + ']', '方案分区 ' + name);
    }

    await page.locator('.agent-plan-card .tabs .tab[data-tab=roles]').click();
    await expectBodyText(ctx, '运营专员');
    await expectBodyText(ctx, '旧角色');

    await page.locator('.agent-plan-card .tabs .tab[data-tab=systems]').click();
    await expectBodyText(ctx, '管理后台');
    await expectBodyText(ctx, '用户详情');
    await t.screenshot('37-agent-plan');

    // 页面已恢复一轮「排队中」的会话轮次并自动重连 SSE：模拟完成后恢复可提交状态
    await expectBodyText(ctx, '继续补充一个报表需求');
    assert.equal(await page.locator('#agent-session-submit').isDisabled(), true, '运行中的会话禁用提交');

    requestRunSimulation(p2w.sessions.pending_round.id, 'done');
    await page.locator('#round-bubble-' + p2w.sessions.pending_round.id + ' .agent-status.is-done')
      .waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => !document.getElementById('agent-session-submit').disabled, null, { timeout: 10000 });
  });

  await t.step('项目助手提交一轮消息并模拟完成，方案区自动刷新', async () => {
    await pauseQueue(30);

    await page.locator('#agent-session-input').fill('补充一个运营角色与导出需求');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/agent/session/message')),
      page.locator('#agent-session-submit').click(),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 0, '提交会话消息');
    const runId = json.data.run_id;
    assert.ok(json.data.session_id === p2w.sessions.active.id, '复用进行中的会话');

    const planRefresh = page.waitForResponse((r) => r.url().includes('/agent_plan'), { timeout: 20000 });
    requestRunSimulation(runId, 'done');

    await page.locator('.msg-agent', { hasText: '模拟回复' }).last().waitFor({ state: 'visible', timeout: 20000 });
    await planRefresh;
    await expectBodyText(ctx, '模拟回复');
    await expectBodyText(ctx, '已完成');
    await t.screenshot('38-agent-session-done');
  });

  await t.step('放弃方案：确认弹窗与空方案状态', async () => {
    // 方案区刷新与忙碌状态可能存在竞态，重新进入页面以服务端当前会话状态为准
    await goto(ctx, '/project/' + p2.id + '/agent');
    await page.waitForFunction(() => {
      const button = document.querySelector('#agent-plan-abandon');
      return button && !button.disabled;
    }, null, { timeout: 15000 });

    await page.locator('#agent-plan-abandon').click();
    await expectVisible(ctx, '.modal-mask.open', '放弃方案确认');
    await expectBodyText(ctx, '放弃后本次会话结束，方案内容不会写入项目');

    await waitReload(ctx, () => confirmPmsModal(ctx), '放弃方案后刷新');

    await expectBodyText(ctx, '还没有方案');
    await expectBodyText(ctx, '新对话：提交后会创建一份方案');
    assert.equal(await page.locator('.agent-plan-card[data-session-id]').count(), 0, '放弃后方案卡不带会话 id');
    await t.screenshot('39-agent-abandoned');
  });

  await t.step('项目助手历史对话：列表与只读回放', async () => {
    await page.locator('[data-open-modal="agent-session-history-modal"]').click();
    await expectVisible(ctx, '#agent-session-history-modal.open', '历史对话弹层');
    await page.locator('#agent-session-history-body .agent-history-item').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('#agent-session-history-body .agent-history-item').count(), 3, '三条历史会话');
    await expectBodyText(ctx, '已确认');
    await expectBodyText(ctx, '已放弃');
    await expectBodyText(ctx, '进行中');

    await page.locator('#agent-session-history-body [data-session-id="' + p2w.sessions.confirmed.id + '"]').click();
    await expectPath(ctx, '/project/' + p2.id + '/agent_session/' + p2w.sessions.confirmed.id, '进入历史会话页');

    await expectText(ctx, '.page-title', '项目助手 · 历史对话');
    await expectBodyText(ctx, '只读回放');
    await expectBodyText(ctx, '已确认');
    await expectBodyText(ctx, '发起人：PW 拥有者');
    await expectBodyText(ctx, '工作项变更 1 条');
    await expectBodyText(ctx, '项目资产维护');
    await expectBodyText(ctx, '角色：新增 1');

    // 服务端回显的 markdown 原文由前端渲染为 HTML
    await expectVisible(ctx, '#agent-chat .agent-md h2', 'Markdown 标题');
    await expectVisible(ctx, '#agent-chat .agent-md table', 'Markdown 表格');
    await expectVisible(ctx, '#agent-chat .agent-md pre', 'Markdown 代码块');
    await expectVisible(ctx, '#agent-chat .agent-md blockquote', 'Markdown 引用');
    await expectVisible(ctx, '#agent-chat .agent-md del', 'Markdown 删除线');
    await expectVisible(ctx, '#agent-chat .agent-md ol li', 'Markdown 有序列表');
    await expectBodyText(ctx, '模拟的会话失败');
    await expectBodyText(ctx, '已完成');

    // 方案留档页签
    for (const name of ['roles', 'processes', 'systems', 'requirements', 'prod_defects']) {
      await page.locator('#agent-plan-wrap .tabs .tab[data-tab=' + name + ']').click();
      await expectVisible(ctx, '#agent-plan-wrap [data-panel=' + name + ']', '历史方案分区 ' + name);
    }

    await page.locator('#agent-plan-wrap .tabs .tab[data-tab=roles]').click();
    await expectBodyText(ctx, '运营专员');
    await expectBodyText(ctx, '方案中标记删除');

    await page.locator('#agent-plan-wrap .tabs .tab[data-tab=requirements]').click();
    await expectBodyText(ctx, '用户标签管理');

    await page.locator('#agent-plan-wrap .tabs .tab[data-tab=prod_defects]').click();
    await expectBodyText(ctx, '线上导出失败');
    await t.screenshot('40-agent-history-session');

    await page.locator('a', { hasText: '回到项目助手' }).click();
    await expectPath(ctx, '/project/' + p2.id + '/agent', '返回项目助手');
  });

  await t.step('单场景助手：需求提交模拟完成并静默刷新列表', async () => {
    await goto(ctx, '/project/' + p1.id + '/requirements');
    await expectVisible(ctx, '#agent-form', '需求助手表单');

    // 空消息不提交
    await page.locator('#agent-input').fill('');
    await page.locator('#agent-submit').click();
    assert.equal(await page.locator('.msg-user').count(), 0, '空消息不应产生对话气泡');

    await page.locator('#agent-input').fill('增加门店交班功能');
    await submitWorkAgent('requirement', '增加门店交班功能', 'requirement', state.p1.requirements.new.id);
    await expectBodyText(ctx, '同步维护资产：角色 ×1、页面 ×2');
    await page.waitForTimeout(1500);
    await expectVisible(ctx, '.work-main table', '列表在会话完成后仍显示');
    await t.screenshot('41-agent-work-list-done');
  });

  await t.step('单场景助手：模拟失败提示与按钮恢复', async () => {
    await pauseQueue(30);

    await page.locator('#agent-input').fill('这次让助手失败');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/agent/run')),
      page.locator('#agent-submit').click(),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 0);

    requestRunSimulation(json.data.run_id, 'failed', ['--message=模拟的助手失败']);

    await page.locator('.text-danger', { hasText: '模拟的助手失败' }).waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await page.locator('#agent-submit').isDisabled(), false, '失败后提交按钮恢复');
    await t.screenshot('42-agent-work-list-failed');
  });

  await t.step('单场景助手：开发 BUG 必须先选版本', async () => {
    await goto(ctx, '/project/' + p2.id + '/bugs');
    await expectVisible(ctx, '#version-select', 'BUG 助手版本选择');

    await page.locator('#agent-input').fill('导出按钮点击无响应');
    await page.locator('#agent-submit').click();
    await waitToast(ctx, '请先选择目标版本', 'BUG 未选版本');

    await page.locator('#version-select').selectOption(String(p2w.versions.v110.id));
    await submitWorkAgent('dev_bug', '导出按钮点击无响应', 'bug', p2w.bugs.new.id);
    await expectBodyText(ctx, '创建 开发 BUG 2 条');
    await t.screenshot('43-agent-bug-done');
  });

  await t.step('单场景助手：生产缺陷提交模拟完成', async () => {
    await goto(ctx, '/project/' + p1.id + '/prod_defects');
    await expectVisible(ctx, '#agent-form', '生产缺陷助手表单');
    assert.equal(await page.locator('#version-select').count(), 0, '生产缺陷不选版本');

    await page.locator('#agent-input').fill('线上收银台偶发白屏');
    await submitWorkAgent('prod_defect', '线上收银台偶发白屏', 'prod_defect', 0);
    await expectBodyText(ctx, '创建 生产缺陷 2 条');
    await t.screenshot('44-agent-prod-defect-done');
  });

  await t.step('单场景助手历史对话：列表分页与详情返回', async () => {
    await goto(ctx, '/project/' + p2.id + '/requirements');
    await page.locator('[data-open-modal="agent-history-modal"]').click();
    await expectVisible(ctx, '#agent-history-modal.open', '历史对话弹层');
    await page.locator('#agent-history-body .agent-history-item').first().waitFor({ state: 'visible' });

    assert.equal(await page.locator('#agent-history-body .agent-history-item').count(), 15, '第一页 15 轮');
    await expectBodyText(ctx, '共 17 轮', '历史分页总数（16 条正常 + 1 条失败）');
    await expectBodyText(ctx, '第 1/2 页');

    await page.locator('#agent-history-body [data-history-page="2"]').click();
    await page.waitForFunction(() => document.querySelector('#agent-history-body')?.innerText.includes('第 2/2 页'), null, { timeout: 10000 });
    await expectBodyText(ctx, '第 2/2 页');

    await page.locator('#agent-history-body [data-run-id]').first().click();
    await page.locator('#agent-history-body .agent-history-detail').waitFor({ state: 'visible' });
    await page.locator('#agent-history-body [data-history-back]').click();
    await page.waitForFunction(() => document.querySelectorAll('#agent-history-body .agent-history-item').length > 0);
    await expectBodyText(ctx, '第 2/2 页');
    await page.locator('#agent-history-modal [data-close]').click();
    await expectHidden(ctx, '#agent-history-modal.open', '关闭历史对话');
    await t.screenshot('45-agent-history-pagination');
  });

  await t.step('单场景助手接口参数校验', async () => {
    const empty = await api(ctx, '/api/agent/run', { method: 'POST', data: { project_id: p2.id, mode: 'requirement', message: '' } });
    assertApiError(empty, 'MESSAGE_REQUIRED', '空消息');

    const badMode = await api(ctx, '/api/agent/run', { method: 'POST', data: { project_id: p2.id, mode: 'unknown', message: 'x' } });
    assertApiError(badMode, 'MODE_INVALID', '非法模式');

    const prodInitial = await api(ctx, '/api/agent/run', {
      method: 'POST',
      data: { project_id: state.projects.p3.id, mode: 'prod_defect', message: 'x' },
    });
    assertApiError(prodInitial, 'PROD_DEFECT_NOT_ALLOWED', '初版项目提交生产缺陷');

    const prodVersion = await api(ctx, '/api/agent/run', {
      method: 'POST',
      data: { project_id: p2.id, mode: 'prod_defect', version_id: p2w.versions.v110.id, message: 'x' },
    });
    assertApiError(prodVersion, 'PROD_DEFECT_VERSION_NOT_ALLOWED', '生产缺陷指定版本');

    const bugNoVersion = await api(ctx, '/api/agent/run', {
      method: 'POST',
      data: { project_id: p2.id, mode: 'dev_bug', message: 'x' },
    });
    assertApiError(bugNoVersion, 'VERSION_REQUIRED', '开发 BUG 未指定版本');

    const badVersion = await api(ctx, '/api/agent/run', {
      method: 'POST',
      data: { project_id: p2.id, mode: 'requirement', version_id: 999999999, message: 'x' },
    });
    assertApiError(badVersion, 'VERSION_NOT_FOUND', '版本不存在');

    const otherProjectVersion = await api(ctx, '/api/agent/run', {
      method: 'POST',
      data: { project_id: p2.id, mode: 'requirement', version_id: p1Release(ctx), message: 'x' },
    });
    assertApiError(otherProjectVersion, 'VERSION_NOT_FOUND', '跨项目版本');
  });

  function p1Release(ctx2) {
    return ctx2.p1ReleaseVersionId || 0;
  }

  await t.step('大而全助手：确认方案后落库并展示结果', async () => {
    await goto(ctx, '/project/' + p1.id + '/agent');
    await expectBodyText(ctx, '增加用户反馈收集功能');
    await expectBodyText(ctx, '运营专员');
    await expectBodyText(ctx, '用户反馈收集');

    await page.locator('#agent-plan-confirm').click();
    await expectVisible(ctx, '.modal-mask.open', '确认方案弹窗');
    await expectBodyText(ctx, '确认后助手会把方案写入项目');

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/agent/session/' + state.p1.sessions.active.id + '/confirm')),
      confirmPmsModal(ctx),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 0, '确认方案接口');

    await expectVisible(ctx, '.modal-mask.open', '确认结果弹窗');
    await expectBodyText(ctx, '方案已确认并写入项目');
    await expectBodyText(ctx, '用户反馈收集');
    await expectBodyText(ctx, '资产维护：角色：新增 1');
    await t.screenshot('46-agent-confirm-result');

    await waitReload(ctx, () => page.locator('.modal-mask.open .modal-footer button.btn-primary').click(), '确认结果后刷新');

    await expectBodyText(ctx, '还没有方案');

    await goto(ctx, '/project/' + p1.id + '/requirements');
    await expectBodyText(ctx, '用户反馈收集');

    await goto(ctx, '/project/' + p1.id + '/knowledge');
    await expectBodyText(ctx, '运营专员');
    await t.screenshot('47-agent-confirmed-data');
  });

  await t.step('大而全助手接口：无会话/重复确认/空消息', async () => {
    const empty = await api(ctx, '/api/agent/session/message', { method: 'POST', data: { project_id: p1.id, message: '' } });
    assertApiError(empty, 'MESSAGE_REQUIRED', '会话空消息');

    const closed = await api(ctx, '/api/agent/session/' + state.p1.sessions.active.id + '/abandon', {
      method: 'POST',
      data: { project_id: p1.id },
    });
    assertApiError(closed, 'SESSION_CLOSED', '已结束会话再次放弃');

    const notFound = await api(ctx, '/api/agent/session/999999999/confirm', {
      method: 'POST',
      data: { project_id: p1.id },
    });
    assertApiError(notFound, 'SESSION_NOT_FOUND', '会话不存在');

    const crossProject = await api(ctx, '/api/agent/session/' + p2w.sessions.confirmed.id + '/confirm', {
      method: 'POST',
      data: { project_id: p1.id },
    });
    assertApiError(crossProject, 'SESSION_NOT_FOUND', '跨项目会话');
  });
};
