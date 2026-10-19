const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const DIR = path.resolve(__dirname, '../../..');
const FIXTURES_DIR = path.join(DIR, 'fixtures');
const STATE_FILE = path.join(DIR, 'state/state.json');
const EXTRA_FILE = path.join(DIR, 'state/extra.json');
const RUN_DIR = process.env.PW_RUN_DIR || path.join(DIR, 'reports/current');

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function loadExtra() {
  if (!fs.existsSync(EXTRA_FILE)) {
    return { project_ids: [], team_ids: [] };
  }

  try {
    const extra = JSON.parse(fs.readFileSync(EXTRA_FILE, 'utf-8'));
    return {
      project_ids: Array.isArray(extra.project_ids) ? extra.project_ids : [],
      team_ids: Array.isArray(extra.team_ids) ? extra.team_ids : [],
    };
  } catch {
    return { project_ids: [], team_ids: [] };
  }
}

function rememberExtra(kind, id) {
  const extra = loadExtra();
  const key = kind === 'project' ? 'project_ids' : 'team_ids';
  id = Number(id);

  if (id && !extra[key].includes(id)) {
    extra[key].push(id);
    fs.writeFileSync(EXTRA_FILE, JSON.stringify(extra, null, 2));
  }
}

function resetExtra() {
  fs.writeFileSync(EXTRA_FILE, JSON.stringify({ project_ids: [], team_ids: [] }, null, 2));
}

function php(script, args = []) {
  return execFileSync('php', [path.join(FIXTURES_DIR, script), ...args], {
    cwd: '/var/www/project_manage_system',
    encoding: 'utf-8',
    timeout: 120000,
    env: { ...process.env, HARNESS_COVERAGE: '0' },
  });
}

async function api(ctx, url, options = {}) {
  const { method = 'GET', data, headers = {}, anon = false } = options;
  const requester = anon ? ctx.anonContext.request : ctx.context.request;
  const response = await requester.fetch(ctx.baseUrl + url, {
    method,
    data,
    headers,
    failOnStatusCode: false,
  });

  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return { status: response.status(), body, headers: response.headers() };
}

function assertApiOk(result, label) {
  assert.ok(result.body, `${label}：响应不是 JSON`);
  assert.equal(result.body.code, 0, `${label}：期望成功，实际 code=${result.body.code} msg=${result.body.msg}`);
  return result.body.data;
}

function assertApiError(result, code, label) {
  assert.ok(result.body, `${label}：响应不是 JSON`);
  assert.equal(result.body.code, code, `${label}：期望错误码 ${code}，实际 ${result.body.code}（${result.body.msg}）`);
  return result.body;
}

async function apiLogin(ctx, email, label = email) {
  const send = await api(ctx, '/api/auth/send_code', { method: 'POST', data: { email } });
  const sent = assertApiOk(send, `${label} 发送验证码`);
  assert.ok(sent.code, `${label}：开发环境应返回验证码`);
  const login = await api(ctx, '/api/auth/login', { method: 'POST', data: { email, code: sent.code } });
  const data = assertApiOk(login, `${label} 登录`);
  assert.equal(data.email, email, `${label}：登录邮箱不一致`);
  return data;
}

async function restoreCookies(ctx, cookies) {
  await ctx.context.clearCookies();
  await ctx.context.addCookies(cookies);
}

async function goto(ctx, url, options = {}) {
  const response = await ctx.page.goto(ctx.baseUrl + url, { waitUntil: 'load', ...options });
  return response;
}

async function expectStatus(ctx, url, status = 200) {
  const response = await goto(ctx, url);
  assert.equal(response.status(), status, `${url} 期望 HTTP ${status}，实际 ${response.status()}`);
  return response;
}

async function expectPath(ctx, suffix, label = '') {
  await ctx.page.waitForURL((url) => url.pathname + url.search === suffix, { timeout: 15000 })
    .catch(async () => {
      throw new Error(`${label}：期望地址 ${suffix}，实际 ${ctx.page.url()}`);
    });
  assert.equal(new URL(ctx.page.url()).pathname, new URL(ctx.baseUrl + suffix).pathname, `${label}：路径不符合预期`);
}

async function text(ctx, selector) {
  const locator = ctx.page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  return (await locator.textContent() || '').trim();
}

async function expectVisible(ctx, selector, label) {
  await ctx.page.locator(selector).first().waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => { throw new Error(`${label || selector}：元素不可见`); });
}

async function expectHidden(ctx, selector, label) {
  const count = await ctx.page.locator(selector).count();
  if (count === 0) {
    return;
  }
  await ctx.page.locator(selector).first().waitFor({ state: 'hidden', timeout: 5000 })
    .catch(() => { throw new Error(`${label || selector}：元素仍然可见`); });
}

async function expectText(ctx, selector, expected, label) {
  const value = await text(ctx, selector);
  assert.ok(
    value.includes(expected),
    `${label || selector}：期望包含「${expected}」，实际「${value}」`
  );
  return value;
}

async function expectBodyText(ctx, expected, label) {
  const body = (await ctx.page.locator('body').innerText()).replace(/\s+/g, ' ');
  assert.ok(body.includes(expected), `${label || '页面'}：期望正文包含「${expected}」，实际「${body.slice(0, 300)}」`);
  return body;
}

async function waitToast(ctx, expected, label) {
  const locator = ctx.page.locator('.toast', { hasText: expected }).first();
  await locator.waitFor({ state: 'visible', timeout: 10000 })
    .catch(async () => {
      const all = await ctx.page.locator('.toast').allInnerTexts().catch(() => []);
      throw new Error(`${label || expected}：没有出现包含「${expected}」的 toast，当前 toast：${JSON.stringify(all)}`);
    });
  return locator;
}

async function clickAndWaitLoad(ctx, selector, label) {
  await Promise.all([
    ctx.page.waitForLoadState('load', { timeout: 15000 }),
    ctx.page.locator(selector).first().click(),
  ]).catch((err) => { throw new Error(`${label || selector}：点击后等待加载失败：${err.message}`); });
}

async function confirmPmsModal(ctx) {
  const modal = ctx.page.locator('.modal-mask.open').last();
  await modal.waitFor({ state: 'visible', timeout: 5000 });
  await modal.locator('.modal-footer button.btn-primary').first().click();
}

async function closeOpenModal(ctx) {
  const modal = ctx.page.locator('.modal-mask.open').last();

  if (await modal.count()) {
    const closer = modal.locator('[data-close]').first();
    if (await closer.count()) {
      await closer.click();
    } else {
      await ctx.page.mouse.click(10, 10);
    }
  }
}

async function selectOption(ctx, selector, value) {
  await ctx.page.locator(selector).first().selectOption(value);
}

async function requestRunSimulation(runId, outcome = 'done', extra = []) {
  return php('simulate_run.php', ['--run_id=' + runId, '--outcome=' + outcome, ...extra]);
}

async function pauseQueue(seconds = 25) {
  return php('pause_queue.php', [String(seconds)]);
}

async function waitReload(ctx, action, label) {
  await Promise.all([
    ctx.page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }),
    action(),
  ]).catch((err) => { throw new Error(`${label || '等待刷新'}：${err.message}`); });
}

module.exports = {
  DIR,
  STATE_FILE,
  EXTRA_FILE,
  RUN_DIR,
  assert,
  loadState,
  loadExtra,
  rememberExtra,
  resetExtra,
  php,
  api,
  assertApiOk,
  assertApiError,
  apiLogin,
  restoreCookies,
  goto,
  expectStatus,
  expectPath,
  text,
  expectVisible,
  expectHidden,
  expectText,
  expectBodyText,
  waitToast,
  clickAndWaitLoad,
  confirmPmsModal,
  closeOpenModal,
  selectOption,
  requestRunSimulation,
  pauseQueue,
  waitReload,
};
