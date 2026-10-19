const assert = require('node:assert/strict');

const NONCE = Date.now();

module.exports = [
  {
    name: '错误码映射与当前用户',
    expected: '未登录可读错误码映射；GET /api/me 返回当前登录用户',
    run: async ({ request, token, expectOk, state }) => {
      const maps = expectOk(await request('/api/error_code_maps', { token: token('owner') }), '错误码映射');
      assert.equal(maps.NOT_LOGGED_IN, '请先登录');
      assert.ok(maps.STATUS_ACTION_INVALID);

      const me = expectOk(await request('/api/me', { token: token('owner') }), '当前用户');
      assert.equal(me.email, state.users.owner.email);
    },
  },
  {
    name: '未登录访问受保护接口',
    expected: '未携带会话时各接口返回 NOT_LOGGED_IN',
    run: async ({ request, expectError }) => {
      for (const [method, url, body] of [
        ['GET', '/api/me'],
        ['GET', '/api/team_space/list'],
        ['GET', '/api/team_space/invites'],
        ['POST', '/api/logout', {}],
        ['POST', '/api/account/nickname', { nickname: 'x' }],
      ]) {
        const result = await request(url, { method, body });
        expectError(result, 'NOT_LOGGED_IN', method + ' ' + url);
      }
    },
  },
  {
    name: '伪造会话 Cookie',
    expected: '无效 token 不被识别为登录，返回 NOT_LOGGED_IN',
    run: async ({ request, expectError }) => {
      const result = await request('/api/me', { token: 'forged-' + Date.now() });
      expectError(result, 'NOT_LOGGED_IN', '伪造 token');
    },
  },
  {
    name: '验证码接口邮箱校验',
    expected: '空邮箱与非法邮箱均返回 EMAIL_INVALID',
    run: async ({ request, expectError }) => {
      for (const email of ['', 'not-an-email', 'a@b']) {
        const result = await request('/api/auth/send_code', { method: 'POST', body: { email } });
        expectError(result, 'EMAIL_INVALID', '发送验证码 ' + JSON.stringify(email));
      }

      const login = await request('/api/auth/login', { method: 'POST', body: { email: 'bad', code: '123456' } });
      expectError(login, 'EMAIL_INVALID', '登录邮箱非法');
    },
  },
  {
    name: '未发送验证码直接登录',
    expected: '没有有效验证码时返回 CODE_INVALID_OR_EXPIRED',
    run: async ({ request, expectError, state }) => {
      const email = 'pw-api-nocode-' + state.tag + '@example.com';
      const result = await request('/api/auth/login', { method: 'POST', body: { email, code: '123456' } });
      expectError(result, 'CODE_INVALID_OR_EXPIRED', '未发送验证码直接登录');
    },
  },
  {
    name: '新邮箱验证码登录与退出',
    expected: '新邮箱自动注册，会话可访问 /api/me，退出后会话失效',
    run: async ({ request, expectOk, expectError, cookieToken, state }) => {
      const email = 'pw-api-' + state.tag + '-' + NONCE + '@example.com';
      const sent = expectOk(await request('/api/auth/send_code', { method: 'POST', body: { email } }), '发送验证码');
      assert.ok(sent.code, '开发环境应返回验证码');

      const loginResult = await request('/api/auth/login', { method: 'POST', body: { email, code: sent.code } });
      const login = expectOk(loginResult, '登录');
      assert.equal(login.email, email);

      const session = cookieToken(loginResult);
      assert.ok(session, '登录响应应写入 pms_token Cookie');

      const me = expectOk(await request('/api/me', { token: session }), '登录后当前用户');
      assert.equal(me.email, email);

      expectOk(await request('/api/logout', { method: 'POST', body: {}, token: session }), '退出登录');
      expectError(await request('/api/me', { token: session }), 'NOT_LOGGED_IN', '退出后会话失效');
    },
  },
  {
    name: '未知 API 路由与不支持的方法',
    expected: '未匹配的 API 返回 HTTP 404 与 JSON Not Found；错误方法同样不进入业务',
    run: async ({ request, expectStatus }) => {
      const missing = await request('/api/definitely-not-an-api');
      expectStatus(missing, 404, '未知 API');
      assert.equal(missing.body.code, 404);
      assert.equal(missing.body.msg, 'Not Found');

      const wrongMethod = await request('/api/me', { method: 'POST', body: {} });
      expectStatus(wrongMethod, 404, '错误方法');
      assert.equal(wrongMethod.body.code, 404);
    },
  },
];
