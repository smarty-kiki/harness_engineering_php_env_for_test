<?php
// 测试辅助：暂时暂停 default tube 的派发，让测试可以在 worker 领取前模拟 run 结果。
// 用法：php pause_queue.php [seconds]

chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$seconds = intval($argv[1] ?? 20);

queue_pause('default', 'default', $seconds);

echo "queue paused for {$seconds}s\n";
