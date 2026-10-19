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

cda 是一个允许你操作浏览器来访问页面、测试页面的工具，**交互式页面访问和测试优先使用 cda**，完后把访问和测试过程中你自己打开的页面关掉，**原本就存在的页面不要去关**，当 cda 中没有浏览器在线时才用 curl 命令做临时替代。工具说明：/var/www/chrome_do_action/cli/help.md  
**需要自动化前端流程、截图、录像、trace 或前端覆盖率时用 playwright-run**（见下方覆盖率说明），只有接口 API 访问和测试才用 curl 命令来测试  

## 黑盒测试覆盖率（PHP + 前端）

本环境默认开启 PCOV 黑盒覆盖率，不需要写 PHPUnit 测试；前端自动化测试与覆盖率使用容器内 Playwright（独立 Chromium），不依赖宿主机 Chrome。详细使用说明见容器内文件 `/usr/local/share/harness/coverage/README.md`。

在以下场景先阅读该文件，再动手：

- 用户要求测试覆盖率、查看未覆盖行或生成覆盖率报告
- 开始一轮黑盒测试并需要评估覆盖情况
- 需要生成 HTML / Clover 报告，或覆盖率报告没有数据
- 需要统计浏览器端 JS 覆盖率
- 需要前端测试的截图、录像或 trace

最短流程：
- PHP：`coverage-reset` → 通过 cda / curl / bash 测试 → `coverage-report`；需要在浏览器查看时执行 `coverage-report --html` 发布到 8080 的 `/php-coverage/`。
- 前端：复制 `/usr/local/share/harness/playwright/flow-example.js` 写流程 → `playwright-run <flow.js>` → `frontend-coverage-report`。
- 观测入口在 8080（容器需映射 `-p 8080:8080`）：`/` 观测目录页（实时画面与测试轮次，每轮含用例通过率、Trace、覆盖率报告）、`/live` 只读实时画面、`/artifacts/` 产物（含 trace.zip、录像、截图）、`/js-coverage/` 前端 JS 覆盖率报告、`/php-coverage/` 后端 HTML 报告、`/reports/` 前后端覆盖率总览（同一页切换）、`/trace/` Trace Viewer。
- harness 在 `/var/www/test_usecase` 提供通用测试平台骨架（入口 `run-all.sh`，含通用破坏性工具）；具体项目的测试用例、造数/清理脚本和报告放运行期目录或挂载目录，**不要提交进 harness 仓库**。运行期 `state/`、`reports/` 不持久化，每轮报告会复制到 Playwright 运行目录的 `round/`。
- 设计测试用例（尤其接口不可用、底层数据删除、命令回滚等破坏性边界）先读 `/usr/local/share/harness/test_usecase/TEST_DESIGN.md`；按入口分层设计、按边界清单列用例，破坏性用例同样计入通过率，不能以覆盖率作为唯一锚点。
- 每轮全量报告用 `round-report <round_dir> <playwright_run_dir>` 生成，把整个 `round/` 复制到 Playwright 运行目录后由 8080 自动展示。输入文件、`summary.json` 契约、发布与回退规则见 `/usr/local/share/harness/coverage/round-report.md`。
- 前端覆盖率按每次 `playwright-run` 独立统计；后端覆盖率累计到下一次 `coverage-reset`。`coverage-reset` 不会删除已经生成的 trace、录像和报告。
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
