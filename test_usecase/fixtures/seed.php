<?php
/**
 * Playwright 黑盒测试数据准备脚本。
 *
 * 只通过项目自身的 domain 层创建测试数据，不修改被测项目代码。
 * 运行：php /var/www/test_usecase/seed.php
 * 输出：/var/www/test_usecase/state/state.json（供前端 / API / CLI 测试使用）
 */

chdir('/var/www/project_manage_system');

include 'bootstrap.php';

$tag = getenv('PW_TAG') ?: date('YmdHis');

$state = [
    'tag'  => $tag,
    'base' => 'http://127.0.0.1',
    'users' => [],
    'teams' => [],
    'projects' => [],
    'p1' => [],
    'p2' => [],
    'p3' => [],
    'p4' => [],
];

$mk_email = function ($name) use ($tag) {
    return 'pw-'.$name.'-'.$tag.'@example.com';
};

// 供状态日志使用的可控时间
$now = time();

unit_of_work(function () use ($tag, $mk_email, &$state, $now) {

    // ---------- 用户 ----------
    $owner    = user::create($mk_email('owner'), 'PW 拥有者');
    $member   = user::create($mk_email('member'), 'PW 成员');
    $invitee  = user::create($mk_email('invitee'), 'PW 受邀人');
    $decliner = user::create($mk_email('decliner'), 'PW 拒绝人');
    $outsider = user::create($mk_email('outsider'), 'PW 局外人');

    $state['users'] = [
        'owner'    => ['id' => (int) $owner->id, 'email' => $owner->email, 'nickname' => $owner->nickname],
        'member'   => ['id' => (int) $member->id, 'email' => $member->email, 'nickname' => $member->nickname],
        'invitee'  => ['id' => (int) $invitee->id, 'email' => $invitee->email, 'nickname' => $invitee->nickname],
        'decliner' => ['id' => (int) $decliner->id, 'email' => $decliner->email, 'nickname' => $decliner->nickname],
        'outsider' => ['id' => (int) $outsider->id, 'email' => $outsider->email, 'nickname' => $outsider->nickname],
    ];

    // ---------- 团队 ----------
    $team_a = team_space::create((int) $owner->id, 'PW 团队 A '.$tag, 'Playwright 主测试团队');
    team_space_member::create((int) $team_a->id, (int) $owner->id, 'owner');
    team_space_member::create((int) $team_a->id, (int) $member->id, 'member');

    $team_b = team_space::create((int) $owner->id, 'PW 团队 B '.$tag, '用于顶部团队切换');
    team_space_member::create((int) $team_b->id, (int) $owner->id, 'owner');

    $team_out = team_space::create((int) $outsider->id, 'PW 外部团队 '.$tag, '局外人的团队');
    team_space_member::create((int) $team_out->id, (int) $outsider->id, 'owner');

    $state['teams'] = [
        'a'       => ['id' => (int) $team_a->id, 'name' => $team_a->name],
        'b'       => ['id' => (int) $team_b->id, 'name' => $team_b->name],
        'outside' => ['id' => (int) $team_out->id, 'name' => $team_out->name],
    ];

    // 邀请在测试流程中通过接口创建：带 pending 邀请时团队页存在已知渲染缺陷，
    // 先验证无邀请时的团队页，再创建邀请并验证受邀人工作台流程。

    // ---------- 项目 ----------
    $p1 = project::create((int) $team_a->id, 'PW 初版项目', '初版阶段：用于需求/缺陷流转与初版发布测试');
    $p2 = project::create((int) $team_a->id, 'PW 版本项目', '已发布：用于版本、知识、用例与助手测试');
    $p3 = project::create((int) $team_a->id, 'PW 空项目', '空数据项目：用于空状态测试');
    $p4 = project::create((int) $team_out->id, 'PW 外部项目', '局外人团队的项目');

    $state['projects'] = [
        'p1' => ['id' => (int) $p1->id, 'name' => $p1->name],
        'p2' => ['id' => (int) $p2->id, 'name' => $p2->name],
        'p3' => ['id' => (int) $p3->id, 'name' => $p3->name],
        'p4' => ['id' => (int) $p4->id, 'name' => $p4->name],
    ];

    // ---------- 通用小工具 ----------
    $mk_role = function ($project, $name, $desc) {
        return project_role::create((int) $project->id, $name, $desc);
    };

    $mk_process = function ($project, $name, $related, $desc) {
        return business_process::create((int) $project->id, $name, $related, $desc);
    };

    $mk_node = function ($process, $name, $seq, $role, $desc) {
        return business_process_node::create((int) $process->id, $name, $seq, (int) $role->id, $desc);
    };

    $mk_system = function ($project, $name, $platform, $roles, $desc = '') {
        $system = project_system::create((int) $project->id, $name, $platform, $desc);
        $system->role_ids = implode(',', array_map(function ($role) { return (int) $role->id; }, $roles));
        return $system;
    };

    $mk_module = function ($system, $name, $desc = '') {
        return system_module::create((int) $system->id, $name, $desc);
    };

    $mk_page = function ($module, $name, $route, $desc = '') {
        return system_page::create((int) $module->id, $name, $desc, $route);
    };

    $mk_api = function ($module, $name, $method, $path, $purpose) {
        return system_server_api::create((int) $module->id, $name, $method, $path, $purpose);
    };

    $mk_open_api = function ($module, $name, $method, $path, $purpose) {
        return system_open_api::create((int) $module->id, $name, $method, $path, $purpose);
    };

    $mk_cron = function ($module, $name, $schedule, $desc) {
        return system_cron_job::create((int) $module->id, $name, $schedule, $desc);
    };

    $link = function ($work_type, $work_id, $asset_type, $asset_id) {
        work_asset_link::create($work_type, (int) $work_id, $asset_type, (int) $asset_id);
    };

    $add_log = function ($work_type, $work_id, $from, $to, $user_id, $time, $source = 'agent') {
        $log = work_status_log::create($work_type, (int) $work_id, $from, $to, (int) $user_id, $source);
        $log->create_time = date('Y-m-d H:i:s', $time);
        return $log;
    };

    $mk_work = function ($type, $project, $title, $status, $desc, $extra = []) use ($add_log, $owner, $now) {
        $class = $type;
        $work = $class::create((int) $project->id, $title, $desc);
        $work->no = work_next_no((int) $project->id, $type);
        $work->description = $desc;

        foreach ($extra as $key => $value) {
            $work->{$key} = $value;
        }

        // 创建日志 + 把状态推进到目标状态（历史完整，详情页变更历史有内容）
        $log_time = $now - 90000;
        $add_log($type, (int) $work->id, '', 'new', (int) $owner->id, $log_time, 'agent');

        $paths = [
            'new'        => [],
            'developing' => [['start_dev', 'developing']],
            'to_review'  => [['start_dev', 'developing'], ['finish_dev', 'to_review']],
            'accepted'   => [['start_dev', 'developing'], ['finish_dev', 'to_review'], ['finish_review', 'accepted']],
        ];

        $from = 'new';
        $i = 1;

        foreach ($paths[$status] ?? [] as $path) {
            $add_log($type, (int) $work->id, $from, $path[1], (int) $owner->id, $log_time + $i * 600, 'page');
            $from = $path[1];
            $i++;
        }

        $work->status = $status;

        return $work;
    };

    // =====================================================================
    // P1：初版项目（资产 + 需求/缺陷 + 用例）
    // =====================================================================
    $p1_role_manager = $mk_role($p1, '店长', '门店一线管理者，负责收银与报表查看');
    $p1_role_sys     = $mk_role($p1, '系统', '系统自动执行的环节');
    $p1_role_stock   = $mk_role($p1, '仓管', '库存服务的使用者');

    $p1_process = $mk_process($p1, '订单履约', '订单', '订单从创建到完成的完整流程');
    $p1_node1 = $mk_node($p1_process, '下单', 1, $p1_role_manager, '店长在收银台创建订单');
    $p1_node2 = $mk_node($p1_process, '自动支付', 2, $p1_role_sys, '系统自动完成支付校验');
    $p1_node3 = $mk_node($p1_process, '出库', 3, $p1_role_stock, '仓管确认库存并出库');

    $p1_sys = $mk_system($p1, '门店系统', 'web', [$p1_role_manager, $p1_role_sys], '门店收银与经营报表');
    $p1_mod_cashier = $mk_module($p1_sys, '收银管理', '收银台与订单操作');
    $p1_page_cashier = $mk_page($p1_mod_cashier, '收银台', '/cashier', '步骤：1.扫码商品 2.选择会员 3.收款');
    $p1_api_order_create = $mk_api($p1_mod_cashier, '创建订单', 'POST', '/api/order/create', '接收商品与会员参数，校验库存后创建订单');
    $p1_api_order_list = $mk_api($p1_mod_cashier, '订单列表', 'GET', '/api/order/list', '分页查询门店订单');
    $p1_open_order_sync = $mk_open_api($p1_mod_cashier, '订单同步', 'POST', '/api/open/order/sync', '供第三方系统同步订单');
    $p1_cron_day_close = $mk_cron($p1_mod_cashier, '日结汇总', '0 1 * * *', '每天凌晨汇总门店销售数据');

    $p1_mod_report = $mk_module($p1_sys, '报表统计', '销售报表与经营分析');
    $p1_page_report = $mk_page($p1_mod_report, '销售报表', '/reports', '步骤：1.选择日期 2.查看销售趋势');
    $p1_api_report = $mk_api($p1_mod_report, '报表查询', 'GET', '/api/report/query', '按日期范围汇总销售额');

    $p1_sys_stock = $mk_system($p1, '库存服务', 'api_service', [$p1_role_stock], '跨系统库存共享接口');
    $p1_mod_stock = $mk_module($p1_sys_stock, '库存管理', '库存数据的共享服务');
    $p1_page_stock = $mk_page($p1_mod_stock, '库存查询', '/stock/query', '查询商品实时库存');
    $p1_api_stock = $mk_api($p1_mod_stock, '库存查询', 'GET', '/api/stock/query', '查询商品实时库存');

    // 需求
    $r_new = $mk_work('requirement', $p1, '新增商品搜索', 'new', '**页面**\n- 收银台商品搜索\n\n**接口**\n- `GET /api/order/list`');
    $r_dev = $mk_work('requirement', $p1, '会员积分抵扣', 'developing', '会员下单时可用积分抵扣部分金额。');
    $r_review = $mk_work('requirement', $p1, '销售报表导出', 'to_review', '销售报表支持导出 Excel。');
    $r_acc1 = $mk_work('requirement', $p1, '订单创建', 'accepted', '收银台创建订单并自动生成单号。');
    $r_acc2 = $mk_work('requirement', $p1, '订单列表查询', 'accepted', '按时间范围查询订单列表。');
    $r_history = $mk_work('requirement', $p1, '历史变更演示', 'accepted', '用于验证变更历史分页的需求。');

    foreach ([
        [$r_new, [$p1_sys, $p1_mod_cashier, $p1_page_cashier, $p1_api_order_list], $p1_role_manager, $p1_process, $p1_node1],
        [$r_dev, [$p1_sys, $p1_mod_cashier, $p1_page_cashier, $p1_api_order_create], $p1_role_manager, $p1_process, $p1_node2],
        [$r_review, [$p1_sys, $p1_mod_report, $p1_page_report, $p1_api_report], $p1_role_manager, $p1_process, $p1_node1],
        [$r_acc1, [$p1_sys, $p1_mod_cashier, $p1_page_cashier, $p1_api_order_create], $p1_role_manager, $p1_process, $p1_node1],
        [$r_acc2, [$p1_sys, $p1_mod_cashier, $p1_page_cashier, $p1_api_order_list], $p1_role_manager, $p1_process, $p1_node1],
        [$r_history, [$p1_sys_stock, $p1_mod_stock, $p1_page_stock, $p1_api_stock], $p1_role_stock, $p1_process, $p1_node3],
    ] as $row) {
        list($work, $assets, $role, $process, $node) = $row;
        $link('requirement', (int) $work->id, 'system', (int) $assets[0]->id);
        $link('requirement', (int) $work->id, 'module', (int) $assets[1]->id);
        $link('requirement', (int) $work->id, 'page', (int) $assets[2]->id);
        $link('requirement', (int) $work->id, 'server_api', (int) $assets[3]->id);
        $link('requirement', (int) $work->id, 'role', (int) $role->id);
        $link('requirement', (int) $work->id, 'process', (int) $process->id);
        $link('requirement', (int) $work->id, 'process_node', (int) $node->id);
    }

    // 历史演示需求：补足 10 条状态日志（覆盖变更历史滚动分页）
    $history_seq = [];
    $status_cycle = ['new', 'developing', 'to_review', 'accepted', 'new', 'developing', 'to_review', 'accepted'];
    $base = $now - 40000;
    $from = 'new';

    foreach ($status_cycle as $index => $to) {
        $add_log('requirement', (int) $r_history->id, $from, $to, (int) $owner->id, $base + $index * 600, 'page');
        $history_seq[] = $to;
        $from = $to;
    }

    // 开发 BUG
    $b_new = $mk_work('bug', $p1, '收银台扫码无响应', 'new', '扫码枪扫描后页面没有反应。');
    $b_dev = $mk_work('bug', $p1, '报表金额四舍五入错误', 'developing', '金额展示少了一分钱。');
    $b_acc = $mk_work('bug', $p1, '订单重复提交', 'accepted', '快速点击提交生成两笔订单。');

    foreach ([[$b_new, $p1_sys], [$b_dev, $p1_sys], [$b_acc, $p1_sys]] as $row) {
        $link('bug', (int) $row[0]->id, 'system', (int) $row[1]->id);
        $link('bug', (int) $row[0]->id, 'module', (int) $p1_mod_cashier->id);
    }

    // P1 活跃助手会话：用于测试「确认方案」落库（不依赖真实大模型）
    $p1_plan = agent_session_plan_normalize([
        'roles' => [
            ['op' => 'ensure', 'name' => '运营专员', 'description' => '负责门店活动与数据运营'],
        ],
        'requirements' => [
            ['op' => 'ensure', 'title' => '用户反馈收集', 'description' => '在收银台增加用户反馈入口，收集顾客评价。', 'links' => []],
        ],
    ]);

    $p1_session = agent_session::create((int) $p1->id, (int) $owner->id, 'PW 初版项目待确认方案');
    $p1_session->plan_json = json_encode($p1_plan, JSON_UNESCAPED_UNICODE);
    $p1_session->round_count = 1;
    $p1_session->status = 'active';

    $p1_round = agent_run::create((int) $p1->id, (int) $owner->id, 'session', '增加用户反馈收集功能');
    $p1_round->session_id = (int) $p1_session->id;
    $p1_round->status = 'done';
    $p1_round->reply_text = '已生成用户反馈收集方案。';
    $p1_round->result_json = json_encode(['plan_counts' => ['roles' => 1, 'requirements' => 1]]);

    // 用例池草稿（初版项目没有版本）
    $p1_tc_rich = test_case::create((int) $p1->id, '收银台下单');
    $p1_tc_rich->description = "1. 打开收银台\n2. 扫码添加商品\n3. 点击收款";
    $p1_tc_rich->precondition = "门店已配置商品与库存";
    $p1_tc_rich->script = "打开 /cashier\n扫码商品\n提交订单\n断言订单生成";
    $p1_tc_rich->system_id = (int) $p1_sys->id;
    $p1_tc_rich->module_id = (int) $p1_mod_cashier->id;
    test_case_point::create((int) $p1_tc_rich->id, '正常创建订单', '订单创建成功并生成编号');
    test_case_point::create((int) $p1_tc_rich->id, '库存不足', '提示库存不足');
    test_case_point::create((int) $p1_tc_rich->id, '重复提交', '仅生成一笔订单');
    $link('test_case', (int) $p1_tc_rich->id, 'system', (int) $p1_sys->id);
    $link('test_case', (int) $p1_tc_rich->id, 'module', (int) $p1_mod_cashier->id);
    $link('test_case', (int) $p1_tc_rich->id, 'page', (int) $p1_page_cashier->id);
    $link('test_case', (int) $p1_tc_rich->id, 'server_api', (int) $p1_api_order_create->id);
    $link('test_case', (int) $p1_tc_rich->id, 'open_api', (int) $p1_open_order_sync->id);
    $link('test_case', (int) $p1_tc_rich->id, 'cron', (int) $p1_cron_day_close->id);

    $p1_tc_simple = test_case::create((int) $p1->id, '报表查询空数据');
    $p1_tc_simple->system_id = (int) $p1_sys->id;
    $p1_tc_simple->module_id = (int) $p1_mod_report->id;

    $state['p1'] = [
        'requirements' => [
            'new'     => ['id' => (int) $r_new->id, 'no' => $r_new->no, 'title' => $r_new->title],
            'dev'     => ['id' => (int) $r_dev->id, 'no' => $r_dev->no, 'title' => $r_dev->title],
            'review'  => ['id' => (int) $r_review->id, 'no' => $r_review->no, 'title' => $r_review->title],
            'accepted1' => ['id' => (int) $r_acc1->id, 'no' => $r_acc1->no, 'title' => $r_acc1->title],
            'accepted2' => ['id' => (int) $r_acc2->id, 'no' => $r_acc2->no, 'title' => $r_acc2->title],
            'history' => ['id' => (int) $r_history->id, 'no' => $r_history->no, 'title' => $r_history->title],
        ],
        'bugs' => [
            'new' => ['id' => (int) $b_new->id, 'no' => $b_new->no, 'title' => $b_new->title],
            'dev' => ['id' => (int) $b_dev->id, 'no' => $b_dev->no, 'title' => $b_dev->title],
            'accepted' => ['id' => (int) $b_acc->id, 'no' => $b_acc->no, 'title' => $b_acc->title],
        ],
        'systems' => [
            'main' => ['id' => (int) $p1_sys->id, 'name' => $p1_sys->name],
            'stock' => ['id' => (int) $p1_sys_stock->id, 'name' => $p1_sys_stock->name],
        ],
        'modules' => [
            'cashier' => ['id' => (int) $p1_mod_cashier->id, 'name' => $p1_mod_cashier->name],
            'report' => ['id' => (int) $p1_mod_report->id, 'name' => $p1_mod_report->name],
        ],
        'pages' => [
            'cashier' => ['id' => (int) $p1_page_cashier->id, 'name' => $p1_page_cashier->name],
            'report' => ['id' => (int) $p1_page_report->id, 'name' => $p1_page_report->name],
        ],
        'apis' => [
            'order_create' => ['id' => (int) $p1_api_order_create->id, 'name' => $p1_api_order_create->name],
            'order_list' => ['id' => (int) $p1_api_order_list->id, 'name' => $p1_api_order_list->name],
            'report' => ['id' => (int) $p1_api_report->id, 'name' => $p1_api_report->name],
        ],
        'test_cases' => [
            'rich' => ['id' => (int) $p1_tc_rich->id, 'name' => $p1_tc_rich->name],
            'simple' => ['id' => (int) $p1_tc_simple->id, 'name' => $p1_tc_simple->name],
        ],
        'sessions' => [
            'active' => ['id' => (int) $p1_session->id],
        ],
    ];

    // =====================================================================
    // P2：已发布项目（版本 + 已验收/池/开发中工作项 + 用例版本账 + 助手会话）
    // =====================================================================
    $p2_role_pm = $mk_role($p2, '产品经理', '负责需求设计与验收');
    $p2_role_dev = $mk_role($p2, '开发工程师', '负责需求开发');
    $p2_role_sys = $mk_role($p2, '系统', '系统自动执行');

    $p2_process = $mk_process($p2, '需求交付', '需求', '需求从提出到验收的流程');
    $p2_node1 = $mk_node($p2_process, '提需求', 1, $p2_role_pm, '产品经理梳理并提交需求');
    $p2_node2 = $mk_node($p2_process, '开发', 2, $p2_role_dev, '开发工程师完成编码');
    $p2_node3 = $mk_node($p2_process, '验收', 3, $p2_role_pm, '产品经理验收需求');

    $p2_sys = $mk_system($p2, '管理后台', 'web', [$p2_role_pm, $p2_role_dev, $p2_role_sys], '内部管理与报表系统');
    $p2_mod_user = $mk_module($p2_sys, '用户管理', '用户与权限维护');
    $p2_page_user = $mk_page($p2_mod_user, '用户列表', '/admin/users', '步骤：1.筛选用户 2.查看详情');
    $p2_api_user_list = $mk_api($p2_mod_user, '用户列表接口', 'GET', '/api/admin/user/list', '分页查询用户');
    $p2_api_user_create = $mk_api($p2_mod_user, '创建用户', 'POST', '/api/admin/user/create', '校验邮箱后创建用户');
    $p2_open_user_sync = $mk_open_api($p2_mod_user, '用户同步', 'POST', '/api/open/user/sync', '外部系统同步用户');
    $p2_cron_user_sync = $mk_cron($p2_mod_user, '用户同步任务', '0 */2 * * *', '每两小时同步用户');

    $p2_mod_report = $mk_module($p2_sys, '报表统计', '经营数据统计');
    $p2_page_report = $mk_page($p2_mod_report, '经营看板', '/admin/report', '步骤：1.选择周期 2.查看图表');
    $p2_api_report = $mk_api($p2_mod_report, '看板数据', 'GET', '/api/admin/report/dashboard', '返回经营看板数据');

    $p2_sys_open = $mk_system($p2, '开放服务', 'api_service', [$p2_role_dev], '跨系统开放接口');
    $p2_mod_open = $mk_module($p2_sys_open, '数据同步', '跨系统数据同步');
    $p2_open_data = $mk_open_api($p2_mod_open, '数据推送', 'POST', '/api/open/data/push', '接收第三方数据推送');

    // 系统仓库
    $p2_repo = system_repo::create((int) $p2_sys->id, 'https://github.com/pw-demo/admin.git', 'test', 'main');

    // 版本
    $v100 = project_version::create((int) $p2->id, '1.0.0', '初版正式发布');
    $v100->status = 'released';
    $v100->released_time = datetime($now - 86400 * 3);
    $v100->released_user_id = (int) $owner->id;

    $v110 = project_version::create((int) $p2->id, '1.1.0', '第二版开发中');

    $p2->state = 'released';
    $p2->initial_version_no = '1.0.0';

    // 工作项
    $r2_acc = $mk_work('requirement', $p2, '用户列表查询', 'accepted', '管理后台支持按关键字分页查询用户。', ['version_id' => (int) $v100->id]);
    $r2_acc->feature_branch = 'feature/REQ-1';
    $r2_acc->code_added = 120;
    $r2_acc->code_deleted = 30;
    $r2_acc->dev_system_id = (int) $p2_sys->id;
    $r2_acc->finish_dev_time = datetime($now - 86400 * 4);
    $r2_acc->finish_review_time = datetime($now - 86400 * 3);

    $r2_modified = $mk_work('requirement', $p2, '用户详情查看', 'accepted', '点击用户查看详情信息。', ['version_id' => (int) $v100->id]);
    $r2_modified->feature_branch = 'feature/REQ-2';
    $r2_modified->code_added = 40;
    $r2_modified->code_deleted = 5;

    $r2_new = $mk_work('requirement', $p2, '用户导出 Excel', 'new', '用户列表支持导出 Excel。', ['version_id' => (int) $v110->id]);
    $r2_dev = $mk_work('requirement', $p2, '用户批量禁用', 'developing', '支持批量禁用用户。', ['version_id' => (int) $v110->id]);
    $r2_pool = $mk_work('requirement', $p2, '用户标签体系', 'new', '为用户增加标签。', ['version_id' => null]);

    foreach ([
        [$r2_acc, $p2_mod_user, $p2_page_user, $p2_api_user_list],
        [$r2_modified, $p2_mod_user, $p2_page_user, $p2_api_user_create],
        [$r2_new, $p2_mod_report, $p2_page_report, $p2_api_report],
        [$r2_dev, $p2_mod_user, $p2_page_user, $p2_api_user_list],
        [$r2_pool, $p2_mod_user, $p2_page_user, $p2_api_user_list],
    ] as $row) {
        $link('requirement', (int) $row[0]->id, 'system', (int) $p2_sys->id);
        $link('requirement', (int) $row[0]->id, 'module', (int) $row[1]->id);
        $link('requirement', (int) $row[0]->id, 'page', (int) $row[2]->id);
        $link('requirement', (int) $row[0]->id, 'server_api', (int) $row[3]->id);
        $link('requirement', (int) $row[0]->id, 'role', (int) $p2_role_pm->id);
        $link('requirement', (int) $row[0]->id, 'process', (int) $p2_process->id);
        $link('requirement', (int) $row[0]->id, 'process_node', (int) $p2_node1->id);
    }

    $b2_acc = $mk_work('bug', $p2, '用户列表分页错误', 'accepted', '第二页重复第一页数据。', ['version_id' => (int) $v100->id]);
    $b2_new = $mk_work('bug', $p2, '导出按钮无响应', 'new', '点击导出没有下载。', ['version_id' => (int) $v110->id]);
    $b2_pool = $mk_work('bug', $p2, '登录偶发失败', 'new', '偶发登录超时。', ['version_id' => null]);

    foreach ([$b2_acc, $b2_new, $b2_pool] as $bug) {
        $link('bug', (int) $bug->id, 'system', (int) $p2_sys->id);
        $link('bug', (int) $bug->id, 'module', (int) $p2_mod_user->id);
    }

    $d2_acc = $mk_work('prod_defect', $p2, '线上报表数据为空', 'accepted', '生产环境看板无数据。', ['version_id' => (int) $v100->id, 'impact' => '影响运营查看经营数据']);
    $d2_pool = $mk_work('prod_defect', $p2, '线上登录验证码收不到', 'new', '用户反馈验证码延迟。', ['version_id' => null, 'impact' => '影响新用户登录']);
    $d2_dev = $mk_work('prod_defect', $p2, '线上用户头像丢失', 'developing', '部分用户头像 404。', ['version_id' => (int) $v110->id, 'impact' => '影响用户识别']);

    foreach ([$d2_acc, $d2_pool, $d2_dev] as $defect) {
        $link('prod_defect', (int) $defect->id, 'system', (int) $p2_sys->id);
        $link('prod_defect', (int) $defect->id, 'module', (int) $p2_mod_user->id);
    }

    // 用例 + 版本账
    $mk_case = function ($name, $system, $module, $version_id, $action, $with_assets = true) use ($p2, $link) {
        $case = test_case::create((int) $p2->id, $name);
        $case->description = "步骤：\n1. 打开页面\n2. 执行操作\n3. 校验结果";
        $case->precondition = '测试环境可用';
        $case->script = "- 打开页面\n- 执行操作\n- 断言结果";
        $case->system_id = (int) $system->id;
        $case->module_id = (int) $module->id;
        $case->version_id = $version_id === null ? null : (int) $version_id;
        test_case_point::create((int) $case->id, $name.' 正常流程', '操作成功');
        return $case;
    };

    $c2_v100 = $mk_case('用户列表查询', $p2_sys, $p2_mod_user, (int) $v100->id, 'created');
    $link('test_case', (int) $c2_v100->id, 'system', (int) $p2_sys->id);
    $link('test_case', (int) $c2_v100->id, 'module', (int) $p2_mod_user->id);
    $link('test_case', (int) $c2_v100->id, 'page', (int) $p2_page_user->id);
    $link('test_case', (int) $c2_v100->id, 'server_api', (int) $p2_api_user_list->id);
    test_case_version_ref::create((int) $p2->id, (int) $v100->id, (int) $c2_v100->id, 'created');

    $c2_modified = $mk_case('用户详情查看', $p2_sys, $p2_mod_user, (int) $v100->id, 'created');
    $link('test_case', (int) $c2_modified->id, 'system', (int) $p2_sys->id);
    $link('test_case', (int) $c2_modified->id, 'module', (int) $p2_mod_user->id);
    $link('test_case', (int) $c2_modified->id, 'page', (int) $p2_page_user->id);
    test_case_version_ref::create((int) $p2->id, (int) $v100->id, (int) $c2_modified->id, 'created');
    // 1.1.0 修改：此时主表保持最新形态，账记 modified
    test_case_version_ref::create((int) $p2->id, (int) $v110->id, (int) $c2_modified->id, 'modified');

    $c2_v110 = $mk_case('导出用户 Excel', $p2_sys, $p2_mod_user, (int) $v110->id, 'created');
    $link('test_case', (int) $c2_v110->id, 'system', (int) $p2_sys->id);
    $link('test_case', (int) $c2_v110->id, 'module', (int) $p2_mod_user->id);
    $link('test_case', (int) $c2_v110->id, 'page', (int) $p2_page_user->id);
    $link('test_case', (int) $c2_v110->id, 'server_api', (int) $p2_api_user_list->id);
    $link('test_case', (int) $c2_v110->id, 'open_api', (int) $p2_open_user_sync->id);
    $link('test_case', (int) $c2_v110->id, 'cron', (int) $p2_cron_user_sync->id);
    test_case_version_ref::create((int) $p2->id, (int) $v110->id, (int) $c2_v110->id, 'created');

    $c2_deleted = $mk_case('旧版导出按钮', $p2_sys, $p2_mod_user, (int) $v100->id, 'created');
    test_case_version_ref::create((int) $p2->id, (int) $v100->id, (int) $c2_deleted->id, 'created');
    test_case_version_ref::create((int) $p2->id, (int) $v110->id, (int) $c2_deleted->id, 'deleted');

    $c2_pool = $mk_case('用户搜索联想', $p2_sys, $p2_mod_user, null, '');
    $link('test_case', (int) $c2_pool->id, 'system', (int) $p2_sys->id);
    $link('test_case', (int) $c2_pool->id, 'module', (int) $p2_mod_user->id);
    $link('test_case', (int) $c2_pool->id, 'page', (int) $p2_page_user->id);

    // 版本 1.0.0 的定稿在第二段事务里完成：先软删「本版删除」用例，再冻结快照

    // ---------- Agent 单场景历史 ----------
    $runs = [];
    for ($i = 0; $i < 16; $i++) {
        $run = agent_run::create((int) $p2->id, (int) $owner->id, 'requirement', 'PW 历史需求 '.($i + 1));
        $run->status = 'done';
        $run->result_json = json_encode(['works' => [['title' => 'PW 历史需求 '.($i + 1)]]], JSON_UNESCAPED_UNICODE);
        $run->work_id = (int) $r2_acc->id;
        $run->work_type = 'requirement';
        $run->create_time = date('Y-m-d H:i:s', $now - 86400 + $i * 60);
        $runs[] = $run;
    }

    // 最新一轮历史对话产生了一条需求变更（详情页「来源」链接 + 历史详情变更清单），
    // 保证历史列表第一页即可看到该轮次
    $changed_run = $runs[15];
    $change_created = agent_run_change::create((int) $changed_run->id, 'requirement', 'created', (int) $r2_acc->id, (string) $r2_acc->no, (string) $r2_acc->title);
    $change_created->project_id = (int) $p2->id;
    $change_deleted = agent_run_change::create((int) $changed_run->id, 'requirement', 'deleted', (int) $r2_pool->id, (string) $r2_pool->no, (string) $r2_pool->title);
    $change_deleted->project_id = (int) $p2->id;

    $failed_run = agent_run::create((int) $p2->id, (int) $owner->id, 'requirement', 'PW 失败的助手任务');
    $failed_run->status = 'failed';
    $failed_run->error_message = '模拟的模型调用失败';

    // ---------- 大而全助手会话 ----------
    $plan_raw = [
        'roles' => [
            ['op' => 'ensure', 'name' => '产品经理', 'description' => '负责需求设计与验收'],
            ['op' => 'ensure', 'name' => '运营专员', 'description' => '负责日常运营数据查看'],
            ['op' => 'delete', 'name' => '旧角色'],
        ],
        'processes' => [
            ['op' => 'ensure', 'name' => '需求交付', 'related_object' => '需求', 'description' => '需求从提出到验收的流程', 'nodes' => [
                ['op' => 'ensure', 'name' => '提需求', 'role' => '产品经理', 'description' => '产品经理梳理并提交需求'],
                ['op' => 'ensure', 'name' => '开发', 'role' => '开发工程师', 'description' => '开发工程师完成编码'],
                ['op' => 'ensure', 'name' => '验收', 'role' => '产品经理', 'description' => '产品经理验收需求'],
                ['op' => 'delete', 'name' => '废弃节点', 'role' => '产品经理', 'description' => ''],
            ]],
        ],
        'systems' => [
            ['op' => 'ensure', 'name' => '管理后台', 'platform' => 'web', 'roles' => ['产品经理', '开发工程师'], 'description' => '内部管理与报表系统', 'modules' => [
                ['op' => 'ensure', 'name' => '用户管理', 'description' => '用户与权限维护', 'pages' => [
                    ['op' => 'ensure', 'name' => '用户列表', 'route' => '/admin/users', 'description' => '步骤：1.筛选用户 2.查看详情'],
                    ['op' => 'ensure', 'name' => '用户详情', 'route' => '/admin/user/detail', 'description' => '展示用户资料'],
                    ['op' => 'delete', 'name' => '旧用户页', 'route' => '/old', 'description' => ''],
                ], 'server_apis' => [
                    ['op' => 'ensure', 'name' => '用户列表接口', 'method' => 'GET', 'path' => '/api/admin/user/list', 'purpose' => '分页查询用户'],
                ], 'open_apis' => [], 'cron_jobs' => []],
                ['op' => 'ensure', 'name' => '报表统计', 'description' => '经营数据统计', 'pages' => [], 'server_apis' => [
                    ['op' => 'ensure', 'name' => '看板数据', 'method' => 'GET', 'path' => '/api/admin/report/dashboard', 'purpose' => '返回看板数据'],
                ], 'open_apis' => [], 'cron_jobs' => []],
            ]],
        ],
        'requirements' => [
            ['op' => 'ensure', 'ref' => '', 'title' => '用户标签管理', 'description' => '为用户打标签并按标签筛选。', 'links' => []],
            ['op' => 'delete', 'ref' => 'REQ-9999999', 'title' => '用户标签管理（旧）', 'description' => '', 'links' => []],
        ],
        'prod_defects' => [
            ['op' => 'ensure', 'ref' => '', 'title' => '线上导出失败', 'impact' => '影响运营导出数据', 'description' => '线上导出接口报错。', 'links' => []],
        ],
    ];

    $plan = agent_session_plan_normalize($plan_raw);

    $session_confirmed = agent_session::create((int) $p2->id, (int) $owner->id, 'PW 已确认方案');
    $session_confirmed->plan_json = json_encode($plan, JSON_UNESCAPED_UNICODE);
    $session_confirmed->result_json = json_encode(['works' => [['id' => (int) $r2_acc->id, 'no' => $r2_acc->no, 'title' => $r2_acc->title, 'work_type' => 'requirement', 'action' => 'updated']], 'assets' => ['role' => ['created' => 1, 'updated' => 0, 'deleted' => 0]], 'skipped' => []], JSON_UNESCAPED_UNICODE);
    $session_confirmed->round_count = 2;
    $session_confirmed->status = 'confirmed';

    $round1 = agent_run::create((int) $p2->id, (int) $owner->id, 'session', '帮我规划用户管理功能');
    $round1->session_id = (int) $session_confirmed->id;
    $round1->status = 'done';
    $round1->reply_text = "## 方案概览\n\n- **角色**：产品经理、运营专员\n- **系统**：管理后台\n\n| 模块 | 页面 |\n| --- | --- |\n| 用户管理 | 用户列表 |\n\n> 确认后写入项目。\n\n1. 第一步\n2. 第二步\n   - 子项\n\n---\n\n~~废弃说明~~\n\n```js\n示例代码\n```";
    $round1->result_json = json_encode(['plan_counts' => ['roles' => 2]]);

    $round2 = agent_run::create((int) $p2->id, (int) $owner->id, 'session', '再增加一个运营角色');
    $round2->session_id = (int) $session_confirmed->id;
    $round2->status = 'done';
    $round2->reply_text = '已根据你的要求更新方案。';
    $round2->result_json = json_encode(['plan_counts' => ['roles' => 3]]);

    $round_failed = agent_run::create((int) $p2->id, (int) $owner->id, 'session', '进入失败分支');
    $round_failed->session_id = (int) $session_confirmed->id;
    $round_failed->status = 'failed';
    $round_failed->error_message = '模拟的会话失败';

    $session_abandoned = agent_session::create((int) $p2->id, (int) $owner->id, 'PW 已放弃方案');
    $session_abandoned->plan_json = json_encode($plan, JSON_UNESCAPED_UNICODE);
    $session_abandoned->round_count = 1;
    $session_abandoned->status = 'abandoned';

    // 活跃会话：测试项目助手页面方案展示与放弃流程
    $session_active = agent_session::create((int) $p2->id, (int) $owner->id, 'PW 进行中的方案');
    $session_active->plan_json = json_encode($plan, JSON_UNESCAPED_UNICODE);
    $session_active->round_count = 1;
    $session_active->status = 'active';

    $round_active = agent_run::create((int) $p2->id, (int) $owner->id, 'session', '规划用户管理');
    $round_active->session_id = (int) $session_active->id;
    $round_active->status = 'done';
    $round_active->reply_text = '方案已生成，请确认。';
    $round_active->result_json = json_encode(['plan_counts' => ['roles' => 2]]);

    // 排队中的轮次：进入项目助手页时恢复运行态（页面会重连 SSE）
    $round_pending = agent_run::create((int) $p2->id, (int) $owner->id, 'session', '继续补充一个报表需求');
    $round_pending->session_id = (int) $session_active->id;
    $round_pending->status = 'pending';

    // 开放接口 Key（含一条旧版无明文 Key，覆盖复制回退分支）
    $token = 'pms_pwseed'.substr(hash('sha256', $tag), 0, 40);
    $api_key = api_key::create((int) $owner->id, 'PW 集成 Key', $token, hash('sha256', $token), substr($token, -4));
    $old_key = api_key::create((int) $owner->id, 'PW 旧版 Key', '', hash('sha256', 'pms_old_'.$tag), 'OLD1');

    $state['p2'] = [
        'systems' => [
            'main' => ['id' => (int) $p2_sys->id, 'name' => $p2_sys->name],
            'open' => ['id' => (int) $p2_sys_open->id, 'name' => $p2_sys_open->name],
        ],
        'modules' => [
            'user' => ['id' => (int) $p2_mod_user->id, 'name' => $p2_mod_user->name],
            'report' => ['id' => (int) $p2_mod_report->id, 'name' => $p2_mod_report->name],
        ],
        'pages' => [
            'user' => ['id' => (int) $p2_page_user->id, 'name' => $p2_page_user->name],
            'report' => ['id' => (int) $p2_page_report->id, 'name' => $p2_page_report->name],
        ],
        'apis' => [
            'user_list' => ['id' => (int) $p2_api_user_list->id, 'name' => $p2_api_user_list->name],
            'report' => ['id' => (int) $p2_api_report->id, 'name' => $p2_api_report->name],
        ],
        'versions' => [
            'v100' => ['id' => (int) $v100->id, 'no' => $v100->version_no, 'status' => 'released'],
            'v110' => ['id' => (int) $v110->id, 'no' => $v110->version_no, 'status' => 'draft'],
        ],
        'requirements' => [
            'accepted' => ['id' => (int) $r2_acc->id, 'no' => $r2_acc->no, 'title' => $r2_acc->title],
            'modified' => ['id' => (int) $r2_modified->id, 'no' => $r2_modified->no, 'title' => $r2_modified->title],
            'new' => ['id' => (int) $r2_new->id, 'no' => $r2_new->no, 'title' => $r2_new->title],
            'dev' => ['id' => (int) $r2_dev->id, 'no' => $r2_dev->no, 'title' => $r2_dev->title],
            'pool' => ['id' => (int) $r2_pool->id, 'no' => $r2_pool->no, 'title' => $r2_pool->title],
        ],
        'bugs' => [
            'accepted' => ['id' => (int) $b2_acc->id, 'no' => $b2_acc->no, 'title' => $b2_acc->title],
            'new' => ['id' => (int) $b2_new->id, 'no' => $b2_new->no, 'title' => $b2_new->title],
            'pool' => ['id' => (int) $b2_pool->id, 'no' => $b2_pool->no, 'title' => $b2_pool->title],
        ],
        'prod_defects' => [
            'accepted' => ['id' => (int) $d2_acc->id, 'no' => $d2_acc->no, 'title' => $d2_acc->title],
            'pool' => ['id' => (int) $d2_pool->id, 'no' => $d2_pool->no, 'title' => $d2_pool->title],
            'dev' => ['id' => (int) $d2_dev->id, 'no' => $d2_dev->no, 'title' => $d2_dev->title],
        ],
        'test_cases' => [
            'v100' => ['id' => (int) $c2_v100->id, 'name' => $c2_v100->name],
            'modified' => ['id' => (int) $c2_modified->id, 'name' => $c2_modified->name],
            'v110' => ['id' => (int) $c2_v110->id, 'name' => $c2_v110->name],
            'deleted' => ['id' => (int) $c2_deleted->id, 'name' => $c2_deleted->name],
            'pool' => ['id' => (int) $c2_pool->id, 'name' => $c2_pool->name],
        ],
        'runs' => [
            'changed' => ['id' => (int) $changed_run->id],
            'oldest' => ['id' => (int) $runs[0]->id],
            'failed' => ['id' => (int) $failed_run->id],
        ],
        'sessions' => [
            'confirmed' => ['id' => (int) $session_confirmed->id],
            'abandoned' => ['id' => (int) $session_abandoned->id],
            'active' => ['id' => (int) $session_active->id],
            'pending_round' => ['id' => (int) $round_pending->id],
        ],
        'repo' => ['url' => $p2_repo->repo_url, 'test_branch' => 'test', 'prod_branch' => 'main'],
    ];

    $state['p3'] = [];
    $state['p4'] = [
        'team_id' => (int) $team_out->id,
        'project_id' => (int) $p4->id,
    ];

    $state['api_key'] = [
        'id' => (int) $api_key->id,
        'token' => $token,
        'name' => $api_key->name,
        'old_id' => (int) $old_key->id,
    ];
});

// 第二段事务：把用例真软删（模拟 API 删除已持久化用例），再冻结 v1.0.0 的知识与用例快照。
unit_of_work(function () use (&$state) {
    $case = dao('test_case')->find_by_id((int) $state['p2']['test_cases']['deleted']['id']);
    $case->delete();
});

unit_of_work(function () use (&$state) {
    $project = dao('project')->find_by_id((int) $state['projects']['p2']['id']);
    $version = dao('project_version')->find_by_id((int) $state['p2']['versions']['v100']['id']);

    version_knowledge_freeze((int) $project->id, (int) $version->id);
    test_case_version_snapshot_freeze($project, $version);
});

file_put_contents(__DIR__.'/../state/state.json', json_encode($state, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

echo "seed ok\n";
echo "tag: {$tag}\n";
echo "owner: {$state['users']['owner']['email']}\n";
echo "p1: {$state['projects']['p1']['id']}, p2: {$state['projects']['p2']['id']}\n";
echo "state: /var/www/test_usecase/state/state.json\n";
