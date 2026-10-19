<?php
/**
 * 测试辅助：不调用真实大模型，直接把一条 agent_run 模拟成完成 / 失败，
 * 并按照 worker 的协议写入 Redis 进度事件，供页面 SSE 正常走完流程。
 *
 * 用法：
 *   php simulate_run.php --run_id=1 --outcome=done --work_id=2 --work_type=requirement --work_count=1
 *   php simulate_run.php --run_id=1 --outcome=failed --message=模拟失败
 *   php simulate_run.php --run_id=1 --outcome=done --session_id=3
 */

chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$params = [];

foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--([^=]+)=(.*)$/s', $arg, $m)) {
        $params[$m[1]] = $m[2];
    }
}

$run_id = intval($params['run_id'] ?? 0);
$outcome = $params['outcome'] ?? 'done';

if (! $run_id) {
    fwrite(STDERR, "missing run_id\n");
    exit(1);
}

$run = dao('agent_run')->find_by_id($run_id);

if ($run->is_null()) {
    fwrite(STDERR, "run not found\n");
    exit(1);
}

agent_run_push_event($run_id, ['type' => 'phase', 'phase' => '模拟执行中']);

if ($outcome === 'failed') {
    $message = $params['message'] ?? '模拟的助手失败';

    unit_of_work(function () use ($run_id, $message) {
        $run = dao('agent_run')->find_by_id($run_id);
        $run->status = 'failed';
        $run->error_message = $message;
    });

    agent_run_push_event($run_id, ['type' => 'error', 'message' => $message]);
    agent_run_set_redis_status($run_id, 'failed');

    echo "simulated failed\n";
    exit(0);
}

// session 轮次：done 事件携带 session 信息，触发方案区刷新
if (! empty($run->session_id)) {
    unit_of_work(function () use ($run_id) {
        $run = dao('agent_run')->find_by_id($run_id);
        $run->status = 'done';
        $run->reply_text = "## 模拟回复\n\n- 已完成方案更新\n\n| 项 | 数量 |\n| --- | --- |\n| 需求 | 1 |";
        $run->result_json = json_encode(['plan_counts' => ['roles' => 3, 'requirements' => 1]], JSON_UNESCAPED_UNICODE);

        $session = dao('agent_session')->find_by_id($run->session_id);
        if ($session->is_not_null()) {
            $session->round_count = intval($session->round_count) + 1;
            $session->plan_json = $session->plan_json ?: json_encode(agent_session_plan_normalize([
                'roles' => [['op' => 'ensure', 'name' => '运营专员', 'description' => '模拟新增角色']],
                'requirements' => [['op' => 'ensure', 'title' => '模拟新增需求', 'description' => '来自模拟运行', 'links' => []]],
            ]), JSON_UNESCAPED_UNICODE);
        }
    });

    agent_run_push_event($run_id, ['type' => 'text', 'content' => "## 模拟回复\n\n- 已完成方案更新\n\n| 项 | 数量 |\n| --- | --- |\n| 需求 | 1 |"]);

    agent_run_push_event($run_id, ['type' => 'plan']);

    agent_run_push_event($run_id, ['type' => 'done', 'data' => [
        'session' => true,
        'session_id' => (int) $run->session_id,
        'plan_counts' => ['roles' => 3, 'requirements' => 1],
    ]]);

    agent_run_set_redis_status($run_id, 'done');

    echo "simulated session done\n";
    exit(0);
}

// 单场景助手
$work_id = intval($params['work_id'] ?? 0);
$work_type = (string) ($params['work_type'] ?? 'requirement');
$work_count = intval($params['work_count'] ?? 1);

unit_of_work(function () use ($run_id, $work_id, $work_type) {
    $run = dao('agent_run')->find_by_id($run_id);
    $run->status = 'done';
    $run->reply_text = "## 模拟需求拆分\n\n- **需求一**：模拟条目\n\n```\n示例\n```";
    $run->result_json = json_encode([
        'works' => [['title' => '模拟需求']],
        'asset_ops' => [['type' => 'role'], ['type' => 'page']],
    ], JSON_UNESCAPED_UNICODE);
    $run->work_id = $work_id ?: null;
    $run->work_type = $work_type;
});

agent_run_push_event($run_id, ['type' => 'text', 'content' => "## 模拟需求拆分\n\n已生成模拟结果。"]);

agent_run_push_event($run_id, ['type' => 'done', 'data' => [
    'work_id' => $work_id ?: null,
    'work_type' => $work_type,
    'work_count' => $work_count,
    'summary' => ['role' => 1, 'page' => 2],
]]);

agent_run_set_redis_status($run_id, 'done');

echo "simulated done\n";
