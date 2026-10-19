FROM debian

# 构建环境带 tty 时，clickhouse 的 postinst（clickhouse install）会因为在 tty 上等密码输入而卡死构建，
# 它只在 stdout 是 tty 且 DEBIAN_FRONTEND 不是 noninteractive 时才去读密码，这里统一声明为非交互
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install apt-utils -y && \
    apt-get upgrade -y && \
    apt-get install nginx -y && \
    apt-get install mariadb-server -y && \
    apt-get install redis-server -y && \
    apt-get install beanstalkd -y
RUN apt-get install php8.4-fpm -y && \
    apt-get install php8.4-pcov -y && \
    apt-get install php8.4-redis -y && \
    apt-get install php8.4-curl -y && \
    apt-get install php8.4-mysql -y && \
    apt-get install php8.4-mongodb -y && \
    apt-get install php8.4-xml -y && \
    apt-get install php8.4-mbstring -y && \
    apt-get install php8.4-yaml -y && \
    apt-get install php8.4-dev -y && \
    apt-get install php8.4-zip -y && \
    apt-get install php8.4-gd -y
RUN apt-get install phpunit -y && \
    apt-get install inotify-tools -y && \
    apt-get install wget -y && \
    apt-get install gnupg -y && \
    apt-get install zip -y && \
    apt-get install git -y && \
    apt-get install composer -y && \
    apt-get install vim -y && \
    apt-get install tmux -y && \
    apt-get install tmuxinator -y && \
    apt-get install supervisor -y
RUN apt-get install python3-pip -y && \
    apt-get install curl -y
# 前端测试的事中观测：Xvfb 承载有头 Chromium，x11vnc + noVNC 提供只读画面
RUN apt-get install xvfb -y && \
    apt-get install x11vnc -y && \
    apt-get install novnc -y && \
    apt-get install websockify -y

# clickhouse 需要先导入官方源与签名密钥（curl、gnupg 要到上面一层才装好）
RUN curl -fsSL 'https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key' | gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg arch=$(dpkg --print-architecture)] https://packages.clickhouse.com/deb lts main" > /etc/apt/sources.list.d/clickhouse.list && \
    printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && \
    chmod +x /usr/sbin/policy-rc.d && \
    apt-get update && \
    apt-get install clickhouse-server -y && \
    apt-get install clickhouse-client -y && \
    rm -f /usr/sbin/policy-rc.d

# 没有 systemd，用自己写的 init 脚本替换 deb 自带的（原因见脚本里的注释），配置一律用 config.d 覆盖
RUN mkdir -p /etc/clickhouse-server/config.d
COPY ./config/clickhouse_config.xml /etc/clickhouse-server/config.d/harness.xml
COPY ./config/clickhouse_init.sh /etc/init.d/clickhouse-server
RUN chmod +x /etc/init.d/clickhouse-server

# kafka 队列：与 clickhouse 一样属于可选组件——这里只装，默认不启动，启动命令加 --enable kafka 才起 broker。
# 三样东西：php-rdkafka 扩展（php-vibe-coding-frame 的 kafka 队列实现用的客户端，装了不影响不用它的项目）、
# broker 本体（官方 tar 包，KRaft 单机模式、不需要 zookeeper）与看消息用的 kcat；jre 是 broker 的运行环境，
# procps 是 kafka-server-stop.sh 找进程要用的。pecl 与编译工具链由上面的 php8.4-dev 带出来
ARG KAFKA_VERSION=4.1.2
ARG KAFKA_SCALA_VERSION=2.13
RUN apt-get install -y librdkafka-dev default-jre-headless kcat procps && \
    printf '\n\n\n\n\n' | pecl install rdkafka && \
    echo "extension=rdkafka.so" > /etc/php/8.4/mods-available/rdkafka.ini && \
    phpenmod -v 8.4 rdkafka && \
    curl -fsSL "https://mirrors.aliyun.com/apache/kafka/${KAFKA_VERSION}/kafka_${KAFKA_SCALA_VERSION}-${KAFKA_VERSION}.tgz" -o /tmp/kafka.tgz && \
    tar xzf /tmp/kafka.tgz -C /opt && \
    mv "/opt/kafka_${KAFKA_SCALA_VERSION}-${KAFKA_VERSION}" /opt/kafka && \
    rm /tmp/kafka.tgz && \
    for cmd in kafka-topics kafka-consumer-groups kafka-console-producer kafka-console-consumer kafka-configs kafka-get-offsets; do \
        printf '#!/bin/sh\nexec /opt/kafka/bin/%s.sh "$@"\n' "$cmd" > "/usr/local/bin/${cmd}"; \
        chmod +x "/usr/local/bin/${cmd}"; \
    done

# 单机开发环境的 broker 覆盖项追加在出厂 server.properties 之后（不整份替换，避免跟不上版本变化）
COPY ./config/kafka_server.properties /opt/kafka/config/harness.properties
RUN cat /opt/kafka/config/harness.properties >> /opt/kafka/config/server.properties

# deb 里没有 kafka 包，init 脚本自己写（KRaft 首次启动前要格式化元数据，见脚本里的注释）
COPY ./config/kafka_init.sh /etc/init.d/kafka
RUN chmod +x /etc/init.d/kafka

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
RUN apt install -y nodejs

RUN npm install -g @anthropic-ai/claude-code@v2.1.217

# Playwright 前端测试栈：容器内 Chromium + trace/录像/截图 + V8 覆盖率。
# 浏览器随镜像安装，测试不依赖宿主机 Chrome；观测入口由 nginx 8080 提供。
COPY ./coverage/playwright/ /usr/local/share/harness/playwright/
RUN cd /usr/local/share/harness/playwright && \
    npm ci --no-audit --no-fund && \
    npx playwright install --with-deps chromium && \
    chmod +x live-view.sh

COPY ./shell/start.sh /bin/start
RUN chown root:root /bin/start && \
    chmod +x /bin/start

# 黑盒覆盖率工具：采集器 + 汇总/重置命令。
# 采集器由 start.sh 写入 PHP 的 auto_prepend_file，覆盖 FPM、CLI 与队列 worker。
RUN mkdir -p /usr/local/lib/harness/coverage /usr/local/share/harness/coverage/reports /var/log/harness-coverage/playwright/runs /var/log/harness-coverage/php-report && \
    chmod 0777 /var/log/harness-coverage /var/log/harness-coverage/playwright /var/log/harness-coverage/playwright/runs /var/log/harness-coverage/php-report
COPY ./shell/coverage_prepend.php /usr/local/lib/harness/coverage/coverage_prepend.php
COPY ./shell/coverage_report.php /usr/local/lib/harness/coverage/coverage_report.php
COPY ./shell/coverage-report /usr/local/bin/coverage-report
COPY ./shell/coverage-reset /usr/local/bin/coverage-reset
COPY ./shell/frontend-coverage-report /usr/local/bin/frontend-coverage-report
COPY ./shell/playwright-run /usr/local/bin/playwright-run
COPY ./shell/round-report /usr/local/bin/round-report
RUN chmod +x /usr/local/bin/coverage-report /usr/local/bin/coverage-reset /usr/local/bin/frontend-coverage-report /usr/local/bin/playwright-run /usr/local/bin/round-report

# 覆盖率详细使用指南：提示词里只留触发条件和入口，细节从这里读取
COPY ./coverage/README.md /usr/local/share/harness/coverage/README.md
# 单轮全量报告生成器与契约说明
COPY ./coverage/round-report.js /usr/local/share/harness/coverage/round-report.js
COPY ./coverage/round-report.md /usr/local/share/harness/coverage/round-report.md
# 8080 的覆盖率总览页：同一页切换前端 / 后端报告
COPY ./config/coverage_reports.html /usr/local/share/harness/coverage/reports/index.html
# 8080 根地址的观测入口目录页：集中列出实时画面、运行产物、覆盖率与 Trace Viewer
COPY ./config/playwright_index.html /usr/local/share/harness/coverage/index.html

COPY ./config/bashrc /root/.bashrc
COPY ./config/append_system_prompt.md /root/.append_system_prompt.md
COPY ./config/tmux.conf /root/.tmux.conf

RUN mkdir -p /root/.tmuxinator
COPY ./config/tmuxinator_init.yml /root/.tmuxinator/init.yml

# cda：交互式页面查看工具（宿主机浏览器）。前端自动化测试与覆盖率由 Playwright 负责，
# 不再使用测试专属版扩展，也不再需要 cda 侧的覆盖率采集。
RUN git clone https://github.com/smarty-kiki/chrome_do_action.git /var/www/chrome_do_action
RUN cd /var/www/chrome_do_action/server && npm install && npm run build
RUN cd /var/www/chrome_do_action/cli && npm install && npm run build && npm link

RUN git clone https://github.com/smarty-kiki/chrome_call_your_claude_code /var/www/chrome_call_your_claude_code
RUN cd /var/www/chrome_call_your_claude_code/server && npm install

COPY ./config/nginx_harness.conf /etc/nginx/conf.d/harness.conf
COPY ./config/nginx_playwright.conf /etc/nginx/conf.d/harness_playwright.conf
COPY ./config/supervisor_playwright.conf /etc/supervisor/conf.d/playwright.conf
COPY ./config/mariadb_harness.cnf /etc/mysql/mariadb.conf.d/99-harness.cnf
COPY ./config/redis_harness.conf /tmp/redis_harness.conf

COPY ./shell/config_init.sh /tmp/config_init.sh
RUN /bin/bash /tmp/config_init.sh

ENV LC_ALL C.UTF-8

EXPOSE 80 3306 8080 8123 9092 12345 12346

CMD start
