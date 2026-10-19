const assert = require('node:assert/strict');

module.exports = [
  {
    name: '插件与 CLI 版本接口',
    expected: '两个公开版本接口返回最新版本号、下载地址与页面锚点',
    run: async ({ request, expectOk }) => {
      const plugin = expectOk(await request('/api/plugin/version'), '插件版本');
      assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
      assert.ok(plugin.page_url.includes('#extension'));

      const cli = expectOk(await request('/api/cli/version'), 'CLI 版本');
      assert.match(cli.version, /^\d+\.\d+\.\d+$/);
      assert.ok(cli.url);
      assert.ok(cli.page_url.includes('#cli'));
    },
  },
  {
    name: 'SSE echo 与路由不存在',
    expected: 'echo 按字符推送 data 事件；未命中的 SSE 路由返回 HTTP 404',
    run: async ({ request, expectStatus }) => {
      const echo = await request('/sse/echo?text=hi', { raw: true });
      expectStatus(echo, 200, 'SSE echo');
      assert.ok(echo.text.includes('data: h'));
      assert.ok(echo.text.includes('data: i'));

      const missing = await request('/sse/not-found', { raw: true });
      expectStatus(missing, 404, 'SSE 404');
      assert.ok(missing.text.includes('Not Found'));
    },
  },
  {
    name: 'SSE 任务不存在与预检',
    expected: '不存在的任务返回任务不存在事件；OPTIONS 预检返回 204 与 CORS 头',
    run: async ({ request, token, expectStatus }) => {
      const missing = await request('/sse/agent/progress?run_id=999999999', { raw: true, token: token('owner') });
      expectStatus(missing, 200, 'SSE 任务不存在');
      assert.ok(missing.text.includes('任务不存在'), '实际：' + missing.text.slice(0, 200));

      const preflight = await fetch((process.env.BASE_URL || 'http://127.0.0.1') + '/sse/echo', { method: 'OPTIONS' });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    },
  },
  {
    name: '流水线统计的项目归属校验',
    expected: '不存在项目和越权项目返回对应错误；合法项目返回完整统计字段',
    run: async ({ request, token, expectOk, expectError, state }) => {
      expectError(await request('/api/project/999999999/pipeline/stats', { token: token('owner') }),
        'PROJECT_NOT_FOUND', '不存在项目统计');
      expectError(await request('/api/project/' + state.projects.p4.id + '/pipeline/stats', { token: token('owner') }),
        'NOT_TEAM_SPACE_MEMBER', '越权项目统计');

      const stats = expectOk(await request('/api/project/' + state.projects.p1.id + '/pipeline/stats', { token: token('owner') }), '项目统计');
      for (const key of ['requirement_total', 'prod_defect_total', 'test_total', 'bug_to_fix', 'bug_accepted']) {
        assert.ok(Object.prototype.hasOwnProperty.call(stats, key), '缺失字段 ' + key);
      }
    },
  },
];
