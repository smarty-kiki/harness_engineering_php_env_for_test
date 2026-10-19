const {
  assert, api, assertApiError, expectStatus, goto, expectPath, expectText,
  expectBodyText, waitToast, waitReload, text,
} = require('../lib/core');

/**
 * 公开页面 + 登录注册流程。
 * 结束后：主上下文为 owner 登录态，返回 owner cookies 供后续切换用户后恢复。
 */
module.exports = async function publicAuth(ctx) {
  const { page, state, t } = ctx;
  const owner = state.users.owner;

  await t.step('公开首页可浏览', async () => {
    await expectStatus(ctx, '/');
    await expectBodyText(ctx, '软件流水线平台');
    await expectBodyText(ctx, '产品能力');
    await expectBodyText(ctx, '免费开始');
    await t.screenshot('01-home');
  });

  await t.step('公开接口：健康检查与插件/CLI 版本', async () => {
    const health = await ctx.context.request.get(ctx.baseUrl + '/health_check');
    assert.equal(health.status(), 200);
    assert.equal((await health.text()).trim(), 'ok');

    const plugin = await api(ctx, '/api/plugin/version', { anon: true });
    assert.equal(plugin.body.code, 0);
    assert.ok(plugin.body.data.version, '插件版本不应为空');
    assert.equal(plugin.body.data.page_url, '/plugin#extension');

    const cli = await api(ctx, '/api/cli/version', { anon: true });
    assert.equal(cli.body.code, 0);
    assert.ok(cli.body.data.url.includes('/assets/cli/'), 'CLI 下载地址应指向 assets/cli');
  });

  await t.step('未登录访问受保护页面会跳转登录页', async () => {
    await goto(ctx, '/dashboard');
    await expectPath(ctx, '/login', '未登录访问工作台');

    await goto(ctx, '/plugin');
    await expectPath(ctx, '/login', '未登录访问工具下载');

    await goto(ctx, '/project/' + state.projects.p1.id);
    await expectPath(ctx, '/login', '未登录访问项目页');
  });

  await t.step('未登录调用用户接口返回未登录错误', async () => {
    const me = await api(ctx, '/api/me', { anon: true });
    assertApiError(me, 'NOT_LOGGED_IN', '未登录读取 /api/me');
  });

  await t.step('注册入口重定向到登录页', async () => {
    await goto(ctx, '/register');
    await expectPath(ctx, '/login', '注册入口');
    await expectText(ctx, '.auth-title', '软件流水线平台');
    await expectBodyText(ctx, '邮箱验证码登录');
    await t.screenshot('02-login');
  });

  await t.step('登录页前端校验：空邮箱、空表单、非法邮箱', async () => {
    await page.locator('#send-code-btn').click();
    await waitToast(ctx, '请先输入邮箱', '空邮箱发送验证码');

    await page.locator('#login-btn').click();
    await waitToast(ctx, '请填写邮箱和验证码', '空表单提交');

    await page.locator('input[name=email]').fill('not-an-email');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/send_code')),
      page.locator('#send-code-btn').click(),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 'EMAIL_INVALID', '非法邮箱应返回 EMAIL_INVALID');
    await waitToast(ctx, '邮箱格式不正确', '非法邮箱发送验证码');
  });

  let devCode = '';

  await t.step('发送验证码：开发环境返回验证码并进入倒计时', async () => {
    await page.locator('input[name=email]').fill(owner.email);

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/send_code')),
      page.locator('#send-code-btn').click(),
    ]);
    const json = await resp.json();

    assert.equal(json.code, 0);
    devCode = json.data.code;
    assert.ok(/^\d{6}$/.test(devCode), '验证码应为 6 位数字');

    await waitToast(ctx, '验证码（开发环境）：' + devCode, '发送验证码成功');
    await expectText(ctx, '#send-code-btn', 's 后重发', '倒计时按钮');
    assert.equal(await page.locator('#send-code-btn').isDisabled(), true, '倒计时期间发送按钮应禁用');
    await t.screenshot('03-code-sent');
  });

  await t.step('验证码错误时提示并允许重试', async () => {
    const wrong = String((parseInt(devCode, 10) + 1) % 1000000).padStart(6, '0');

    await page.locator('input[name=code]').fill(wrong);
    await page.locator('#login-btn').click();
    await waitToast(ctx, '验证码错误或已过期', '错误验证码登录');
    assert.equal(await page.locator('#login-btn').isDisabled(), false, '失败后登录按钮应恢复');
  });

  await t.step('正确验证码登录进入工作台', async () => {
    await page.locator('input[name=code]').fill(devCode);

    await waitReload(ctx, async () => {
      await page.locator('#login-btn').click();
    }, '登录跳转工作台');

    await expectPath(ctx, '/dashboard', '登录后跳转');
    await expectText(ctx, '.page-title', '工作台');
    await expectText(ctx, '.user-nickname', owner.nickname);
    await t.screenshot('04-dashboard');

    ctx.ownerCookies = await ctx.context.cookies();
    assert.ok(ctx.ownerCookies.some((cookie) => cookie.name === 'pms_token'), '登录后应写入 pms_token');
  });

  await t.step('已登录访问登录页自动回到工作台', async () => {
    await goto(ctx, '/login');
    await expectPath(ctx, '/dashboard', '已登录访问登录页');
  });

  return { devCode };
};
