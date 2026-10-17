#!/bin/sh
### BEGIN INIT INFO
# Provides:          kafka
# Required-Start:    $network
# Required-Stop:     $network
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: kafka broker daemon (KRaft combined mode, single node)
### END INIT INFO

# kafka 用官方 tar 包装在 /opt/kafka，deb 里没有对应的 init 脚本，这份是给容器里 `service kafka start/stop/restart` 用的。
# 两处与常规部署不同：
#   1. KRaft 模式要先格式化元数据目录才能启动，这里在首次启动时自动做（判据是数据目录里有没有 meta.properties）。
#      放在 init 脚本而不是镜像构建期，是因为数据目录归容器运行时所有——构建期格式化会把 cluster id 固化进镜像，
#      且容器换一个数据卷就跑不起来
#   2. broker 运行日志用 LOG_DIR 指到 /var/log/kafka（kafka-server-start.sh 默认写到 /opt/kafka/logs），
#      与数据目录 /var/lib/kafka 分开

KAFKA_HOME=/opt/kafka
KAFKA_DATA_DIR=/var/lib/kafka
KAFKA_LOG_DIR=/var/log/kafka
KAFKA_CONFIG=$KAFKA_HOME/config/server.properties
KAFKA_BOOTSTRAP=127.0.0.1:9092

start()
{
    if [ ! -f "$KAFKA_DATA_DIR/meta.properties" ]
    then
        mkdir -p "$KAFKA_DATA_DIR"

        # 格式化会清空数据目录，所以只在没格式化过时做（重复启动不能重复格式化）
        "$KAFKA_HOME/bin/kafka-storage.sh" format --standalone \
            -t "$("$KAFKA_HOME/bin/kafka-storage.sh" random-uuid)" \
            -c "$KAFKA_CONFIG" || return 1
    fi

    mkdir -p "$KAFKA_LOG_DIR"

    LOG_DIR="$KAFKA_LOG_DIR" "$KAFKA_HOME/bin/kafka-server-start.sh" -daemon "$KAFKA_CONFIG"

    # -daemon 是发射后不管，这里等到 broker 真能应答再返回——service kafka start 返回即代表可用
    for i in $(seq 1 60)
    do
        "$KAFKA_HOME/bin/kafka-topics.sh" --bootstrap-server "$KAFKA_BOOTSTRAP" --list > /dev/null 2>&1 && return 0
        sleep 0.5
    done

    echo "kafka 启动超时，看 $KAFKA_LOG_DIR/server.log" >&2
    return 1
}

stop()
{
    "$KAFKA_HOME/bin/kafka-server-stop.sh" > /dev/null 2>&1

    # stop 脚本只发信号不等进程退出，这里等干净再返回（restart 紧跟 start 时不会撞上还没退的旧进程）
    for i in $(seq 1 60)
    do
        pgrep -f 'kafka\.Kafka' > /dev/null || return 0
        sleep 0.5
    done

    echo "kafka 没能停干净，仍在运行的进程：" >&2
    pgrep -af 'kafka\.Kafka' >&2
    return 1
}

status()
{
    if pgrep -f 'kafka\.Kafka' > /dev/null
    then
        echo "kafka is running"
    else
        echo "kafka is not running"
        exit 3
    fi
}

case "$1" in
start)
    start
    ;;
stop)
    stop
    ;;
restart)
    stop
    start
    ;;
status)
    status
    ;;
*)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 2
    ;;
esac
