const assert = require('node:assert/strict');

const NONCE = String(Date.now()).slice(-6);

module.exports = [
  {
    name: '用例弹窗选项与系统归属校验',
    expected: '非法 / 跨项目系统返回 SYSTEM_NOT_FOUND；合法系统返回模块列表',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const p2 = state.projects.p2;
      const base = '/api/project/' + p2.id + '/test_case/options';

      for (const systemId of [0, 999999999, state.p1.systems.main.id]) {
        expectError(await request(base + '?system_id=' + systemId, { token: token('owner') }),
          'SYSTEM_NOT_FOUND', '选项系统 ' + systemId);
      }

      const data = expectOk(await request(base + '?system_id=' + state.p2.systems.main.id, { token: token('owner') }), '合法系统选项');
      assert.ok(Array.isArray(data.modules) && data.modules.length >= 2);
      assert.ok(data.modules.some((item) => item.id === state.p2.modules.user.id));
    },
  },
  {
    name: '用例弹窗按模块返回资产',
    expected: '合法 module_id 返回该模块的页面 / 接口 / 开放接口 / 定时任务资产',
    run: async ({ request, token, expectOk, state }) => {
      const url = '/api/project/' + state.projects.p2.id + '/test_case/options'
        + '?system_id=' + state.p2.systems.main.id
        + '&module_id=' + state.p2.modules.user.id;

      const data = expectOk(await request(url, { token: token('owner') }), '合法模块选项');
      assert.ok(Array.isArray(data.assets.page));
      assert.ok(Array.isArray(data.assets.server_api));
    },
  },
  {
    name: '用例详情与跨项目隔离',
    expected: '跨项目、不存在、已软删的用例均返回 TEST_CASE_NOT_FOUND',
    run: async ({ request, token, expectError, state }) => {
      const p2 = state.projects.p2;
      expectError(await request('/api/project/' + p2.id + '/test_case/' + state.p1.test_cases.rich.id + '/detail', {
        token: token('owner'),
      }), 'TEST_CASE_NOT_FOUND', '跨项目用例详情');

      expectError(await request('/api/project/' + p2.id + '/test_case/999999999/detail', {
        token: token('owner'),
      }), 'TEST_CASE_NOT_FOUND', '不存在用例详情');

      expectError(await request('/api/project/' + p2.id + '/test_case/' + state.p2.test_cases.deleted.id + '/detail', {
        token: token('owner'),
      }), 'TEST_CASE_NOT_FOUND', '已软删用例详情');
    },
  },
  {
    name: '用例新增的参数校验',
    expected: '名称、系统、模块、版本、关联资产与测试点分别校验并返回对应错误',
    run: async ({ request, token, expectError, state }) => {
      const p2 = state.projects.p2;
      const url = '/api/project/' + p2.id + '/test_case/create';
      const base = {
        system_id: state.p2.systems.main.id,
        module_id: state.p2.modules.user.id,
        name: 'API 校验用例',
        points: [],
        assets: [],
      };

      expectError(await request(url, { method: 'POST', token: token('owner'), body: { ...base, name: '' } }),
        'TEST_CASE_NAME_REQUIRED', '空名称');
      expectError(await request(url, { method: 'POST', token: token('owner'), body: { ...base, name: 'x'.repeat(101) } }),
        'TEST_CASE_NAME_TOO_LONG', '超长名称');
      expectError(await request(url, { method: 'POST', token: token('owner'), body: { ...base, system_id: 0 } }),
        'SYSTEM_NOT_FOUND', '缺系统');
      expectError(await request(url, { method: 'POST', token: token('owner'), body: { ...base, module_id: 0 } }),
        'TEST_MODULE_NOT_FOUND', '缺模块');
      expectError(await request(url, { method: 'POST', token: token('owner'), body: { ...base, version_id: state.p2.versions.v100.id } }),
        'VERSION_ALREADY_RELEASED', '已发布版本');
      expectError(await request(url, {
        method: 'POST', token: token('owner'), body: { ...base, assets: [{ type: 'page', id: state.p2.pages.report.id }] },
      }), 'TEST_ASSET_NOT_IN_MODULE', '资产不属模块');
      expectError(await request(url, {
        method: 'POST', token: token('owner'), body: { ...base, points: [{ name: 'p'.repeat(256), expected: '' }] },
      }), 'TEST_POINT_NAME_TOO_LONG', '测试点名称超长');
    },
  },
  {
    name: '用例新增、更新与删除',
    expected: '池用例可创建并保存测试点与资产，可更新，可删除；删除后详情不可见',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const p2 = state.projects.p2;
      const create = expectOk(await request('/api/project/' + p2.id + '/test_case/create', {
        method: 'POST',
        token: token('owner'),
        body: {
          system_id: state.p2.systems.main.id,
          module_id: state.p2.modules.user.id,
          name: 'API 生命周期用例',
          description: '由 API 测试创建',
          precondition: '已登录',
          script: '1. 打开用户列表',
          points: [{ name: '列表加载', expected: '展示用户' }],
          assets: [{ type: 'page', id: state.p2.pages.user.id }],
        },
      }), '创建用例');
      assert.ok(create.id > 0);

      const detail = expectOk(await request('/api/project/' + p2.id + '/test_case/' + create.id + '/detail', {
        token: token('owner'),
      }), '读取用例详情');
      assert.equal(detail.name, 'API 生命周期用例');
      assert.equal(detail.points.length, 1);

      expectOk(await request('/api/project/' + p2.id + '/test_case/' + create.id + '/update', {
        method: 'POST',
        token: token('owner'),
        body: {
          system_id: state.p2.systems.main.id,
          module_id: state.p2.modules.user.id,
          name: 'API 生命周期用例（已更新）',
          points: [{ name: '列表加载', expected: '展示用户' }, { name: '搜索', expected: '结果过滤' }],
          assets: [{ type: 'page', id: state.p2.pages.user.id }],
        },
      }), '更新用例');

      const updated = expectOk(await request('/api/project/' + p2.id + '/test_case/' + create.id + '/detail', {
        token: token('owner'),
      }), '更新后详情');
      assert.equal(updated.name, 'API 生命周期用例（已更新）');
      assert.equal(updated.points.length, 2);

      expectOk(await request('/api/project/' + p2.id + '/test_case/' + create.id + '/delete', {
        method: 'POST', token: token('owner'), body: {},
      }), '删除用例');

      expectError(await request('/api/project/' + p2.id + '/test_case/' + create.id + '/detail', {
        token: token('owner'),
      }), 'TEST_CASE_NOT_FOUND', '删除后详情');
    },
  },
  {
    name: '用例跨版本变更与删除',
    expected: '用例可进入草稿版本并连续修改；不能回到更早版本；已发布版本不可删除；同版本可删除',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const p2 = state.projects.p2;
      const caseId = state.p2.test_cases.pool.id;

      const versionA = expectOk(await request('/api/project/' + p2.id + '/version/create', {
        method: 'POST', token: token('owner'), body: { version_no: '9.9.5-api-' + NONCE, description: '用例版本 A' },
      }), '创建版本 A');
      const versionB = expectOk(await request('/api/project/' + p2.id + '/version/create', {
        method: 'POST', token: token('owner'), body: { version_no: '9.9.4-api-' + NONCE, description: '用例版本 B' },
      }), '创建版本 B');

      const update = (versionId) => request('/api/project/' + p2.id + '/test_case/' + caseId + '/update', {
        method: 'POST',
        token: token('owner'),
        body: {
          system_id: state.p2.systems.main.id,
          module_id: state.p2.modules.user.id,
          name: '跨版本用例',
          points: [{ name: '步骤', expected: '成功' }],
          assets: [],
          version_id: versionId,
        },
      });

      expectOk(await update(versionA.id), '进入版本 A');
      expectOk(await update(versionB.id), '演进到版本 B');
      expectError(await update(versionA.id), 'TEST_CASE_ALREADY_VERSIONED', '回退到版本 A');

      expectError(await request('/api/project/' + p2.id + '/test_case/' + caseId + '/delete', {
        method: 'POST', token: token('owner'), body: { version_id: state.p2.versions.v100.id },
      }), 'VERSION_ALREADY_RELEASED', '已发布版本删除');

      expectOk(await request('/api/project/' + p2.id + '/test_case/' + caseId + '/delete', {
        method: 'POST', token: token('owner'), body: { version_id: versionB.id },
      }), '版本 B 删除');

      expectError(await request('/api/project/' + p2.id + '/test_case/' + caseId + '/detail', {
        token: token('owner'),
      }), 'TEST_CASE_NOT_FOUND', '删除后详情');
    },
  },
  {
    name: '已入版本用例的修改限制',
    expected: '已进入版本的用例不能在池中修改；已发布版本不能再作为变更目标',
    run: async ({ request, token, expectError, state }) => {
      const p2 = state.projects.p2;
      const caseId = state.p2.test_cases.v100.id;

      expectError(await request('/api/project/' + p2.id + '/test_case/' + caseId + '/update', {
        method: 'POST',
        token: token('owner'),
        body: {
          system_id: state.p2.systems.main.id,
          module_id: state.p2.modules.user.id,
          name: '试图回池修改',
          points: [],
          assets: [],
          version_id: null,
        },
      }), 'TEST_CASE_ALREADY_VERSIONED', '已入版本用例回池');

      expectError(await request('/api/project/' + p2.id + '/test_case/' + caseId + '/update', {
        method: 'POST',
        token: token('owner'),
        body: {
          system_id: state.p2.systems.main.id,
          module_id: state.p2.modules.user.id,
          name: '已发布版本修改',
          points: [],
          assets: [],
          version_id: state.p2.versions.v100.id,
        },
      }), 'VERSION_ALREADY_RELEASED', '已发布版本修改');
    },
  },
];
