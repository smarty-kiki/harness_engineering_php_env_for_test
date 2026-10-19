<?php
// 测试辅助：恢复 default tube 的派发（delay=0 即取消暂停）。
chdir('/var/www/project_manage_system');

include 'bootstrap.php';

queue_pause('default', 'default', 0);

echo "queue resumed\n";
