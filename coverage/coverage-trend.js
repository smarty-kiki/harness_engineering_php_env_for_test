#!/usr/bin/env node
/**
 * 覆盖率趋势与下一轮补测计划。
 *
 * 读取轮次注册目录（/var/log/harness-coverage/rounds/<id>/summary.json）：
 *   - 输出每轮通过率、PHP 业务口径、JS 覆盖率及相对上一轮的增量
 *   - 连续 window 轮的 PHP / JS 增量都低于 threshold 时判定为「停滞」
 *   - 可从最新一轮的未覆盖行生成下一轮 plan.md 模板
 *
 *   coverage-trend [--dir=<rounds目录>] [--threshold=0.5] [--window=2] [--json] [--plan=<文件>]
 */

const fs = require('fs');
const path = require('path');
const state = require('./round-state');

function parseArgs(argv) {
  const options = {
    dir: state.ROUNDS_DIR,
    threshold: 0.5,
    window: 2,
    json: false,
    plan: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('--')) continue;

    const equal = arg.indexOf('=');
    const key = equal >= 0 ? arg.slice(2, equal) : arg.slice(2);
    const value = equal >= 0 ? arg.slice(equal + 1) : argv[++i];

    if (key === 'json') {
      options.json = true;
      continue;
    }

    if (key === 'dir') options.dir = path.resolve(value);
    if (key === 'threshold') options.threshold = Math.max(0, Number(value) || 0);
    if (key === 'window') options.window = Math.max(1, Number(value) || 1);
    if (key === 'plan') options.plan = path.resolve(value);
  }

  return options;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

function loadRounds(dir) {
  if (!fs.existsSync(dir)) return [];

  const rows = [];

  for (const name of fs.readdirSync(dir).sort()) {
    const roundDir = path.join(dir, name);

    if (!fs.statSync(roundDir).isDirectory()) continue;

    const summary = readJson(path.join(roundDir, 'summary.json'))
      || readJson(path.join(roundDir, 'report', 'summary.json'));

    if (!summary) continue;

    const php = summary.coverage && summary.coverage.php_business;
    const js = summary.coverage && summary.coverage.js;

    rows.push({
      round_id: summary.round_id || name,
      started_at: summary.started_at || (summary.finished_at || ''),
      finished_at: summary.finished_at || '',
      total: summary.totals ? summary.totals.total : 0,
      passed: summary.totals ? summary.totals.passed : 0,
      failed: summary.totals ? summary.totals.failed : 0,
      pass_rate: summary.totals ? summary.totals.pass_rate : 0,
      php_business: php ? php.percent : null,
      js: js ? js.percent : null,
      php_total: php ? php.total : 0,
      js_total: js ? js.total : 0,
      summary,
      dir: roundDir,
    });
  }

  return rows.sort((a, b) => String(a.round_id).localeCompare(String(b.round_id)));
}

function withDeltas(rows) {
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const phpDelta = previous && previous.php_business !== null && row.php_business !== null
      ? row.php_business - previous.php_business
      : null;
    const jsDelta = previous && previous.js !== null && row.js !== null
      ? row.js - previous.js
      : null;

    return Object.assign({}, row, { php_delta: phpDelta, js_delta: jsDelta });
  });
}

function plateauOf(rows, threshold, window) {
  if (rows.length <= window) {
    return { plateau: false, reason: `至少需要 ${window + 1} 轮有覆盖率数据的记录` };
  }

  const recent = rows.slice(-window);
  const phpComparable = recent.every((row) => row.php_delta !== null);
  const jsComparable = recent.every((row) => row.js_delta !== null);
  const phpStable = phpComparable && recent.every((row) => Math.abs(row.php_delta) < threshold);
  const jsStable = jsComparable && recent.every((row) => Math.abs(row.js_delta) < threshold);
  const hasMetric = phpComparable || jsComparable;

  return {
    plateau: phpStable && jsStable,
    reason: !hasMetric
      ? '最近几轮没有可比对的覆盖率增量'
      : (!phpComparable || !jsComparable)
        ? `最近 ${window} 轮缺少完整的 PHP / JS 覆盖率数据，暂不能判定停滞`
        : `最近 ${window} 轮 PHP / JS 增量均小于 ${threshold} 个百分点`,
  };
}

function fmt(value, suffix = '%') {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toFixed(2) + suffix;
}

function fmtDelta(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';

  const number = Number(value);

  return (number >= 0 ? '+' : '') + number.toFixed(2) + 'pp';
}

function uncoveredSnippet(file, limit = 12) {
  const text = readText(file);
  const marker = text.indexOf('未覆盖行：');

  if (marker < 0) return [];

  return text.slice(marker + '未覆盖行：'.length)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function writePlan(file, rows, plateau, threshold, window) {
  const latest = rows[rows.length - 1];

  if (!latest) return '';

  // summary.json 已由 round-report 汇总过未覆盖行；注册目录不一定保留原始文本，优先读 summary。
  const suggestions = (latest.summary && latest.summary.next_round_suggestions) || {};
  const phpUncovered = Array.isArray(suggestions.php) && suggestions.php.length
    ? suggestions.php
    : uncoveredSnippet(path.join(latest.dir, 'php-uncovered.txt'));
  const jsUncovered = Array.isArray(suggestions.js) && suggestions.js.length
    ? suggestions.js
    : uncoveredSnippet(path.join(latest.dir, 'js-uncovered.txt'));
  const uncoveredLines = [
    ...phpUncovered.map((line) => `- [PHP] ${line}`),
    ...jsUncovered.map((line) => `- [JS] ${line}`),
  ];

  const pageFirst = latest.summary.page_first || null;
  const dataCheck = latest.summary.data_check || null;
  const auditLines = [];

  if (pageFirst && pageFirst.unclassified > 0) {
    auditLines.push(`- 页面穿透未分类 ${pageFirst.unclassified} 条：补 \`via_page\` 或 \`unreachable_reason\``);
  }

  if (dataCheck && dataCheck.unverified > 0) {
    auditLines.push(`- 写数据未校验 ${dataCheck.unverified} 条：操作后查询数据库并补 \`db_verification\``);
  }

  const content = `# 下一轮补测计划（基于上一轮覆盖率报告）

- 上一轮：${latest.round_id}
- 上一轮通过率：${fmt(latest.pass_rate)}（${latest.passed}/${latest.total}）
- 上一轮 PHP 业务口径：${fmt(latest.php_business)}；JS：${fmt(latest.js)}
- 趋势判定：${plateau.plateau ? '已停滞' : '仍在增长'}（${plateau.reason}）
- 停滞阈值：连续 ${window} 轮增量 < ${threshold} 个百分点

## 1. 验收审计缺口

${auditLines.length ? auditLines.join('\n') : '- 页面穿透与落库校验均无缺口'}

## 2. 页面穿透补测（优先）

按未覆盖行逐项补页面流程，能从页面触发的行为一律先写 Playwright 用例；
接口 / CLI 只用于页面不可达或难以稳定触发的分支。

## 3. 未覆盖行

${uncoveredLines.length ? uncoveredLines.join('\n') : '- 上一轮没有未覆盖行明细，请先检查覆盖率报告是否生成'}

## 4. 接口 / CLI 补充用例

对确实无法从页面触发的分支补接口或 CLI 用例，并在结果 JSON 中写明：

- \`via_page\`：对应的页面用例名（能从页面穿透时）
- \`unreachable_reason\`：页面不可达的具体原因（无法穿透时）

## 5. 停止条件

连续 ${window} 轮的 PHP 业务口径与 JS 覆盖率增量都小于 ${threshold} 个百分点，或未覆盖行中已没有可通过现有入口触达的代码时，停止迭代。
`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);

  return file;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = withDeltas(loadRounds(options.dir));
  const plateau = plateauOf(rows, options.threshold, options.window);
  const latest = rows[rows.length - 1] || null;
  const result = {
    rounds: rows.map((row) => ({
      round_id: row.round_id,
      pass_rate: row.pass_rate,
      total: row.total,
      passed: row.passed,
      failed: row.failed,
      php_business: row.php_business,
      php_delta: row.php_delta,
      js: row.js,
      js_delta: row.js_delta,
    })),
    threshold: options.threshold,
    window: options.window,
    plateau: plateau.plateau,
    reason: plateau.reason,
    recommendation: plateau.plateau ? 'stop' : 'continue',
  };

  if (options.plan && latest) {
    result.plan = writePlan(options.plan, rows, plateau, options.threshold, options.window);
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!rows.length) {
    console.log(`还没有可分析的轮次报告：${options.dir}`);
    return;
  }

  console.log('轮次                            通过率            PHP 业务   Δ          JS        Δ');
  for (const row of rows) {
    console.log(
      String(row.round_id).padEnd(32)
      + `${fmt(row.pass_rate)} (${row.passed}/${row.total})`.padEnd(18)
      + fmt(row.php_business).padEnd(11)
      + fmtDelta(row.php_delta).padEnd(11)
      + fmt(row.js).padEnd(10)
      + fmtDelta(row.js_delta)
    );
  }

  console.log('');
  console.log(`趋势：${plateau.plateau ? '已停滞' : '继续补测'}（${plateau.reason}）`);
  console.log(`停滞阈值：连续 ${options.window} 轮 PHP / JS 增量 < ${options.threshold} 个百分点`);

  if (result.plan) {
    console.log(`下一轮计划：${result.plan}`);
  } else if (!plateau.plateau) {
    console.log('建议：基于上一轮未覆盖行创建下一轮，优先补页面穿透用例；用 --plan 生成计划模板。');
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
