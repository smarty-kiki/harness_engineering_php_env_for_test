<?php
// 测试辅助：为指定邮箱直接写入 Redis 会话，输出 token。用于多用户切换，避免验证码冷却限制。
// 用法：php make_session.php --email=xxx@example.com

chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$email = '';

foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--email=(.+)$/', $arg, $m)) {
        $email = $m[1];
    }
}

$user = dao('user')->find_by_column(['email' => $email]);

if ($user->is_null()) {
    fwrite(STDERR, "user not found\n");
    exit(1);
}

$token = bin2hex(random_bytes(32));

cache_set('pms:session:'.$token, ['user_id' => (int) $user->id, 'login_time' => datetime()], 7 * 86400);

echo $token;
