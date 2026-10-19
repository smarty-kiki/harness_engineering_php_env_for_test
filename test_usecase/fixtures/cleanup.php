<?php
/**
 * 清理测试数据：按 state/state.json 中记录的测试实体物理删除，
 * 同时清理测试用户相关的 Redis 会话、验证码与工作项编号计数器。
 *
 * 运行：php /var/www/test_usecase/fixtures/cleanup.php
 */

chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$state_file = __DIR__.'/../state/state.json';

if (! file_exists($state_file)) {
    echo "no state file, skip\n";
    exit(0);
}

$state = json_decode(file_get_contents($state_file), true);

if (! is_array($state) || empty($state['users'])) {
    echo "invalid state, skip\n";
    exit(0);
}

$placeholders = function (array $ids) {
    return implode(',', array_fill(0, count($ids), '?'));
};

$in = function (array $ids) {
    return $ids ? implode(',', array_map('intval', $ids)) : '0';
};

$user_ids = array_column($state['users'], 'id');
$emails = array_column($state['users'], 'email');

$team_ids = array_map(fn ($t) => (int) $t['id'], $state['teams']);

// 测试过程中通过 UI 新建的项目 / 团队由 state/extra.json 记录
$extra_file = __DIR__.'/../state/extra.json';
$extra = file_exists($extra_file) ? json_decode(file_get_contents($extra_file), true) : [];
$extra_projects = is_array($extra) ? ($extra['project_ids'] ?? []) : [];
$extra_teams = is_array($extra) ? ($extra['team_ids'] ?? []) : [];

$project_ids = array_map(fn ($p) => (int) $p['id'], $state['projects']);
$project_ids = array_values(array_unique(array_merge($project_ids, array_map('intval', $extra_projects))));
$team_ids = array_values(array_unique(array_merge($team_ids, array_map('intval', $extra_teams))));

// 额外团队可能是 UI 新建、由 owner 拥有：把所有涉及项目挂到额外团队下时也能清理
$extra_project_rows = $project_ids ? db_query('select id, team_space_id from `project` where id in ('.$in($project_ids).')') : [];
foreach ($extra_project_rows as $row) {
    $team_ids[] = (int) $row['team_space_id'];
}
$team_ids = array_values(array_unique($team_ids));

$project_ids_in = $in($project_ids);
$work_ids = ['requirement' => [], 'bug' => [], 'prod_defect' => [], 'test_case' => []];

foreach (['p1', 'p2'] as $project_key) {
    foreach (['requirements' => 'requirement', 'bugs' => 'bug', 'prod_defects' => 'prod_defect', 'test_cases' => 'test_case'] as $state_key => $work_type) {
        foreach (($state[$project_key][$state_key] ?? []) as $item) {
            $work_ids[$work_type][] = (int) $item['id'];
        }
    }
}

// 项目下由 UI / 助手新创建的工作项（不在 state 中）也一并找出，避免留下孤立的关联记录
if ($project_ids_in !== '0') {
    foreach (['requirement', 'bug', 'prod_defect'] as $table) {
        foreach (db_query('select id from `'.$table.'` where project_id in ('.$project_ids_in.')') as $row) {
            $work_ids[$table][] = (int) $row['id'];
        }
    }
    foreach (db_query('select id from `test_case` where project_id in ('.$project_ids_in.')') as $row) {
        $work_ids['test_case'][] = (int) $row['id'];
    }
    foreach ($work_ids as $type => $ids) {
        $work_ids[$type] = array_values(array_unique($ids));
    }
}

$all_work_ids = array_merge(...array_values($work_ids));

// ----- 项目下的资产 id -----
$system_ids = [];
$module_ids = [];
$asset_ids = [];

foreach (['p1', 'p2'] as $project_key) {
    foreach (($state[$project_key]['systems'] ?? []) as $item) {
        $system_ids[] = (int) $item['id'];
        $asset_ids[] = (int) $item['id'];
    }
    foreach (($state[$project_key]['modules'] ?? []) as $item) {
        $module_ids[] = (int) $item['id'];
        $asset_ids[] = (int) $item['id'];
    }
    foreach (['pages', 'apis'] as $key) {
        foreach (($state[$project_key][$key] ?? []) as $item) {
            $asset_ids[] = (int) $item['id'];
        }
    }
}

// ----- 先删子表，再删主表 -----
// 项目下由 UI / 助手新创建的资产（不在 state 中）也按项目归属收集
foreach (db_query('select id from `project_system` where project_id in ('.$project_ids_in.')') as $row) {
    $system_ids[] = (int) $row['id'];
}
$system_ids = array_values(array_unique($system_ids));

if ($system_ids) {
    foreach (db_query('select id from `system_module` where system_id in ('.$in($system_ids).')') as $row) {
        $module_ids[] = (int) $row['id'];
    }
    $module_ids = array_values(array_unique($module_ids));
}

if ($module_ids) {
    foreach (['system_page', 'system_server_api', 'system_open_api', 'system_cron_job'] as $table) {
        foreach (db_query('select id from `'.$table.'` where module_id in ('.$in($module_ids).')') as $row) {
            $asset_ids[] = (int) $row['id'];
        }
    }
    $asset_ids = array_values(array_unique($asset_ids));
}

if ($all_work_ids) {
    db_delete('delete from `work_asset_link` where work_id in ('.$in($all_work_ids).')');
    db_delete('delete from `work_status_log` where work_id in ('.$in($all_work_ids).')');
}

if ($asset_ids) {
    db_delete('delete from `work_asset_link` where asset_id in ('.$in($asset_ids).')');
}

if ($module_ids) {
    foreach (['system_page', 'system_server_api', 'system_open_api', 'system_cron_job'] as $table) {
        db_delete('delete from `'.$table.'` where module_id in ('.$in($module_ids).')');
    }
}

if ($system_ids) {
    db_delete('delete from `system_repo` where system_id in ('.$in($system_ids).')');
    db_delete('delete from `system_module` where system_id in ('.$in($system_ids).')');
    db_delete('delete from `project_system` where id in ('.$in($system_ids).')');
}

if (! empty($work_ids['test_case'])) {
    db_delete('delete from `test_case_point` where case_id in ('.$in($work_ids['test_case']).')');
}

db_delete('delete from `test_case_version_ref` where project_id in ('.$project_ids_in.')');
db_delete('delete from `test_case_version_snapshot` where project_id in ('.$project_ids_in.')');
db_delete('delete from `test_case` where project_id in ('.$project_ids_in.')');
db_delete('delete from `version_knowledge_snapshot` where project_id in ('.$project_ids_in.')');
db_delete('delete from `agent_run_change` where project_id in ('.$project_ids_in.') or run_id in (select id from `agent_run` where project_id in ('.$project_ids_in.'))');
db_delete('delete from `agent_run` where project_id in ('.$project_ids_in.')');
// 历史遗留的、所属 run 已被删除的变更明细（project_id 为空的老数据）一并清理，避免复用 ID 时串到新工作项
db_delete('delete from `agent_run_change` where run_id not in (select id from `agent_run`)');
db_delete('delete from `agent_session` where project_id in ('.$project_ids_in.')');

foreach (['requirement', 'bug', 'prod_defect'] as $table) {
    db_delete('delete from `'.$table.'` where project_id in ('.$project_ids_in.')');
}

db_delete('delete from `project_version` where project_id in ('.$project_ids_in.')');

$process_ids = [];
foreach (['p1', 'p2'] as $project_key) {
    // seed 未输出 process id，按项目查
}
foreach (db_query('select id from `business_process` where project_id in ('.$project_ids_in.')') as $row) {
    $process_ids[] = (int) $row['id'];
}
if ($process_ids) {
    db_delete('delete from `business_process_node` where process_id in ('.$in($process_ids).')');
}
db_delete('delete from `business_process` where project_id in ('.$project_ids_in.')');
db_delete('delete from `project_role` where project_id in ('.$project_ids_in.')');
db_delete('delete from `project` where id in ('.$project_ids_in.')');

if ($team_ids) {
    db_delete('delete from `team_space_invite` where team_space_id in ('.$in($team_ids).')');
    db_delete('delete from `team_space_member` where team_space_id in ('.$in($team_ids).')');
    db_delete('delete from `team_space` where id in ('.$in($team_ids).')');
}

// 测试中自动注册的临时账号（登录流程）也按 tag 清理
if (! empty($state['tag'])) {
    foreach (db_query('select id from `user` where email like :pattern', [':pattern' => 'pw-%'.$state['tag'].'%@example.com']) as $row) {
        $user_ids[] = (int) $row['id'];
    }
    $user_ids = array_values(array_unique($user_ids));
}

if ($user_ids) {
    db_delete('delete from `api_key` where user_id in ('.$in($user_ids).')');
    db_delete('delete from `user` where id in ('.$in($user_ids).')');
}

// ----- Redis -----
foreach ($project_ids as $project_id) {
    cache_delete('pms:work_no:requirement:'.$project_id);
    cache_delete('pms:work_no:bug:'.$project_id);
    cache_delete('pms:work_no:prod_defect:'.$project_id);
}

foreach ($emails as $email) {
    cache_delete('pms:auth_code:'.$email);
    cache_delete('pms:auth_code:'.$email.':cooldown');
    cache_delete('pms:auth_code:'.$email.':attempts');
}

// 登录失败尝试测试会使用额外的邮箱，统一清理包含本次 tag 的验证码键
try {
    $redis = new Redis();
    $redis->connect('127.0.0.1', 6379);
    foreach ($redis->keys('pms:auth_code:*') as $key) {
        if (strpos($key, (string) ($state['tag'] ?? '')) !== false) {
            $redis->del($key);
        }
    }
} catch (Throwable $e) {
}

// 清理测试用户的所有会话 token
try {
    $redis = new Redis();
    $redis->connect('127.0.0.1', 6379);
    $keys = $redis->keys('pms:session:*');
    foreach ($keys as $key) {
        $session = json_decode((string) $redis->get($key), true);
        if (is_array($session) && in_array((int) ($session['user_id'] ?? 0), array_map('intval', $user_ids), true)) {
            $redis->del($key);
        }
    }
} catch (Throwable $e) {
    echo 'redis cleanup skipped: '.$e->getMessage()."\n";
}

echo "cleanup ok\n";
