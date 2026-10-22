#!/bin/bash
# 通用综合测试平台：以「轮次」为单位执行项目自己的前端 / 接口 / CLI 用例。
#
# 一轮测试从开始写用例时就可以在 8080 观测台看到：先执行 round-status start，
# 再写 tests/ 下的用例；run-all 会复用当前 active 轮次，并在准备、造数、前端、
# 接口、CLI、覆盖率、报告各阶段持续更新状态。轮次结束会把报告发布到
# /var/log/harness-coverage/rounds/<round_id>/，供 8080 与覆盖率趋势工具读取。
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
#   TEST_TAG                 造数标签，默认轮次号
#   ROUND_ID                 复用指定轮次（可选；默认复用 active，或新建）
#   NEW_ROUND=1              忽略 active，强制新建一轮
#   HEADLESS=1               无头运行前端流程；默认有头，便于 8080 实时画面观察
#   AUDIT_STRICT             默认 1：页面穿透 / 数据落库 / 设计元数据 / 检查点校验不通过时本轮失败；0 可放宽
#   PAGE_FIRST_STRICT        单独覆盖页面穿透审计（1 严格，0 放宽）
#   DATA_CHECK_STRICT        单独覆盖落库校验（1 严格，0 放宽）
#   DESIGN_STRICT            单独覆盖用例设计元数据校验（1 严格，0 放宽）
#   CHECKPOINT_STRICT        单独覆盖检查点校验（1 严格，0 放宽）：每个通过用例必须有检查点
#   REQUIRE_PAGE_FIRST=1     PAGE_FIRST_STRICT 的旧别名
#
# 产物：
#   reports/rounds/<轮次>/   本轮用例结果、覆盖率、全量报告
#   /var/log/harness-coverage/rounds/<轮次>/
#     status.json            实时状态（8080 轮询）
#     summary.json           发布后的报告摘要（覆盖率趋势读取）
#     report/                发布后的 HTML 报告与覆盖率报告
#   reports/latest           最近一轮
#
# 用法：./run-all.sh [playwright-run 参数...]
# 例如：./run-all.sh --headed

set -u

SUITE=${TEST_SUITE_DIR:-$(cd "$(dirname "$0")" && pwd)}
PROJECT=${PRJ_HOME:-}
BASE_URL=${BASE_URL:-http://127.0.0.1}
AUDIT_STRICT=${AUDIT_STRICT:-1}
PAGE_FIRST_STRICT=${PAGE_FIRST_STRICT:-$AUDIT_STRICT}
DATA_CHECK_STRICT=${DATA_CHECK_STRICT:-$AUDIT_STRICT}
DESIGN_STRICT=${DESIGN_STRICT:-$AUDIT_STRICT}
CHECKPOINT_STRICT=${CHECKPOINT_STRICT:-$AUDIT_STRICT}
if [ "${REQUIRE_PAGE_FIRST:-0}" = "1" ]; then PAGE_FIRST_STRICT=1; fi
COVERAGE_DIR=${HARNESS_COVERAGE_DIR:-/var/log/harness-coverage}
TEST_TAG=${TEST_TAG:-}
LATEST_LINK="$SUITE/reports/latest"

if [ -z "$PROJECT" ] || [ ! -d "$PROJECT" ]; then
    echo "PRJ_HOME 未设置或不存在：${PROJECT:-<empty>}" >&2
    exit 2
fi

# round-status / coverage-trend 在镜像里是命令；从仓库直接运行时回退到源码路径。
ROUND_TOOL=1
if [ -n "${ROUND_STATUS_BIN:-}" ]; then
    round_cmd() { "$ROUND_STATUS_BIN" "$@"; }
elif command -v round-status >/dev/null 2>&1; then
    round_cmd() { round-status "$@"; }
elif [ -f "$SUITE/../coverage/round-status.js" ]; then
    round_cmd() { node "$SUITE/../coverage/round-status.js" "$@"; }
else
    ROUND_TOOL=0
    round_cmd() { return 0; }
fi

if [ -n "${COVERAGE_TREND_BIN:-}" ]; then
    trend_cmd() { "$COVERAGE_TREND_BIN" "$@"; }
elif command -v coverage-trend >/dev/null 2>&1; then
    trend_cmd() { coverage-trend "$@"; }
elif [ -f "$SUITE/../coverage/coverage-trend.js" ]; then
    trend_cmd() { node "$SUITE/../coverage/coverage-trend.js" "$@"; }
else
    trend_cmd() { return 0; }
fi

ROUND_STATE_ID=""
ROUND_DIR=""
ROUND_ENABLED=0
ROUND_FINALIZED=0
HB_PID=""

if [ "$ROUND_TOOL" = "1" ]; then
    if [ "${NEW_ROUND:-0}" != "1" ] && [ -z "${ROUND_ID:-}" ] && [ -f "$SUITE/reports/rounds/.active" ]; then
        ACTIVE_ID=$(cat "$SUITE/reports/rounds/.active" 2>/dev/null | tr -d '[:space:]')

        if [ -n "$ACTIVE_ID" ]; then
            ACTIVE_STATE=$(round_cmd show --id "$ACTIVE_ID" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).state||""))}catch{}})' 2>/dev/null || true)

            case "$ACTIVE_STATE" in
                done|failed|interrupted|"") ;;
                *) ROUND_STATE_ID=$ACTIVE_ID ;;
            esac
        fi
    fi

    if [ -z "$ROUND_STATE_ID" ] && [ -n "${ROUND_ID:-}" ]; then
        if round_cmd show --id "$ROUND_ID" >/dev/null 2>&1; then
            ROUND_STATE_ID=$ROUND_ID
        else
            ROUND_STATE_ID=$(round_cmd start --id "$ROUND_ID" --name round --suite-dir "$SUITE" 2>/dev/null || true)
        fi
    fi

    # 手动 round-status start 的轮次（例如正在写用例）没有 .active 指针时，从注册目录复用
    if [ "${NEW_ROUND:-0}" != "1" ] && [ -z "${ROUND_ID:-}" ] && [ -z "$ROUND_STATE_ID" ]; then
        ROUND_STATE_ID=$(round_cmd active --suite-dir "$SUITE" 2>/dev/null | head -n1 | tr -d '[:space:]' || true)
    fi

    if [ -z "$ROUND_STATE_ID" ]; then
        ROUND_STATE_ID=$(round_cmd start --name round --suite-dir "$SUITE" 2>/dev/null || true)
    fi

    if [ -n "$ROUND_STATE_ID" ]; then
        ROUND_ENABLED=1
    fi
fi

if [ -z "$ROUND_STATE_ID" ]; then
    ROUND_STATE_ID=$(date +%Y%m%d-%H%M%S)
    ROUND_ENABLED=0
fi

ROUND_DIR="$SUITE/reports/rounds/$ROUND_STATE_ID"
TEST_TAG=${TEST_TAG:-$ROUND_STATE_ID}
mkdir -p "$ROUND_DIR" "$SUITE/reports/rounds"

round_update() {
    if [ "$ROUND_ENABLED" = "1" ]; then
        round_cmd update --id "$ROUND_STATE_ID" "$@" >/dev/null 2>&1 || true
    fi
}

round_layer_counts() {
    local name=$1
    local file=$2
    local layer_state=${3:-done}

    if [ ! -f "$file" ]; then
        round_update --layer "$name" --layer-state failed --total 0 --passed 0 --failed 0 --not-run 0
        return
    fi

    local counts
    counts=$(node -e '
        const fs = require("fs");
        try {
            const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            const cases = Array.isArray(data.cases) ? data.cases : [];
            const passed = data.passed !== undefined ? data.passed : cases.filter((c) => c.status === "passed").length;
            const failed = data.failed !== undefined ? data.failed : cases.filter((c) => c.status === "failed").length;
            const notRun = data.not_run !== undefined ? data.not_run : cases.filter((c) => c.status === "not_run").length;
            process.stdout.write([data.total !== undefined ? data.total : cases.length, passed, failed, notRun].join(" "));
        } catch {
            process.stdout.write("0 0 0 0");
        }
    ' "$file" 2>/dev/null || echo "0 0 0 0")

    set -- $counts
    round_update --layer "$name" --layer-state "$layer_state" --total "${1:-0}" --passed "${2:-0}" --failed "${3:-0}" --not-run "${4:-0}"
}

# 三层用例都写完后，按同一口径（显式 checkpoints / 落库检查 / 用例结果）汇总检查点，
# 让 8080 在报告生成前就能显示总数、已测试与未通过数。
round_checkpoint_counts() {
    local counts
    counts=$(node -e '
        const fs = require("fs");
        const path = require("path");

        let checkpointAudit;
        try {
            checkpointAudit = require("/usr/local/share/harness/coverage/checkpoints.js").checkpointAudit;
        } catch {
            process.exit(0);
        }

        const read = (name) => {
            try { return JSON.parse(fs.readFileSync(path.join(process.argv[1], name), "utf8")); } catch { return null; }
        };
        const audit = checkpointAudit({
            frontend: read("frontend-cases.json"),
            api: read("api-results.json"),
            cli: read("cli-results.json"),
        });

        process.stdout.write([audit.total, audit.tested, audit.passed, audit.failed, audit.not_tested].join(" "));
    ' "$ROUND_DIR" 2>/dev/null || true)

    [ -n "$counts" ] || return 0

    set -- $counts
    round_update --checkpoint-total "${1:-0}" --checkpoint-tested "${2:-0}" --checkpoint-passed "${3:-0}" --checkpoint-failed "${4:-0}" --checkpoint-not-tested "${5:-0}"
}

finalize() {
    if [ "$ROUND_ENABLED" = "1" ] && [ "$ROUND_FINALIZED" = "0" ] && [ -n "$ROUND_STATE_ID" ]; then
        round_cmd finish --id "$ROUND_STATE_ID" --failed --message "本轮执行中断" >/dev/null 2>&1 || true
    fi
}

cleanup_done=0
cleanup() {
    if [ "$cleanup_done" = "1" ]; then return; fi
    cleanup_done=1
    if [ -n "${HB_PID:-}" ]; then
        kill "$HB_PID" >/dev/null 2>&1 || true
    fi
    if [ -f "$SUITE/fixtures/cleanup.php" ]; then
        HARNESS_COVERAGE=0 php "$SUITE/fixtures/cleanup.php" >/dev/null 2>&1 || true
    fi
    if [ -f "$SUITE/fixtures/cleanup.sh" ]; then
        bash "$SUITE/fixtures/cleanup.sh" >/dev/null 2>&1 || true
    fi
}
trap 'finalize; cleanup' EXIT

cd "$PROJECT" || exit 1

echo "===== 综合测试轮次：$ROUND_STATE_ID ====="

round_update --state preparing --message "准备测试环境" --suite-dir "$SUITE" --round-dir "$ROUND_DIR"

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

round_update --state seeding --message "执行造数"

if [ -f "$SUITE/fixtures/seed.php" ]; then
    echo "== 造数 =="
    TEST_TAG="$TEST_TAG" PW_TAG="$TEST_TAG" HARNESS_COVERAGE=0 php "$SUITE/fixtures/seed.php" || exit 1
fi

PW_STATUS=0
RUN_DIR=""
PW_ARGS=("$@")

if [ -f "$SUITE/tests/frontend/flow.js" ]; then
    echo "== 前端 Playwright 测试 =="

    # 默认有头：浏览器出现在 Xvfb 上，8080 的实时画面才能看到自动化过程。
    # 需要无头运行时显式传 --headless 或设置 HEADLESS=1。
    HAS_HEADLESS=0
    for pw_arg in "${PW_ARGS[@]}"; do
        [ "$pw_arg" = "--headless" ] && HAS_HEADLESS=1
    done

    if [ "${HEADLESS:-0}" = "1" ] && [ "$HAS_HEADLESS" = "0" ]; then
        PW_ARGS+=(--headless)
    fi

    round_update --state frontend --message "执行前端页面流程" --layer frontend --layer-state running

    # 前端阶段可能持续几分钟；持续心跳，8080 能看到轮次仍在进行
    if [ "$ROUND_ENABLED" = "1" ]; then
        (while true; do round_cmd heartbeat --id "$ROUND_STATE_ID" --message "前端页面流程执行中" >/dev/null 2>&1 || exit 0; sleep 5; done) &
        HB_PID=$!
    fi

    ROUND_DIR="$ROUND_DIR" ROUND_ID="$ROUND_STATE_ID" TEST_TAG="$TEST_TAG" timeout 1200 playwright-run "$SUITE/tests/frontend/flow.js" \
        --name "test-$ROUND_STATE_ID" --root "$PROJECT" "${PW_ARGS[@]}"
    PW_STATUS=$?

    if [ -n "$HB_PID" ]; then
        kill "$HB_PID" >/dev/null 2>&1 || true
        HB_PID=""
    fi

    echo "前端退出码：$PW_STATUS"

    RUN_DIR=$(readlink -f "${HARNESS_COVERAGE_DIR:-/var/log/harness-coverage}/playwright/latest" 2>/dev/null || true)
    if [ -n "$RUN_DIR" ] && [ -f "$RUN_DIR/meta.json" ]; then
        cp "$RUN_DIR/meta.json" "$ROUND_DIR/frontend-meta.json" 2>/dev/null || true
    fi

    round_layer_counts frontend "$ROUND_DIR/frontend-cases.json" "$([ "$PW_STATUS" -eq 0 ] && echo done || echo failed)"
    if [ -n "$RUN_DIR" ]; then
        round_update --playwright-run "$RUN_DIR"
    fi
else
    round_update --layer frontend --layer-state skipped
fi

API_STATUS=0
if [ -f "$SUITE/tests/api/run.js" ]; then
    echo "== 接口测试 =="
    round_update --state api --message "执行接口用例" --layer api --layer-state running
    ROUND_DIR="$ROUND_DIR" BASE_URL="$BASE_URL" TEST_TAG="$TEST_TAG" node "$SUITE/tests/api/run.js"
    API_STATUS=$?
    echo "接口退出码：$API_STATUS"

    round_layer_counts api "$ROUND_DIR/api-results.json" "$([ "$API_STATUS" -eq 0 ] && echo done || echo failed)"
else
    round_update --layer api --layer-state skipped
fi

CLI_STATUS=0
if [ -f "$SUITE/tests/cli/run.js" ]; then
    echo "== CLI 测试 =="
    round_update --state cli --message "执行 CLI 用例" --layer cli --layer-state running
    ROUND_DIR="$ROUND_DIR" TEST_TAG="$TEST_TAG" node "$SUITE/tests/cli/run.js"
    CLI_STATUS=$?
    echo "CLI 退出码：$CLI_STATUS"

    round_layer_counts cli "$ROUND_DIR/cli-results.json" "$([ "$CLI_STATUS" -eq 0 ] && echo done || echo failed)"
else
    round_update --layer cli --layer-state skipped
fi

round_checkpoint_counts

echo "== 覆盖率报告 =="
round_update --state coverage --message "统计本轮覆盖率"

COVERAGE_ARGS=()
if [ -n "${COVERAGE_EXCLUDE:-}" ]; then
    COVERAGE_ARGS=(--exclude "$COVERAGE_EXCLUDE")
fi

coverage-report --only-summary > "$ROUND_DIR/php-coverage-full.txt" 2>&1 || true
coverage-report "${COVERAGE_ARGS[@]}" --show-uncovered > "$ROUND_DIR/php-coverage-business.txt" 2>&1 || true
cp "$ROUND_DIR/php-coverage-business.txt" "$ROUND_DIR/php-uncovered.txt" 2>/dev/null || true
coverage-report "${COVERAGE_ARGS[@]}" --html "$ROUND_DIR/php-coverage" >/dev/null 2>&1 || true

# 前端覆盖率按「轮次」统计：合并该轮记录的全部 Playwright 运行。
# 老版本命令没有 --round 时退回最近一次运行，保证兼容。
FC_ARGS=(--root "$PROJECT")
if frontend-coverage-report --help 2>&1 | grep -q -- '--round'; then
    FC_ARGS=(--round "$ROUND_STATE_ID" --root "$PROJECT")
fi

frontend-coverage-report "${FC_ARGS[@]}" > "$ROUND_DIR/js-coverage.txt" 2>&1 || true
frontend-coverage-report "${FC_ARGS[@]}" --show-uncovered > "$ROUND_DIR/js-uncovered.txt" 2>&1 || true
frontend-coverage-report "${FC_ARGS[@]}" --html "$ROUND_DIR/js-coverage" >/dev/null 2>&1 || true

echo "== 生成统一报告 =="
round_update --state reporting --message "生成全量报告"

REPORT_ARGS=("$ROUND_DIR" "${RUN_DIR:-}")
if [ "$PAGE_FIRST_STRICT" = "1" ]; then
    REPORT_ARGS+=(--strict-page-first)
fi
if [ "$DATA_CHECK_STRICT" = "1" ]; then
    REPORT_ARGS+=(--strict-data-check)
fi
if [ "$DESIGN_STRICT" = "1" ]; then
    REPORT_ARGS+=(--strict-design)
fi
if [ "$CHECKPOINT_STRICT" = "1" ]; then
    REPORT_ARGS+=(--strict-checkpoints)
fi

if command -v round-report >/dev/null 2>&1; then
    round-report "${REPORT_ARGS[@]}"
else
    node /usr/local/share/harness/coverage/round-report.js "${REPORT_ARGS[@]}"
fi
REPORT_STATUS=$?

if [ -n "${RUN_DIR:-}" ] && [ -d "$RUN_DIR" ]; then
    mkdir -p "$RUN_DIR/round"
    cp "$ROUND_DIR/index.html" "$ROUND_DIR/summary.json" "$ROUND_DIR/summary.md" "$RUN_DIR/round/" 2>/dev/null || true
    cp -r "$ROUND_DIR/php-coverage" "$RUN_DIR/round/php-coverage" 2>/dev/null || true
    cp -r "$ROUND_DIR/js-coverage" "$RUN_DIR/round/js-coverage" 2>/dev/null || true
    cp "$ROUND_DIR/php-uncovered.txt" "$ROUND_DIR/js-uncovered.txt" "$RUN_DIR/round/" 2>/dev/null || true
fi

# 轮次注册目录是 8080 与覆盖率趋势的统一读取位置：
# 即使没有 Playwright 运行（纯接口 / CLI 轮次），也要能看到完整报告。
if [ -f "$ROUND_DIR/summary.json" ]; then
    round_report_url="/rounds/$ROUND_STATE_ID/report/index.html"

    # 先发布摘要，趋势工具从轮次注册目录读取历史；报告目录在趋势生成后随 finish 一起同步。
    if [ "$ROUND_ENABLED" = "1" ]; then
        round_cmd publish --id "$ROUND_STATE_ID" --summary "$ROUND_DIR/summary.json" >/dev/null 2>&1 || true
    fi

    round_update --state done --message "本轮完成"

    # 覆盖率趋势与下一轮计划：接在上一轮报告之后，生成下一轮的补测入口
    trend_cmd --json > "$ROUND_DIR/coverage-trend.json" 2>/dev/null || true
    trend_cmd --plan "$ROUND_DIR/next-round-plan.md" > "$ROUND_DIR/coverage-trend.txt" 2>/dev/null || true

    if [ -s "$ROUND_DIR/coverage-trend.txt" ]; then
        echo "== 覆盖率趋势 =="
        cat "$ROUND_DIR/coverage-trend.txt"
    fi

    if [ "$ROUND_ENABLED" = "1" ]; then
        round_cmd finish --id "$ROUND_STATE_ID" --summary "$ROUND_DIR/summary.json" --report-url "$round_report_url" --report-dir "$ROUND_DIR" --message "本轮完成" >/dev/null 2>&1 || true
    fi

    ROUND_FINALIZED=1
else
    round_update --state failed --message "全量报告未生成"
    ROUND_FINALIZED=1
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
if (summary.page_first) {
    console.log(`页面穿透：页面用例 ${summary.page_first.frontend_cases}，API/CLI ${summary.page_first.api_cli_cases}，已关联页面 ${summary.page_first.via_page}，不可达说明 ${summary.page_first.unreachable}，未分类 ${summary.page_first.unclassified}`);
}
if (summary.design_check) {
    console.log(`设计元数据：带元数据 ${summary.design_check.metadata_cases}/${summary.design_check.total_cases}，操作步骤 ${summary.design_check.operation_steps_cases}，元数据错误 ${summary.design_check.violations.length}`);
}
if (summary.checkpoints) {
    console.log(`检查点：总 ${summary.checkpoints.total}，已测试 ${summary.checkpoints.tested}，通过 ${summary.checkpoints.passed}，未通过 ${summary.checkpoints.failed}，未测试 ${summary.checkpoints.not_tested}`);
}
if (summary.checkpoint_coverage) {
    console.log(`检查点覆盖：通过用例 ${summary.checkpoint_coverage.with_checkpoints}/${summary.checkpoint_coverage.passed_cases}，缺少 ${summary.checkpoint_coverage.missing}`);
}
console.log(`轮次报告：http://127.0.0.1:8080/rounds/${summary.round_id}/report/index.html`);
NODE

echo "报告：$ROUND_DIR/index.html"
echo "最近一轮：$LATEST_LINK"

if [ "$REPORT_STATUS" -ne 0 ]; then exit "$REPORT_STATUS"; fi

FAILED_TOTAL=$(node -e "const s=require('$ROUND_DIR/summary.json');console.log(s.totals.failed+s.totals.not_run)" 2>/dev/null || echo 0)
if [ "$FAILED_TOTAL" != "0" ]; then
    echo "存在失败或未执行用例：$FAILED_TOTAL"
    exit 1
fi

if [ "$PAGE_FIRST_STRICT" = "1" ]; then
    PAGE_FIRST_UNCLASSIFIED=$(node -e "const s=require('$ROUND_DIR/summary.json');console.log(s.page_first ? s.page_first.unclassified : 0)" 2>/dev/null || echo 0)
    if [ "$PAGE_FIRST_UNCLASSIFIED" != "0" ]; then
        echo "页面穿透审计未通过：${PAGE_FIRST_UNCLASSIFIED} 条接口 / CLI 用例未写 via_page 或 unreachable_reason"
        exit 1
    fi
fi

if [ "$DATA_CHECK_STRICT" = "1" ]; then
    DATA_CHECK_UNVERIFIED=$(node -e "const s=require('$ROUND_DIR/summary.json');console.log(s.data_check ? s.data_check.unverified : 0)" 2>/dev/null || echo 0)
    if [ "$DATA_CHECK_UNVERIFIED" != "0" ]; then
        echo "数据落库校验未通过：${DATA_CHECK_UNVERIFIED} 条写数据用例缺少 db_verification"
        exit 1
    fi
fi

if [ "$DESIGN_STRICT" = "1" ]; then
    DESIGN_ERRORS=$(node -e "const s=require('$ROUND_DIR/summary.json');console.log(s.design_check && Array.isArray(s.design_check.violations) ? s.design_check.violations.length : 0)" 2>/dev/null || echo 0)
    if [ "$DESIGN_ERRORS" != "0" ]; then
        echo "用例设计元数据校验未通过：${DESIGN_ERRORS} 条元数据错误"
        exit 1
    fi
fi

if [ "$PW_STATUS" -ne 0 ] || [ "$API_STATUS" -ne 0 ] || [ "$CLI_STATUS" -ne 0 ]; then
    exit 1
fi

exit 0
