#!/bin/sh
### BEGIN INIT INFO
# Provides:          clickhouse-server
# Required-Start:    $network
# Required-Stop:     $network
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: clickhouse-server daemon
### END INIT INFO

# 这个脚本替换 clickhouse deb 自带的 /etc/init.d/clickhouse-server，只保留容器里用得上的 start/stop/restart/status，
# 因为自带脚本有两处在这个容器里跑不通：
#   1. 它以 root 执行 `clickhouse start --user clickhouse`，ClickHouse 会去调用外部 sudo 降权，而镜像里没有 sudo，
#      子进程直接 127 退出（表现为 Code: 302 CHILD_WAS_NOT_EXITED_NORMALLY）；加上 --no-sudo 后改用 ClickHouse
#      内置的 clickhouse su 降权，不依赖任何外部提权命令
#   2. 它用 flock 给脚本加锁，而锁的文件描述符会被 clickhouse-server 守护进程继承且一直不释放，
#      导致之后每次 `service clickhouse-server restart` 都报 "Init script is already running"

CLICKHOUSE_USER=clickhouse
CLICKHOUSE_PIDDIR=/var/run/clickhouse-server
CLICKHOUSE_CONFDIR=/etc/clickhouse-server
CLICKHOUSE_BINDIR=/usr/bin

start()
{
    # pid 目录在 tmpfs 下，每次启动都要重建
    mkdir -p "$CLICKHOUSE_PIDDIR"
    chown ${CLICKHOUSE_USER}:${CLICKHOUSE_USER} "$CLICKHOUSE_PIDDIR"
    clickhouse start --no-sudo \
        --user "${CLICKHOUSE_USER}" \
        --pid-path "${CLICKHOUSE_PIDDIR}" \
        --config-path "${CLICKHOUSE_CONFDIR}" \
        --binary-path "${CLICKHOUSE_BINDIR}"
}

case "$1" in
start)
    start
    ;;
stop)
    clickhouse stop --pid-path "${CLICKHOUSE_PIDDIR}"
    ;;
restart)
    clickhouse stop --pid-path "${CLICKHOUSE_PIDDIR}"
    start
    ;;
status)
    clickhouse status --pid-path "${CLICKHOUSE_PIDDIR}"
    ;;
*)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 2
    ;;
esac
