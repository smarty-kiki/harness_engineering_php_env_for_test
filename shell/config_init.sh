#!/bin/bash

ROOT_DIR="$(cd "$(dirname $0)" && pwd)"

# nginx：这几个在 events / 主上下文里，进不了 conf.d，只能改主配置
sed -i -e "s/^\tworker_connections 768;/\tworker_connections 4096;/" /etc/nginx/nginx.conf
sed -i -e "s/^\t# multi_accept on;/\tmulti_accept on;/" /etc/nginx/nginx.conf
sed -i -e "/^events {/i worker_rlimit_nofile 16384;" /etc/nginx/nginx.conf

sed -i -e "s/^zlib\.output_compression\ = .*/zlib\.output_compression = \On/g" /etc/php/8.4/fpm/php.ini
sed -i -e "s/^;max_input_vars\ = .*/max_input_vars\ =\ 20000/g" /etc/php/8.4/fpm/php.ini
sed -i -e "s/^listen\ = .*/listen = \/var\/run\/php-fpm\.sock/g" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^;catch_workers_output\ = .*/catch_workers_output\ =\ yes/g" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^;decorate_workers_output\ = .*/decorate_workers_output\ =\ no/g" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^error_log\ = .*/error_log = \/var\/log\/php-fpm\.log/g" /etc/php/8.4/fpm/php-fpm.conf

# request_terminate_timeout 是必需的兜底：PHP 的 max_execution_time 只算 CPU 时间，卡在 IO 上的请求它管不到
sed -i -e "s/^pm\.max_children\ = 5$/pm.max_children = 12/" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^pm\.start_servers\ = 2$/pm.start_servers = 3/" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^pm\.min_spare_servers\ = 1$/pm.min_spare_servers = 2/" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^pm\.max_spare_servers\ = 3$/pm.max_spare_servers = 6/" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^;pm\.max_requests\ = 500$/pm.max_requests = 500/" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^;listen\.backlog\ = 511$/listen.backlog = 4096/" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^;request_terminate_timeout\ = 0$/request_terminate_timeout = 60s/" /etc/php/8.4/fpm/pool.d/www.conf
sed -i -e "s/^;process_control_timeout\ = 0$/process_control_timeout = 10s/" /etc/php/8.4/fpm/php-fpm.conf

grep -q '^opcache\.revalidate_freq' /etc/php/8.4/mods-available/opcache.ini ||
    echo 'opcache.revalidate_freq=0' >> /etc/php/8.4/mods-available/opcache.ini
sed -i -e "s/^bind\-address/#bind\-address/g" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "s/^#general_log/general_log/g" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "s/^#log_slow_query_file\ .*/log_slow_query_file\ =\ \/var\/log\/mysql\/slow\.log/g" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "s/^#log_slow_query_time\ .*/log_slow_query_time\ =\ 0.5/g" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "s/^#skip\-name\-resolve/skip\-name\-resolve/g" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "/^log_slow_query_file/a\log_slow_query\ =\ 1" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "s/^#log_slow_verbosity\ .*/log_slow_verbosity\ =\ query_plan\,explain/g" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "s/^#log-queries-not-using-indexes.*/log-queries-not-using-indexes\ =\ on/g" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "s/^#log_error/log_error/g" /etc/mysql/mariadb.conf.d/50-server.cnf
sed -i -e "s/^skip_log_error/#skip_log_error/g" /etc/mysql/mariadb.conf.d/50-mysqld_safe.cnf
sed -i -e "s/^#BEANSTALKD_EXTRA=.*/BEANSTALKD_EXTRA=\"-z\ 524280\"/g" /etc/default/beanstalkd
sed -i -e "s/^loglevel\ .*/loglevel\ warning/g" /etc/redis/redis.conf
sed -i -e "s/^slowlog-max-len\ .*/slowlog-max-len\ 256/g" /etc/redis/redis.conf

# redis.conf 没有 include 机制，调参追加在末尾
grep -q '^maxmemory ' /etc/redis/redis.conf ||
    cat /tmp/redis_harness.conf >> /etc/redis/redis.conf

# redis / beanstalkd 的 init 脚本：--exec 按 exe/argv0 认进程，在 rosetta 包装层下永远匹配不上
# （redis restart 静默假成功、beanstalkd restart 报 failed 且写坏 pidfile）。stop 的 --exec 换 --name
# （比 /proc/<pid>/stat 的 comm），start 的 --exec 兼作「启动哪个程序」、换 --startas + --name；原生机器行为不变
sed -i -e '/start-stop-daemon --start/ s/--exec \$DAEMON/--startas \$DAEMON --name \$NAME/' /etc/init.d/redis-server
sed -i -e 's/--exec \$DAEMON/--name \$NAME/' /etc/init.d/redis-server
sed -i -e 's/--background --exec \$DAEMON/--background --startas \$DAEMON --name \$NAME/' /etc/init.d/beanstalkd
sed -i -e 's/--exec \$DAEMON/--name \$NAME/' /etc/init.d/beanstalkd
# beanstalkd 自带的 running_pid 也读 cmdline 首段，一并改成按 comm 比
sed -i -e 's@cmd=`cat /proc/\$pid/cmdline.*`@cmd=`cat /proc/$pid/comm 2>/dev/null`@' /etc/init.d/beanstalkd
sed -i -e 's@\[ "\$cmd" != "\$name" \]@[ "$cmd" != "${name##*/}" ]@' /etc/init.d/beanstalkd

ln -fs /var/www/chrome_do_action/server/supervisord.conf /etc/supervisor/conf.d/chrome_do_action_server.conf
ln -fs /var/www/chrome_call_your_claude_code/server/supervisord.conf /etc/supervisor/conf.d/chrome_call_your_claude_code.conf

mkdir /var/log/mysql
chown mysql /var/log/mysql

mkdir -p /var/log/clickhouse-server
chown clickhouse:clickhouse /var/log/clickhouse-server

# kafka 的 broker 日志目录（数据目录由 init 脚本在首次启动时建）
mkdir -p /var/log/kafka

mkdir /tmp/chrome
