#!/bin/bash
# 破坏性 CLI 测试：在隔离的项目副本与临时数据库中执行真实的 migrate:rollback，
# 验证 down SQL 会执行、migrations 记录会删除，且无批次时再次回滚是安全的空操作。
#
# 不触碰主项目的数据库与代码；失败时输出诊断并以非 0 退出。

set -u

PROJECT=${PRJ_HOME:-$(pwd)}
DB="pms_rollback_probe_$$_$(date +%s)"
TMP=$(mktemp -d /tmp/test-rollback-probe-XXXXXX)
MIGRATION="9999_12_31_23_59_59_rollback_probe.sql"
FAILED=0

cleanup() {
    mysql -uroot -e "drop database if exists \`$DB\`" >/dev/null 2>&1 || true
    rm -rf "$TMP"
}

trap cleanup EXIT

fail() {
    echo "ROLLBACK_PROBE_FAIL: $*"
    exit 1
}

mysql -uroot -e "create database \`$DB\` character set utf8mb4" || fail '无法创建临时数据库'

rsync -a \
    --exclude=.git \
    --exclude=harness_engineering_php_env_for_test \
    --exclude=test_usecase \
    --exclude=node_modules \
    --exclude='view/blade' \
    "$PROJECT/" "$TMP/project/" || fail '无法复制项目到隔离目录'

# 只在隔离副本中改连接信息，主项目配置完全不动。
perl -0pi -e \
    "s/'database' => 'default'/'database' => '$DB'/g; s/'username' => 'default'/'username' => 'root'/g; s/'password' => 'password'/'password' => ''/g" \
    "$TMP/project/config/mysql.php" "$TMP/project/config/development/mysql.php" \
    || fail '无法配置隔离副本数据库'

cat > "$TMP/project/command/migration/sql/$MIGRATION" <<'SQL'
# up
create table `rollback_probe` (`id` bigint not null, primary key (`id`)) engine=InnoDB default charset=utf8mb4;

# down
drop table `rollback_probe`;
SQL

cd "$TMP/project" || fail '无法进入隔离副本'

HARNESS_COVERAGE=0 php public/cli.php migrate:install || fail 'migrate:install 失败'

mysql -uroot "$DB" <<SQL || fail '无法准备回滚探针数据'
create table rollback_probe (id bigint not null, primary key (id)) engine=InnoDB default charset=utf8mb4;
insert into migrations (migration, batch) values ('$MIGRATION', 1);
SQL

ROLLBACK_OUTPUT=$(HARNESS_COVERAGE=0 php public/cli.php migrate:rollback 2>&1)
ROLLBACK_STATUS=$?

echo "$ROLLBACK_OUTPUT"

if [ "$ROLLBACK_STATUS" -ne 0 ]; then
    fail "migrate:rollback 退出码 $ROLLBACK_STATUS"
fi

if ! echo "$ROLLBACK_OUTPUT" | grep -q 'success down'; then
    fail '回滚输出没有成功标记 success down'
fi

PROBE_EXISTS=$(mysql -N -uroot "$DB" -e "select count(*) from information_schema.tables where table_schema = '$DB' and table_name = 'rollback_probe'")
MIGRATION_ROWS=$(mysql -N -uroot "$DB" -e 'select count(*) from `migrations`')

if [ "$PROBE_EXISTS" != "0" ]; then
    fail "down SQL 未删除探针表（剩余 $PROBE_EXISTS）"
fi

if [ "$MIGRATION_ROWS" != "0" ]; then
    fail "回滚记录未删除（剩余 $MIGRATION_ROWS）"
fi

SECOND_OUTPUT=$(HARNESS_COVERAGE=0 php public/cli.php migrate:rollback 2>&1)
SECOND_STATUS=$?

echo "$SECOND_OUTPUT"

if [ "$SECOND_STATUS" -ne 0 ]; then
    fail "无批次再次回滚失败，退出码 $SECOND_STATUS"
fi

echo "ROLLBACK_PROBE_OK success_down=1 sentinel_dropped=1 migration_row_removed=1 second_noop=1"
exit 0
