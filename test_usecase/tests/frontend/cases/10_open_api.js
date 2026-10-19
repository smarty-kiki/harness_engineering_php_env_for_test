const {
  assert, goto, expectBodyText, api, assertApiOk, assertApiError, pauseQueue,
  requestRunSimulation,
} = require('../lib/core');

/**
 * 开放接口（/api/open/*）：Key 鉴权、项目/版本/系统/需求/资产/知识查询、
 * 仓库定位、工作项状态流转、助手任务提交（模拟执行，不调用真实模型）。
 */
module.exports = async function openApi(ctx) {
  const { state, t } = ctx;
  const p1 = state.projects.p1;
  const p2 = state.projects.p2;
  const p3 = state.projects.p3;
  const p4 = state.projects.p4;
  const w = state.p2;
  const token = state.api_key.token;

  const headers = { Authorization: 'Bearer ' + token };

  async function open(path, options = {}) {
    return api(ctx, path, { ...options, anon: true, headers: { ...headers, ...(options.headers || {}) } });
  }

  let v120 = 0;

  await t.step('开放接口鉴权：缺失 / 非法 / 两种请求头', async () => {
    const none = await api(ctx, '/api/open/projects', { anon: true });
    assertApiError(none, 'API_KEY_INVALID', '无 Key');

    const badPrefix = await api(ctx, '/api/open/projects', {
      anon: true,
      headers: { Authorization: 'Bearer abc' },
    });
    assertApiError(badPrefix, 'API_KEY_INVALID', '非法前缀');

    const unknown = await api(ctx, '/api/open/projects', {
      anon: true,
      headers: { 'X-Api-Key': 'pms_unknown_token' },
    });
    assertApiError(unknown, 'API_KEY_INVALID', '未知 Key');

    const bearer = await open('/api/open/projects');
    assertApiOk(bearer, 'Bearer Key');

    const xApiKey = await api(ctx, '/api/open/projects', { anon: true, headers: { 'X-Api-Key': token } });
    assertApiOk(xApiKey, 'X-Api-Key');

    // CORS 预检
    const optionsResp = await ctx.anonContext.request.fetch(ctx.baseUrl + '/api/open/projects', {
      method: 'OPTIONS',
      failOnStatusCode: false,
    });
    assert.equal(optionsResp.status(), 204, 'OPTIONS 预检');
    assert.equal(optionsResp.headers()['access-control-allow-origin'], '*');
    assert.ok((optionsResp.headers()['access-control-allow-methods'] || '').includes('POST'));
  });

  await t.step('开放接口：项目列表', async () => {
    const result = assertApiOk(await open('/api/open/projects'), '项目列表');
    assert.ok(Array.isArray(result), '项目列表应为数组');
    const ids = result.map((item) => item.id);
    assert.ok(ids.includes(p1.id) && ids.includes(p2.id) && ids.includes(p3.id), '包含团队 A 的全部项目');
    assert.ok(!ids.includes(p4.id), '不包含未加入团队的项目');
    const p2row = result.find((item) => item.id === p2.id);
    assert.equal(p2row.team_space_id, state.teams.a.id);
    assert.equal(p2row.team_name, state.teams.a.name);
  });

  await t.step('准备未发布版本 1.2.0 并把池工作项指派进去', async () => {
    const created = await api(ctx, '/api/project/' + p2.id + '/version/create', {
      method: 'POST',
      data: { version_no: '1.2.0', description: '开放接口测试版本' },
    });
    const data = assertApiOk(created, '创建 1.2.0');
    v120 = data.id;
    ctx.p2DraftVersionId = v120;

    for (const [type, id] of [
      ['requirement', w.requirements.pool.id],
      ['bug', w.bugs.pool.id],
      ['prod_defect', w.prod_defects.pool.id],
    ]) {
      const assigned = await api(ctx, '/api/project/' + p2.id + '/version/' + v120 + '/assign', {
        method: 'POST',
        data: { work_type: type, work_id: id },
      });
      assertApiOk(assigned, '指派 ' + type);
    }
  });

  await t.step('开放接口：未发布版本列表', async () => {
    const result = assertApiOk(await open('/api/open/project/' + p2.id + '/unreleased_versions'), '未发布版本');
    assert.equal(result.state, 'released');
    assert.equal(result.versions.length, 1, '仅 1 个未发布版本');
    assert.equal(result.versions[0].id, v120);
    assert.equal(result.versions[0].version_no, '1.2.0');
    assert.equal(result.versions[0].status, 'draft');

    const initial = assertApiOk(await open('/api/open/project/' + p3.id + '/unreleased_versions'), '初版项目版本');
    assert.equal(initial.state, 'initial');
    assert.deepEqual(initial.versions, []);

    assertApiError(await open('/api/open/project/999999999/unreleased_versions'), 'PROJECT_NOT_FOUND', '项目不存在');
    assertApiError(await open('/api/open/project/' + p4.id + '/unreleased_versions'), 'NOT_TEAM_SPACE_MEMBER', '非成员项目');
  });

  await t.step('开放接口：项目系统（含仓库配置）', async () => {
    const systems = assertApiOk(await open('/api/open/project/' + p2.id + '/systems'), '项目系统');
    assert.equal(systems.length, 2);
    const main = systems.find((item) => item.id === w.systems.main.id);
    assert.equal(main.repo_url, 'https://github.com/pw-demo/admin.git');
    assert.equal(main.prod_branch, 'main');
    assert.equal(main.platform, 'web');

    const empty = assertApiOk(await open('/api/open/project/' + p3.id + '/systems'), '空项目系统');
    assert.deepEqual(empty, []);

    assertApiError(await open('/api/open/project/0/systems'), 'PROJECT_REQUIRED', '项目 ID 缺失');
    assertApiError(await open('/api/open/project/' + p4.id + '/systems'), 'NOT_TEAM_SPACE_MEMBER', '非成员项目');
  });

  await t.step('开放接口：待开发需求（版本 / 系统过滤与校验）', async () => {
    const todo = assertApiOk(await open('/api/open/project/' + p2.id + '/requirements/todo?version_id=' + v120), '待开发需求');
    assert.equal(todo.stage, 'released');
    assert.equal(todo.version_label, 'v1.2.0');
    assert.equal(todo.requirements.length, 1, 'v1.2.0 待开发需求 1 条');
    assert.equal(todo.requirements[0].id, w.requirements.pool.id);
    assert.equal(todo.requirements[0].system_name, w.systems.main.name);

    const filtered = assertApiOk(await open('/api/open/project/' + p2.id + '/requirements/todo?version_id=' + v120 + '&system_id=' + w.systems.main.id), '按系统过滤');
    assert.equal(filtered.requirements.length, 1);

    const filteredOut = assertApiOk(await open('/api/open/project/' + p2.id + '/requirements/todo?version_id=' + v120 + '&system_id=' + w.systems.open.id), '按无关联系统过滤');
    assert.equal(filteredOut.requirements.length, 0);

    assertApiError(await open('/api/open/project/' + p2.id + '/requirements/todo?version_id=' + v120 + '&system_id=999999999'), 'SYSTEM_NOT_FOUND', '系统不存在');
    assertApiError(await open('/api/open/project/' + p2.id + '/requirements/todo?version_id=' + v120 + '&system_id=' + state.p1.systems.main.id), 'SYSTEM_NOT_FOUND', '跨项目系统');

    assertApiError(await open('/api/open/project/' + p2.id + '/requirements/todo'), 'VERSION_ID_REQUIRED', '已发布项目缺版本');
    assertApiError(await open('/api/open/project/' + p2.id + '/requirements/todo?version_id=999999999'), 'VERSION_NOT_FOUND', '版本不存在');
    assertApiError(await open('/api/open/project/' + p2.id + '/requirements/todo?version_id=' + ctx.p1ReleaseVersionId), 'VERSION_NOT_FOUND', '跨项目版本');

    const initial = assertApiOk(await open('/api/open/project/' + p3.id + '/requirements/todo'), '初版项目待开发需求');
    assert.equal(initial.stage, 'initial');
    assert.equal(initial.version_id, null);
    assert.equal(initial.version_label, '初版');
    assert.deepEqual(initial.requirements, []);

    assertApiError(await open('/api/open/project/' + p3.id + '/requirements/todo?version_id=1'), 'VERSION_NOT_FOUND', '初版项目传版本');
  });

  await t.step('开放接口：需求关联资产明细', async () => {
    const result = assertApiOk(await open('/api/open/project/' + p2.id + '/requirement/' + w.requirements.pool.id + '/assets'), '需求关联资产');
    assert.equal(result.work.id, w.requirements.pool.id);
    assert.ok(result.assets.systems.some((item) => item.name === w.systems.main.name));
    assert.ok(result.assets.modules.some((item) => item.name === w.modules.user.name));
    assert.ok(result.assets.pages.some((item) => item.route === '/admin/users'));
    assert.ok(result.assets.server_apis.some((item) => item.path === '/api/admin/user/list'));
    assert.ok(result.assets.processes.length >= 1);
    const process = result.assets.processes[0];
    assert.ok(process.nodes.some((node) => node.linked === true), '流程节点带直接关联标记');

    assertApiError(await open('/api/open/project/' + p2.id + '/requirement/999999999/assets'), 'WORK_NOT_FOUND', '工作项不存在');
    assertApiError(await open('/api/open/project/' + p2.id + '/requirement/' + state.p1.requirements.new.id + '/assets'), 'WORK_NOT_FOUND', '跨项目工作项');
    assertApiError(await open('/api/open/project/' + p4.id + '/requirement/' + w.requirements.pool.id + '/assets'), 'NOT_TEAM_SPACE_MEMBER', '非成员项目');
  });

  await t.step('开放接口：版本知识列表与知识视图', async () => {
    const versions = assertApiOk(await open('/api/open/project/' + p2.id + '/knowledge_versions'), '版本知识列表');
    assert.equal(versions.state, 'released');
    const v100row = versions.versions.find((item) => item.id === w.versions.v100.id);
    const v110row = versions.versions.find((item) => item.id === w.versions.v110.id);
    const v120row = versions.versions.find((item) => item.id === v120);
    assert.equal(v100row.frozen, true);
    assert.equal(v110row.frozen, true);
    assert.equal(v120row.frozen, false);

    const initialVersions = assertApiOk(await open('/api/open/project/' + p3.id + '/knowledge_versions'), '初版知识版本');
    assert.equal(initialVersions.state, 'initial');
    assert.deepEqual(initialVersions.versions, []);

    const snapshot = assertApiOk(await open('/api/open/project/' + p2.id + '/knowledge?version_id=' + w.versions.v100.id), 'v1.0.0 知识');
    assert.equal(snapshot.source, 'snapshot');
    assert.equal(snapshot.version.version_no, '1.0.0');
    assert.ok(snapshot.knowledge.systems.some((item) => item.name === w.systems.main.name));

    const dynamic = assertApiOk(await open('/api/open/project/' + p2.id + '/knowledge?version_id=' + v120), 'v1.2.0 知识');
    assert.equal(dynamic.source, 'dynamic');
    assert.equal(dynamic.version.status, 'draft');

    const filtered = assertApiOk(await open('/api/open/project/' + p2.id + '/knowledge?version_id=' + v120 + '&system_id=' + w.systems.main.id), '知识按系统过滤');
    assert.equal(filtered.knowledge.systems.length, 1);

    const live = assertApiOk(await open('/api/open/project/' + p3.id + '/knowledge'), '初版实时知识');
    assert.equal(live.stage, 'initial');
    assert.equal(live.source, 'live');
    assert.equal(live.version, null);

    assertApiError(await open('/api/open/project/' + p2.id + '/knowledge'), 'VERSION_ID_REQUIRED', '已发布项目缺版本');
    assertApiError(await open('/api/open/project/' + p2.id + '/knowledge?version_id=999999999'), 'VERSION_NOT_FOUND', '版本不存在');
    assertApiError(await open('/api/open/project/' + p3.id + '/knowledge?version_id=1'), 'VERSION_NOT_FOUND', '初版项目传版本');
    assertApiError(await open('/api/open/project/' + p2.id + '/knowledge?version_id=' + v120 + '&system_id=999999999'), 'SYSTEM_NOT_FOUND', '知识系统不存在');
  });

  await t.step('开放接口：按仓库地址定位项目与系统', async () => {
    const variants = [
      'git@github.com:pw-demo/admin.git',
      'https://github.com/pw-demo/admin',
      'ssh://github.com/pw-demo/admin.git',
      'http://github.com/pw-demo/admin.git',
    ];

    for (const repo of variants) {
      const scope = assertApiOk(await open('/api/open/dev/resolve_repo', { method: 'POST', data: { repo_url: repo } }), '定位仓库 ' + repo);
      assert.equal(scope.project_id, p2.id);
      assert.equal(scope.system_id, w.systems.main.id);
      assert.equal(scope.prod_branch, 'main');
    }

    const store = assertApiOk(await open('/api/open/dev/resolve_repo', {
      method: 'POST',
      data: { repo_url: 'https://github.com/pw-demo/store.git' },
    }), '定位初版项目仓库');
    assert.equal(store.project_id, p1.id);

    assertApiError(await open('/api/open/dev/resolve_repo', { method: 'POST', data: { repo_url: '' } }), 'REPO_URL_REQUIRED', '空仓库地址');
    assertApiError(await open('/api/open/dev/resolve_repo', { method: 'POST', data: { repo_url: 'https://github.com/none/none.git' } }), 'REPO_SCOPE_NOT_FOUND', '未配置仓库');
  });

  await t.step('开放接口：工作项状态流转（未入版本校验）', async () => {
    const notInVersion = await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: state.p1.requirements.new.id, action: 'start_dev' },
    });
    assertApiError(notInVersion, 'WORK_NOT_FOUND', '跨项目工作项');

    // r2_pool 已入 v1.2.0，先验证另一条未入版本的池草稿——需求池已清空，这里用错误参数路径
    assertApiError(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, action: 'start_dev' },
    }), 'WORK_IDENTIFIER_REQUIRED', '缺少工作项标识');

    assertApiError(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.requirements.pool.id, work_no: w.requirements.new.no, action: 'start_dev' },
    }), 'WORK_NOT_FOUND', 'id 与编号不一致');

    assertApiError(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_no: 'REQ-9999999', action: 'start_dev' },
    }), 'WORK_NOT_FOUND', '编号不存在');

    assertApiError(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p4.id, work_id: w.requirements.pool.id, action: 'start_dev' },
    }), 'NOT_TEAM_SPACE_MEMBER', '非成员项目');
  });

  await t.step('开放接口：需求完成开发的上报参数校验与成功流转', async () => {
    const invalidAction = await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.requirements.pool.id, action: 'unknown' },
    });
    assertApiError(invalidAction, 'STATUS_ACTION_INVALID', '非法动作');

    const started = assertApiOk(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.requirements.pool.id, action: 'start_dev' },
    }), '开始开发');
    assert.equal(started.status, 'developing');

    const negative = await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.requirements.pool.id, action: 'finish_dev', code_added: -1, code_deleted: 0 },
    });
    assertApiError(negative, 'CODE_STAT_INVALID', '负数代码行');

    const notNumeric = await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.requirements.pool.id, action: 'finish_dev', code_added: 'abc' },
    });
    assertApiError(notNumeric, 'CODE_STAT_INVALID', '非数字代码行');

    const longBranch = await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.requirements.pool.id, action: 'finish_dev', feature_branch: 'b'.repeat(256) },
    });
    assertApiError(longBranch, 'REPO_BRANCH_TOO_LONG', '分支过长');

    const longRepo = await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.requirements.pool.id, action: 'finish_dev', repo_url: 'x'.repeat(256) },
    });
    assertApiError(longRepo, 'REPO_URL_TOO_LONG', '仓库地址过长');

    const finished = assertApiOk(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: {
        project_id: p2.id,
        work_no: w.requirements.pool.no,
        action: 'finish_dev',
        feature_branch: 'feature/REQ-POOL',
        code_added: 88,
        code_deleted: 12,
        repo_url: 'git@github.com:pw-demo/admin.git',
      },
    }), '完成开发并上报');
    assert.equal(finished.status, 'to_review');

    const accepted = assertApiOk(await open('/api/open/work/requirement/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.requirements.pool.id, action: 'finish_review' },
    }), '完成验收');
    assert.equal(accepted.status, 'accepted');
  });

  await t.step('开放接口：开发 BUG / 生产缺陷状态流转', async () => {
    const bugStart = assertApiOk(await open('/api/open/work/dev_bug/status', {
      method: 'POST',
      data: { project_id: p2.id, work_no: w.bugs.pool.no, action: 'start_dev' },
    }), 'BUG 开始开发');
    assert.equal(bugStart.status, 'developing');

    assertApiError(await open('/api/open/work/dev_bug/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.bugs.pool.id, action: 'finish_review' },
    }), 'STATUS_ACTION_INVALID', 'BUG 跳过完成开发');

    assertApiOk(await open('/api/open/work/dev_bug/status', {
      method: 'POST',
      data: { project_id: p2.id, work_no: w.bugs.pool.no, action: 'finish_dev' },
    }), 'BUG 完成开发');

    const bugAccepted = assertApiOk(await open('/api/open/work/dev_bug/status', {
      method: 'POST',
      data: { project_id: p2.id, work_no: w.bugs.pool.no, action: 'finish_review' },
    }), 'BUG 完成验收');
    assert.equal(bugAccepted.status, 'accepted');

    assertApiOk(await open('/api/open/work/prod_defect/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.prod_defects.pool.id, action: 'start_dev' },
    }), '生产缺陷开始开发');
    assertApiOk(await open('/api/open/work/prod_defect/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.prod_defects.pool.id, action: 'finish_dev' },
    }), '生产缺陷完成开发');
    const defectAccepted = assertApiOk(await open('/api/open/work/prod_defect/status', {
      method: 'POST',
      data: { project_id: p2.id, work_id: w.prod_defects.pool.id, action: 'finish_review' },
    }), '生产缺陷完成验收');
    assert.equal(defectAccepted.status, 'accepted');
  });

  await t.step('开放接口：需求状态上报结果在详情页体现', async () => {
    await goto(ctx, '/project/' + p2.id + '/requirements/' + w.requirements.pool.id);
    await expectBodyText(ctx, w.requirements.pool.title);
    await expectBodyText(ctx, '已验收');
    await expectBodyText(ctx, 'feature/REQ-POOL');
    await expectBodyText(ctx, '+88');
    await expectBodyText(ctx, '-12');
    await expectBodyText(ctx, 'https://github.com/pw-demo/admin.git');
    await expectBodyText(ctx, '开放接口');
  });

  await t.step('开放接口：助手任务提交（队列暂停 + 模拟执行）', async () => {
    await pauseQueue(120);

    const cases = [
      { mode: 'requirement', project: p2.id, data: { project_id: p2.id, message: '开放接口提交需求', version_no: '1.2.0' } },
      { mode: 'dev_bug', project: p2.id, data: { project_id: p2.id, message: '开放接口提交 BUG', version_id: v120 } },
      { mode: 'prod_defect', project: p2.id, data: { project_id: p2.id, message: '开放接口提交生产缺陷' } },
      { mode: 'requirement', project: p3.id, data: { project_id: p3.id, message: '初版项目通过开放接口提交需求' } },
    ];

    for (const item of cases) {
      const result = await open('/api/open/agent/' + item.mode, { method: 'POST', data: item.data });
      const data = assertApiOk(result, '开放接口提交 ' + item.mode + '（项目 ' + item.project + '）');
      assert.ok(data.run_id > 0, '返回任务 id');
      requestRunSimulation(data.run_id, 'done');
    }

    // 参数校验
    assertApiError(await open('/api/open/agent/requirement', { method: 'POST', data: { project_id: 0, message: 'x' } }), 'PROJECT_REQUIRED', '缺项目');
    assertApiError(await open('/api/open/agent/requirement', { method: 'POST', data: { project_id: p4.id, message: 'x' } }), 'NOT_TEAM_SPACE_MEMBER', '非成员项目');
    assertApiError(await open('/api/open/agent/dev_bug', { method: 'POST', data: { project_id: p2.id, message: 'x' } }), 'VERSION_REQUIRED', '已发布项目 BUG 缺版本');
    assertApiError(await open('/api/open/agent/prod_defect', { method: 'POST', data: { project_id: p2.id, message: 'x', version_id: v120 } }), 'PROD_DEFECT_VERSION_NOT_ALLOWED', '生产缺陷指定版本');
    assertApiError(await open('/api/open/agent/prod_defect', { method: 'POST', data: { project_id: p3.id, message: 'x' } }), 'PROD_DEFECT_NOT_ALLOWED', '初版项目生产缺陷');
    assertApiError(await open('/api/open/agent/requirement', { method: 'POST', data: { project_id: p2.id, message: 'x', version_no: '9.9.9' } }), 'VERSION_NOT_FOUND', '版本号不存在');
    assertApiError(await open('/api/open/agent/requirement', { method: 'POST', data: { project_id: p2.id, message: 'x', version_id: v120, version_no: '1.0.0' } }), 'VERSION_NOT_FOUND', '版本 id 与编号不一致');
    assertApiError(await open('/api/open/agent/requirement', { method: 'POST', data: { project_id: p2.id, message: '' } }), 'MESSAGE_REQUIRED', '空消息');
  });

  await t.step('开放接口：知识版本在状态流转后实时合成', async () => {
    const dynamic = assertApiOk(await open('/api/open/project/' + p2.id + '/knowledge?version_id=' + v120), 'v1.2.0 实时知识');
    assert.equal(dynamic.source, 'dynamic');
    assert.ok(dynamic.knowledge.roles.some((item) => item.name === '产品经理'));
    assert.ok(dynamic.knowledge.systems.some((item) => item.name === w.systems.main.name));
  });
};
