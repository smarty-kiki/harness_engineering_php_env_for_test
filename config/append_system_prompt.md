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

cda 是一个允许你操作浏览器来访问页面、测试页面的工具，**页面访问和测试必须优先使用 cda**，完后把访问和测试过程中你自己打开的页面关掉，**原本就存在的页面不要去关**，当 cda 中没有浏览器在线时才用 curl 命令做临时替代。工具说明：/var/www/chrome_do_action/cli/help.md  
**只有接口 API 访问和测试才用 curl 命令来测试**  

## 黑盒测试覆盖率（PCOV，默认开启）

本环境的黑盒测试覆盖率默认开启，不需要写 PHPUnit 测试，也不需要在项目代码里接入任何东西。页面、接口、CLI 命令和队列 worker 执行过的项目代码都会被自动采集。覆盖率用于判断黑盒测试是否覆盖到目标代码，不要用 phpunit 来统计。

### 标准使用流程

1. 开始一轮测试前执行 `coverage-reset` 清零。
2. 按真实入口测试：页面优先用 cda；接口用 curl；命令行和队列用 bash 触发；覆盖正常、边界和异常路径。
3. 执行 `coverage-report` 查看总覆盖率。
4. 执行 `coverage-report --show-uncovered` 查看可执行但未覆盖的行，根据未覆盖行补测，再复核。
5. 需要给用户看时生成 HTML 报告（见下）。

### 统计口径

- 默认统计项目根目录下全部 PHP 文件，自动排除 `vendor`、`node_modules`、`.git`、`tests`、`test`、`frame`、`project`。
- `frame/` 是 php-vibe-coding-frame 的框架核心，`project/` 是部署/环境配置，不属于业务代码，不要手工加回来。
- 完整回归不要传 `--include`，默认范围就是完整项目；只有针对某个功能做聚焦测试时，才用 `coverage-report --include <源码目录>`。
- `interceptor/` 等业务目录会自动纳入，不需要特殊配置。
- Blade 项目的 `view/` 源模板由编译后的代码执行，源模板通常显示 0%；看业务代码覆盖率时加 `--exclude view`。
- 报告开头会打印“统计范围 / 排除目录”，先核对口径再看百分比。

### 报告命令

测试过程中可以随时执行 `coverage-report` 查看当前累计结果，不需要等整轮测试结束；报告会累计到下一次 `coverage-reset`。

```bash
coverage-report                                   # 完整项目汇总
coverage-report --only-summary                    # 只看汇总
coverage-report --show-uncovered                  # 列出未覆盖行
coverage-report --exclude view --show-uncovered   # 业务代码口径（不含模板）
coverage-report --include src,app                 # 聚焦某次测试
coverage-report --html public/coverage-report     # HTML，给浏览器看
coverage-report --clover /tmp/coverage.xml        # Clover XML
coverage-report --help                            # 查看全部参数
```

- HTML 报告生成到 `public/coverage-report` 后，用 cda 打开 `http://127.0.0.1/coverage-report/index.html`；用完关闭自己打开的页面，生成的报告不要提交到 git。
- 终端输出没有数据时，先确认测试流量确实打到了应用；采集事件在 `/var/log/harness-coverage/`。

### 采集边界与性能

- 页面/API 在请求结束时落盘；长驻 CLI（如队列 worker）约每 2 秒落盘一次；FPM 长连接（如 SSE）在请求结束时才落盘。
- `coverage-reset` 只清除已落盘的数据；重置瞬间可能带入不到 2 秒的旧数据，属于正常现象。
- PCOV 只支持行覆盖率，不支持分支/路径覆盖率。
- 覆盖率常开有性能开销：CPU 密集型脚本约 2 倍，页面请求影响相对较小；不要为了覆盖率跳过正常测试步骤。
- 完全不需要覆盖率时，启动容器加 `HARNESS_COVERAGE=0`。  
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
