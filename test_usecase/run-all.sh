#!/bin/bash
# 单轮全量黑盒测试：前端 Playwright + 接口 + CLI，统一通过率与覆盖率报告。
#
# 用法：
#   ./run-all.sh                 # 默认无头执行
#   ./run-all.sh --headed        # 透传 playwright-run 参数
#
# 产物：
#   reports/rounds/<轮次>/      本轮报告、用例结果、前后端覆盖率
#   reports/latest -> 最近一轮
#
# 设计原则：页面能覆盖的逻辑优先走 Playwright；页面测不到或不好测的走 API；
# CLI 命令通过 bash 执行。任一层失败都会继续执行后续用例，最终统一统计通过率。

set -u

SUITE=/var/www/test_usecase
PROJECT=${PRJ_HOME:-/var/www/project_manage_system}
BASE_URL=http://127.0.0.1
ROUND_ID=$(date +%Y%m%d-%H%M%S)
ROUND_DIR="$SUITE/reports/rounds/$ROUND_ID"
LATEST_LINK="$SUITE/reports/latest"

mkdir -p "$ROUND_DIR" "$SUITE/reports/rounds"

cleanup_done=0
cleanup() {
  if [ "$cleanup_done" = "1" ]; then return; fi
  cleanup_done=1
  HARNESS_COVERAGE=0 php "$SUITE/fixtures/cleanup.php" || true
}
trap cleanup EXIT

cd "$PROJECT" || exit 1

echo "===== 全量测试轮次：$ROUND_ID ====="

echo "== 重置队列（清掉上一轮遗留任务，避免复用 ID 时串数据）=="
service beanstalkd restart >/dev/null 2>&1 || true
supervisorctl restart 'project_manage_system_queue_worker:*' >/dev/null 2>&1 || true
sleep 1
HARNESS_COVERAGE=0 php "$SUITE/fixtures/pause_queue.php" 3600 >/dev/null 2>&1 || true

echo "== 清理旧数据 =="
HARNESS_COVERAGE=0 php "$SUITE/fixtures/cleanup.php" >/dev/null 2>&1 || true

echo "== 重置覆盖率 =="
coverage-reset || true

echo "== 造数 =="
HARNESS_COVERAGE=0 php "$SUITE/fixtures/seed.php" || exit 1

echo "== 前端 Playwright 测试 =="
PW_ARGS=("$@")
if [ "${#PW_ARGS[@]}" -eq 0 ]; then
  PW_ARGS=(--headless)
fi
ROUND_DIR="$ROUND_DIR" timeout 1200 playwright-run "$SUITE/tests/frontend/flow.js" \
  --name "pms-$ROUND_ID" --root "$PROJECT" "${PW_ARGS[@]}"
PW_STATUS=$?
echo "前端退出码：$PW_STATUS"

RUN_DIR=$(readlink -f /var/log/harness-coverage/playwright/latest 2>/dev/null || true)
if [ -n "$RUN_DIR" ] && [ -f "$RUN_DIR/meta.json" ]; then
  cp "$RUN_DIR/meta.json" "$ROUND_DIR/frontend-meta.json"
  PW_RUN_ID=$(python3 -c "import json;print(json.load(open('$RUN_DIR/meta.json')).get('run_id',''))" 2>/dev/null || true)
else
  PW_RUN_ID=""
fi
echo "Playwright 运行：${PW_RUN_ID:-未生成}"

echo "== 接口测试 =="
ROUND_DIR="$ROUND_DIR" BASE_URL="$BASE_URL" node "$SUITE/tests/api/run.js"
API_STATUS=$?
echo "接口退出码：$API_STATUS"

echo "== CLI 测试 =="
ROUND_DIR="$ROUND_DIR" node "$SUITE/tests/cli/run.js"
CLI_STATUS=$?
echo "CLI 退出码：$CLI_STATUS"

echo "== 覆盖率报告 =="
coverage-report --only-summary > "$ROUND_DIR/php-coverage-full.txt" 2>&1 || true
coverage-report --exclude view,harness_engineering_php_env_for_test --show-uncovered \
  > "$ROUND_DIR/php-coverage-business.txt" 2>&1 || true
cp "$ROUND_DIR/php-coverage-business.txt" "$ROUND_DIR/php-uncovered.txt"
coverage-report --exclude view,harness_engineering_php_env_for_test --html "$ROUND_DIR/php-coverage" \
  >/dev/null 2>&1 || true

frontend-coverage-report --root "$PROJECT" > "$ROUND_DIR/js-coverage.txt" 2>&1 || true
frontend-coverage-report --root "$PROJECT" --show-uncovered > "$ROUND_DIR/js-uncovered.txt" 2>&1 || true
frontend-coverage-report --root "$PROJECT" --html "$ROUND_DIR/js-coverage" >/dev/null 2>&1 || true

echo "== 生成统一报告 =="
if command -v round-report >/dev/null 2>&1; then
  round-report "$ROUND_DIR" "${RUN_DIR:-}"
else
  node "$SUITE/lib/report-round.js" "$ROUND_DIR" "${RUN_DIR:-}"
fi
REPORT_STATUS=$?

# 把本轮报告放进 Playwright 运行产物，便于从 8080 直接查看
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
