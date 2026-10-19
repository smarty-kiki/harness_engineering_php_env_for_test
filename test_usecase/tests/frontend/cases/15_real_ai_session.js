const {
  goto, expectVisible, expectBodyText, waitReload, confirmPmsModal, loadExtra, php,
} = require('../lib/core');

/**
 * 真实大模型：大而全助手的一轮规划（最佳努力）。
 * 覆盖会话轮次执行（方案流式预览、方案合并）与放弃方案的完整落库前路径。
 */
module.exports = async function realAiSession(ctx) {
  const { page, t } = ctx;
  const extra = loadExtra();
  const projectId = extra.project_ids[0];

  if (!projectId) {
    console.log('SKIP real ai session: no UI-created project');
    return;
  }

  await t.step('真实大模型：大而全助手一轮规划与放弃（最佳努力）', async () => {
    php('resume_queue.php');

    await goto(ctx, '/project/' + projectId + '/agent');
    const initial = ctx.apiFixtures || {};
    initial.ui_project_id = projectId;

    await page.locator('#agent-session-input').fill('规划会员积分功能：会员积分查询、积分调整记录、店长审核');
    await page.locator('#agent-session-submit').click();

    try {
      await page.waitForFunction(() => {
        const bubbles = document.querySelectorAll('#agent-chat .msg-agent');
        const last = bubbles[bubbles.length - 1];
        if (!last) { return false; }
        return !!last.querySelector('.agent-status.is-done') || !!last.querySelector('.text-danger');
      }, null, { timeout: 300000, polling: 2000 });
    } catch (err) {
      ctx.realAiSession = { status: 'timeout', message: err.message };
      console.log('REAL AI SESSION TIMEOUT: ' + err.message);
      await t.takeCoverage('real-ai-session-timeout').catch(() => {});
      throw new Error('真实大模型会话规划超时：' + err.message);
    }

    const last = page.locator('#agent-chat .msg-agent').last();
    const text = await last.innerText();

    if (await last.locator('.text-danger').count()) {
      ctx.realAiSession = { status: 'error', message: text.slice(0, 500) };
      console.log('REAL AI SESSION ERROR: ' + text.slice(0, 800));
      await t.takeCoverage('real-ai-session-error').catch(() => {});
      const errorLine = (await last.locator('.text-danger').last().innerText()).trim();
      throw new Error('真实大模型会话规划返回错误：' + errorLine.replace(/^❌\s*/, '').slice(0, 500));
    }

    await expectVisible(ctx, '.agent-plan-card[data-session-id]', '真实方案卡');
    await expectBodyText(ctx, '提交给项目助手');

    ctx.realAiSession = { status: 'success', reply: text.slice(0, 500) };
    console.log('REAL AI SESSION SUCCESS');

    // 放弃方案：不把 AI 生成的规划写入项目，回到空方案状态
    await page.locator('#agent-plan-abandon').click();
    await expectVisible(ctx, '.modal-mask.open', '放弃方案确认');
    await waitReload(ctx, () => confirmPmsModal(ctx), '放弃真实方案');
    await expectBodyText(ctx, '还没有方案');

    await t.screenshot('65-real-ai-session-abandoned');
    await t.takeCoverage('real-ai-session-done').catch(() => {});
  });
};
