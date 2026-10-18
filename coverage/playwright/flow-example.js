/**
 * Playwright 流程模板：复制到项目目录（或在容器内任意位置）后按实际页面改。
 *
 *   playwright-run /path/to/flow.js
 *
 * 流程函数拿到的是已经开好录像/trace/覆盖率采集的页面，直接写业务操作即可。
 * 覆盖率会在每次页面 load、每 3 秒以及流程结束时自动采集；也可以在关键步骤后
 * 主动 await takeCoverage('reason')。
 *
 * 注意：这个示例用开发环境的验证码自动登录，会在数据库里创建测试用户；
 * 跑完测试后记得清理（按 email 前缀检索 user 表，并删除对应 Redis 会话）。
 */
module.exports = async function ({ page, baseUrl, screenshot, step, takeCoverage, setMeta }) {
  await step('打开登录页', async () => {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'load' });
    await screenshot('01-login');
  });

  const email = `pw-test-${Date.now()}@example.com`;

  await step('发送验证码并登录', async () => {
    await page.fill('input[name=email]', email);

    const [sendResp] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/send_code')),
      page.click('#send-code-btn'),
    ]);

    const code = (await sendResp.json())?.data?.code;

    if (!code) throw new Error('开发环境没有在 send_code 响应里返回验证码');

    await page.fill('input[name=code]', code);
    await Promise.all([
      page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => null),
      page.click('#login-btn'),
    ]);

    await page.waitForTimeout(800);
    await screenshot('02-dashboard');
    await takeCoverage('dashboard');
  });

  setMeta({ email });

  return { email };
};
