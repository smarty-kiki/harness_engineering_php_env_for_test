const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, expectVisible,
  api, assertApiOk, assertApiError, waitReload, confirmPmsModal, php, restoreCookies,
} = require('../lib/core');

/**
 * 邀请接受/拒绝、成员权限、局外人访问拦截、移除成员、退出登录。
 */
module.exports = async function permissionsInvites(ctx) {
  const { page, state, t, context } = ctx;
  const teamA = state.teams.a;
  const p1 = state.projects.p1;
  const p3 = state.projects.p3;
  const p4 = state.projects.p4;

  async function switchUser(email) {
    const token = php('make_session.php', ['--email=' + email]).trim();
    assert.ok(token.length > 20, '创建测试会话');

    await context.clearCookies();
    await context.addCookies([{
      name: 'pms_token',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    }]);
  }

  await t.step('拒绝邀请：受邀人工作台操作', async () => {
    await switchUser(state.users.decliner.email);
    await goto(ctx, '/dashboard');
    await expectBodyText(ctx, '待处理邀请');
    await expectBodyText(ctx, teamA.name);
    await expectBodyText(ctx, 'PW 拥有者');

    await waitReload(ctx, () => page.locator('[data-decline-invite]').first().click(), '拒绝邀请后刷新');

    assert.equal(await page.locator('[data-decline-invite]').count(), 0, '拒绝后邀请消失');
    await t.screenshot('52-invite-declined');
  });

  await t.step('接受邀请：受邀人成为团队成员', async () => {
    await switchUser(state.users.invitee.email);
    await goto(ctx, '/dashboard');
    await expectBodyText(ctx, teamA.name);
    await expectBodyText(ctx, 'PW 拥有者');

    await waitReload(ctx, () => page.locator('[data-accept-invite]').first().click(), '接受邀请后刷新');

    assert.equal(await page.locator('[data-accept-invite]').count(), 0, '接受后邀请消失');
    await expectBodyText(ctx, teamA.name);
    await expectBodyText(ctx, '项目数：3');

    await page.locator('.card', { hasText: teamA.name }).first().click();
    await expectPath(ctx, '/team_space/' + teamA.id, '进入受邀团队');
    await expectBodyText(ctx, state.users.invitee.email);
    await expectBodyText(ctx, '成员');
    assert.equal(await page.locator('#invite-form').count(), 0, '普通成员没有邀请表单');
    assert.equal(await page.locator('[data-remove-member]').count(), 0, '普通成员没有移除按钮');
    await t.screenshot('53-invite-accepted');
  });

  await t.step('普通成员权限：可访问项目但无管理权限', async () => {
    await goto(ctx, '/project/' + p1.id);
    await expectBodyText(ctx, p1.name);

    await goto(ctx, '/project/' + p3.id + '/versions');
    await expectBodyText(ctx, '初版发布需要团队拥有者或管理员操作');
    assert.equal(await page.locator('#initial-release-form').count(), 0);

    await goto(ctx, '/account');
    await expectBodyText(ctx, teamA.name);
    await expectBodyText(ctx, '成员');

    const release = await api(ctx, '/api/project/' + p3.id + '/release_initial', {
      method: 'POST',
      data: { version_no: '1.0.0' },
    });
    assertApiError(release, 'NO_TEAM_SPACE_PERMISSION', '普通成员发布初版');

    const invite = await api(ctx, '/api/team_space/' + teamA.id + '/invite', {
      method: 'POST',
      data: { email: 'someone@example.com' },
    });
    assertApiError(invite, 'NO_TEAM_SPACE_PERMISSION', '普通成员邀请成员');

    const update = await api(ctx, '/api/team_space/' + teamA.id + '/update', {
      method: 'POST',
      data: { name: '改名尝试', description: '' },
    });
    assertApiError(update, 'NO_TEAM_SPACE_PERMISSION', '普通成员修改团队');

    const remove = await api(ctx, '/api/team_space/' + teamA.id + '/remove_member', {
      method: 'POST',
      data: { user_id: state.users.member.id },
    });
    assertApiError(remove, 'NO_TEAM_SPACE_PERMISSION', '普通成员移除成员');
  });

  await t.step('种子成员同样没有管理入口', async () => {
    await switchUser(state.users.member.email);
    await goto(ctx, '/team_space/' + teamA.id);
    await expectBodyText(ctx, state.users.member.email);
    assert.equal(await page.locator('#invite-form').count(), 0);
    assert.equal(await page.locator('[data-remove-member]').count(), 0);

    await goto(ctx, '/project/' + p1.id + '/versions');
    assert.equal(await page.locator('#initial-release-form').count(), 0, '普通成员看不到初版发布表单');
  });

  await t.step('局外人访问团队与项目被拦截', async () => {
    await switchUser(state.users.outsider.email);

    await goto(ctx, '/team_space/' + teamA.id);
    await expectBodyText(ctx, '您不是该团队空间的成员');

    await goto(ctx, '/project/' + p1.id);
    await expectBodyText(ctx, '您不是该团队空间的成员');

    await goto(ctx, '/project/' + p3.id + '/knowledge');
    await expectBodyText(ctx, '您不是该团队空间的成员');

    const teamApi = await api(ctx, '/api/team_space/' + teamA.id);
    assertApiError(teamApi, 'NOT_TEAM_SPACE_MEMBER', '局外人读取团队');

    const projectCreate = await api(ctx, '/api/project/create?team_space_id=' + teamA.id, {
      method: 'POST',
      data: { name: '非法项目' },
    });
    assertApiError(projectCreate, 'NOT_TEAM_SPACE_MEMBER', '局外人在他人团队建项目');

    // 自己的团队与项目可访问
    await goto(ctx, '/team_space/' + state.teams.outside.id);
    await expectBodyText(ctx, state.teams.outside.name);
    await goto(ctx, '/project/' + p4.id);
    await expectBodyText(ctx, p4.name);
    await t.screenshot('54-outsider');
  });

  await t.step('拥有者移除受邀成员', async () => {
    await restoreCookies(ctx, ctx.ownerCookies);

    await goto(ctx, '/team_space/' + teamA.id);
    await expectBodyText(ctx, state.users.invitee.email);
    await expectVisible(ctx, '[data-remove-member="' + state.users.invitee.id + '"]', '受邀成员可被移除');

    await page.locator('[data-remove-member="' + state.users.invitee.id + '"]').click();
    await expectVisible(ctx, '.modal-mask.open', '移除确认');
    await waitReload(ctx, () => confirmPmsModal(ctx), '移除成员后刷新');

    assert.equal(await page.locator('[data-remove-member="' + state.users.invitee.id + '"]').count(), 0, '受邀成员已被移除');
    await expectBodyText(ctx, state.users.member.email, '原有成员仍在');

    const removeAgain = await api(ctx, '/api/team_space/' + teamA.id + '/remove_member', {
      method: 'POST',
      data: { user_id: state.users.invitee.id },
    });
    assertApiError(removeAgain, 'NOT_TEAM_SPACE_MEMBER', '重复移除已移出的成员');

    // 被移除后失去团队访问权限
    await switchUser(state.users.invitee.email);
    await goto(ctx, '/team_space/' + teamA.id);
    await expectBodyText(ctx, '您不是该团队空间的成员');
    await restoreCookies(ctx, ctx.ownerCookies);
    await t.screenshot('55-member-removed');
  });

  await t.step('成员管理接口：非法邮箱与不存在目标', async () => {
    const invalidEmail = await api(ctx, '/api/team_space/' + teamA.id + '/invite', {
      method: 'POST',
      data: { email: 'bad' },
    });
    assertApiError(invalidEmail, 'INVITE_EMAIL_INVALID', '邀请非法邮箱');

    const inviteOwner = await api(ctx, '/api/team_space/' + teamA.id + '/invite', {
      method: 'POST',
      data: { email: state.users.owner.email },
    });
    assertApiError(inviteOwner, 'INVITE_ALREADY_MEMBER', '邀请拥有者');

    const acceptMissing = await api(ctx, '/api/team_space/invite/999999999/accept', {
      method: 'POST',
      data: {},
    });
    assertApiError(acceptMissing, 'INVITE_NOT_FOUND', '接受不存在的邀请');

    const declineMissing = await api(ctx, '/api/team_space/invite/999999999/decline', {
      method: 'POST',
      data: {},
    });
    assertApiError(declineMissing, 'INVITE_NOT_FOUND', '拒绝不存在的邀请');
  });
};
