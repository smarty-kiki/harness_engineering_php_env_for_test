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
- pcov（黑盒测试代码覆盖率）
- inotify-tools
- supervisor
- wget
- git
- composer
- vim
- tmux
- pip
- claude (Anthropic CLI)
- chrome_do_action（cda 交互式页面查看工具）
- chrome_call_your_claude_code
- playwright + chromium（前端自动化测试：trace、录像、截图、V8 覆盖率）
- xvfb / x11vnc / noVNC（前端测试的只读实时画面，独立 8080 端口）

### 构建镜像

仓库根目录就是构建上下文：

```bash
docker build -t registry.cn-shenzhen.aliyuncs.com/smarty/harness_engineering_php_env .
```

- 构建需要网络：会下载 Playwright 的 Chromium（数百 MB）和 Chromium 的系统依赖，并从 GitHub 克隆 cda、chrome_call_your_claude_code，首次构建耗时较长
- `-p 8080:8080` 是运行参数，不是构建参数；镜像只声明了 `EXPOSE 8080`
- 构建完成后推送到镜像仓库，或直接用本地 tag 启动（把快速开始里的镜像名换成本地 tag）

仓库结构：

- `Dockerfile`：镜像构建与组件安装
- `config/`：nginx、supervisor、MariaDB/Redis/Kafka/ClickHouse 等配置
- `shell/`：容器初始化、PHP 覆盖率工具、前端运行器入口
- `coverage/`：覆盖率使用指南与 Playwright 运行器源码（`coverage/playwright/`）

### 快速开始

假设项目名为 `my-app`，代码在本机 `/home/me/projects/my-app`：

```bash
sudo docker run --rm -ti \
    -p 80:80 \
    -p 3306:3306 \
    -p 8080:8080 \
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

> **关于 8080：** 它提供前端测试的实时画面、截图、录像、trace 和覆盖率报告。若不需要局域网访问，建议写成 `-p 127.0.0.1:8080:8080`，避免把页面内容暴露到局域网；宿主 8080 已被占用时可换映射（例如 `-p 18080:8080`），访问地址的端口也要相应改。

### 参数说明

| 参数 | 说明 |
|------|------|
| `--rm` | 容器退出后自动删除，不留残留 |
| `-p 80:80` | 将容器的 80 端口（nginx）映射到本机 80 端口 |
| `-p 8080:8080` | 将容器的 8080 端口（前端测试观测入口：live view / 产物 / 覆盖率 / trace）映射到本机，与项目 80 端口互不影响 |
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

按 **2 核 4G** 的机器做内存与并发预算（同容器里还常驻 php-fpm、5 个队列 worker、redis、nginx、cda 与 chrome_call 两个 node 服务，以及前端测试的 Xvfb/x11vnc/websockify）：

| 组件 | 调整 | 位置 |
|------|------|------|
| nginx | `worker_connections` 768 → 4096、`worker_rlimit_nofile` 16384；`client_max_body_size` 与 PHP 的 `post_max_size` 对齐 | `config_init.sh`、`config/nginx_harness.conf` |
| php-fpm | www pool 5 → 12 个 worker，补 `max_requests` / `request_terminate_timeout` / `listen.backlog`；opcache 校验间隔 2s → 0 | `config_init.sh` |
| MariaDB | 缓冲池 128M → 512M、MyISAM 与 Aria 缓存 128M → 16M、`max_connections` 151 → 80、SSD 刷盘口径 | `config/mariadb_harness.cnf` |
| Redis | `maxmemory` 384mb + `volatile-lru`、lazyfree、`tcp-backlog` | `config/redis_harness.conf` |
| beanstalkd | 没动：可调的只有 `-z`，早先已从默认 64K 提到 512K | — |

> 另修了 redis / beanstalkd 的 init 脚本：`start-stop-daemon --exec` 认进程在 rosetta 包装层下永远匹配不上，导致 `service redis-server restart` 静默假成功、`service beanstalkd restart` 报 failed 且写坏 pidfile；改成 `--name` / `--startas` 后原生机器行为不变。细节见 `shell/config_init.sh`。

> 前端测试栈常驻的 Xvfb/x11vnc/websockify 占用很小；真正跑 `playwright-run` 时会再启动一个 Chromium（数百 MB）。2C4G 机器上建议串行跑前端测试，不要和其他压测同时进行。

### 黑盒测试代码覆盖率（PCOV）

环境默认开启 PCOV 覆盖率采集，**不要求项目使用 PHPUnit**。测试时通过页面、接口、CLI 命令、队列 worker 等正常入口触发代码，覆盖数据会自动汇总。Claude 的完整使用指南见 `coverage/README.md`（镜像内路径 `/usr/local/share/harness/coverage/README.md`）。

采集链路：

- `auto_prepend_file` 挂到所有 PHP 进程（FPM / CLI），请求或命令开始即开始采集
- FPM 请求在结束时落盘；短 CLI 命令在退出时落盘
- 长驻 CLI（队列 worker 等）每约 2 秒自动落盘一次，报告接近实时
- 只统计 `$PRJ_HOME` 下的代码，排除 `vendor/`、`node_modules/`、`.git/`
- 事件按进程写入 `/var/log/harness-coverage/*.ndjson`，由报告命令合并

常用命令：

```bash
# 开始一轮测试前清零
coverage-reset

# 通过页面 / curl / bash / 队列触发业务代码……

# 查看总覆盖率
coverage-report

# 列出未覆盖行
coverage-report --show-uncovered

# 可选：只统计业务目录，用于聚焦某次测试
coverage-report --include src,app

# 生成 HTML / Clover 报告
coverage-report --html /tmp/coverage-html --clover /tmp/coverage.xml
```

说明与边界：

- `coverage-report` 默认统计项目根目录下全部 PHP 文件（自动排除 `vendor/`、`node_modules/`、`.git/`、`tests/`、`test/`、`frame/`、`project/`）；`frame/` 是 php-vibe-coding-frame 的框架核心，`project/` 是部署/环境配置，均不参与项目代码覆盖率统计。做完整回归时不要再传 `--include`，只有聚焦某次测试时才用它缩小范围
- 使用 Blade 的项目，`view/` 下的源模板由编译后的代码执行，通常显示 0% 行覆盖；看业务代码覆盖率时可加 `--exclude view`
- `coverage-reset` 只清除已落盘的采集事件；正在运行的长驻进程在下一次 flush 后重新产生数据，重置后继续测试即可从头累计
- 重置瞬间正在执行的长驻进程可能带入不到一个 flush 周期（约 2 秒）的旧数据；FPM 长连接（如 SSE）在请求结束时才落盘
- PCOV 只提供行覆盖率，不支持分支覆盖率 / 路径覆盖率
- 覆盖率常开会带来额外开销：CPU 密集型 CLI 脚本约 2 倍耗时，普通页面请求的相对影响较小
- PCOV 会关闭 opcache JIT，PHP 日志里出现 `JIT is incompatible with third party extensions` 属于预期
- 如完全不需要覆盖率（例如做性能基准），启动容器时设置 `HARNESS_COVERAGE=0`，`start` 会关闭 PCOV 采集

### 前端自动化测试与覆盖率（Playwright）

前端测试在容器内跑独立的 Chromium（Playwright），不依赖宿主机 Chrome，也不需要 cda 扩展。cda 只保留给宿主机浏览器的交互式页面查看；自动化、截图、录像、trace 和前端覆盖率都走 `playwright-run`。

```bash
# 写一个流程文件（可复制模板 /usr/local/share/harness/playwright/flow-example.js）
playwright-run /path/to/flow.js

# 需要多观察一会儿最终画面时
playwright-run /path/to/flow.js --linger 30

# 只重新生成最近一次运行的前端覆盖率报告
frontend-coverage-report --show-uncovered
```

`playwright-run --help` 可查看完整参数（`--headless`、`--no-video`、`--root`、`--web-root`、`--base-url`、`--name` 等）；`frontend-coverage-report` 支持 `--html`、`--clover`、`--run`，详见 `coverage/README.md`。

流程文件是一个导出 async 函数的 Node 模块，里面就是标准 Playwright 代码：

```js
module.exports = async function ({ page, baseUrl, step, screenshot }) {
    await step('打开首页', async () => {
        await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
        await screenshot('01-home');
    });

    // 继续写页面操作，例如点击、填表、等待接口响应……
};
```

`page/context/baseUrl/screenshot/step/takeCoverage/log/setMeta` 的完整说明、登录流程模板和参数列表见 `coverage/README.md`（镜像内 `/usr/local/share/harness/coverage/README.md`）。

每次运行在 `/var/log/harness-coverage/playwright/runs/<时间戳>-<名称>/` 下自成一套产物：

- `trace.zip`：Playwright Trace Viewer，含动作、前后截图、DOM 快照、网络与 Console
- `run.webm`：录像（多页面流程在 `videos/` 下）
- `screenshots/`：流程截图，`99-final.png` 是结束时的页面
- `events/`、`report/`、`coverage.txt`：V8 精确覆盖率原始事件与报告
- `meta.json`：运行信息、步骤耗时、页面错误与 Console 错误

容器内 nginx 在 **8080** 端口提供观测入口，与项目 80 端口互不影响：

| 地址 | 内容 |
|------|------|
| `http://127.0.0.1:8080/` | 只读实时画面（noVNC，不可接管） |
| `http://127.0.0.1:8080/artifacts/` | 运行产物列表，`latest/` 指向最近一次运行 |
| `http://127.0.0.1:8080/coverage/` | 最近一次运行的 HTML 覆盖率报告 |
| `http://127.0.0.1:8080/trace/` | 最近一次运行的 Trace Viewer |

注意：

- 宿主机访问 8080 需要在启动容器时加 `-p 8080:8080`；没映射时容器内仍可正常测试和生成产物
- live view 是只读的（x11vnc `-viewonly`），由 supervisor 常驻，容器启动即可用，无需手动启动
- Trace Viewer 在每次 `playwright-run` 后启动并指向本次 trace；容器刚启动、还没跑过测试时 `/trace` 不可用。托管入口始终显示最近一次运行，回看历史请到 `/artifacts/runs/<id>/` 下载 `trace.zip`，本地用 `npx playwright show-trace trace.zip` 打开
- 同一时间只允许一个 `playwright-run`（共用一块 Xvfb 屏幕和 trace viewer），并发运行会直接报错退出
- 前端覆盖率按「一次运行」统计，不跨运行累计；`coverage-reset` 不会删除已生成的 trace/录像
- 运行记录不会自动清理，`runs/` 会持续累积；不需要的历史目录可以手动删除
- 流程脚本要跨容器重建保留，请放在挂载进容器的项目目录（如 `tests/e2e/`）；放 `/tmp` 的脚本会随容器删除
- 测试流程若创建了测试账号，跑完要清理数据库与 Redis 会话

### 目录与数据

| 内容 | 位置 |
|------|------|
| PHP 覆盖率原始事件 | `/var/log/harness-coverage/*.ndjson` |
| Playwright 运行产物（trace/录像/截图/events/report/meta） | `/var/log/harness-coverage/playwright/runs/<时间戳>-<名称>/` |
| 最近一次 Playwright 运行 | `/var/log/harness-coverage/playwright/latest`（软链） |
| Trace Viewer 日志与 PID | `/var/log/harness-coverage/playwright/trace-viewer.log`、`trace-viewer.pid` |
| live view 日志 | `/var/log/supervisor/playwright-live-view.log` |
| 运行器与流程模板 | `/usr/local/share/harness/playwright/`（镜像内） |
| 覆盖率使用指南 | `/usr/local/share/harness/coverage/README.md`（镜像内） |
| 8080 观测入口配置 | `/etc/nginx/conf.d/harness_playwright.conf`（镜像内） |

### 故障排查

- **宿主机打不开 8080**：启动容器时是否加了 `-p 8080:8080`（或 `-p 127.0.0.1:8080:8080`）；宿主端口被占用时换映射端口
- **live view 空白或连接失败**：`supervisorctl status playwright-live-view`，日志见 `/var/log/supervisor/playwright-live-view.log`；修改过配置后 `service supervisor restart`
- **`/trace` 404**：还没有跑过 `playwright-run`；跑一次后 viewer 会自动启动
- **前端覆盖率没有数据**：确认流程确实打开了项目页面；外链脚本要能按 URL 映射到 `<PRJ_HOME>/public/` 下的文件；页面加载过快时可手动 `await takeCoverage('原因')`
- **流程失败想定位**：看运行目录里的 `meta.json`（`error.step`、`steps`）和 `trace.zip`；运行器退出码为 `1`
- **第二个 `playwright-run` 直接报错**：同一时间只允许一个运行，等上一个结束
- **构建时 Chromium 下载失败**：检查构建机网络；Playwright 浏览器和系统依赖在构建阶段下载，运行阶段不需要外网
- **页面中文显示为方块**：Playwright 的 `--with-deps` 会安装 `fonts-wqy-zenhei`；如果自定义镜像裁剪了系统依赖，需要补装中文字体
