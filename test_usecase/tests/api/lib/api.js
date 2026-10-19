const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const SUITE_DIR = path.resolve(__dirname, '../../..');
const FIXTURES_DIR = path.join(SUITE_DIR, 'fixtures');
const STATE_FILE = path.join(SUITE_DIR, 'state/state.json');
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1').replace(/\/$/, '');

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function php(script, args = []) {
  return execFileSync('php', [path.join(FIXTURES_DIR, script), ...args], {
    cwd: '/var/www/project_manage_system',
    encoding: 'utf-8',
    timeout: 120000,
    env: { ...process.env, HARNESS_COVERAGE: '0' },
  });
}

async function request(url, options = {}) {
  const { method = 'GET', body, token, headers = {}, raw = false } = options;
  const requestHeaders = { Accept: 'application/json', ...headers };

  if (token) {
    requestHeaders.Cookie = 'pms_token=' + token;
  }

  let payload;

  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(BASE_URL + url, {
    method,
    headers: requestHeaders,
    body: payload,
  });

  const text = await response.text();
  let json = null;

  if (!raw) {
    try { json = JSON.parse(text); } catch { json = null; }
  }

  return { status: response.status, body: json, text, headers: response.headers };
}

function expectOk(result, label) {
  assert.ok(result.body, `${label}：响应不是 JSON（HTTP ${result.status}）`);
  assert.equal(result.body.code, 0, `${label}：期望成功，实际 code=${result.body.code} msg=${result.body.msg}`);
  return result.body.data;
}

function expectError(result, code, label) {
  assert.ok(result.body, `${label}：响应不是 JSON（HTTP ${result.status}）`);
  assert.equal(result.body.code, code, `${label}：期望错误码 ${code}，实际 ${result.body.code}（${result.body.msg}）`);
  return result.body;
}

function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}：期望 HTTP ${status}，实际 ${result.status}`);
}

function cookieToken(result) {
  const header = result.headers && result.headers.get('set-cookie');
  const match = String(header || '').match(/pms_token=([^;,\s]+)/);

  return match ? match[1] : '';
}

function createContext() {
  const state = loadState();
  const tokens = {};
  const token = (key) => {
    if (!tokens[key]) {
      const user = state.users[key];
      assert.ok(user, 'unknown user key ' + key);
      tokens[key] = php('make_session.php', ['--email=' + user.email]).trim();
      assert.ok(tokens[key], '无法为用户 ' + key + ' 创建会话');
    }
    return tokens[key];
  };

  return {
    state,
    baseUrl: BASE_URL,
    token,
    request,
    php,
    cookieToken,
    expectOk,
    expectError,
    expectStatus,
  };
}

module.exports = {
  SUITE_DIR,
  BASE_URL,
  createContext,
  expectOk,
  expectError,
  expectStatus,
};
