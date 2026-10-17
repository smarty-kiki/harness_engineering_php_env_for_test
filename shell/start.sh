#!/bin/bash

# 可选组件默认不启动，用 start --enable <组件名> 按需打开（值可逗号分隔多个，如 --enable clickhouse,kafka）
usage_error()
{
    echo "$1" >&2
    echo "用法：start [--enable <组件名>]（当前支持的可选组件：clickhouse、kafka）" >&2
    exit 1
}

ENABLED_COMPONENTS=""
while [ $# -gt 0 ]
do
    case "$1" in
        --enable)
            [ -n "$2" ] || usage_error "缺少组件名：--enable <组件名>"
            ENABLED_COMPONENTS="$ENABLED_COMPONENTS,$2"
            shift 2
            ;;
        --enable=*)
            [ -n "${1#--enable=}" ] || usage_error "缺少组件名：--enable <组件名>"
            ENABLED_COMPONENTS="$ENABLED_COMPONENTS,${1#--enable=}"
            shift
            ;;
        *)
            usage_error "未知参数：$1"
            ;;
    esac
done
ENABLED_COMPONENTS="${ENABLED_COMPONENTS#,}"

# 组件名写错时宁可启动失败，也不要静默地少启动组件
for component in $(echo "$ENABLED_COMPONENTS" | tr ',' ' ')
do
    case "$component" in
        clickhouse) ;;
        kafka) ;;
        *) usage_error "不支持的可选组件：$component" ;;
    esac
done

# 用前后逗号包住做整名匹配，避免以后组件名互为前缀时互相误判
is_enabled()
{
    case ",$ENABLED_COMPONENTS," in
        *",$1,"*) return 0 ;;
        *) return 1 ;;
    esac
}

if  [ -n "$TIMEZONE" ]
then
    cp /usr/share/zoneinfo/$TIMEZONE /etc/localtime
    echo $TIMEZONE >/etc/timezone
fi

# 黑盒覆盖率：所有 PHP 入口（FPM / CLI / 队列 worker）都会经过采集器。
# 配置必须在启动 php-fpm 之前写好；pcov.directory 指向项目根目录，只统计项目代码。
COVERAGE_SPOOL="${HARNESS_COVERAGE_DIR:-/var/log/harness-coverage}"
mkdir -p "$COVERAGE_SPOOL"
chmod 0777 "$COVERAGE_SPOOL"

coverage_enabled=1

if [ -z "$PRJ_HOME" ] || [ ! -d "$PRJ_HOME" ] || [ "${HARNESS_COVERAGE:-1}" = "0" ]
then
    coverage_enabled=0
fi

if command -v phpenmod > /dev/null 2>&1
then
    # 清掉上一次启动留下的旧优先级链接，避免同一份配置被加载两次
    rm -f /etc/php/8.4/cli/conf.d/*-harness-coverage.ini
    rm -f /etc/php/8.4/fpm/conf.d/*-harness-coverage.ini

    if [ "$coverage_enabled" = "1" ] && [ -f /usr/local/lib/harness/coverage_prepend.php ]
    then
        PRJ_HOME_REAL="$(realpath "$PRJ_HOME")"

        cat > /etc/php/8.4/mods-available/harness-coverage.ini <<INI
; priority=99
pcov.enabled=1
pcov.directory="$PRJ_HOME_REAL"
pcov.exclude="~/(vendor|node_modules|\.git)/~"
auto_prepend_file=/usr/local/lib/harness/coverage_prepend.php
INI

        if [ -f /etc/php/8.4/mods-available/pcov.ini ]
        then
            phpenmod -v 8.4 -s cli pcov > /dev/null 2>&1 || true
            phpenmod -v 8.4 -s fpm pcov > /dev/null 2>&1 || true
        fi

        phpenmod -v 8.4 -s cli harness-coverage > /dev/null 2>&1 || true
        phpenmod -v 8.4 -s fpm harness-coverage > /dev/null 2>&1 || true
    else
        # 显式关闭 PCOV，避免加载扩展后即使不采集也产生插桩开销
        cat > /etc/php/8.4/mods-available/harness-coverage.ini <<'INI'
; priority=99
pcov.enabled=0
INI

        phpenmod -v 8.4 -s cli harness-coverage > /dev/null 2>&1 || true
        phpenmod -v 8.4 -s fpm harness-coverage > /dev/null 2>&1 || true
    fi
fi

if [ -f "$BEFORE_START_SHELL" ]
then
    /bin/bash $BEFORE_START_SHELL
fi

service php8.4-fpm   start > /dev/null &
service nginx        start > /dev/null &
service mariadb      start > /dev/null &
service redis-server start > /dev/null &
service beanstalkd   start > /dev/null &
if is_enabled clickhouse
then
    # clickhouse 的 pid 目录在 tmpfs 下，每次启动都要重建，这一步由 clickhouse 的 init 脚本自己负责
    service clickhouse-server start > /dev/null &
fi
if is_enabled kafka
then
    # KRaft 元数据的首次格式化、启动与就绪等待都在 kafka 的 init 脚本里
    service kafka start > /dev/null &
fi
service supervisor   start > /dev/null &

wait

if [ -f "$AFTER_START_SHELL" ]
then
    if is_enabled clickhouse
    then
        # clickhouse 起来后还要过几秒才接受连接，而 service 只等到进程起来（systemd 下是靠 Type=notify 等的）
        for i in $(seq 1 30)
        do
            clickhouse-client --query 'SELECT 1' > /dev/null 2>&1 && break
            sleep 0.5
        done
    fi
    if is_enabled kafka
    then
        # kafka broker 要等 KRaft 元数据加载完才接受请求，等它能应答再往下走
        for i in $(seq 1 60)
        do
            kafka-topics --bootstrap-server 127.0.0.1:9092 --list > /dev/null 2>&1 && break
            sleep 0.5
        done
    fi
    /bin/bash $AFTER_START_SHELL
fi

# 给 claude 的系统提示词要跟着启用的组件走：可选组件的内容在提示词里用 <!-- 组件名 --> ... <!-- /组件名 --> 包着，
# 这里把未启用组件的整块剔除，否则 claude 会去连不存在的服务、查不更新的日志
awk -v enabled=",$ENABLED_COMPONENTS," '
    BEGIN { n = split(enabled, list, ",") }
    /^<!-- \// { skip = 0; next }
    /^<!-- / {
        skip = 1
        for (i = 1; i <= n; i++) if (list[i] == $2) skip = 0
        next
    }
    !skip { print }
' /root/.append_system_prompt.md > /tmp/append_system_prompt.md

# 提示词过滤和 tmuxinator 的窗口条件渲染都从这份列表取（ERB 从 ENV 读），保证几处判断的是同一件事
export ENABLED_COMPONENTS

tmuxinator init
