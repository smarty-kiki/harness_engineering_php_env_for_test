const assert = require('node:assert/strict');

const NONCE = String(Date.now()).slice(-6);

module.exports = [
  {
    name: '工作项状态流转的动作校验',
    expected: '需求 / 开发 BUG / 生产缺陷传入非法 action 均返回 STATUS_ACTION_INVALID',
    run: async ({ request, token, expectError, state }) => {
      const p2 = state.projects.p2;
      const w = state.p2;

      for (const [type, id] of [
        ['requirement', w.requirements.accepted.id],
        ['bug', w.bugs.accepted.id],
        ['prod_defect', w.prod_defects.accepted.id],
      ]) {
        expectError(await request('/api/project/' + p2.id + '/' + type + '/' + id + '/status', {
          method: 'POST',
          token: token('owner'),
          body: { action: 'definitely_invalid_action' },
        }), 'STATUS_ACTION_INVALID', type + ' 非法 action');
      }
    },
  },
  {
    name: '跨项目工作项与状态日志隔离',
    expected: '用 A 项目的 work_id 访问 B 项目返回 WORK_NOT_FOUND；不存在的日志工作项同样返回 WORK_NOT_FOUND',
    run: async ({ request, token, expectError, state }) => {
      const p1 = state.projects.p1;
      const p2 = state.projects.p2;
      const crossId = state.p1.requirements.history.id;

      const crossLog = await request('/api/project/' + p2.id + '/requirement/' + crossId + '/status_logs', {
        token: token('owner'),
      });
      expectError(crossLog, 'WORK_NOT_FOUND', '跨项目需求日志');

      expectError(await request('/api/project/' + p2.id + '/requirement/' + crossId + '/status', {
        method: 'POST',
        token: token('owner'),
        body: { action: 'start_dev' },
      }), 'WORK_NOT_FOUND', '跨项目需求状态');

      for (const type of ['bug', 'prod_defect']) {
        expectError(await request('/api/project/' + p2.id + '/' + type + '/999999999/status_logs', {
          token: token('owner'),
        }), 'WORK_NOT_FOUND', '不存在的 ' + type + ' 日志');
      }

      expectError(await request('/api/project/' + p1.id + '/requirement/999999999/status_logs', {
        token: token('owner'),
      }), 'WORK_NOT_FOUND', '不存在的需求日志');
    },
  },
  {
    name: '状态日志分页参数收敛',
    expected: 'limit 收敛到 1..50，start_id 负值按 0 处理，返回 logs/has_more/next_start_id',
    run: async ({ request, token, expectOk, state }) => {
      const work = state.p1.requirements.history;
      const url = '/api/project/' + state.projects.p1.id + '/requirement/' + work.id + '/status_logs';

      const one = expectOk(await request(url + '?limit=0', { token: token('owner') }), 'limit=0');
      assert.equal(one.logs.length, 1, 'limit 最小为 1');
      assert.equal(typeof one.has_more, 'boolean');
      assert.ok(Number.isInteger(one.next_start_id));

      const many = expectOk(await request(url + '?limit=999', { token: token('owner') }), 'limit=999');
      assert.ok(many.logs.length > 1 && many.logs.length <= 50, 'limit 最大 50');

      const negative = expectOk(await request(url + '?start_id=-5&limit=2', { token: token('owner') }), 'start_id=-5');
      assert.equal(negative.logs.length, 2);
      assert.ok(negative.next_start_id > 0);
    },
  },
  {
    name: '版本创建与重复校验',
    expected: '空版本号被拒绝；自定义版本可创建；同项目重复版本号返回 VERSION_EXISTS',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const p2 = state.projects.p2;

      expectError(await request('/api/project/' + p2.id + '/version/create', {
        method: 'POST', token: token('owner'), body: { version_no: '', description: '' },
      }), 'VERSION_NO_REQUIRED', '空版本号');

      const created = expectOk(await request('/api/project/' + p2.id + '/version/create', {
        method: 'POST', token: token('owner'), body: { version_no: '9.9.9-api-' + NONCE, description: 'API 测试版本' },
      }), '创建 API 测试版本');
      assert.ok(created.id > 0);

      expectError(await request('/api/project/' + p2.id + '/version/create', {
        method: 'POST', token: token('owner'), body: { version_no: '9.9.9-api-' + NONCE, description: '' },
      }), 'VERSION_EXISTS', '重复版本号');
    },
  },
  {
    name: '工作项指派与移出版本',
    expected: '草稿版本可多次指派/移出；重复移出返回 WORK_NOT_FOUND；已发布版本不允许指派',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const p2 = state.projects.p2;
      const version = expectOk(await request('/api/project/' + p2.id + '/version/create', {
        method: 'POST', token: token('owner'), body: { version_no: '9.9.8-api-' + NONCE, description: '指派测试' },
      }), '创建指派版本');

      const work = state.p2.requirements.pool;
      const assignUrl = '/api/project/' + p2.id + '/version/' + version.id + '/assign';
      const unassignUrl = '/api/project/' + p2.id + '/version/' + version.id + '/unassign';

      expectOk(await request(assignUrl, {
        method: 'POST', token: token('owner'), body: { work_type: 'requirement', work_id: work.id },
      }), '指派需求');

      expectOk(await request(unassignUrl, {
        method: 'POST', token: token('owner'), body: { work_type: 'requirement', work_id: work.id },
      }), '移出需求');

      expectError(await request(unassignUrl, {
        method: 'POST', token: token('owner'), body: { work_type: 'requirement', work_id: work.id },
      }), 'WORK_NOT_FOUND', '重复移出');

      expectError(await request('/api/project/' + p2.id + '/version/' + state.p2.versions.v100.id + '/assign', {
        method: 'POST', token: token('owner'), body: { work_type: 'requirement', work_id: work.id },
      }), 'VERSION_ALREADY_RELEASED', '已发布版本指派');
    },
  },
  {
    name: '版本发布的前置条件',
    expected: '存在未验收工作项的版本不能发布；不存在的版本、已发布项目再次初版发布均返回对应错误',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const fs = require('fs');
      const path = require('path');
      const fixturesFile = path.join(__dirname, '../../../state/api-fixtures.json');
      const fixtures = fs.existsSync(fixturesFile) ? JSON.parse(fs.readFileSync(fixturesFile, 'utf-8')) : {};
      let unacceptedChecked = false;

      // 优先使用前端真实助手创建、仍未被验收的工作项
      if (fixtures.p3_prod_defect_id) {
        const p3 = state.projects.p3;
        const version = expectOk(await request('/api/project/' + p3.id + '/version/create', {
          method: 'POST', token: token('owner'), body: { version_no: '9.9.7-api-' + NONCE, description: '发布校验' },
        }), '创建发布校验版本');

        expectOk(await request('/api/project/' + p3.id + '/version/' + version.id + '/assign', {
          method: 'POST', token: token('owner'), body: { work_type: 'prod_defect', work_id: fixtures.p3_prod_defect_id },
        }), '指派未验收生产缺陷');

        expectError(await request('/api/project/' + p3.id + '/version/' + version.id + '/release', {
          method: 'POST', token: token('owner'), body: {},
        }), 'VERSION_UNACCEPTED_ITEMS', '未验收版本发布');
        unacceptedChecked = true;
      } else if (fixtures.ui_project_id && fixtures.ui_requirement_id) {
        expectError(await request('/api/project/' + fixtures.ui_project_id + '/release_initial', {
          method: 'POST', token: token('owner'), body: { version_no: '9.9.7-api-' + NONCE },
        }), 'INITIAL_RELEASE_UNACCEPTED', '初版发布存在未验收工作项');
        unacceptedChecked = true;
      }

      assert.ok(unacceptedChecked, '本轮缺少未验收工作项造数（前端助手用例未产出）');

      const p2 = state.projects.p2;
      expectError(await request('/api/project/' + p2.id + '/version/999999999/release', {
        method: 'POST', token: token('owner'), body: {},
      }), 'VERSION_NOT_FOUND', '不存在版本发布');

      expectError(await request('/api/project/' + p2.id + '/release_initial', {
        method: 'POST', token: token('owner'), body: { version_no: '9.9.6' },
      }), 'PROJECT_ALREADY_RELEASED', '已发布项目再次初版发布');
    },
  },
  {
    name: '流水线统计的版本过滤',
    expected: '非法版本返回空统计；pool 过滤与全部统计结构一致',
    run: async ({ request, token, expectOk, state }) => {
      const p2 = state.projects.p2;
      const base = '/api/project/' + p2.id + '/pipeline/stats';

      const invalid = expectOk(await request(base + '?version=999999', { token: token('owner') }), '非法版本统计');
      assert.equal(invalid.requirement_total, 0);
      assert.equal(invalid.prod_defect_total, 0);

      const pool = expectOk(await request(base + '?version=pool', { token: token('owner') }), '池统计');
      for (const key of ['requirement_total', 'to_dev', 'developing', 'to_review', 'accepted', 'bug_to_fix']) {
        assert.ok(Object.prototype.hasOwnProperty.call(pool, key), '缺失统计字段 ' + key);
      }
    },
  },
];
