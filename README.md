# Harness Engineering PHP Environment
这是一个 PHP 项目的 Harness Engineering 开发环境，方便快速在开发电脑上快速启动一个运行环境并与 claude 进行对话开发，环境中提前告知了 claude 这个开发环境中的各组件安装情况及日志对应位置，并且引导 claude 要自己通过访问项目来测试，查看日志并解决问题，并且自动提交 commit。

## 操作系统简介

基于 Debian trixie 的 PHP 开发环境容器

### 包含组件
- nginx
- mariadb-server
- redis-server
- beanstalkd
- clickhouse-server（可选组件，默认不启动，启动命令末尾加 `--enable clickhouse` 才启动）
- kafka（可选组件：broker 默认不启动，启动命令末尾加 `--enable kafka` 才启动；php 的 rdkafka 扩展与 kcat 命令行已装好，装了不影响不用 kafka 的项目）
- php8.4-fpm
- phpunit
- inotify-tools
- supervisor
- wget
- git
- composer
- vim
- tmux
- pip
- claude (Anthropic CLI)
- chrome_do_action
- chrome_call_your_claude_code

### 快速开始

假设项目名为 `my-app`，代码在本机 `/home/me/projects/my-app`：

```bash
sudo docker run --rm -ti \
    -p 80:80 \
    -p 3306:3306 \
    -p 8123:8123 \
    -p 9092:9092 \
    -p 12345:12345 \
    -p 12346:12346 \
    --name harness_engineering_php_env \
    -v ~/.claude:/root/.claude \
    -e 'CLAUDE_CONFIG_DIR=/root/.claude' \
    -v /home/me/projects/my-app:/var/www/my-app \
    -e 'PRJ_HOME=/var/www/my-app' \
    -e 'TIMEZONE=Asia/Shanghai' \
    registry.cn-shenzhen.aliyuncs.com/smarty/harness_engineering_php_env start
```

> **注意：** 要使用容器的完整开发能力，必须通过上述方式启动容器（即 `docker run ... start` 启动命令末尾带上 `start`）。启动完成后会直接进入 `start` 命令的界面——基础服务（nginx、MariaDB、redis、beanstalkd、php-fpm、supervisor 等）已启动完毕，并已进入 tmux 开发会话。请勿使用 `docker exec` 等方式绕过 `start` 直接进入容器，否则服务不会启动，开发能力不完整。

> **关于 ClickHouse：** ClickHouse 属于可选组件，默认不启动（省内存，tmux 里不会有它的日志窗口，发给 claude 的系统提示词里也不包含它）。项目需要 ClickHouse 时，在启动命令末尾追加 `--enable clickhouse`，即 `... harness_engineering_php_env start --enable clickhouse`。

> **关于 Kafka：** Kafka 同属可选组件，默认也不启动（broker 是单机 KRaft 模式，日志窗口与系统提示词里的内容同样跟着启停走）。项目需要 Kafka 时，在启动命令末尾追加 `--enable kafka`，即 `... harness_engineering_php_env start --enable kafka`；两者都要就写 `--enable clickhouse,kafka`。镜像里已装好 broker、kcat（看消息用）与 php 的 rdkafka 扩展——rdkafka 是 php-vibe-coding-frame 的 kafka 队列实现要用的客户端，装了不影响不用它的项目。

### 参数说明

| 参数 | 说明 |
|------|------|
| `--rm` | 容器退出后自动删除，不留残留 |
| `-p 80:80` | 将容器的 80 端口（nginx）映射到本机 80 端口 |
| `-p 3306:3306` | 将容器的 3306 端口（MariaDB）映射到本机，方便用本地客户端连接 |
| `-p 8123:8123` | 将容器的 8123 端口（ClickHouse HTTP 接口）映射到本机，方便用本地客户端连接 |
| `-p 9092:9092` | 将容器的 9092 端口（Kafka broker）映射到本机，方便用本地客户端连接 |
| `-p 12345:12345` | 将容器的 12345 端口（chrome_do_action）映射到本机，方便用本地浏览器插件连接 |
| `-p 12346:12346` | 将容器的 12346 端口（chrome_call_your_claude_code）映射到本机，方便用本地浏览器插件连接 |
| `-v ~/.claude:/root/.claude` | （可选）映射本机 Claude CLI 配置目录，复用本机的对话历史和设置 |
| `-e 'CLAUDE_CONFIG_DIR=/root/.claude'` | 让容器内 Claude CLI 的主配置写进上面挂载的目录（即 `/root/.claude/.claude.json`）。不要改成单文件挂载 `~/.claude.json`——单文件挂载会与宿主侧互写打架（容器报 configuration file not found、宿主文件还会被清成 0 字节） |
| `-v {CODE_PATH}:/var/www/{PROJECT_NAME}` | 将项目代码目录挂载进容器 |
| `-e PRJ_HOME` | 项目在容器内的根目录路径 |
| `-e TIMEZONE` | 容器时区，默认 `Asia/Shanghai` |
| `-e BEFORE_START_SHELL` | （可选）容器启动、服务进程启动前执行的初始化脚本，如准备目录、权限、服务启动前依赖的配置文件等 |
| `-e AFTER_START_SHELL` | （可选）容器启动后执行的初始化脚本，如建表、导入测试数据等 |
| `start --enable <组件名>` | 跟在启动命令末尾的 `start` 后面，启动默认不启动的可选组件，当前支持 `clickhouse` 与 `kafka`，如 `start --enable kafka`（可逗号分隔多个，如 `--enable clickhouse,kafka`） |

### 组件调参（2C4G 基准）

按 **2 核 4G** 的机器做内存与并发预算（同容器里还常驻 php-fpm、5 个队列 worker、redis、nginx、两个 node 服务）：

| 组件 | 调整 | 位置 |
|------|------|------|
| nginx | `worker_connections` 768 → 4096、`worker_rlimit_nofile` 16384；`client_max_body_size` 与 PHP 的 `post_max_size` 对齐 | `config_init.sh`、`config/nginx_harness.conf` |
| php-fpm | www pool 5 → 12 个 worker，补 `max_requests` / `request_terminate_timeout` / `listen.backlog`；opcache 校验间隔 2s → 0 | `config_init.sh` |
| MariaDB | 缓冲池 128M → 512M、MyISAM 与 Aria 缓存 128M → 16M、`max_connections` 151 → 80、SSD 刷盘口径 | `config/mariadb_harness.cnf` |
| Redis | `maxmemory` 384mb + `volatile-lru`、lazyfree、`tcp-backlog` | `config/redis_harness.conf` |
| beanstalkd | 没动：可调的只有 `-z`，早先已从默认 64K 提到 512K | — |

> 另修了 redis / beanstalkd 的 init 脚本：`start-stop-daemon --exec` 认进程在 rosetta 包装层下永远匹配不上，导致 `service redis-server restart` 静默假成功、`service beanstalkd restart` 报 failed 且写坏 pidfile；改成 `--name` / `--startas` 后原生机器行为不变。细节见 `shell/config_init.sh`。
