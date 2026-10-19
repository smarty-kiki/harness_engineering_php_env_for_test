const {
  assert, goto, expectBodyText, expectVisible, loadExtra, php, waitToast,
} = require('../lib/core');

/**
 * 真实大模型链路（最佳努力）：在 UI 新建的空项目需求页提交一条自然语言需求，
 * 让队列 worker 真实调用 MiniMax，覆盖 util/ai.php、单场景助手执行与资产/工作项落库。
 *
 * 外部模型可能出现网络、配额、输出格式等问题：本用例只记录结果，不因 AI 失败使全量流程失败；
 * 失败时仍覆盖请求构造与错误回传路径。
 */
module.exports = async function realAi(ctx) {
  const { page, t } = ctx;
  const extra = loadExtra();
  const projectId = extra.project_ids[0];

  if (!projectId) {
    console.log('SKIP real ai: no UI-created project');
    return;
  }

  await t.step('真实大模型：单场景助手端到端（最佳努力）', async () => {
    php('resume_queue.php');

    await goto(ctx, '/project/' + projectId + '/requirements');
    await expectBodyText(ctx, '项目助手 · 需求');

    const message = '增加会员列表页面：展示会员昵称和积分，店长可以按手机号搜索会员';

    await page.locator('#agent-input').fill(message);
    await page.locator('#agent-submit').click();

    try {
      await page.waitForFunction(() => {
        const bubbles = document.querySelectorAll('#assistant-chat .msg-agent');
        const last = bubbles[bubbles.length - 1];
        if (!last) { return false; }
        return !!last.querySelector('.agent-status.is-done') || !!last.querySelector('.text-danger');
      }, null, { timeout: 300000, polling: 2000 });
    } catch (err) {
      ctx.realAi = { status: 'timeout', message: err.message };
      console.log('REAL AI TIMEOUT: ' + err.message);
      await t.takeCoverage('real-ai-timeout').catch(() => {});
      throw new Error('真实大模型单场景助手超时：' + err.message);
    }

    const bubbles = page.locator('#assistant-chat .msg-agent');
    const last = bubbles.last();
    const text = await last.innerText();

    if (await last.locator('.text-danger').count()) {
      ctx.realAi = { status: 'error', message: text.slice(0, 500) };
      console.log('REAL AI ERROR: ' + text.slice(0, 800));
      await t.takeCoverage('real-ai-error').catch(() => {});
      const errorLine = (await last.locator('.text-danger').last().innerText()).trim();
      throw new Error('真实大模型单场景助手返回错误：' + errorLine.replace(/^❌\s*/, '').slice(0, 500));
    }

    await expectBodyText(ctx, '已完成');
    await t.takeCoverage('real-ai-done').catch(() => {});

    // 助手完成后列表静默刷新
    await page.waitForTimeout(3000);
    const rowCount = await page.locator('.work-main tbody tr[data-href]').count();
    assert.ok(rowCount > 0, '真实助手创建了工作项');

    const requirementHref = await page.locator('.work-main tbody tr[data-href]').first().getAttribute('data-href');
    const requirementMatch = String(requirementHref || '').match(/\/requirements\/(\d+)/);
    if (requirementMatch) {
      ctx.apiFixtures.ui_requirement_id = Number(requirementMatch[1]);
    }

    ctx.realAi = { status: 'success', rowCount, reply: text.slice(0, 500) };
    console.log('REAL AI SUCCESS: rows=' + rowCount);

    await goto(ctx, '/project/' + projectId);
    await expectBodyText(ctx, '项目概览');
    await t.screenshot('62-real-ai-overview');
    await t.takeCoverage('real-ai-overview').catch(() => {});
  });

  await t.step('真实大模型：开发 BUG 单场景（最佳努力）', async () => {
    if (!ctx.realAi || ctx.realAi.status !== 'success') {
      console.log('SKIP real ai bug: requirement run not successful');
      return;
    }

    await goto(ctx, '/project/' + projectId + '/bugs');
    await expectBodyText(ctx, '项目助手 · 开发 BUG');

    await page.locator('#agent-input').fill('会员积分在会员列表里显示为负数，需要修复');
    await page.locator('#agent-submit').click();

    try {
      await page.waitForFunction(() => {
        const bubbles = document.querySelectorAll('#assistant-chat .msg-agent');
        const last = bubbles[bubbles.length - 1];
        if (!last) { return false; }
        return !!last.querySelector('.agent-status.is-done') || !!last.querySelector('.text-danger');
      }, null, { timeout: 300000, polling: 2000 });
    } catch (err) {
      ctx.realAiBug = { status: 'timeout', message: err.message };
      console.log('REAL AI BUG TIMEOUT: ' + err.message);
      await t.takeCoverage('real-ai-bug-timeout').catch(() => {});
      throw new Error('真实大模型开发 BUG 超时：' + err.message);
    }

    const last = page.locator('#assistant-chat .msg-agent').last();
    const text = await last.innerText();

    if (await last.locator('.text-danger').count()) {
      ctx.realAiBug = { status: 'error', message: text.slice(0, 500) };
      console.log('REAL AI BUG ERROR: ' + text.slice(0, 800));
      await t.takeCoverage('real-ai-bug-error').catch(() => {});
      throw new Error('真实大模型开发 BUG 返回错误：' + text.replace(/\s+/g, ' ').slice(0, 300));
    }

    await page.waitForTimeout(3000);
    const rowCount = await page.locator('.work-main tbody tr[data-href]').count();
    assert.ok(rowCount > 0, '真实助手创建了开发 BUG');
    const bugHref = await page.locator('.work-main tbody tr[data-href]').first().getAttribute('data-href');
    const bugMatch = String(bugHref || '').match(/\/bugs\/(\d+)/);
    if (bugMatch) {
      ctx.apiFixtures.ui_bug_id = Number(bugMatch[1]);
    }

    ctx.realAiBug = { status: 'success', rowCount, reply: text.slice(0, 500) };
    console.log('REAL AI BUG SUCCESS: rows=' + rowCount);

    if (bugHref) {
      await goto(ctx, bugHref);
      await expectBodyText(ctx, '开发 BUG');
      await expectBodyText(ctx, '来源：项目助手对话', '真实助手创建的 BUG 详情应有来源对话');
      await page.locator('a', { hasText: '来源：项目助手对话' }).click();
      await expectVisible(ctx, '#agent-history-modal.open', 'BUG 来源对话弹层');
      await page.locator('#agent-history-modal [data-close]').click();
    }
    await t.screenshot('63-real-ai-bug');
    await t.takeCoverage('real-ai-bug-done').catch(() => {});
  });
};
