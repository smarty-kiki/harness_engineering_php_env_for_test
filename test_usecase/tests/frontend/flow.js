/**
 * Playwright 全量黑盒测试流程。
 *
 * 运行：
 *   /var/www/test_usecase/run-all.sh
 * 或：
 *   playwright-run /var/www/test_usecase/tests/frontend/flow.js --headless
 *
 * 前置：fixtures/seed.php 已执行并生成 state/state.json。
 */

const fs = require('fs');
const path = require('path');
const { loadState, resetExtra } = require('./lib/core');

function failureMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// 断言消息里通常已经写了「期望…实际…」，拆成期望与实际两部分；没有时给通用预期描述
function expectedActualOf(message, name) {
  const chinese = message.match(/^(.*?)，实际([\s\S]*)$/);

  if (chinese) {
    return { expected: chinese[1].trim(), actual: chinese[2].trim() };
  }

  const english = message.match(/expected\s+([\s\S]*?)\s+(?:but|actual)\s+([\s\S]*)/i);

  if (english) {
    return { expected: english[1].trim(), actual: english[2].trim() };
  }

  // assert.ok / assert.equal 的失败消息通常在首段描述「应该怎样」，后面紧跟实际差异
  const lines = message.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const first = lines[0] || '';
  const looksLikeAssertion = /[\u4e00-\u9fa5]/.test(first)
    && !/^(locator\.|Error|AssertionError|Cannot |Timeout|page\.)/.test(first);

  if (looksLikeAssertion && lines.length > 1) {
    return { expected: first, actual: lines.slice(1).join('\n') };
  }

  return { expected: '步骤「' + name + '」的全部断言通过', actual: message };
}

module.exports = async function flow({ page, context, browser, baseUrl, screenshot, step, takeCoverage, log, setMeta }) {
  const state = loadState();

  resetExtra();

  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });

  const anonContext = await browser.newContext();

  const frontendCases = [];
  const frontendFailures = [];

  // 每个步骤是一个前端测试用例。失败时记录期望/实际并继续执行后续用例，
  // 避免因为一个失败而丢失整轮通过率与后续覆盖率。
  const wrappedStep = async (name, fn) => {
    const startedAt = Date.now();
    try {
      const result = await step(name, fn);
      frontendCases.push({ name, status: 'passed', duration_ms: Date.now() - startedAt });
      return result;
    } catch (err) {
      const message = failureMessage(err);
      const split = expectedActualOf(message, name);
      const item = {
        name,
        status: 'failed',
        duration_ms: Date.now() - startedAt,
        expected: split.expected,
        actual: split.actual,
        error: message,
      };
      frontendCases.push(item);
      frontendFailures.push(item);
      log('CASE FAILED ' + name + '：' + message);
      return null;
    } finally {
      // 每步结束后主动采集一次前端覆盖率：页面内的交互往往在 3 秒定时采集前就跳转，
      // 不主动采集会丢掉刚执行的 DOMContentLoaded / 事件处理代码。
      await takeCoverage('step:' + name).catch(() => {});
    }
  };

  const ctx = {
    page,
    context,
    browser,
    baseUrl,
    state,
    anonContext,
    ownerCookies: null,
    frontendCases,
    frontendFailures,
    apiFixtures: { ui_project_id: 0, ui_requirement_id: 0, ui_bug_id: 0, p3_prod_defect_id: 0 },
    t: { step: wrappedStep, screenshot, takeCoverage, log, setMeta },
  };

  const started = Date.now();

  const runCaseModule = async (label, loader) => {
    try {
      await loader()(ctx);
    } catch (err) {
      const message = failureMessage(err);
      const item = {
        name: label,
        status: 'failed',
        expected: '用例模块「' + label + '」执行完成',
        actual: message,
        module_error: true,
      };
      frontendCases.push(item);
      frontendFailures.push(item);
      log('CASE MODULE FAILED ' + label + '：' + message);
    }
  };

  const filter = process.env.FLOW_CASES
    ? new Set(process.env.FLOW_CASES.split(',').map((code) => code.trim()))
    : null;
  const selected = (code) => !filter || filter.has(code);

  try {
    if (selected('01')) { await runCaseModule('01 公开与登录', () => require('./cases/01_public_auth')); }
    if (selected('02')) { await runCaseModule('02 团队与项目', () => require('./cases/02_team_project')); }
    if (selected('03')) { await runCaseModule('03 项目页面', () => require('./cases/03_project_pages')); }
    if (selected('04')) { await runCaseModule('04 工作项', () => require('./cases/04_work_items')); }
    if (selected('05')) { await runCaseModule('05 初版发布', () => require('./cases/05_initial_release')); }

    for (const [code, label, file] of [
      ['06', '06 版本化项目', './cases/06_released_project'],
      ['07', '07 助手', './cases/07_agent'],
      ['08', '08 个人中心与工具', './cases/08_account_tools'],
      ['09', '09 权限与邀请', './cases/09_permissions_invites'],
      ['10', '10 开放接口', './cases/10_open_api'],
      ['12', '12 助手方案落库与发布', './cases/12_agent_apply_release'],
      ['13', '13 真实大模型', './cases/13_real_ai'],
      ['15', '15 真实大模型会话规划', './cases/15_real_ai_session'],
      ['14', '14 会话生产缺陷', './cases/14_session_prod_defect'],
      ['11', '11 错误与边界', './cases/11_api_errors'],
    ]) {
      if (selected(code) && fs.existsSync(path.join(__dirname, file + '.js'))) {
        await runCaseModule(label, () => require(file));
      }
    }

    const summary = {
      layer: 'frontend',
      total: frontendCases.length,
      passed: frontendCases.filter((item) => item.status === 'passed').length,
      failed: frontendFailures.length,
      cases: frontendCases,
    };

    if (process.env.ROUND_DIR) {
      fs.mkdirSync(process.env.ROUND_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.ROUND_DIR, 'frontend-cases.json'), JSON.stringify(summary, null, 2));
    }

    // 接口层需要的少量未验收工作项 ID（版本发布拦截等场景），由前端用例真实创建后落盘
    const extra = require('fs').existsSync(path.join(__dirname, '../../state/extra.json'))
      ? JSON.parse(fs.readFileSync(path.join(__dirname, '../../state/extra.json'), 'utf-8'))
      : { project_ids: [] };
    ctx.apiFixtures.ui_project_id = extra.project_ids[0] || 0;
    fs.writeFileSync(path.join(__dirname, '../../state/api-fixtures.json'), JSON.stringify(ctx.apiFixtures, null, 2));

    setMeta({
      tag: state.tag,
      owner_email: state.users.owner.email,
      duration_ms: Date.now() - started,
      real_ai: ctx.realAi || null,
      real_ai_bug: ctx.realAiBug || null,
      real_ai_session: ctx.realAiSession || null,
      frontend_cases: { total: summary.total, passed: summary.passed, failed: summary.failed },
    });

    return { tag: state.tag, frontend: summary };
  } finally {
    await anonContext.close().catch(() => {});
  }
};
