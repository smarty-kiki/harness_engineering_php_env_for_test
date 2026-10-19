<?php
/**
 * 测试辅助：为 P3 创建一份「更新 / 删除既有资产与工作项」的待确认方案。
 * 用于覆盖方案确认时的 update / delete 分支（页面不直接提供这些操作）。
 *
 * 输出 JSON：{"session_id": x}
 */

chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$state = json_decode(file_get_contents(__DIR__.'/../state/state.json'), true);
$fixtures = json_decode(file_get_contents(__DIR__.'/../state/api-fixtures.json'), true);

$project = dao('project')->find_by_id((int) $state['projects']['p3']['id']);
$user = dao('user')->find_by_id((int) $state['users']['owner']['id']);

if ($project->is_null() || $user->is_null()) {
    fwrite(STDERR, "project or user missing\n");
    exit(1);
}

$requirements = dao('requirement')->find_all_by_column(['project_id' => (int) $project->id]);
$requirement = reset($requirements);

$defect = dao('prod_defect')->find_by_id((int) ($fixtures['p3_prod_defect_id'] ?? 0));

if (! $requirement || $defect->is_null()) {
    fwrite(STDERR, "requirement or defect missing\n");
    exit(1);
}

$plan = agent_session_plan_normalize([
    'roles' => [
        ['op' => 'ensure', 'name' => '仓库管理员', 'description' => '负责入库与库存核对（已更新）'],
        ['op' => 'delete', 'name' => '系统'],
        ['op' => 'delete', 'name' => '不存在的角色'],
    ],
    'processes' => [
        ['op' => 'ensure', 'name' => '入库流程', 'related_object' => '入库单', 'description' => '入库流程（已更新）', 'nodes' => [
            ['op' => 'ensure', 'name' => '创建入库单', 'role' => '仓库管理员', 'description' => '创建入库单（已更新）'],
            ['op' => 'delete', 'name' => '自动审核', 'role' => '系统', 'description' => ''],
        ]],
    ],
    'systems' => [
        ['op' => 'ensure', 'name' => '仓储系统', 'platform' => 'web', 'roles' => ['仓库管理员'], 'description' => '仓库入库与库存管理（已更新）', 'modules' => [
            ['op' => 'delete', 'name' => '报表统计', 'description' => ''],
        ]],
    ],
    'requirements' => [
        ['op' => 'ensure', 'ref' => (string) $requirement->no, 'title' => '创建入库单（已更新）', 'description' => '更新后的需求说明', 'links' => [
            'system' => '仓储系统',
            'modules' => ['入库管理'],
            'pages' => ['入库单列表'],
            'server_apis' => ['创建入库单'],
            'open_apis' => ['库存同步'],
            'crons' => ['库存日报'],
            'roles' => ['仓库管理员'],
            'processes' => ['入库流程'],
            'process_nodes' => ['创建入库单'],
        ]],
    ],
    'prod_defects' => [
        ['op' => 'delete', 'ref' => (string) $defect->no, 'title' => '删除待开发缺陷'],
    ],
]);

$session_id = 0;

unit_of_work(function () use ($project, $user, $plan, &$session_id) {
    $session = agent_session::create((int) $project->id, (int) $user->id, 'PW 资产更新删除方案');
    $session->plan_json = json_encode($plan, JSON_UNESCAPED_UNICODE);
    $session->round_count = 1;
    $session->status = 'active';

    $session_id = (int) $session->id;
});

echo json_encode(['session_id' => $session_id], JSON_UNESCAPED_UNICODE);
