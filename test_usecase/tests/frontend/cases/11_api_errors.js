const {
  assert, goto, expectPath, expectText, expectBodyText, api, assertApiOk,
  assertApiError, expectVisible, php, restoreCookies, waitReload, loadExtra,
  rememberExtra,
} = require('../lib/core');

/**
 * 团队列表/邀请接口、登录冷却与重试、SSE、404、错误码映射、退出登录、
 * 以及开放接口的仓库匹配回退路径。
 */
module.exports = async function apiErrors(ctx) {
  const { page, state, t, context } = ctx;
  const teamA = state.teams.a;
  const teamB = state.teams.b;
  const p1 = state.projects.p1;
  const p2 = state.projects.p2;
  const p4 = state.projects.p4;
  const w = state.p2;
  const authHeaders = { Authorization: 'Bearer ' + state.api_key.token };

  async function switchUser(email) {
    const token = php('make_session.php', ['--email=' + email]).trim();
    await context.clearCookies();
    await context.addCookies([{
      name: 'pms_token', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax',
    }]);
  }

  async function open(path, options = {}) {
    return api(ctx, path, { ...options, anon: true, headers: { ...authHeaders, ...(options.headers || {}) } });
  }

  await t.step('错误码映射与当前用户接口', async () => {
    const maps = await api(ctx, '/api/error_code_maps');
    const data = assertApiOk(maps, '错误码映射');
    assert.equal(data.NOT_LOGGED_IN, '请先登录');
    assert.ok(data.STATUS_ACTION_INVALID);

    const me = await api(ctx, '/api/me');
    const meData = assertApiOk(me, '当前用户');
    assert.equal(meData.email, state.users.owner.email);

    // 已登录访问注册入口回工作台
    await goto(ctx, '/register');
    await expectPath(ctx, '/dashboard', '已登录访问注册');
  });

  await t.step('团队列表与邀请接口', async () => {
    const ownerList = assertApiOk(await api(ctx, '/api/team_space/list'), '拥有者团队列表');
    assert.ok(ownerList.count >= 2);
    const names = ownerList.team_spaces.map((item) => item.name);
    assert.ok(names.includes(teamA.name) && names.includes(teamB.name));
    const teamArow = ownerList.team_spaces.find((item) => item.id === teamA.id);
    assert.equal(teamArow.project_count, 3);


    const ownerInvites = assertApiOk(await api(ctx, '/api/team_space/invites'), '拥有者邀请列表');
    assert.equal(ownerInvites.count, 0);

    // 拥有者邀请局外人加入团队 B
    const inviteOutsider = await api(ctx, '/api/team_space/' + teamB.id + '/invite', {
      method: 'POST',
      data: { email: state.users.outsider.email },
    });
    const outsiderInvite = assertApiOk(inviteOutsider, '邀请局外人到团队 B');

    // 拥有者邀请种子成员加入团队 B
    const inviteMember = await api(ctx, '/api/team_space/' + teamB.id + '/invite', {
      method: 'POST',
      data: { email: state.users.member.email },
    });
    const memberInvite = assertApiOk(inviteMember, '邀请成员到团队 B');

    // 成员 B：收到团队 B 邀请；不能接受不属于自己的邀请
    await switchUser(state.users.member.email);
    const memberInvites = assertApiOk(await api(ctx, '/api/team_space/invites'), '成员待处理邀请');
    assert.equal(memberInvites.count, 1);
    assert.equal(memberInvites.invites[0].team_space_name, teamB.name);

    const notMine = await api(ctx, '/api/team_space/invite/' + outsiderInvite.id + '/accept', {
      method: 'POST',
      data: {},
    });
    assertApiError(notMine, 'INVITE_NOT_MINE', '接受他人邀请');

    const declined = assertApiOk(await api(ctx, '/api/team_space/invite/' + memberInvite.id + '/decline', {
      method: 'POST',
      data: {},
    }), '拒绝团队邀请');
    assert.equal(declined.id, memberInvite.id);

    const afterDecline = assertApiOk(await api(ctx, '/api/team_space/invites'), '拒绝后邀请列表');
    assert.equal(afterDecline.count, 0);

    const memberList = assertApiOk(await api(ctx, '/api/team_space/list'), '成员团队列表');
    assert.ok(!memberList.team_spaces.some((item) => item.id === teamB.id), '拒绝后未加入团队 B');

    // 局外人：接受邀请后进入团队 B
    await switchUser(state.users.outsider.email);
    const outsiderInvites = assertApiOk(await api(ctx, '/api/team_space/invites'), '局外人待处理邀请');
    assert.equal(outsiderInvites.count, 1);

    const accepted = assertApiOk(await api(ctx, '/api/team_space/invite/' + outsiderInvite.id + '/accept', {
      method: 'POST',
      data: {},
    }), '接受团队邀请');
    assert.equal(accepted.team_space_id, teamB.id);

    const outsiderList = assertApiOk(await api(ctx, '/api/team_space/list'), '接受后团队列表');
    assert.ok(outsiderList.team_spaces.some((item) => item.id === teamB.id), '已加入团队 B');

    const teamDetail = assertApiOk(await api(ctx, '/api/team_space/' + teamB.id), '团队成员视角详情');
    assert.ok(teamDetail.members.some((item) => item.email === state.users.outsider.email));

    // 拥有者把局外人移出团队 B
    await restoreCookies(ctx, ctx.ownerCookies);
    const removed = await api(ctx, '/api/team_space/' + teamB.id + '/remove_member', {
      method: 'POST',
      data: { user_id: state.users.outsider.id },
    });
    assertApiOk(removed, '移出团队 B');
  });

  await t.step('工作项状态日志接口（BUG / 生产缺陷）', async () => {
    const bugLogs = await api(ctx, '/api/project/' + p1.id + '/bug/' + state.p1.bugs.accepted.id + '/status_logs');
    assertApiOk(bugLogs, 'BUG 状态日志');

    const defectLogs = await api(ctx, '/api/project/' + p2.id + '/prod_defect/' + w.prod_defects.accepted.id + '/status_logs?limit=50');
    assertApiOk(defectLogs, '生产缺陷状态日志');

    const missingBug = await api(ctx, '/api/project/' + p1.id + '/bug/999999999/status_logs');
    assertApiError(missingBug, 'WORK_NOT_FOUND', 'BUG 不存在');
  });

  await t.step('登录验证码冷却与错误尝试上限', async () => {
    const email = 'pw-attempts-' + state.tag + '@example.com';

    const first = await api(ctx, '/api/auth/send_code', { method: 'POST', data: { email } });
    const data = assertApiOk(first, '发送验证码');
    assert.ok(data.code);

    const frequent = await api(ctx, '/api/auth/send_code', { method: 'POST', data: { email } });
    assertApiError(frequent, 'CODE_SEND_TOO_FREQUENT', '冷却期内重复发送');

    for (let i = 0; i < 5; i++) {
      const wrong = await api(ctx, '/api/auth/login', {
        method: 'POST',
        data: { email, code: i === 4 ? String((parseInt(data.code, 10) + 2) % 1000000).padStart(6, '0') : '000000' },
      });
      assertApiError(wrong, 'CODE_INVALID_OR_EXPIRED', '错误验证码第 ' + (i + 1) + ' 次');
    }

    const locked = await api(ctx, '/api/auth/login', { method: 'POST', data: { email, code: data.code } });
    assertApiError(locked, 'CODE_INVALID_OR_EXPIRED', '超过尝试次数后验证码失效');

    const invalidEmail = await api(ctx, '/api/auth/login', { method: 'POST', data: { email: 'bad', code: '123456' } });
    assertApiError(invalidEmail, 'EMAIL_INVALID', '登录邮箱非法');
  });

  await t.step('SSE：echo 流、任务不存在、未命中路由', async () => {
    const echo = await ctx.anonContext.request.get(ctx.baseUrl + '/sse/echo?text=hi', { failOnStatusCode: false });
    assert.equal(echo.status(), 200);
    const echoBody = await echo.text();
    assert.ok(echoBody.includes('data: h'), 'SSE echo 输出字符 h');
    assert.ok(echoBody.includes('data: i'), 'SSE echo 输出字符 i');

    const missing = await ctx.context.request.get(ctx.baseUrl + '/sse/agent/progress?run_id=999999999', {
      failOnStatusCode: false,
      timeout: 15000,
    });
    assert.equal(missing.status(), 200);
    const missingBody = await missing.text();
    assert.ok(missingBody.includes('任务不存在'), 'SSE 任务不存在事件，实际：' + missingBody.slice(0, 200));

    const notFound = await ctx.anonContext.request.get(ctx.baseUrl + '/sse/not-found', { failOnStatusCode: false });
    assert.equal(notFound.status(), 404);
    assert.ok((await notFound.text()).includes('Not Found'));

    const preflight = await ctx.anonContext.request.fetch(ctx.baseUrl + '/sse/echo', {
      method: 'OPTIONS',
      failOnStatusCode: false,
    });
    assert.equal(preflight.status(), 204);
    assert.equal(preflight.headers()['access-control-allow-origin'], '*');
  });

  await t.step('404：页面与接口', async () => {
    const page404 = await goto(ctx, '/project/' + p2.id + '/test_tasks');
    assert.equal(page404.status(), 404);
    await expectBodyText(ctx, '您访问的页面不存在');

    await goto(ctx, '/definitely-not-a-page');
    await expectBodyText(ctx, '您访问的页面不存在');

    const api404 = await api(ctx, '/api/definitely-not-an-api');
    assert.equal(api404.status, 404);
    assert.equal(api404.body.code, 404);
    assert.equal(api404.body.msg, 'Not Found');
  });

  await t.step('开放接口仓库匹配回退：未命中仓库地址时使用关联系统', async () => {
    const workId = w.requirements.modified.id;

    // 已验收 → 重新开发 → 开发中
    assertApiOk(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: workId, action: 're_dev' },
    }), '重新开发');
    assertApiOk(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: workId, action: 'start_dev' },
    }), '开始开发');

    const finished = assertApiOk(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: {
        project_id: p2.id,
        work_id: workId,
        action: 'finish_dev',
        feature_branch: 'feature/REQ-FALLBACK',
        code_added: 5,
        code_deleted: 2,
        repo_url: 'https://github.com/not-configured/repo.git',
      },
    }), '完成开发（仓库未匹配）');
    assert.equal(finished.status, 'to_review');

    await goto(ctx, '/project/' + p2.id + '/requirements/' + workId);
    await expectBodyText(ctx, 'feature/REQ-FALLBACK');
    await expectBodyText(ctx, '+5');
    await expectBodyText(ctx, 'https://github.com/pw-demo/admin.git', '回退到需求关联系统的仓库地址');
  });

  await t.step('页面边界：非法版本流水线、草稿版本知识、全部版本已发布的开发分支', async () => {
    // 非法版本参数：展示范围回退全部，但过滤仍按非法版本（已知行为）
    await goto(ctx, '/project/' + p2.id + '/pipeline?version=999999');
    await expectText(ctx, '.page-title', '流水线');
    // 非法版本在服务端回退为「全部」，前端轮询用的也是回退后的范围
    assert.equal(await page.locator('select[name=version]').inputValue(), 'all');
    await page.waitForFunction(
      () => Number(document.querySelector('[data-stat=requirement_total]').textContent.trim()) > 0,
      null,
      { timeout: 5000 }
    );

    // 未发布版本的项目知识实时合成视图
    if (ctx.p2DraftVersionId) {
      await goto(ctx, '/project/' + p2.id + '/knowledge?version=' + ctx.p2DraftVersionId);
      await expectBodyText(ctx, '开发中 · 实时合成');
      await expectBodyText(ctx, '此前已发布版本的定稿基座');
    }

    // P1 所有版本均已发布：开发分支退回最新版本号
    await goto(ctx, '/project/' + p1.id + '/system_repos');
    const branches = (await page.locator('.repo-dev-branch').allInnerTexts()).map((v) => v.trim());
    assert.ok(branches.every((value) => value === 'v1.1.0-dev'), '全部发布后退回最新版本开发分支：' + JSON.stringify(branches));
  });

  await t.step('空历史列表：单场景助手与大而全助手', async () => {
    const created = assertApiOk(await api(ctx, '/api/project/create', {
      method: 'POST',
      data: { team_space_id: teamA.id, name: 'PW 空历史项目' },
    }), '创建空历史项目');
    rememberExtra('project', created.id);

    const html = await page.request.get(ctx.baseUrl + '/project/' + created.id + '/agent_session_history?page=1');
    assert.equal(html.status(), 200);
    assert.ok((await html.text()).includes('还没有历史对话'), '空会话历史提示');

    const runs = await page.request.get(ctx.baseUrl + '/project/' + created.id + '/agent_history?mode=dev_bug');
    assert.equal(runs.status(), 200);
    assert.ok((await runs.text()).includes('还没有与项目助手'), '空轮次历史提示');
  });

  await t.step('新邮箱验证码登录自动注册：无团队的空账号', async () => {
    const email = 'pw-newuser-' + state.tag + '@example.com';
    const sent = assertApiOk(await api(ctx, '/api/auth/send_code', { method: 'POST', data: { email } }), '新邮箱发送验证码');
    const login = assertApiOk(await api(ctx, '/api/auth/login', { method: 'POST', data: { email, code: sent.code } }), '新邮箱登录');
    assert.equal(login.email, email);

    const list = assertApiOk(await api(ctx, '/api/team_space/list'), '新账号团队列表');
    assert.equal(list.count, 0);
    assert.deepEqual(list.team_spaces, []);

    const invites = assertApiOk(await api(ctx, '/api/team_space/invites'), '新账号邀请列表');
    assert.equal(invites.count, 0);

    await goto(ctx, '/dashboard');
    await expectBodyText(ctx, '还没有团队空间');
    await goto(ctx, '/account');
    await expectBodyText(ctx, '尚未加入任何团队空间');

    await restoreCookies(ctx, ctx.ownerCookies);
  });

  await t.step('退出登录与登录态失效', async () => {
    await goto(ctx, '/account');
    await expectVisible(ctx, '[data-logout]', '退出按钮');

    await waitReload(ctx, () => page.locator('[data-logout]').click(), '退出登录');

    await expectPath(ctx, '/login', '退出后跳转登录页');

    const me = await api(ctx, '/api/me');
    assertApiError(me, 'NOT_LOGGED_IN', '退出后当前用户接口');

    const logoutAgain = await api(ctx, '/api/logout', { method: 'POST', data: {} });
    assertApiError(logoutAgain, 'NOT_LOGGED_IN', '未登录再次退出');

    await goto(ctx, '/dashboard');
    await expectPath(ctx, '/login', '退出后访问工作台');
    await t.screenshot('56-logged-out');
  });
};
