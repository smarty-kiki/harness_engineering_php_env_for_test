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

COPY ./shell/start.sh /bin/start
RUN chown root:root /bin/start && \
    chmod +x /bin/start

COPY ./config/bashrc /root/.bashrc
COPY ./config/append_system_prompt.md /root/.append_system_prompt.md
COPY ./config/tmux.conf /root/.tmux.conf

RUN mkdir -p /root/.tmuxinator
COPY ./config/tmuxinator_init.yml /root/.tmuxinator/init.yml

RUN git clone https://github.com/smarty-kiki/chrome_do_action.git /var/www/chrome_do_action
RUN cd /var/www/chrome_do_action/server && npm install && npm run build
RUN cd /var/www/chrome_do_action/cli && npm install && npm run build && npm link

RUN git clone https://github.com/smarty-kiki/chrome_call_your_claude_code /var/www/chrome_call_your_claude_code
RUN cd /var/www/chrome_call_your_claude_code/server && npm install

COPY ./config/nginx_harness.conf /etc/nginx/conf.d/harness.conf
COPY ./config/mariadb_harness.cnf /etc/mysql/mariadb.conf.d/99-harness.cnf
COPY ./config/redis_harness.conf /tmp/redis_harness.conf

COPY ./shell/config_init.sh /tmp/config_init.sh
RUN /bin/bash /tmp/config_init.sh

ENV LC_ALL C.UTF-8

EXPOSE 80 3306 8123 9092 12345 12346

CMD start
