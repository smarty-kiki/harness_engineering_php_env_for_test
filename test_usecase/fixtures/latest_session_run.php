<?php
// 测试辅助：输出最近一条「大而全助手」会话轮次：{"session_id":x,"run_id":y}
chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$project_id = intval($argv[1] ?? 0);
$user_id = intval($argv[2] ?? 0);

$runs = dao('agent_run')->find_all_by_column(['project_id' => $project_id, 'user_id' => $user_id, 'mode' => 'session']);

$run = null;
foreach ($runs as $candidate) {
    if (! $run || (int) $candidate->id > (int) $run->id) {
        $run = $candidate;
    }
}

if (! $run) {
    fwrite(STDERR, "no session run\n");
    exit(1);
}

echo json_encode(['session_id' => (int) $run->session_id, 'run_id' => (int) $run->id]);
