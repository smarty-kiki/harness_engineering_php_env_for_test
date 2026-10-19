<?php
/**
 * 测试辅助：为 P3 空项目创建一份「大而全助手」待确认方案（资产 + 需求 + 完整 links）。
 * 由 Playwright 流程在空状态用例跑完后调用，确认方案走真实接口，覆盖资产落库逻辑。
 *
 * 输出 JSON：{"session_id": x}
 */

chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$state = json_decode(file_get_contents(__DIR__.'/../state/state.json'), true);

$project = dao('project')->find_by_id((int) $state['projects']['p3']['id']);
$user = dao('user')->find_by_id((int) $state['users']['owner']['id']);

if ($project->is_null() || $user->is_null()) {
    fwrite(STDERR, "project or user missing\n");
    exit(1);
}

$rich_md = "# 创建入库单\n\n"
    ."**业务目的**：仓库管理员在商品到货后创建入库单，系统自动审核并更新库存。\n\n"
    ."## 页面\n\n- 入库单列表\n- 入库单详情\n\n"
    ."## 字段\n\n| 字段 | 类型 | 说明 |\n| --- | --- | --- |\n| 单号 | 文本 | 系统自动生成 |\n| 数量 | 数字 | 必填 |\n\n"
    ."> 规则：入库单创建后自动进入审核流程。\n\n"
    ."```http\nPOST /api/stock/in/create\n```\n\n"
    ."接口说明见 [接口文档](https://example.com/docs)。\n\n"
    ."~~旧版说明~~\n\n"
    ."1. 打开入库单列表\n2. 点击新增并填写数量\n\n"
    ."行内 **粗体**、*斜体*、`inline code`、[链接](https://example.com) 与裸链接 https://example.org/path。\n\n"
    ."- 无序一\n- 无序二\n  - 嵌套一\n  - 嵌套二\n\n"
    ."1. 有序一\n2. 有序二\n\n"
    ."> 引用第一段\n>\n> 引用第二段\n\n"
    ."```http\nPOST /api/stock/in/apply\n```\n\n"
    ."| 列一 | 列二 |\n| --- | --- |\n| 值一 | 值二 |\n\n"
    ."---\n";

$plan_raw = [
    'roles' => [
        ['op' => 'ensure', 'name' => '仓库管理员', 'description' => '负责入库单创建与库存核对'],
        ['op' => 'ensure', 'name' => '系统', 'description' => '系统自动执行审核与通知'],
    ],
    'processes' => [
        ['op' => 'ensure', 'name' => '入库流程', 'related_object' => '入库单', 'description' => '入库单从创建到入库的流程', 'nodes' => [
            ['op' => 'ensure', 'name' => '创建入库单', 'role' => '仓库管理员', 'description' => '仓库管理员填写到货商品与数量'],
            ['op' => 'ensure', 'name' => '自动审核', 'role' => '系统', 'description' => '系统校验数量并更新库存'],
        ]],
    ],
    'systems' => [
        ['op' => 'ensure', 'name' => '仓储系统', 'platform' => 'web', 'roles' => ['仓库管理员', '系统'], 'description' => '仓库入库与库存管理', 'modules' => [
            ['op' => 'ensure', 'name' => '入库管理', 'description' => '入库单与库存操作', 'pages' => [
                ['op' => 'ensure', 'name' => '入库单列表', 'route' => '/stock/in/list', 'description' => '步骤：1.筛选入库单 2.查看详情'],
            ], 'server_apis' => [
                ['op' => 'ensure', 'name' => '创建入库单', 'method' => 'POST', 'path' => '/api/stock/in/create', 'purpose' => '接收商品与数量，校验后创建入库单'],
            ], 'open_apis' => [
                ['op' => 'ensure', 'name' => '库存同步', 'method' => 'POST', 'path' => '/api/open/stock/sync', 'purpose' => '向第三方同步库存'],
            ], 'cron_jobs' => [
                ['op' => 'ensure', 'name' => '库存日报', 'schedule' => '0 8 * * *', 'description' => '每天早八点生成库存日报'],
            ]],
            ['op' => 'ensure', 'name' => '报表统计', 'description' => '库存数据统计', 'pages' => [], 'server_apis' => [
                ['op' => 'ensure', 'name' => '库存报表数据', 'method' => 'GET', 'path' => '/api/stock/report', 'purpose' => '返回库存报表数据'],
            ], 'open_apis' => [], 'cron_jobs' => []],
        ]],
    ],
    'requirements' => [
        ['op' => 'ensure', 'title' => '创建入库单', 'description' => $rich_md, 'links' => [
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
    'prod_defects' => [],
];

$plan = agent_session_plan_normalize($plan_raw);

$session_id = 0;

unit_of_work(function () use ($project, $user, $plan, &$session_id) {
    $session = agent_session::create((int) $project->id, (int) $user->id, 'PW 仓储系统建设方案');
    $session->plan_json = json_encode($plan, JSON_UNESCAPED_UNICODE);
    $session->round_count = 1;
    $session->status = 'active';

    $round = agent_run::create((int) $project->id, (int) $user->id, 'session', '规划一个仓储系统：入库单创建、自动审核、库存报表');
    $round->session_id = (int) $session->id;
    $round->status = 'done';
    $round->reply_text = "## 仓储系统方案\n\n已完成角色、流程、系统与需求规划，请确认。";
    $round->result_json = json_encode(['plan_counts' => agent_session_plan_counts($plan)], JSON_UNESCAPED_UNICODE);

    $session_id = (int) $session->id;
});

echo json_encode(['session_id' => $session_id], JSON_UNESCAPED_UNICODE);
