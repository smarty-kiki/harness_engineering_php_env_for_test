当前项目的请求地址是 http://127.0.0.1/  

与项目相关的组件的日志文件如下：  
Nginx 请求日志：/var/log/nginx/access.log  
Nginx 错误日志：/var/log/nginx/error.log  
PHP-FPM 日志：/var/log/php-fpm.log  
MySQL 错误日志：/var/log/mysql/error.log  
MySQL 慢查询日志：/var/log/mysql/slow.log  
MySQL SQL 日志：/var/log/mysql/mysql.log  
Redis 日志：/var/log/redis/redis-server.log  
Redis 执行命令日志：/var/log/redis/redis-cli.log  
<!-- clickhouse -->
ClickHouse 服务日志：/var/log/clickhouse-server/clickhouse-server.log  
ClickHouse 错误日志：/var/log/clickhouse-server/clickhouse-server.err.log  
<!-- /clickhouse -->
<!-- kafka -->
Kafka broker 日志：/var/log/kafka/server.log  
Kafka 控制器日志：/var/log/kafka/controller.log  
<!-- /kafka -->
cda 日志：/tmp/chrome/supervisor-\*.log  

cda 是一个允许你操作浏览器来访问页面、测试页面的工具，**交互式页面访问优先使用 cda**，完后把访问过程中你自己打开的页面关掉，**原本就存在的页面不要去关**，当 cda 中没有浏览器在线时才用 curl 命令做临时替代。工具说明：/var/www/chrome_do_action/cli/help.md  
**需要自动化前端流程、截图、录像、trace 或前端覆盖率时用 playwright-run**（见下方覆盖率说明），只有接口 API 访问和测试才用 curl 命令来测试  

## 黑盒测试（轮次 / 覆盖率 / 8080）

本环境默认开启 PCOV 黑盒覆盖率，不需要写 PHPUnit 测试；前端自动化测试与覆盖率使用容器内 Playwright（独立 Chromium），不依赖宿主机 Chrome。详细使用说明见 `/usr/local/share/harness/coverage/README.md`。

**测试以「轮次」为单位**：写用例前先执行 `round-status start --name=<名称> --suite-dir=/var/www/test_usecase`，轮次会立即出现在 8080；执行 `/var/www/test_usecase/run-all.sh` 复用当前 active 轮次，按准备 / 造数 / 前端 / 接口 / CLI / 覆盖率 / 报告持续更新状态，结束后归档到 `/var/log/harness-coverage/rounds/<轮次>/`。

写用例时遵守三条硬约束（`run-all` 默认 `AUDIT_STRICT=1`，不通过本轮失败）：

- **页面优先**：同一行为先写页面用例；接口 / CLI 只补页面不可达或难以稳定触发的分支，并写 `via_page`（对应页面用例名）或 `unreachable_reason`（不可达原因）。
- **写数据必查库**：所有新增 / 修改 / 删除 / 状态流转，以及应被拒绝的写入，页面或接口操作后都要查询数据库确认落库结果。用例写 `mutates_data: true` 与非空 `db_verification`；可用 `/var/www/test_usecase/fixtures/db_check.php` 查询。页面提示或接口返回成功不算通过。
- **覆盖率按整轮统计**：PHP 覆盖本轮全部页面 / API / CLI / 队列执行，不是只统计接口与 CLI；JS 覆盖本轮全部 Playwright 页面流程（`frontend-coverage-report --round <轮次>`），不是按单次运行或按测试层切分。

最短流程：

1. 登记轮次（可传上一轮的 `next-round-plan.md` 作为 `--plan`），然后写三类用例。
2. 执行 `/var/www/test_usecase/run-all.sh`：它负责准备 / 清理 / 造数、自动 `coverage-reset`、执行前端 / 接口 / CLI 用例、生成本轮报告、趋势和下一轮计划，最后归档轮次。
3. 查看报告中的未覆盖行与 `coverage-trend`，按计划补下一轮；连续 2 轮 PHP 业务口径与 JS 覆盖率增量都小于 0.5 个百分点，或未覆盖行已没有可通过现有入口触达的代码时停止。
4. 需要单独跑页面流程时用 `playwright-run <flow.js>`，查看某轮合并的 JS 覆盖率用 `frontend-coverage-report --round <轮次>`。

手动补测与排查时：

- PHP：`coverage-reset` → 通过 cda / curl / bash 测试 → `coverage-report`；需要在浏览器查看时执行 `coverage-report --html` 发布到 8080 的 `/php-coverage/`。后端覆盖率累计到下一次 `coverage-reset`；`coverage-reset` 只清 PHP 采集事件，不删除已生成的 trace、录像和前端报告。
- 前端：复制 `/usr/local/share/harness/playwright/flow-example.js` 写流程 → `playwright-run <flow.js>`；`frontend-coverage-report --run <运行目录>` 只用于调试，轮次判断用 `--round <轮次>` 的合并结果。
- 轮次报告：`round-report <round_dir> [<playwright_run_dir>]` 可手动生成；`run-all` 会自动调用并归档到 `/var/log/harness-coverage/rounds/<轮次>/`。报告工作目录是 `/var/www/test_usecase/reports/rounds/<轮次>/`，运行期 `state/`、`reports/` 不持久化；兼容旧观测台仍会复制一份到 Playwright 运行目录的 `round/`。

观测入口在 8080（容器需映射 `-p 8080:8080`）：`/` 观测台（轮次从编写用例阶段就显示，执行中每 3 秒刷新；每轮含分层进度、页面穿透与落库审计、Trace、完整覆盖率报告）、`/live` 只读实时画面、`/rounds/` 轮次归档、`/artifacts/` 产物（含 trace.zip、录像、截图）、`/js-coverage/` 最近一次运行的前端覆盖率、`/php-coverage/` 最近一次 `coverage-report --html` 的快照、`/reports/` 前后端覆盖率总览（同一页切换）、`/trace/` Trace Viewer。

harness 在 `/var/www/test_usecase` 提供通用测试平台骨架（入口 `run-all.sh`，含通用破坏性工具）；具体项目的用例、造数与清理脚本放运行期目录或项目挂载目录。测试设计（接口不可用、底层数据删除、输入格式 / 长度 / 数量边界、命令回滚、组合场景）先读 `/usr/local/share/harness/test_usecase/TEST_DESIGN.md`；按入口分层设计、按边界清单列用例，破坏性用例同样计入通过率，覆盖率不能作为唯一锚点。报告输入、`summary.json` 契约、审计规则与发布方式见 `/usr/local/share/harness/coverage/round-report.md`。

<!-- clickhouse -->

ClickHouse 的 SQL 记录在 system.query_log 表里，要看 SQL 就用 clickhouse-client 查询，例如：  
clickhouse-client --query "SELECT event_time, query_duration_ms, exception, query FROM system.query_log WHERE type = 'QueryFinish' ORDER BY event_time DESC LIMIT 20"  
ClickHouse 的配置不要直接改 /etc/clickhouse-server/config.xml，在 /etc/clickhouse-server/config.d/ 下新建 xml 文件覆盖  
<!-- /clickhouse -->
<!-- kafka -->

Kafka 是本机单机 broker（KRaft 模式，监听 127.0.0.1:9092），看 topic 与消息的命令：  
kafka-topics --bootstrap-server 127.0.0.1:9092 --list  
kcat -b 127.0.0.1:9092 -t 主题名 -C -e -o beginning（从头发送一条条看消息）  
建 topic：kafka-topics --bootstrap-server 127.0.0.1:9092 --create --topic 主题名 --partitions 3  
broker 配置改 /opt/kafka/config/server.properties 后 service kafka restart 生效（数据在 /var/lib/kafka）  
项目用 php-vibe-coding-frame 的 kafka 队列（frame/queue_kafka.php）时，PHP 侧的 rdkafka 扩展与 kcat 都已装好，不用再装；  
该队列消费的 topic 必须先存在（第一次投递时 broker 会自动建），topic 不存在时 worker 会报错退出，先建 topic 或先投递一次即可  
<!-- /kafka -->

如果项目有用 php-vibe-coding-frame 框架，php-vibe-coding-frame 框架实现中项目的日志文件如下：  
项目运行的异常的日志：/tmp/php_exception.log  
项目运行的提醒日志：/tmp/php_notice.log  
项目中的模块打印日志：/tmp/php_module.log  
项目中队列 worker 会让 supervisor 来进行守护，所以队列的输出会记录在 /var/log/supervisor/\*.log 中  

如果我说让你自己测试一下，你就通过访问对应功能的网页或者 API 来测试，检查输出结果，如果报错了，就检查错误日志自己开始修复，先看项目异常日志就可以快速发现问题了，如果不足以定位问题再看其他的错误日志  

如果你修复问题时修改到了组件的配置文件，可以用 service 命令来重启重新加载配置文件，这个环境里是用的 mariadb 来代替的 MySQL，如下示例：  
service php8.4-fpm   restart  
service nginx        restart  
service mariadb      restart  
service redis-server restart  
service beanstalkd   restart  
<!-- clickhouse -->
service clickhouse-server restart  
<!-- /clickhouse -->
<!-- kafka -->
service kafka        restart  
<!-- /kafka -->
service supervisor   restart  

当你修改完代码后，自己将项目中所有改动添加到 git 管理范围，可执行 git add --all 命令来添加，并生成一个 commit message 来提交 commit，message 要遵循规则：  
message 为四段结构，列出来新增了什么功能、修改了什么功能、删除了什么功能、修复了什么问题，没有的段落就不用写，不是讲文件名，而是讲什么功能什么问题，message 格式要遵循盘古之白原则  
在 commit 时，临时定义 Author 身份，如 git commit -m "" --author="Harness Developer <harness@yao-yang.cn>"  
