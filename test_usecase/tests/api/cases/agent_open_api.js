const assert = require('node:assert/strict');

module.exports = [
  {
    name: '单场景助手的提交参数校验',
    expected: '空消息、非法模式、发布后 BUG 缺版本、跨项目版本、非成员项目、初版生产缺陷均返回对应错误',
    run: async ({ request, token, expectError, state }) => {
      const p2 = state.projects.p2;
      const p1 = state.projects.p1;
      const extra = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../../state/extra.json'), 'utf-8'));
      const initialProjectId = extra.project_ids[0];
      const initialTeamId = extra.team_ids[0];
      let hasInitialProject = false;
      if (initialProjectId && initialTeamId) {
        const detail = await request('/api/team_space/' + initialTeamId, { token: token('owner') });
        hasInitialProject = !!(detail.body && detail.body.code === 0 && detail.body.data.projects.some((item) => item.id === initialProjectId));
      }

      expectError(await request('/api/agent/run', {
        method: 'POST', token: token('owner'), body: { project_id: p2.id, mode: 'requirement', message: '   ' },
      }), 'MESSAGE_REQUIRED', '空消息');

      expectError(await request('/api/agent/run', {
        method: 'POST', token: token('owner'), body: { project_id: p2.id, mode: 'invalid_mode', message: 'x' },
      }), 'MODE_INVALID', '非法模式');

      expectError(await request('/api/agent/run', {
        method: 'POST', token: token('owner'), body: { project_id: p2.id, mode: 'dev_bug', message: '测试 BUG' },
      }), 'VERSION_REQUIRED', '发布后 BUG 缺版本');

      expectError(await request('/api/agent/run', {
        method: 'POST', token: token('owner'), body: { project_id: p1.id, mode: 'requirement', version_id: state.p2.versions.v100.id, message: '跨项目版本' },
      }), 'VERSION_NOT_FOUND', '版本与项目不匹配');

      expectError(await request('/api/agent/run', {
        method: 'POST', token: token('owner'), body: { project_id: state.projects.p4.id, mode: 'requirement', message: 'x' },
      }), 'NOT_TEAM_SPACE_MEMBER', '非成员项目');

      if (hasInitialProject) {
        expectError(await request('/api/agent/run', {
          method: 'POST', token: token('owner'), body: { project_id: initialProjectId, mode: 'prod_defect', message: '初版缺陷' },
        }), 'PROD_DEFECT_NOT_ALLOWED', '初版提交生产缺陷');
      }
    },
  },
  {
    name: '大而全助手消息与确认的校验',
    expected: '空消息、非法项目、确认/放弃不存在的会话均返回对应错误',
    run: async ({ request, token, expectError, state }) => {
      const p2 = state.projects.p2;
      const p1 = state.projects.p1;

      expectError(await request('/api/agent/session/message', {
        method: 'POST', token: token('owner'), body: { project_id: p2.id, message: '  ' },
      }), 'MESSAGE_REQUIRED', '会话空消息');

      expectError(await request('/api/agent/session/message', {
        method: 'POST', token: token('owner'), body: { project_id: 999999999, message: 'x' },
      }), 'PROJECT_NOT_FOUND', '会话不存在项目');

      expectError(await request('/api/agent/session/message', {
        method: 'POST', token: token('owner'), body: { project_id: state.projects.p4.id, message: 'x' },
      }), 'NOT_TEAM_SPACE_MEMBER', '会话非成员项目');

      expectError(await request('/api/agent/session/999999999/confirm', {
        method: 'POST', token: token('owner'), body: { project_id: p2.id },
      }), 'SESSION_NOT_FOUND', '确认不存在会话');

      expectError(await request('/api/agent/session/999999999/abandon', {
        method: 'POST', token: token('owner'), body: { project_id: p2.id },
      }), 'SESSION_NOT_FOUND', '放弃不存在会话');

      expectError(await request('/api/agent/session/' + state.p2.sessions.confirmed.id + '/confirm', {
        method: 'POST', token: token('owner'), body: { project_id: p1.id },
      }), 'SESSION_NOT_FOUND', '会话与项目不匹配');
    },
  },
  {
    name: '开放接口 Key 鉴权与 CORS',
    expected: '缺失/错误前缀/未知 Key 返回 API_KEY_INVALID；Bearer 与 X-Api-Key 均可用；预检返回 204 与 CORS 头',
    run: async ({ request, expectOk, expectError, state }) => {
      const token = state.api_key.token;

      expectError(await request('/api/open/projects'), 'API_KEY_INVALID', '无 Key');
      expectError(await request('/api/open/projects', { headers: { Authorization: 'Bearer abc' } }), 'API_KEY_INVALID', '非法前缀');
      expectError(await request('/api/open/projects', { headers: { 'X-Api-Key': 'pms_unknown' } }), 'API_KEY_INVALID', '未知 Key');

      const bearer = expectOk(await request('/api/open/projects', { headers: { Authorization: 'Bearer ' + token } }), 'Bearer');
      const header = expectOk(await request('/api/open/projects', { headers: { 'X-Api-Key': token } }), 'X-Api-Key');
      assert.deepEqual(bearer.map((item) => item.id).sort(), header.map((item) => item.id).sort());

      const preflight = await fetch((process.env.BASE_URL || 'http://127.0.0.1') + '/api/open/projects', {
        method: 'OPTIONS',
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
      assert.ok((preflight.headers.get('access-control-allow-methods') || '').includes('POST'));
    },
  },
  {
    name: '开放接口项目查询与权限',
    expected: '项目列表只含成员项目；系统、版本、知识查询对不存在的项目和越权项目返回对应错误',
    run: async ({ request, expectOk, expectError, state }) => {
      const headers = { Authorization: 'Bearer ' + state.api_key.token };
      const p2 = state.projects.p2;
      const p4 = state.projects.p4;

      const projects = expectOk(await request('/api/open/projects', { headers }), '项目列表');
      const ids = projects.map((item) => item.id);
      assert.ok(ids.includes(p2.id));
      assert.ok(!ids.includes(p4.id));

      expectError(await request('/api/open/project/999999999/systems', { headers }), 'PROJECT_NOT_FOUND', '不存在项目系统');
      expectError(await request('/api/open/project/' + p4.id + '/systems', { headers }), 'NOT_TEAM_SPACE_MEMBER', '越权项目系统');

      const versions = expectOk(await request('/api/open/project/' + p2.id + '/unreleased_versions', { headers }), '未发布版本');
      assert.equal(versions.state, 'released');
      assert.ok(Array.isArray(versions.versions));

      expectError(await request('/api/open/project/' + p2.id + '/knowledge_versions', { headers: {} }), 'API_KEY_INVALID', '知识版本无 Key');
    },
  },
  {
    name: '开放接口待开发需求与资产查询校验',
    expected: '版本/系统参数缺失、非法或跨项目均返回对应错误；需求资产按项目隔离',
    run: async ({ request, expectOk, expectError, state }) => {
      const headers = { Authorization: 'Bearer ' + state.api_key.token };
      const p2 = state.projects.p2;
      const p1 = state.projects.p1;
      const base = '/api/open/project/' + p2.id + '/requirements/todo';

      expectError(await request(base, { headers }), 'VERSION_ID_REQUIRED', '缺版本');
      expectError(await request(base + '?version_id=999999999', { headers }), 'VERSION_NOT_FOUND', '非法版本');
      expectError(await request(base + '?version_id=' + state.p2.versions.v100.id + '&system_id=' + state.p1.systems.main.id, { headers }),
        'SYSTEM_NOT_FOUND', '跨项目系统');

      const todo = expectOk(await request(base + '?version_id=' + state.p2.versions.v100.id, { headers }), '已发布版本待开发需求');
      assert.equal(todo.stage, 'released');
      assert.equal(todo.version_label, 'v1.0.0');

      expectError(await request('/api/open/project/' + p2.id + '/requirement/' + state.p1.requirements.new.id + '/assets', { headers }),
        'WORK_NOT_FOUND', '跨项目需求资产');
      expectError(await request('/api/open/project/' + p2.id + '/requirement/999999999/assets', { headers }),
        'WORK_NOT_FOUND', '不存在需求资产');

      const assets = expectOk(await request('/api/open/project/' + p2.id + '/requirement/' + state.p2.requirements.accepted.id + '/assets', { headers }),
        '需求资产');
      assert.ok(assets.assets);
    },
  },
  {
    name: '开放接口知识视图校验',
    expected: '已发布项目必须传版本；非法版本与跨项目系统返回错误；初版项目返回 live 知识',
    run: async ({ request, expectError, expectOk, state }) => {
      const headers = { Authorization: 'Bearer ' + state.api_key.token };
      const p2 = state.projects.p2;
      const p1 = state.projects.p1;
      const base = '/api/open/project/' + p2.id + '/knowledge';

      expectError(await request(base, { headers }), 'VERSION_ID_REQUIRED', '已发布项目缺版本');
      expectError(await request(base + '?version_id=999999999', { headers }), 'VERSION_NOT_FOUND', '非法版本知识');
      expectError(await request(base + '?version_id=' + state.p2.versions.v100.id + '&system_id=' + state.p1.systems.main.id, { headers }),
        'SYSTEM_NOT_FOUND', '跨项目系统知识');

      const knowledge = expectOk(await request(base + '?version_id=' + state.p2.versions.v100.id, { headers }), '版本知识');
      assert.equal(knowledge.source, 'snapshot');
      assert.ok(Array.isArray(knowledge.knowledge.systems));

      const extra = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../../state/extra.json'), 'utf-8'));
      const initialId = extra.project_ids[0];
      const initialTeamId = extra.team_ids[0];
      let hasInitialProject = false;
      if (initialId && initialTeamId) {
        const detail = await request('/api/team_space/' + initialTeamId, { headers });
        hasInitialProject = !!(detail.body && detail.body.code === 0 && detail.body.data.projects.some((item) => item.id === initialId));
      }
      if (hasInitialProject) {
        const initial = expectOk(await request('/api/open/project/' + initialId + '/knowledge', { headers }), '初版知识');
        assert.equal(initial.source, 'live');
        assert.equal(initial.stage, 'initial');
      }
    },
  },
  {
    name: '大而全助手方案：资产与工作项更新/删除',
    expected: '确认方案时更新既有角色/流程/系统/需求，删除角色、流程节点、模块与待开发生产缺陷，并记录删除结果',
    run: async ({ request, token, expectOk, php, state }) => {
      const output = JSON.parse(php('session_ops_plan.php'));
      assert.ok(output.session_id > 0, '创建更新删除方案会话');

      const result = expectOk(await request('/api/agent/session/' + output.session_id + '/confirm', {
        method: 'POST',
        token: token('owner'),
        body: { project_id: state.projects.p3.id },
      }), '确认更新删除方案');

      assert.ok(result.assets.role.updated >= 1, '角色更新统计');
      assert.ok(result.assets.role.deleted >= 1, '角色删除统计');
      assert.ok(result.assets.process.updated >= 1, '流程更新统计');
      assert.ok(result.assets.system.updated >= 1, '系统更新统计');

      const updatedWork = result.works.find((item) => item.work_type === 'requirement');
      assert.equal(updatedWork.action, 'updated', '需求更新结果');
      const deletedWork = result.works.find((item) => item.work_type === 'prod_defect');
      assert.equal(deletedWork.action, 'deleted', '生产缺陷删除结果');
      assert.ok(result.skipped.some((item) => item.includes('不存在的角色')), '未找到的删除项进入 skipped');
    },
  },
  {
    name: '开放接口：未发布版本知识实时合成',
    expected: '草稿版本知识返回 dynamic 与版本信息；未发布版本列表包含该版本；待开发需求为空',
    run: async ({ request, token, expectOk, state }) => {
      const headers = { Authorization: 'Bearer ' + state.api_key.token };
      const p2 = state.projects.p2;
      const versionNo = '9.9.3-api-' + Date.now();
      const version = expectOk(await request('/api/project/' + p2.id + '/version/create', {
        method: 'POST',
        token: token('owner'),
        body: { version_no: versionNo, description: '动态知识校验' },
      }), '创建动态知识版本');

      const unreleased = expectOk(await request('/api/open/project/' + p2.id + '/unreleased_versions', { headers }), '未发布版本列表');
      assert.ok(unreleased.versions.some((item) => item.id === version.id), '未发布列表应包含草稿版本');

      const knowledge = expectOk(await request('/api/open/project/' + p2.id + '/knowledge?version_id=' + version.id, { headers }), '草稿版本知识');
      assert.equal(knowledge.source, 'dynamic');
      assert.equal(knowledge.version.status, 'draft');
      assert.equal(knowledge.version.frozen, false);
      assert.ok(Array.isArray(knowledge.knowledge.systems));

      const filtered = expectOk(await request('/api/open/project/' + p2.id + '/knowledge?version_id=' + version.id + '&system_id=' + state.p2.systems.main.id, { headers }), '草稿版本按系统过滤');
      assert.ok(Array.isArray(filtered.knowledge.systems));

      const todo = expectOk(await request('/api/open/project/' + p2.id + '/requirements/todo?version_id=' + version.id, { headers }), '草稿版本待开发需求');
      assert.equal(todo.version_label, 'v' + versionNo);
      assert.deepEqual(todo.requirements, []);
    },
  },
  {
    name: '开放接口按仓库定位',
    expected: '空仓库地址返回 REPO_URL_REQUIRED；未配置地址返回 REPO_SCOPE_NOT_FOUND；已配置地址返回项目与系统',
    run: async ({ request, expectOk, expectError, state }) => {
      const headers = { Authorization: 'Bearer ' + state.api_key.token };

      expectError(await request('/api/open/dev/resolve_repo', {
        method: 'POST', headers, body: {},
      }), 'REPO_URL_REQUIRED', '空仓库地址');

      expectError(await request('/api/open/dev/resolve_repo', {
        method: 'POST', headers, body: { repo_url: 'https://github.com/not-configured/unknown.git' },
      }), 'REPO_SCOPE_NOT_FOUND', '未配置仓库');

      const scope = expectOk(await request('/api/open/dev/resolve_repo', {
        method: 'POST', headers, body: { repo_url: state.p2.repo.url },
      }), '已配置仓库');
      assert.equal(scope.project_id, state.projects.p2.id);
      assert.equal(scope.system_id, state.p2.systems.main.id);
    },
  },
  {
    name: '开放接口助手提交参数校验',
    expected: '缺项目、空消息、生产缺陷带版本、发布后 BUG 缺版本均返回对应错误',
    run: async ({ request, expectError, state }) => {
      const headers = { Authorization: 'Bearer ' + state.api_key.token };
      const p2 = state.projects.p2;

      expectError(await request('/api/open/agent/requirement', {
        method: 'POST', headers, body: { message: 'x' },
      }), 'PROJECT_REQUIRED', '缺项目');

      expectError(await request('/api/open/agent/requirement', {
        method: 'POST', headers, body: { project_id: p2.id, message: '  ' },
      }), 'MESSAGE_REQUIRED', '空消息');

      expectError(await request('/api/open/agent/prod_defect', {
        method: 'POST', headers, body: { project_id: p2.id, message: 'x', version_id: state.p2.versions.v100.id },
      }), 'PROD_DEFECT_VERSION_NOT_ALLOWED', '生产缺陷带版本');

      expectError(await request('/api/open/agent/dev_bug', {
        method: 'POST', headers, body: { project_id: p2.id, message: 'x' },
      }), 'VERSION_REQUIRED', '开发 BUG 缺版本');
    },
  },
];
