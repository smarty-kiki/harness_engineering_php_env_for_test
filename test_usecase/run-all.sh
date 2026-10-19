#!/bin/bash
# 通用综合测试平台：按约定路径执行项目自己的前端 / 接口 / CLI 用例，
# 统一统计通过率与覆盖率，生成 round 报告并复制到 Playwright 运行目录。
#
# 项目根：必须有 PRJ_HOME（或在启动环境时设置），本脚本不写死任何项目路径。
# 平台目录：默认为本脚本所在目录，可用 TEST_SUITE_DIR 覆盖。
#
# 可选文件（存在即执行，均属于具体项目，不随 harness 仓库提供）：
#   fixtures/prepare.sh       每轮开始前（可做队列重置等）
#   fixtures/seed.php         造数
#   fixtures/cleanup.php      退出时清理
#   fixtures/cleanup.sh       退出时清理（与 cleanup.php 二选一或都执行）
#   tests/frontend/flow.js    Playwright 流程，需在 ROUND_DIR 写 frontend-cases.json
#   tests/api/run.js          接口测试，需在 ROUND_DIR 写 api-results.json
#   tests/cli/run.js          CLI 测试，需在 ROUND_DIR 写 cli-results.json
#
# 环境变量：
#   PRJ_HOME                 项目根目录（必填）
#   BASE_URL                 项目地址，默认 http://127.0.0.1
#   COVERAGE_EXCLUDE         覆盖率排除项，如 "view,harness_dir"；默认不排除
#   TEST_TAG                 造数标签，默认本轮次号
#
# 产物：
#   reports/rounds/<轮次>/   本轮用例结果、覆盖率、全量报告
#   reports/latest           最近一轮
#
# 用法：./run-all.sh [playwright-run 参数...]
# 例如：./run-all.sh --headed

set -u

SUITE=${TEST_SUITE_DIR:-$(cd "$(dirname "$0")" && pwd)}
PROJECT=${PRJ_HOME:-}
BASE_URL=${BASE_URL:-http://127.0.0.1}
ROUND_ID=$(date +%Y%m%d-%H%M%S)
TEST_TAG=${TEST_TAG:-$ROUND_ID}
ROUND_DIR="$SUITE/reports/rounds/$ROUND_ID"
LATEST_LINK="$SUITE/reports/latest"

if [ -z "$PROJECT" ] || [ ! -d "$PROJECT" ]; then
    echo "PRJ_HOME 未设置或不存在：${PROJECT:-<empty>}" >&2
    exit 2
fi

mkdir -p "$ROUND_DIR" "$SUITE/reports/rounds"

cleanup_done=0
cleanup() {
    if [ "$cleanup_done" = "1" ]; then return; fi
    cleanup_done=1
    if [ -f "$SUITE/fixtures/cleanup.php" ]; then
        HARNESS_COVERAGE=0 php "$SUITE/fixtures/cleanup.php" >/dev/null 2>&1 || true
    fi
    if [ -f "$SUITE/fixtures/cleanup.sh" ]; then
        bash "$SUITE/fixtures/cleanup.sh" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

cd "$PROJECT" || exit 1

echo "===== 综合测试轮次：$ROUND_ID ====="

if [ -f "$SUITE/fixtures/prepare.sh" ]; then
    echo "== 执行轮次准备脚本 =="
    HARNESS_COVERAGE=0 bash "$SUITE/fixtures/prepare.sh" || exit 1
fi

if [ -f "$SUITE/fixtures/cleanup.php" ]; then
    echo "== 清理旧数据 =="
    HARNESS_COVERAGE=0 php "$SUITE/fixtures/cleanup.php" >/dev/null 2>&1 || true
fi

echo "== 重置覆盖率 =="
coverage-reset >/dev/null 2>&1 || true

if [ -f "$SUITE/fixtures/seed.php" ]; then
    echo "== 造数 =="
    TEST_TAG="$TEST_TAG" PW_TAG="$TEST_TAG" HARNESS_COVERAGE=0 php "$SUITE/fixtures/seed.php" || exit 1
fi

PW_STATUS=0
RUN_DIR=""
PW_ARGS=("$@")

if [ -f "$SUITE/tests/frontend/flow.js" ]; then
    echo "== 前端 Playwright 测试 =="
    if [ "${#PW_ARGS[@]}" -eq 0 ]; then
        PW_ARGS=(--headless)
    fi
    ROUND_DIR="$ROUND_DIR" TEST_TAG="$TEST_TAG" timeout 1200 playwright-run "$SUITE/tests/frontend/flow.js" \
        --name "test-$ROUND_ID" --root "$PROJECT" "${PW_ARGS[@]}"
    PW_STATUS=$?
    echo "前端退出码：$PW_STATUS"

    RUN_DIR=$(readlink -f /var/log/harness-coverage/playwright/latest 2>/dev/null || true)
    if [ -n "$RUN_DIR" ] && [ -f "$RUN_DIR/meta.json" ]; then
        cp "$RUN_DIR/meta.json" "$ROUND_DIR/frontend-meta.json" 2>/dev/null || true
    fi
fi

API_STATUS=0
if [ -f "$SUITE/tests/api/run.js" ]; then
    echo "== 接口测试 =="
    ROUND_DIR="$ROUND_DIR" BASE_URL="$BASE_URL" TEST_TAG="$TEST_TAG" node "$SUITE/tests/api/run.js"
    API_STATUS=$?
    echo "接口退出码：$API_STATUS"
fi

CLI_STATUS=0
if [ -f "$SUITE/tests/cli/run.js" ]; then
    echo "== CLI 测试 =="
    ROUND_DIR="$ROUND_DIR" TEST_TAG="$TEST_TAG" node "$SUITE/tests/cli/run.js"
    CLI_STATUS=$?
    echo "CLI 退出码：$CLI_STATUS"
fi

echo "== 覆盖率报告 =="
COVERAGE_ARGS=()
if [ -n "${COVERAGE_EXCLUDE:-}" ]; then
    COVERAGE_ARGS=(--exclude "$COVERAGE_EXCLUDE")
fi

coverage-report --only-summary > "$ROUND_DIR/php-coverage-full.txt" 2>&1 || true
coverage-report "${COVERAGE_ARGS[@]}" --show-uncovered > "$ROUND_DIR/php-coverage-business.txt" 2>&1 || true
cp "$ROUND_DIR/php-coverage-business.txt" "$ROUND_DIR/php-uncovered.txt" 2>/dev/null || true
coverage-report "${COVERAGE_ARGS[@]}" --html "$ROUND_DIR/php-coverage" >/dev/null 2>&1 || true

frontend-coverage-report --root "$PROJECT" > "$ROUND_DIR/js-coverage.txt" 2>&1 || true
frontend-coverage-report --root "$PROJECT" --show-uncovered > "$ROUND_DIR/js-uncovered.txt" 2>&1 || true
frontend-coverage-report --root "$PROJECT" --html "$ROUND_DIR/js-coverage" >/dev/null 2>&1 || true

echo "== 生成统一报告 =="
if command -v round-report >/dev/null 2>&1; then
    round-report "$ROUND_DIR" "${RUN_DIR:-}"
else
    node /usr/local/share/harness/coverage/round-report.js "$ROUND_DIR" "${RUN_DIR:-}"
fi
REPORT_STATUS=$?

if [ -n "${RUN_DIR:-}" ] && [ -d "$RUN_DIR" ]; then
    mkdir -p "$RUN_DIR/round"
    cp "$ROUND_DIR/index.html" "$ROUND_DIR/summary.json" "$ROUND_DIR/summary.md" "$RUN_DIR/round/" 2>/dev/null || true
    cp -r "$ROUND_DIR/php-coverage" "$RUN_DIR/round/php-coverage" 2>/dev/null || true
    cp -r "$ROUND_DIR/js-coverage" "$RUN_DIR/round/js-coverage" 2>/dev/null || true
    cp "$ROUND_DIR/php-uncovered.txt" "$ROUND_DIR/js-uncovered.txt" "$RUN_DIR/round/" 2>/dev/null || true
fi

ln -sfn "$ROUND_DIR" "$LATEST_LINK"

cleanup

echo "== 本轮结果 =="
node - "$ROUND_DIR/summary.json" <<'NODE'
const fs = require('fs');
const file = process.argv[2];

if (!fs.existsSync(file)) {
    console.log('报告未生成：' + file);
    process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(file, 'utf-8'));
const line = (name, layer) => `${name} ${layer.passed}/${layer.total}（${layer.pass_rate.toFixed(2)}%）`;
console.log(line('前端：', summary.layers.frontend));
console.log(line('接口：', summary.layers.api));
console.log(line('CLI ：', summary.layers.cli));
console.log(`全量：${summary.totals.passed}/${summary.totals.total}（${summary.totals.pass_rate.toFixed(2)}%），失败 ${summary.totals.failed}，未执行 ${summary.totals.not_run}`);
console.log(`覆盖率：PHP ${summary.coverage.php_business ? summary.coverage.php_business.percent.toFixed(2) + '%' : '—'} / JS ${summary.coverage.js ? summary.coverage.js.percent.toFixed(2) + '%' : '—'}`);
NODE

echo "报告：$ROUND_DIR/index.html"
echo "最近一轮：$LATEST_LINK"

if [ "$REPORT_STATUS" -ne 0 ]; then exit "$REPORT_STATUS"; fi

FAILED_TOTAL=$(node -e "const s=require('$ROUND_DIR/summary.json');console.log(s.totals.failed+s.totals.not_run)" 2>/dev/null || echo 0)
if [ "$FAILED_TOTAL" != "0" ]; then
    echo "存在失败或未执行用例：$FAILED_TOTAL"
    exit 1
fi

if [ "$PW_STATUS" -ne 0 ] || [ "$API_STATUS" -ne 0 ] || [ "$CLI_STATUS" -ne 0 ]; then
    exit 1
fi

exit 0
