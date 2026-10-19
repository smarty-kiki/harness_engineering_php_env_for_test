const assert = require('node:assert/strict');

const NONCE = Date.now();

module.exports = [
  {
    name: '团队列表与详情权限',
    expected: '只能看到已加入的团队；非成员访问团队详情返回 NOT_TEAM_SPACE_MEMBER',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const ownerList = expectOk(await request('/api/team_space/list', { token: token('owner') }), '拥有者团队列表');
      const ids = ownerList.team_spaces.map((item) => item.id);
      assert.ok(ids.includes(state.teams.a.id) && ids.includes(state.teams.b.id));
      assert.ok(!ids.includes(state.teams.outside.id), '不应包含未加入的团队');

      expectError(await request('/api/team_space/999999999', { token: token('owner') }), 'NOT_TEAM_SPACE_MEMBER', '不存在的团队');
      expectError(await request('/api/team_space/' + state.teams.outside.id, { token: token('owner') }), 'NOT_TEAM_SPACE_MEMBER', '外部团队');

      const detail = expectOk(await request('/api/team_space/' + state.teams.a.id, { token: token('owner') }), '团队详情');
      assert.ok(detail.members.some((item) => item.email === state.users.owner.email));
      assert.ok(detail.projects.some((item) => item.id === state.projects.p1.id));
    },
  },
  {
    name: '团队列表返回当前用户角色',
    expected: 'owner 在团队列表中的 member_role 为 owner',
    run: async ({ request, token, expectOk, state }) => {
      const list = expectOk(await request('/api/team_space/list', { token: token('owner') }), '拥有者团队列表');
      const row = list.team_spaces.find((item) => item.id === state.teams.a.id);
      assert.ok(row, '团队列表应包含团队 A');
      assert.equal(row.member_role, 'owner', 'owner 的团队角色应为 owner');
    },
  },
  {
    name: '邀请成员的参数与重复校验',
    expected: '非法邮箱、已是成员、已有待处理邀请分别返回 INVITE_EMAIL_INVALID / INVITE_ALREADY_MEMBER / INVITE_ALREADY_PENDING',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const invalid = await request('/api/team_space/' + state.teams.b.id + '/invite', {
        method: 'POST',
        token: token('owner'),
        body: { email: 'not-an-email' },
      });
      expectError(invalid, 'INVITE_EMAIL_INVALID', '非法邀请邮箱');

      const existing = await request('/api/team_space/' + state.teams.b.id + '/invite', {
        method: 'POST',
        token: token('owner'),
        body: { email: state.users.owner.email },
      });
      expectError(existing, 'INVITE_ALREADY_MEMBER', '邀请已是成员');

      const email = 'pw-invite-' + state.tag + '-' + NONCE + '@example.com';
      const first = await request('/api/team_space/' + state.teams.b.id + '/invite', {
        method: 'POST',
        token: token('owner'),
        body: { email },
      });
      const created = expectOk(first, '首次邀请');
      assert.ok(created.id);

      const duplicate = await request('/api/team_space/' + state.teams.b.id + '/invite', {
        method: 'POST',
        token: token('owner'),
        body: { email },
      });
      expectError(duplicate, 'INVITE_ALREADY_PENDING', '重复待处理邀请');

      const detail = expectOk(await request('/api/team_space/' + state.teams.b.id, { token: token('owner') }), '待邀请团队详情');
      const pending = detail.invites.find((item) => item.email === email);
      assert.ok(pending, '详情应包含待处理邀请');
      assert.ok(pending.create_time, '邀请应带创建时间');
    },
  },
  {
    name: '邀请接受与拒绝的归属校验',
    expected: '非受邀人不能处理邀请；不存在或已处理的邀请返回 INVITE_NOT_FOUND',
    run: async ({ request, token, expectOk, expectError, state }) => {
      const created = expectOk(await request('/api/team_space/' + state.teams.b.id + '/invite', {
        method: 'POST',
        token: token('owner'),
        body: { email: 'pw-decliner-' + state.tag + '-' + NONCE + '@example.com' },
      }), '创建给拒绝人的邀请');

      expectError(await request('/api/team_space/invite/' + created.id + '/accept', {
        method: 'POST',
        token: token('member'),
        body: {},
      }), 'INVITE_NOT_MINE', '成员接受他人邀请');

      expectError(await request('/api/team_space/invite/' + created.id + '/decline', {
        method: 'POST',
        token: token('member'),
        body: {},
      }), 'INVITE_NOT_MINE', '成员拒绝他人邀请');

      expectError(await request('/api/team_space/invite/999999999/accept', {
        method: 'POST',
        token: token('decliner'),
        body: {},
      }), 'INVITE_NOT_FOUND', '接受不存在的邀请');

      expectError(await request('/api/team_space/invite/999999999/decline', {
        method: 'POST',
        token: token('decliner'),
        body: {},
      }), 'INVITE_NOT_FOUND', '拒绝不存在的邀请');
    },
  },
  {
    name: '团队成员管理与权限边界',
    expected: '普通成员无管理权限；不能移除 owner；移除非成员返回 NOT_TEAM_SPACE_MEMBER',
    run: async ({ request, token, expectError, state }) => {
      expectError(await request('/api/team_space/' + state.teams.a.id + '/invite', {
        method: 'POST',
        token: token('member'),
        body: { email: 'pw-api-other-' + state.tag + '@example.com' },
      }), 'NO_TEAM_SPACE_PERMISSION', '普通成员邀请');

      expectError(await request('/api/team_space/' + state.teams.a.id + '/update', {
        method: 'POST',
        token: token('member'),
        body: { name: 'x' },
      }), 'NO_TEAM_SPACE_PERMISSION', '普通成员更新团队');

      expectError(await request('/api/team_space/' + state.teams.a.id + '/remove_member', {
        method: 'POST',
        token: token('owner'),
        body: { user_id: state.users.owner.id },
      }), 'CANNOT_REMOVE_OWNER', '移除 owner');

      expectError(await request('/api/team_space/' + state.teams.b.id + '/remove_member', {
        method: 'POST',
        token: token('owner'),
        body: { user_id: state.users.outsider.id },
      }), 'NOT_TEAM_SPACE_MEMBER', '移除不在团队的成员');
    },
  },
  {
    name: '团队与项目的创建参数校验',
    expected: '团队名、项目名必填；非成员团队不能创建项目；不存在的团队返回 NOT_TEAM_SPACE_MEMBER',
    run: async ({ request, token, expectError, state }) => {
      expectError(await request('/api/team_space/create', {
        method: 'POST', token: token('owner'), body: { name: '', description: '' },
      }), 'TEAM_SPACE_NAME_REQUIRED', '创建空名团队');

      expectError(await request('/api/team_space/999999999/update', {
        method: 'POST', token: token('owner'), body: { name: 'x' },
      }), 'NOT_TEAM_SPACE_MEMBER', '更新不存在团队');

      expectError(await request('/api/team_space/' + state.teams.a.id + '/update', {
        method: 'POST', token: token('owner'), body: { name: '', description: '' },
      }), 'TEAM_SPACE_NAME_REQUIRED', '团队名置空');

      expectError(await request('/api/project/create', {
        method: 'POST', token: token('owner'), body: { team_space_id: 999999999, name: 'x' },
      }), 'NOT_TEAM_SPACE_MEMBER', '非成员团队创建项目');

      expectError(await request('/api/project/create', {
        method: 'POST', token: token('owner'), body: { team_space_id: state.teams.a.id, name: '' },
      }), 'PROJECT_NAME_REQUIRED', '创建空名项目');
    },
  },
  {
    name: '账号昵称与团队昵称校验',
    expected: '账号昵称与团队昵称空值/超长被拒绝；非团队成员不能设置团队昵称',
    run: async ({ request, token, expectError, state }) => {
      for (const nickname of ['', 'n'.repeat(31)]) {
        expectError(await request('/api/account/nickname', {
          method: 'POST', token: token('owner'), body: { nickname },
        }), 'ACCOUNT_NICKNAME_INVALID', '账号昵称 ' + JSON.stringify(nickname));
      }

      expectError(await request('/api/account/team-nickname', {
        method: 'POST', token: token('owner'), body: { team_space_id: state.teams.a.id, nickname: 'n'.repeat(31) },
      }), 'TEAM_NICKNAME_INVALID', '团队昵称超长');

      expectError(await request('/api/account/team-nickname', {
        method: 'POST', token: token('owner'), body: { team_space_id: state.teams.outside.id, nickname: 'x' },
      }), 'NOT_TEAM_SPACE_MEMBER', '非团队成员设置昵称');
    },
  },
  {
    name: '开放接口 Key 的归属校验',
    expected: '空名称被拒绝；只能删除自己的 Key；自己的 Key 可创建并删除',
    run: async ({ request, token, expectOk, expectError }) => {
      expectError(await request('/api/account/api-key', {
        method: 'POST', token: token('owner'), body: { name: '  ' },
      }), 'API_KEY_NAME_REQUIRED', '空 Key 名称');

      const memberKey = expectOk(await request('/api/account/api-key', {
        method: 'POST', token: token('member'), body: { name: 'PW API 归属测试' },
      }), '成员创建 Key');
      assert.ok(memberKey.token.startsWith('pms_'));

      expectError(await request('/api/account/api-key/delete', {
        method: 'POST', token: token('owner'), body: { id: memberKey.id },
      }), 'API_KEY_INVALID', '删除他人 Key');

      expectOk(await request('/api/account/api-key/delete', {
        method: 'POST', token: token('member'), body: { id: memberKey.id },
      }), '删除自己的 Key');
    },
  },
];
