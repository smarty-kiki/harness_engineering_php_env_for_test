const {
  assert, goto, expectPath, expectText, expectBodyText, waitToast, expectVisible,
  api, assertApiOk, assertApiError, waitReload, confirmPmsModal, php,
} = require('../lib/core');

/**
 * 用一份完整的「大而全助手」方案走真实确认接口落库：
 * 角色 / 业务流程（节点）/ 系统（模块/页面/服务端接口/开放接口/定时任务）/ 需求（完整 links）。
 * 随后验收需求、发布初版，覆盖项目资产落库、富 Markdown 渲染与版本知识定稿。
 */
module.exports = async function agentApplyRelease(ctx) {
  const { page, state, t } = ctx;
  const p3 = state.projects.p3;
  const authHeaders = { Authorization: 'Bearer ' + state.api_key.token };
  let sessionId = 0;
  let work = null;

  await t.step('为初版项目准备完整助手方案', async () => {
    const output = php('seed_p3_plan.php');
    const data = JSON.parse(output);
    sessionId = data.session_id;
    assert.ok(sessionId > 0, '创建 P3 助手会话');
  });

  await t.step('确认完整方案：资产与需求落库', async () => {
    await goto(ctx, '/project/' + p3.id + '/agent');
    await expectVisible(ctx, '.agent-plan-card[data-session-id="' + sessionId + '"]', '方案卡');
    await expectBodyText(ctx, '仓库管理员');
    await page.locator('.agent-plan-card .tabs .tab[data-tab=processes]').click();
    await expectBodyText(ctx, '入库流程');
    await expectBodyText(ctx, '自动审核');
    await page.locator('.agent-plan-card .tabs .tab[data-tab=systems]').click();
    await expectBodyText(ctx, '仓储系统');
    await expectBodyText(ctx, '库存日报');

    await page.locator('#agent-plan-confirm').click();
    await expectVisible(ctx, '.modal-mask.open', '确认方案弹窗');

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/agent/session/' + sessionId + '/confirm')),
      confirmPmsModal(ctx),
    ]);
    const json = await resp.json();
    assert.equal(json.code, 0, '确认方案接口');

    const result = json.data;
    assert.equal(result.works.length, 1, '落库 1 条需求');
    work = result.works[0];
    assert.equal(work.action, 'created');
    assert.equal(work.work_type, 'requirement');
    assert.equal(work.title, '创建入库单');
    assert.equal(result.assets.role.created, 2);
    assert.equal(result.assets.process.created, 1);
    assert.equal(result.assets.system.created, 1);

    await expectVisible(ctx, '.modal-mask.open', '确认结果弹窗');
    await expectBodyText(ctx, '方案已确认并写入项目');
    await expectBodyText(ctx, '创建入库单');
    await expectBodyText(ctx, '角色：新增 2');
    await t.screenshot('57-agent-rich-result');

    await waitReload(ctx, () => page.locator('.modal-mask.open .modal-footer button.btn-primary').click(), '确认后刷新');
    await expectBodyText(ctx, '还没有方案');
  });

  await t.step('落库后的项目概览与知识页', async () => {
    await goto(ctx, '/project/' + p3.id);
    const statNums = (await page.locator('.stat-num').allInnerTexts()).map((v) => v.trim());
    assert.deepEqual(statNums, ['2', '1', '1'], '角色 / 流程 / 系统统计');
    await expectBodyText(ctx, '业务流程（2 节点）');
    await expectBodyText(ctx, '系统（2 模块）');

    await goto(ctx, '/project/' + p3.id + '/knowledge');
    await expectBodyText(ctx, '仓库管理员');
    await page.locator('.tabs .tab[data-tab=processes]').click();
    await expectBodyText(ctx, '入库流程');
    await expectBodyText(ctx, '自动审核');
    await page.locator('.tabs .tab[data-tab=systems]').click();
    await expectBodyText(ctx, '仓储系统');
    await expectBodyText(ctx, '入库管理');
    await expectBodyText(ctx, '入库单列表');
    await expectBodyText(ctx, '/api/stock/in/create');
    await expectBodyText(ctx, '/api/open/stock/sync');
    await expectBodyText(ctx, '库存日报');
    await expectBodyText(ctx, '报表统计');
    await t.screenshot('58-agent-rich-knowledge');
  });

  await t.step('需求详情：完整关联资产与富 Markdown 渲染', async () => {
    await goto(ctx, '/project/' + p3.id + '/requirements/' + work.id);
    await expectText(ctx, '.page-title', '创建入库单');
    await expectBodyText(ctx, work.no);
    await expectBodyText(ctx, '仓储系统');
    await expectBodyText(ctx, '入库管理');
    await expectBodyText(ctx, '入库单列表');
    await expectBodyText(ctx, '创建入库单');
    await expectBodyText(ctx, '库存同步');
    await expectBodyText(ctx, '库存日报');
    await expectBodyText(ctx, '仓库管理员');
    await expectBodyText(ctx, '入库流程');
    await expectBodyText(ctx, '测试用例数');
    await expectBodyText(ctx, '0 个');

    const md = page.locator('.md-body');
    await expectVisible(ctx, '.md-body h1', 'Markdown 一级标题');
    await expectVisible(ctx, '.md-body h2', 'Markdown 二级标题');
    await expectVisible(ctx, '.md-body table', 'Markdown 表格');
    await expectVisible(ctx, '.md-body blockquote', 'Markdown 引用');
    await expectVisible(ctx, '.md-body pre', 'Markdown 代码块');
    await expectVisible(ctx, '.md-body a[href="https://example.com/docs"]', 'Markdown 链接');
    await expectVisible(ctx, '.md-body ol li', 'Markdown 有序列表');
    await expectVisible(ctx, '.md-body ul li', 'Markdown 无序列表');
    await expectBodyText(ctx, '嵌套一', 'Markdown 嵌套列表');
    await expectVisible(ctx, '.md-body em', 'Markdown 斜体');
    await expectVisible(ctx, '.md-body code', 'Markdown 行内代码');
    await expectVisible(ctx, '.md-body hr', 'Markdown 分割线');
    await t.screenshot('59-rich-markdown');
  });

  await t.step('初版项目的用例树与系统仓库', async () => {
    await goto(ctx, '/project/' + p3.id + '/test_cases');
    await expectBodyText(ctx, '仓储系统');
    await expectBodyText(ctx, '入库管理');
    await expectBodyText(ctx, '在左侧树中点击一条用例');

    await goto(ctx, '/project/' + p3.id + '/system_repos');
    await expectBodyText(ctx, '共 1 个系统');
    await page.locator('.repo-btn-edit-all').click();
    // 从输入框类名直接解析系统 id（页面结构：repo-url-<system_id>）
    const inputClasses = await page.locator('input.repo-edit').evaluateAll((els) => els.map((el) => el.className));
    const match = inputClasses.map((cls) => cls.match(/repo-url-(\d+)/)).find(Boolean);
    assert.ok(match, '找到系统仓库输入框');
    const id = match[1];

    await page.locator('.repo-url-' + id).fill('https://github.com/pw-demo/stock.git');
    await page.locator('.repo-test-branch-' + id).fill('test');
    await page.locator('.repo-prod-branch-' + id).fill('main');
    await page.locator('.repo-btn-save-all').click();
    await waitToast(ctx, '仓库配置已保存', '保存初版项目仓库');
    await expectBodyText(ctx, 'https://github.com/pw-demo/stock.git');
  });

  await t.step('开放接口读取完整需求资产（含开放接口与定时任务）', async () => {
    const result = await api(ctx, '/api/open/project/' + p3.id + '/requirement/' + work.id + '/assets', {
      anon: true,
      headers: authHeaders,
    });
    const data = assertApiOk(result, '完整需求资产');
    assert.ok(data.assets.systems.some((item) => item.name === '仓储系统'));
    assert.ok(data.assets.open_apis.some((item) => item.name === '库存同步'));
    assert.ok(data.assets.cron_jobs.some((item) => item.name === '库存日报'));
    assert.ok(data.assets.roles.some((item) => item.name === '仓库管理员'));
    const process = data.assets.processes.find((item) => item.name === '入库流程');
    assert.ok(process.nodes.some((node) => node.name === '自动审核' && node.role_name === '系统'));
  });

  await t.step('开放接口推进需求验收，准备发布初版', async () => {
    const headers = authHeaders;

    for (const action of ['start_dev', 'finish_dev', 'finish_review']) {
      const result = await api(ctx, '/api/open/work/requirement/status', {
        method: 'POST',
        anon: true,
        headers,
        data: {
          project_id: p3.id,
          work_id: work.id,
          action,
          feature_branch: action === 'finish_dev' ? 'feature/STOCK-IN' : '',
          code_added: action === 'finish_dev' ? 20 : null,
          code_deleted: action === 'finish_dev' ? 3 : null,
        },
      });
      assertApiOk(result, '初版项目开放接口 ' + action);
    }

    await goto(ctx, '/project/' + p3.id + '/requirements/' + work.id);
    await expectBodyText(ctx, '已验收');
    await expectBodyText(ctx, 'feature/STOCK-IN');
  });

  await t.step('发布初版：版本知识定稿包含完整资产', async () => {
    await goto(ctx, '/project/' + p3.id + '/versions');
    await page.locator('#initial-release-form input[name=version_no]').fill('0.1.0');
    await page.locator('#initial-release-form button[type=submit]').click();
    await expectVisible(ctx, '.modal-mask.open', '发布初版确认');
    await waitReload(ctx, () => confirmPmsModal(ctx), '发布 0.1.0');

    await expectBodyText(ctx, 'v0.1.0');
    await expectBodyText(ctx, '已发布');
    await expectBodyText(ctx, '1/1 已验收');
    await t.screenshot('60-initial-rich-released');

    // 从需求详情的版本下拉取版本 id
    await goto(ctx, '/project/' + p3.id + '/requirements/' + work.id);
    const options = await page.locator('#version-select option').evaluateAll((opts) => opts.map((o) => ({
      value: o.value,
      label: (o.textContent || '').trim(),
    })));
    const found = options.find((item) => item.label.includes('0.1.0'));
    assert.ok(found, '找到 0.1.0 版本：' + JSON.stringify(options));

    ctx.p3ReleaseVersionId = Number(found.value);

    await goto(ctx, '/project/' + p3.id + '/knowledge?version=' + ctx.p3ReleaseVersionId);
    await expectBodyText(ctx, '版本 v0.1.0');
    await expectBodyText(ctx, '已发布 · 知识定稿');
    await page.locator('details summary').click();
    await expectBodyText(ctx, work.no);
    await page.locator('.tabs .tab[data-tab=systems]').click();
    await expectBodyText(ctx, '库存日报');
    await expectBodyText(ctx, '/api/open/stock/sync');

    await goto(ctx, '/project/' + p3.id + '/test_cases?version=' + ctx.p3ReleaseVersionId);
    await expectBodyText(ctx, '已发布定稿内容（只读）');
    await t.screenshot('61-rich-version-frozen');
  });
};
