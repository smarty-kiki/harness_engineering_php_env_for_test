const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, waitReload,
  expectVisible, expectHidden, clickAndWaitLoad, rememberExtra, api, assertApiOk,
} = require('../lib/core');

/**
 * 工作台、团队空间、顶部下拉、通过 UI 新建团队 / 项目。
 */
module.exports = async function teamProject(ctx) {
  const { page, state, t } = ctx;
  const teamA = state.teams.a;
  const teamB = state.teams.b;
  const p1 = state.projects.p1;
  const p2 = state.projects.p2;
  const p3 = state.projects.p3;

  await t.step('工作台展示我的团队空间', async () => {
    await goto(ctx, '/dashboard');
    await expectText(ctx, '.page-title', '工作台');
    await expectBodyText(ctx, teamA.name, '团队 A 卡片');
    await expectBodyText(ctx, teamB.name, '团队 B 卡片');
    await expectBodyText(ctx, '项目数：3', '团队 A 项目数');

    // 待处理邀请只属于受邀人，拥有者看不到
    assert.equal(await page.locator('[data-accept-invite]').count(), 0, '拥有者不应看到待处理邀请按钮');
    await t.screenshot('05-dashboard-teams');
  });

  await t.step('顶部团队/项目下拉可展开收起', async () => {
    await page.locator('#team-dropdown [data-dropdown-toggle]').click();
    await expectVisible(ctx, '#team-dropdown.open', '团队下拉展开');
    await page.locator('.page-title').click();
    await expectHidden(ctx, '#team-dropdown.open', '团队下拉收起');

    await page.locator('#team-dropdown [data-dropdown-toggle]').click();
    await page.locator('#team-dropdown .dropdown-item', { hasText: teamB.name }).click();
    await expectPath(ctx, '/team_space/' + teamB.id, '顶部团队切换到团队 B');
    await expectBodyText(ctx, '团队 ' + teamB.name);
  });

  await t.step('团队空间页展示成员、邀请与项目', async () => {
    await goto(ctx, '/team_space/' + teamA.id);
    await expectBodyText(ctx, state.users.owner.email, '团队成员：拥有者邮箱');
    await expectBodyText(ctx, state.users.member.email, '团队成员：成员邮箱');
    await expectBodyText(ctx, p1.name, '团队项目 P1');
    await expectBodyText(ctx, p2.name, '团队项目 P2');
    await expectBodyText(ctx, p3.name, '团队项目 P3');
    await expectVisible(ctx, '#invite-form', '拥有者可见邀请表单');
    await expectVisible(ctx, '[data-remove-member="' + state.users.member.id + '"]', '拥有者可见移除成员按钮');
    await t.screenshot('06-team-space');
  });

  await t.step('移除成员二次确认可取消', async () => {
    await page.locator('[data-remove-member="' + state.users.member.id + '"]').click();
    await expectVisible(ctx, '.modal-mask.open', '移除确认弹窗');
    await expectBodyText(ctx, '确定将该成员移出团队空间吗？');
    await page.locator('.modal-mask.open .modal-footer button:not(.btn-primary)').click();
    await expectHidden(ctx, '.modal-mask.open', '取消移除');
    await expectBodyText(ctx, state.users.member.email, '成员仍在列表中');
  });

  await t.step('邀请成员：非法邮箱 / 已是成员 / 重复邀请', async () => {
    const input = page.locator('#invite-form input[name=email]');
    const submit = page.locator('#invite-form button[type=submit]');

    await input.fill('bad-email');
    // 表单带 HTML5 邮箱校验，直接点提交会被浏览器拦下；派发 submit 事件覆盖 JS 侧错误提示
    await page.evaluate(() => {
      document.getElementById('invite-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitToast(ctx, '邮箱格式不正确', '邀请非法邮箱');

    await input.fill(state.users.member.email);
    await submit.click();
    await waitToast(ctx, '该邮箱已是团队成员', '邀请已是成员的邮箱');
  });

  await t.step('通过团队页邀请受邀人并展示待处理邀请', async () => {
    const input = page.locator('#invite-form input[name=email]');
    const submit = page.locator('#invite-form button[type=submit]');

    await goto(ctx, '/team_space/' + state.teams.a.id);
    await input.fill(state.users.invitee.email);

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/team_space/' + state.teams.a.id + '/invite')),
      submit.click(),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 0, '邀请接口应成功');

    await waitToast(ctx, '邀请已发送', '邀请成功提示');

    // 先创建拒绝人的邀请，保证后续工作台拒绝流程不依赖本步骤的页面渲染结果
    const created = await api(ctx, '/api/team_space/' + state.teams.a.id + '/invite', {
      method: 'POST',
      data: { email: state.users.decliner.email },
    });
    assert.equal(created.body.code, 0, '创建拒绝人邀请');

    const duplicate = await api(ctx, '/api/team_space/' + state.teams.a.id + '/invite', {
      method: 'POST',
      data: { email: state.users.decliner.email },
    });
    assert.equal(duplicate.body.code, 'INVITE_ALREADY_PENDING', '重复邀请');

    // 存在待处理邀请时，团队页应正常渲染并展示邀请邮箱
    await goto(ctx, '/team_space/' + state.teams.a.id);
    await expectBodyText(ctx, '待处理邀请');
    await expectBodyText(ctx, state.users.invitee.email, '邀请出现在待处理列表');
  });

  await t.step('顶部团队下拉可打开新建团队弹窗并关闭', async () => {
    await goto(ctx, '/team_space/' + teamB.id);
    await page.locator('#team-dropdown [data-dropdown-toggle]').click();
    await page.locator('#team-dropdown [data-open-modal="team-create-modal"]').click();
    await expectVisible(ctx, '#team-create-modal.open', '新建团队弹窗');
    await page.locator('#team-create-modal [data-close]').click();
    await expectHidden(ctx, '#team-create-modal.open', '关闭新建团队弹窗');

    // 点击遮罩关闭
    await page.locator('#team-dropdown [data-dropdown-toggle]').click();
    await page.locator('#team-dropdown [data-open-modal="team-create-modal"]').click();
    await page.locator('#team-create-modal').click({ position: { x: 5, y: 5 } });
    await expectHidden(ctx, '#team-create-modal.open', '点击遮罩关闭新建团队弹窗');
  });

  await t.step('通过 UI 新建团队并进入团队页', async () => {
    const teamName = 'PW UI 团队 ' + state.tag;

    await page.locator('#team-dropdown [data-dropdown-toggle]').click();
    await page.locator('#team-dropdown [data-open-modal="team-create-modal"]').click();
    await page.locator('#team-create-form input[name=name]').fill(teamName);
    await page.locator('#team-create-form textarea[name=description]').fill('Playwright 通过 UI 创建的团队');

    await waitReload(ctx, async () => {
      await page.locator('#team-create-form button[type=submit]').click();
    }, '创建团队跳转');

    const url = new URL(page.url());
    assert.ok(url.pathname.startsWith('/team_space/'), '创建团队后应进入团队页');
    const teamId = Number(url.pathname.split('/').pop());
    rememberExtra('team', teamId);

    await expectBodyText(ctx, '团队 ' + teamName);
    await expectBodyText(ctx, '还没有项目', '新团队无项目提示');
    await t.screenshot('07-created-team');
  });

  await t.step('通过 UI 在团队 B 新建项目', async () => {
    await goto(ctx, '/team_space/' + teamB.id);
    await expectBodyText(ctx, '还没有项目', '团队 B 空项目提示');

    // 顶部项目下拉此时在团队 B 语境下出现
    await page.locator('#project-dropdown [data-dropdown-toggle]').click();
    await page.locator('#project-dropdown [data-open-modal="project-create-modal"]').click();
    await expectVisible(ctx, '#project-create-modal.open', '新建项目弹窗');

    await page.locator('#project-create-form input[name=name]').fill('PW UI 项目 ' + state.tag);
    await page.locator('#project-create-form textarea[name=description]').fill('UI 创建的项目');

    await waitReload(ctx, async () => {
      await page.locator('#project-create-form button[type=submit]').click();
    }, '创建项目跳转');

    const url = new URL(page.url());
    assert.ok(/^\/project\/\d+$/.test(url.pathname), '创建项目后应进入项目概览');
    const projectId = Number(url.pathname.split('/').pop());
    rememberExtra('project', projectId);

    await expectBodyText(ctx, 'PW UI 项目 ' + state.tag);
    await expectBodyText(ctx, '初版', '新项目初始状态');
    await expectBodyText(ctx, '初版开发中');
    await t.screenshot('08-created-project');

    // 回到团队 B，项目列表出现新项目
    await goto(ctx, '/team_space/' + teamB.id);
    await expectBodyText(ctx, 'PW UI 项目 ' + state.tag, '团队 B 项目列表');
  });

  await t.step('顶部项目下拉可直接切换到已有项目', async () => {
    await goto(ctx, '/team_space/' + teamA.id);
    await page.locator('#project-dropdown [data-dropdown-toggle]').click();
    await page.locator('#project-dropdown .dropdown-item', { hasText: p2.name }).click();
    await expectPath(ctx, '/project/' + p2.id, '切换到版本项目');
    await expectText(ctx, '.page-title', p2.name);
  });

  await t.step('团队接口：成员权限与参数校验', async () => {
    const empty = await api(ctx, '/api/team_space/' + teamA.id + '/update', {
      method: 'POST',
      data: { name: '', description: '' },
    });
    assert.equal(empty.body.code, 'TEAM_SPACE_NAME_REQUIRED');

    const notFound = await api(ctx, '/api/team_space/999999999');
    assert.equal(notFound.body.code, 'NOT_TEAM_SPACE_MEMBER');

    const removeOwner = await api(ctx, '/api/team_space/' + teamA.id + '/remove_member', {
      method: 'POST',
      data: { user_id: state.users.owner.id },
    });
    assert.equal(removeOwner.body.code, 'CANNOT_REMOVE_OWNER');

    const removeMissing = await api(ctx, '/api/team_space/' + teamA.id + '/remove_member', {
      method: 'POST',
      data: { user_id: 999999999 },
    });
    assert.equal(removeMissing.body.code, 'NOT_TEAM_SPACE_MEMBER');

    const update = await api(ctx, '/api/team_space/' + teamA.id + '/update', {
      method: 'POST',
      data: { name: teamA.name, description: 'Playwright 主测试团队（已更新）' },
    });
    assertApiOk(update, '更新团队信息');
    await goto(ctx, '/team_space/' + teamA.id);
    await expectBodyText(ctx, '已更新', '团队描述更新');
  });
};
