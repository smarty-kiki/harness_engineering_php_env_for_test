<?php
/**
 * 测试辅助：把一条已模拟完成的会话轮次的方案替换为「包含生产缺陷」的完整方案，
 * 用于确认落库路径（prod_defect::create 只能在 Web/worker 进程中执行才会产生覆盖率）。
 *
 * 用法：php set_session_plan.php --session_id=1
 */

chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$params = [];
foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--([^=]+)=(.*)$/s', $arg, $m)) {
        $params[$m[1]] = $m[2];
    }
}

$session_id = intval($params['session_id'] ?? 0);

$plan = agent_session_plan_normalize([
    'prod_defects' => [[
        'op' => 'ensure',
        'title' => '库存同步超时',
        'description' => '生产环境库存同步偶发超时，入库单状态未能及时更新。',
        'impact' => '仓库管理员看到过期库存，可能重复入库',
        'links' => [
            'system' => '仓储系统',
            'modules' => ['入库管理'],
            'pages' => ['入库单列表'],
            'server_apis' => ['创建入库单'],
            'open_apis' => ['库存同步'],
            'crons' => ['库存日报'],
            'roles' => ['仓库管理员'],
            'processes' => ['入库流程'],
            'process_nodes' => ['自动审核'],
        ],
    ]],
]);

unit_of_work(function () use ($session_id, $plan) {
    $session = dao('agent_session')->find_by_id($session_id);
    $session->plan_json = json_encode($plan, JSON_UNESCAPED_UNICODE);
});

echo "plan set\n";
