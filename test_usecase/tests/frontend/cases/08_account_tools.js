const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, expectVisible,
  expectHidden, api, assertApiOk, assertApiError, waitReload, confirmPmsModal,
} = require('../lib/core');

/**
 * 个人中心（昵称 / 团队昵称 / 开放接口 Key）、接口文档、工具下载页。
 */
module.exports = async function accountTools(ctx) {
  const { page, state, t } = ctx;
  const owner = state.users.owner;
  const teamA = state.teams.a;
  const teamB = state.teams.b;

  await t.step('个人中心展示账号、团队昵称与开放接口 Key', async () => {
    await goto(ctx, '/account');
    await expectText(ctx, '.page-title', '个人中心');
    await expectBodyText(ctx, owner.email);
    await expectBodyText(ctx, teamA.name);
    await expectBodyText(ctx, teamB.name);
    await expectBodyText(ctx, '拥有者');
    await expectBodyText(ctx, state.api_key.name);
    await expectBodyText(ctx, 'PW 旧版 Key');
    await expectBodyText(ctx, '从未使用');
    await expectBodyText(ctx, '…OLD1');
    await t.screenshot('48-account');
  });

  await t.step('修改账号昵称：空值 / 过长 / 正常保存', async () => {
    const input = page.locator('[data-account-nick-input]');
    const save = page.locator('[data-save-account-nick]');

    await input.fill('');
    await save.click();
    await waitToast(ctx, '账号昵称不能为空且不能超过 30 个字', '空昵称');

    await input.fill('x'.repeat(31));
    await save.click();
    await waitToast(ctx, '账号昵称不能为空且不能超过 30 个字', '过长昵称');

    await input.fill('PW 拥有者二号');
    await save.click();
    await waitToast(ctx, '账号昵称已保存', '保存账号昵称');
    await expectText(ctx, '.user-nickname', 'PW 拥有者二号');

    const placeholder = await page.locator('[data-team-input]').first().getAttribute('placeholder');
    assert.ok(placeholder.includes('PW 拥有者二号'), '团队昵称占位提示同步新昵称');

    await input.fill('PW 拥有者');
    await save.click();
    await waitToast(ctx, '账号昵称已保存', '恢复账号昵称');
    await expectText(ctx, '.user-nickname', 'PW 拥有者');
  });

  await t.step('修改团队昵称：过长 / 正常保存 / 留空恢复', async () => {
    const input = page.locator('[data-team-input="' + teamA.id + '"]');
    const save = page.locator('[data-save-team-nick="' + teamA.id + '"]');

    assert.equal(await input.getAttribute('maxlength'), '30', '团队昵称输入框限制 30 字');

    await input.fill('PW 团队昵称');
    await save.click();
    await waitToast(ctx, '昵称已保存', '保存团队昵称');

    await input.fill('');
    await save.click();
    await waitToast(ctx, '昵称已保存', '清空团队昵称');

    const tooLongApi = await api(ctx, '/api/account/team-nickname', {
      method: 'POST',
      data: { team_space_id: teamA.id, nickname: 'n'.repeat(31) },
    });
    assertApiError(tooLongApi, 'TEAM_NICKNAME_INVALID', '团队昵称接口校验');

    const notMember = await api(ctx, '/api/account/team-nickname', {
      method: 'POST',
      data: { team_space_id: state.teams.outside.id, nickname: 'x' },
    });
    assertApiError(notMember, 'NOT_TEAM_SPACE_MEMBER', '非团队成员设置昵称');
  });

  await t.step('开放接口 Key：空名称 / 新建 / 复制 / 删除', async () => {
    await page.locator('[data-open-modal="api-key-create-modal"]').click();
    await expectVisible(ctx, '#api-key-create-modal.open', '新建 Key 弹层');

    await page.locator('#api-key-create-btn').click();
    await waitToast(ctx, '请输入 Key 名称', '空名称');

    await page.locator('#api-key-name').fill('PW UI Key');
    await page.locator('#api-key-create-btn').click();

    await expectVisible(ctx, '#api-key-reveal', 'Key 明文展示区');
    const token = await page.locator('#api-key-token').inputValue();
    assert.ok(token.startsWith('pms_'), '新 Key 应以 pms_ 开头');

    await page.locator('#api-key-copy-btn').click();
    await waitToast(ctx, 'Key 已复制', '复制 Key');

    await waitReload(ctx, () => page.locator('#api-key-done-btn').click(), '完成新建 Key 后刷新');
    await expectBodyText(ctx, 'PW UI Key');
    await expectBodyText(ctx, token.slice(-4));

    // 点击标识再次复制
    await page.locator('[data-copy-api-key]').first().click();
    await waitToast(ctx, '完整 Key 已复制', '点击标识复制 Key');

    // 旧版无明文 Key 的复制回退提示
    await page.locator('[data-copy-api-key=""]').first().click();
    await waitToast(ctx, '该 Key 创建于旧版本', '旧 Key 复制提示');

    // 删除 UI Key
    const deleteButtons = page.locator('[data-delete-api-key]');
    const deleteCountBefore = await deleteButtons.count();
    assert.ok(deleteCountBefore >= 3, '至少 3 个 Key');

    await page.locator('[data-delete-api-key]').first().click();
    await expectVisible(ctx, '.modal-mask.open', '删除 Key 确认');
    await expectBodyText(ctx, '删除后该 Key 立即失效');

    await waitReload(ctx, () => confirmPmsModal(ctx), '删除 Key 后刷新');
    assert.equal(await page.locator('[data-delete-api-key]').count(), deleteCountBefore - 1, 'Key 数量减少');
    await t.screenshot('49-account-keys');
  });

  await t.step('开放接口 Key 接口鉴权与校验', async () => {
    const emptyName = await api(ctx, '/api/account/api-key', { method: 'POST', data: { name: '  ' } });
    assertApiError(emptyName, 'API_KEY_NAME_REQUIRED', '空 Key 名称');

    const deleteOthers = await api(ctx, '/api/account/api-key/delete', { method: 'POST', data: { id: 999999999 } });
    assertApiError(deleteOthers, 'API_KEY_INVALID', '删除不存在的 Key');

    const created = await api(ctx, '/api/account/api-key', { method: 'POST', data: { name: 'PW 临时 Key' } });
    const data = assertApiOk(created, '接口新建 Key');
    assert.ok(data.token.startsWith('pms_'));

    await api(ctx, '/api/account/api-key/delete', { method: 'POST', data: { id: data.id } });
  });

  await t.step('接口文档页展示开放接口说明', async () => {
    await goto(ctx, '/api_docs');
    await expectText(ctx, '.page-title', '接口文档');
    await expectBodyText(ctx, 'Authorization: Bearer pms_xxxx');
    await expectBodyText(ctx, '/api/open/agent/requirement');
    await expectBodyText(ctx, '/api/open/projects');
    await expectBodyText(ctx, '/api/open/project/{project_id}/unreleased_versions');
    await expectBodyText(ctx, '/api/open/work/requirement/status');
    await expectBodyText(ctx, '/api/open/project/{project_id}/knowledge');
    await t.screenshot('50-api-docs');
  });

  await t.step('工具下载页：插件 / CLI 页签与下载产物', async () => {
    await goto(ctx, '/plugin');
    await expectText(ctx, '.page-title', '工具下载');
    await expectBodyText(ctx, '软件流水线助手');
    await expectBodyText(ctx, '安装步骤');
    await expectVisible(ctx, 'a[href*="/assets/extension/pms-extension-"]', '插件下载链接');

    await page.locator('.tabs .tab[data-tab=cli]').click();
    await expectVisible(ctx, '[data-panel=cli]', 'CLI 面板');
    await expectHidden(ctx, '[data-panel=extension]', '插件面板隐藏');
    await expectBodyText(ctx, 'pms-cli');
    await expectVisible(ctx, 'a[href*="/assets/cli/pms-cli-"]', 'CLI 下载链接');
    assert.ok(page.url().endsWith('#cli'), '点击页签写入 hash');

    // hash 直达与 hashchange
    await goto(ctx, '/plugin#extension');
    await expectVisible(ctx, '[data-panel=extension]', 'hash 直达插件页签');
    await page.evaluate(() => { window.location.hash = '#cli'; });
    await expectVisible(ctx, '[data-panel=cli]', 'hashchange 切到 CLI 页签');
    await t.screenshot('51-plugin');
  });
};
