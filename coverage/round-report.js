/**
 * 单轮全量测试报告：合并前端步骤、接口用例、CLI 用例的通过率，
 * 以及本轮的前端 JS / 后端 PHP 覆盖率，生成 summary.json、summary.md 与 index.html。
 *
 * 用法：round-report <round_dir> [<playwright_run_dir>] [--previous=<summary.json>] [--strict-page-first] [--strict-data-check] [--strict-design]
 *
 * 本轮语义：
 *   - PHP 覆盖率 = 本轮全部页面 / API / CLI / 队列执行，不只是接口与 CLI；
 *   - JS 覆盖率 = 本轮全部 Playwright 页面流程，不只是某一个页面；
 *   - 接口 / CLI 用例可用 via_page 关联已覆盖同一行为的页面用例，
 *     页面不可达时用 unreachable_reason 说明原因；--strict-page-first 时未分类用例会让报告失败；
 *   - 会写数据的用例标记 mutates_data，并提供 db_verification 记录落库校验；
 *     --strict-data-check 时缺少落库校验的用例会让报告失败。
 *
 * 输入（均位于 round_dir）：
 *   frontend-cases.json / api-results.json / cli-results.json
 *   php-coverage-full.txt / php-coverage-business.txt / js-coverage.txt
 *   php-uncovered.txt / js-uncovered.txt（可选，用于下一轮建议）
 * 输出（写回 round_dir）：
 *   summary.json / summary.md / index.html
 *
 * 生成后的 round_dir 发布到 /var/log/harness-coverage/rounds/<round_id>/report/，
 * 8080 直接读取；同时保留复制到 Playwright 运行目录 round/ 的兼容行为。
 */
const fs = require('fs');
const path = require('path');

let roundState = null;

try {
  roundState = require('./round-state');
} catch {
  // 从非标准安装路径单独运行时，仍可生成报告，只是不自动查找上一轮
}

const { designAudit } = require('./case-design');

const argv = process.argv.slice(2);

if (!argv[0] && process.env.ROUND_DIR) {
  argv[0] = process.env.ROUND_DIR;
}

function flagValue(name) {
  const withEqual = argv.find((arg) => arg.startsWith(`--${name}=`));

  if (withEqual) return withEqual.slice(name.length + 3);

  const index = argv.indexOf(`--${name}`);

  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    return argv[index + 1];
  }

  return '';
}

const auditStrict = process.env.AUDIT_STRICT === '1';
const strictPageFirst = argv.includes('--strict-page-first') || process.env.PAGE_FIRST_STRICT === '1' || auditStrict;
const strictDataCheck = argv.includes('--strict-data-check') || process.env.DATA_CHECK_STRICT === '1' || auditStrict;
const strictDesign = argv.includes('--strict-design') || process.env.DESIGN_STRICT === '1' || auditStrict;
const positional = [];
const valueFlags = new Set(['--previous']);

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];

  if (arg.startsWith('--')) {
    if (!arg.includes('=') && valueFlags.has(arg)) i++;
    continue;
  }

  positional.push(arg);
}

if (!positional[0] && !process.env.ROUND_DIR) {
  console.log(`用法：round-report <round_dir> [<playwright_run_dir>] [--previous=<summary.json>] [--strict-page-first] [--strict-data-check] [--strict-design]

round_dir 需包含本轮测试结果：
  frontend-cases.json       前端用例（status: passed / failed / not_run）
  api-results.json          接口用例
  cli-results.json          CLI 用例
  php-coverage-full.txt     后端完整口径覆盖率文本
  php-coverage-business.txt 后端业务口径覆盖率文本
  js-coverage.txt           前端 V8 覆盖率文本

用例可选设计元数据：case_id / design_method / test_unit / test_point / case_kind / operation_steps。
提供 design_method 的用例会校验设计方法、测试点前缀、测试单元与操作步骤；
--strict-design 时元数据错误会让报告失败。

生成 summary.json、summary.md、index.html，并写回 round_dir。
将整个 round_dir 发布到 /var/log/harness-coverage/rounds/<round_id>/report/ 后，8080 自动展示。`);
  process.exit(1);
}

const roundDir = path.resolve(positional[0] || process.env.ROUND_DIR);
const runDir = positional[1] ? path.resolve(positional[1]) : '';
const roundId = path.basename(roundDir);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; }
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pct(covered, total) {
  return total > 0 ? (covered / total * 100) : 0;
}

function fmtPct(value) {
  return value > 0 ? value.toFixed(2) + '%' : '—';
}

function fmtDelta(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';

  const number = Number(value);

  return (number >= 0 ? '+' : '') + number.toFixed(2) + 'pp';
}

function parsePhpCoverage(text) {
  const match = text.match(/行覆盖率：([\d.]+)%（(\d+)\s*\/\s*(\d+)）/);

  if (!match) { return null; }

  return {
    percent: Number(match[1]),
    covered: Number(match[2]),
    total: Number(match[3]),
  };
}

function parseJsCoverage(text) {
  const match = text.match(/^合计\s+([\d.]+)%\s+\((\d+)\/(\d+)\)/m);

  if (!match) { return null; }

  return {
    percent: Number(match[1]),
    covered: Number(match[2]),
    total: Number(match[3]),
  };
}

function normalizeLayer(name, data) {
  if (!data || !Array.isArray(data.cases)) {
    return {
      name,
      available: false,
      total: 1,
      passed: 0,
      failed: 0,
      not_run: 1,
      pass_rate: 0,
      cases: [{
        layer: name,
        name: name + '测试套件',
        status: 'not_run',
        synthetic: true,
        expected: '测试套件执行完成并产出结果',
        actual: '本轮没有生成该层的测试结果文件',
      }],
    };
  }

  const cases = data.cases.map((item) => ({
    layer: name,
    ...item,
    status: item.status || 'failed',
  }));
  const passed = cases.filter((item) => item.status === 'passed').length;
  const failed = cases.filter((item) => item.status === 'failed').length;
  const notRun = cases.filter((item) => item.status === 'not_run').length;

  return {
    name,
    available: true,
    total: cases.length,
    passed,
    failed,
    not_run: notRun,
    pass_rate: pct(passed, cases.length),
    cases,
  };
}

function frontendFromMeta(meta) {
  if (!meta || !Array.isArray(meta.steps)) { return null; }

  return {
    cases: meta.steps.map((step) => ({
      name: step.name,
      status: step.status === 'ok' ? 'passed' : 'failed',
      duration_ms: step.duration_ms,
      expected: step.status === 'ok' ? '' : '该步骤断言通过',
      actual: step.error || '',
      operation_steps: step.operation_steps || '',
    })),
  };
}

// 页面穿透审计：接口 / CLI 用例要么关联到页面用例，要么说明页面不可达。
function pageFirstAudit(layers) {
  const frontendNames = new Set(layers.frontend.cases.map((item) => item.name));
  const apiCliCases = [...layers.api.cases, ...layers.cli.cases].filter((item) => !item.synthetic);
  const violations = [];
  let viaPage = 0;
  let unreachable = 0;

  for (const item of apiCliCases) {
    const via = String(item.via_page || '').trim();
    const reason = String(item.unreachable_reason || '').trim();

    if (via !== '') {
      if (frontendNames.has(via)) {
        viaPage++;
        continue;
      }

      violations.push({
        layer: item.layer,
        name: item.name,
        reason: `via_page 指向不存在的前端用例：${via}`,
      });
      continue;
    }

    if (reason !== '') {
      unreachable++;
      continue;
    }

    violations.push({
      layer: item.layer,
      name: item.name,
      reason: '缺少 via_page（页面已覆盖）或 unreachable_reason（页面不可达）',
    });
  }

  return {
    frontend_cases: layers.frontend.cases.filter((item) => !item.synthetic).length,
    api_cli_cases: apiCliCases.length,
    via_page: viaPage,
    unreachable,
    unclassified: violations.length,
    compliant: violations.length === 0,
    violations,
  };
}

// 数据落库校验：会写数据的用例，除了页面 / 接口断言，还要记录数据库实际结果。
// 约定 db_verification 可以是说明字符串、校验项数组，或 { checks: [...], detail, actual, passed } 对象。
function hasDbVerification(item) {
  const value = item.db_verification;

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean).length > 0;
  }

  if (!value || typeof value !== 'object' || value.checked === false) {
    return false;
  }

  if (Array.isArray(value.checks) && value.checks.filter(Boolean).length > 0) {
    return true;
  }

  return value.passed === true || String(value.actual || value.detail || value.expect || '').trim() !== '';
}

function dataCheckAudit(layers) {
  const cases = Object.values(layers)
    .flatMap((layer) => layer.cases)
    .filter((item) => !item.synthetic);
  const mutating = cases.filter((item) => item.mutates_data === true || item.mutates_data === 'true');
  const violations = [];

  for (const item of mutating) {
    if (!hasDbVerification(item)) {
      violations.push({
        layer: item.layer,
        name: item.name,
        reason: '写数据用例缺少 db_verification（数据库落库校验）',
      });
    }
  }

  return {
    mutating_cases: mutating.length,
    verified: mutating.length - violations.length,
    unverified: violations.length,
    compliant: violations.length === 0,
    violations,
  };
}

function uncoveredSuggestions(text, limit) {
  const marker = text.indexOf('未覆盖行：');

  if (marker < 0) return [];

  return text.slice(marker + '未覆盖行：'.length)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => line.length > 180 ? line.slice(0, 177) + '…' : line);
}

function deltaOf(current, previous, key) {
  const currentValue = current && current[key] ? current[key].percent : null;
  const previousValue = previous && previous[key] ? previous[key].percent : null;

  if (currentValue === null || previousValue === null || !Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
    return null;
  }

  return currentValue - previousValue;
}

function roundPlaywrightRunIds() {
  if (!roundState) return [];

  try {
    const status = roundState.readRound(roundId);
    const runs = status && Array.isArray(status.playwright_runs) ? status.playwright_runs : [];

    return runs.map((run) => path.basename(String(run))).filter(Boolean);
  } catch {
    return [];
  }
}

function previousSummary() {
  const explicit = flagValue('previous');

  if (explicit) {
    return { round_id: path.basename(path.dirname(path.resolve(explicit))), summary: readJson(path.resolve(explicit), null) };
  }

  if (roundState) {
    try {
      return roundState.previousSummary(roundId);
    } catch {
      return null;
    }
  }

  return null;
}

function renderHtml(summary) {
  const layerRows = Object.values(summary.layers).map((layer) => `
      <div class="metric">
        <div class="metric-label">${esc(layer.name)}</div>
        <div class="metric-value">${fmtPct(layer.pass_rate)}</div>
        <div class="metric-sub">${layer.passed}/${layer.total} 通过${layer.not_run ? ' · ' + layer.not_run + ' 未执行' : ''}</div>
      </div>`).join('');

  const failures = summary.totals.issues;
  const failureRows = failures.length ? failures.map((item) => `
      <tr>
        <td><span class="badge ${item.status === 'not_run' ? 'warn' : 'err'}">${item.status === 'not_run' ? '未执行' : '失败'}</span></td>
        <td class="layer">${esc(item.layer)}</td>
        <td class="case-name">${esc(item.name)}</td>
        <td class="operation-steps">${esc(item.operation_steps || '—')}</td>
        <td class="expected">${esc(item.expected || '—')}</td>
        <td class="actual">${esc(item.actual || '—')}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">本轮没有失败或未执行的用例</td></tr>';

  const traceHref = summary.playwright.run_id
    ? '/trace/index.html?trace=' + encodeURIComponent('/artifacts/runs/' + summary.playwright.run_id + '/trace.zip')
    : '';

  const pageFirst = summary.page_first;
  const pageFirstViolations = pageFirst.violations.length
    ? `<ul class="violations">${pageFirst.violations.slice(0, 30).map((item) => `<li>[${esc(item.layer)}] ${esc(item.name)} — ${esc(item.reason)}</li>`).join('')}</ul>${pageFirst.violations.length > 30 ? `<p class="meta">另有 ${pageFirst.violations.length - 30} 条未展示</p>` : ''}`
    : '<p class="ok-text">全部接口 / CLI 用例都已关联页面用例或说明页面不可达原因。</p>';

  const dataCheck = summary.data_check;
  const dataCheckViolations = dataCheck.violations.length
    ? `<ul class="violations">${dataCheck.violations.slice(0, 30).map((item) => `<li>[${esc(item.layer)}] ${esc(item.name)} — ${esc(item.reason)}</li>`).join('')}</ul>${dataCheck.violations.length > 30 ? `<p class="meta">另有 ${dataCheck.violations.length - 30} 条未展示</p>` : ''}`
    : '<p class="ok-text">全部已标记为写数据的用例都记录了数据库落库校验。</p>';

  const designCheck = summary.design_check || { metadata_cases: 0, total_cases: 0, operation_steps_cases: 0, method_counts: {}, units_without_positive: [], violations: [] };
  const designMethodText = Object.keys(designCheck.method_counts || {}).length
    ? Object.entries(designCheck.method_counts).map(([name, count]) => `${esc(name)} ${count}`).join(' · ')
    : '暂无设计方法元数据';
  const designViolations = (designCheck.violations || []).length
    ? `<ul class="violations">${designCheck.violations.slice(0, 30).map((item) => `<li>[${esc(item.layer)}] ${esc(item.name)} — ${esc(item.reason)}</li>`).join('')}</ul>${designCheck.violations.length > 30 ? `<p class="meta">另有 ${designCheck.violations.length - 30} 条未展示</p>` : ''}`
    : '<p class="ok-text">已提供的设计元数据自洽。</p>';
  const unitWarnings = (designCheck.units_without_positive || []).length
    ? `<p class="meta">以下测试单元只有负向用例，建议补正向：${designCheck.units_without_positive.slice(0, 20).map((unit) => esc(unit.test_unit)).join('、')}${designCheck.units_without_positive.length > 20 ? ' 等' : ''}</p>`
    : '';

  const phpDelta = summary.coverage_delta ? summary.coverage_delta.php_business : null;
  const jsDelta = summary.coverage_delta ? summary.coverage_delta.js : null;
  const previousRound = summary.coverage_delta ? summary.coverage_delta.previous_round_id : '';

  const suggestions = summary.next_round_suggestions || { php: [], js: [] };
  const suggestionRows = [
    ...suggestions.php.map((line) => `<li><span class="badge warn">PHP</span> ${esc(line)}</li>`),
    ...suggestions.js.map((line) => `<li><span class="badge warn">JS</span> ${esc(line)}</li>`),
  ];
  const suggestionHtml = suggestionRows.length
    ? `<ul class="suggestions">${suggestionRows.join('')}</ul>`
    : '<p class="meta">报告里没有未覆盖行明细；请确认覆盖率报告是否生成。</p>';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>全量测试报告 · ${esc(summary.round_id)}</title>
<style>
    :root {
        color-scheme: light dark;
        --bg: #f6f7f9; --panel: #fff; --border: #d9dde3; --text: #1f2328; --muted: #57606a;
        --accent: #0969da; --ok: #1a7f37; --ok-soft: #dafbe1; --warn: #9a6700; --warn-soft: #fff8c5;
        --err: #cf222e; --err-soft: #ffebe9; --shadow: 0 1px 3px rgba(31,35,40,.06);
    }
    @media (prefers-color-scheme: dark) {
        :root { --bg:#0d1117; --panel:#161b22; --border:#30363d; --text:#e6edf3; --muted:#8b949e;
            --accent:#58a6ff; --ok:#3fb950; --ok-soft:#12261e; --warn:#d29922; --warn-soft:#2a2118;
            --err:#f85149; --err-soft:#3c1618; --shadow:none; }
    }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","PingFang SC",sans-serif; }
    .wrap { max-width: 1240px; margin: 0 auto; padding: 30px 20px 48px; }
    h1 { margin:0; font-size:24px; }
    .sub { margin:4px 0 0; color:var(--muted); font-size:13px; }
    .section-title { margin:26px 0 10px; color:var(--muted); font-size:13px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; }
    .hero { display:flex; flex-wrap:wrap; gap:12px; margin-top:20px; }
    .metric { flex:1 1 170px; padding:15px 16px; border:1px solid var(--border); border-radius:12px; background:var(--panel); box-shadow:var(--shadow); }
    .metric-label { color:var(--muted); font-size:12.5px; }
    .metric-value { font-size:26px; font-weight:700; line-height:1.3; margin-top:3px; }
    .metric-value.ok { color: var(--ok); }
    .metric-value.err { color: var(--err); }
    .metric-sub { color:var(--muted); font-size:12px; }
    .coverage { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
    .card { border:1px solid var(--border); border-radius:12px; background:var(--panel); box-shadow:var(--shadow); padding:15px 16px; }
    .card h3 { margin:0 0 4px; font-size:14px; }
    .card p { margin:0; color:var(--muted); font-size:12.5px; }
    .card .big { font-size:25px; font-weight:700; margin:6px 0 2px; }
    .ok-text { color: var(--ok); }
    .links { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    a.btn { display:inline-flex; align-items:center; padding:5px 10px; border:1px solid var(--border); border-radius:7px; color:var(--accent); font-size:12.5px; text-decoration:none; }
    a.btn:hover { background:var(--bg); border-color:var(--accent); }
    table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--border); border-radius:10px; overflow:hidden; font-size:12.5px; }
    th, td { padding:8px 10px; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; }
    th { color:var(--muted); font-weight:600; white-space:nowrap; }
    tr:last-child td { border-bottom:0; }
    .layer { width: 64px; min-width: 64px; white-space: nowrap; }
    .status-col { width: 64px; white-space: nowrap; }
    .case-name { min-width:180px; font-weight:600; }
    .operation-steps { min-width:220px; color:var(--muted); word-break:break-word; }
    .expected { min-width:220px; color:var(--muted); }
    .actual { min-width:240px; color:var(--err); word-break:break-word; }
    .badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11.5px; font-weight:600; white-space:nowrap; }
    .badge.ok { color:var(--ok); background:var(--ok-soft); }
    .badge.err { color:var(--err); background:var(--err-soft); }
    .badge.warn { color:var(--warn); background:var(--warn-soft); }
    .empty { color:var(--muted); text-align:center; }
    .meta { color:var(--muted); font-size:12px; }
    .meta code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--text); }
    .violations, .suggestions { margin:8px 0 0; padding-left:18px; font-size:12.5px; line-height:1.7; }
    .violations { color:var(--err); }
    .suggestions { color:var(--text); }
    .suggestions code, .violations code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11.5px; word-break:break-all; }
    @media (max-width:760px) { .wrap{padding:20px 12px 36px;} .expected,.actual{min-width:160px;} }
</style>
</head>
<body>
<div class="wrap">
    <h1>全量测试报告</h1>
    <p class="sub">${esc(summary.round_id)} · ${esc(summary.finished_at)} · 前端 + 接口 + CLI 统一统计</p>

    <div class="hero">
        <div class="metric">
            <div class="metric-label">全量用例通过率</div>
            <div class="metric-value ${summary.totals.failed || summary.totals.not_run ? 'err' : 'ok'}">${fmtPct(summary.totals.pass_rate)}</div>
            <div class="metric-sub">${summary.totals.passed}/${summary.totals.total} 通过 · 失败 ${summary.totals.failed} · 未执行 ${summary.totals.not_run}</div>
        </div>
        ${layerRows}
    </div>

    <div class="section-title">页面穿透审计</div>
    <div class="card">
        <p>页面用例 ${pageFirst.frontend_cases} 条 · 接口 / CLI 用例 ${pageFirst.api_cli_cases} 条 · 已关联页面 ${pageFirst.via_page} 条 · 页面不可达说明 ${pageFirst.unreachable} 条 · 未分类 ${pageFirst.unclassified} 条${pageFirst.compliant ? ' · 全部已归类' : ''}</p>
        ${pageFirstViolations}
        <p class="meta" style="margin-top:8px">规则：同一行为优先写页面用例；页面不可达时，接口 / CLI 用例写 <code>unreachable_reason</code>，能从页面穿透时写 <code>via_page</code>（页面用例名）。<code>PAGE_FIRST_STRICT=1</code> 时未分类会让本轮报告失败。</p>
    </div>

    <div class="section-title">数据落库校验</div>
    <div class="card">
        <p>写数据用例 ${dataCheck.mutating_cases} 条 · 已校验 ${dataCheck.verified} 条 · 未校验 ${dataCheck.unverified} 条${dataCheck.compliant ? ' · 全部已校验' : ''}</p>
        ${dataCheckViolations}
        <p class="meta" style="margin-top:8px">规则：凡会写数据的用例（新增、修改、删除、状态流转，以及应被拒绝的写入请求），标记 <code>mutates_data: true</code>，并在 <code>db_verification</code> 记录数据库中的实际结果；仅页面提示或接口返回成功不算通过。<code>DATA_CHECK_STRICT=1</code> 时缺少校验会让本轮报告失败。</p>
    </div>

    <div class="section-title">覆盖率（本轮完整执行）</div>
    <div class="coverage">
        <div class="card">
            <h3>后端 PHP 行覆盖率</h3>
            <div class="big">${summary.coverage.php_business ? fmtPct(summary.coverage.php_business.percent) : '—'}</div>
            <p>${esc(summary.coverage_scope.php)}。业务口径排除模板 view 与测试环境 harness；完整口径 ${summary.coverage.php_full ? fmtPct(summary.coverage.php_full.percent) : '—'}。</p>
            <p>${summary.coverage.php_business ? summary.coverage.php_business.covered + ' / ' + summary.coverage.php_business.total + ' 行' : '本轮没有 PHP 覆盖率数据'}${previousRound ? ` · 较 ${esc(previousRound)} ${fmtDelta(phpDelta)}` : ''}</p>
            <div class="links">
                <a class="btn" href="php-coverage/index.html">PHP HTML 报告</a>
                <a class="btn" href="php-uncovered.txt">未覆盖行</a>
            </div>
        </div>
        <div class="card">
            <h3>前端 JS 行覆盖率</h3>
            <div class="big">${summary.coverage.js ? fmtPct(summary.coverage.js.percent) : '—'}</div>
            <p>${esc(summary.coverage_scope.js)}；每轮页面流程全部计入，不只统计某一个页面。</p>
            <p>${summary.coverage.js ? summary.coverage.js.covered + ' / ' + summary.coverage.js.total + ' 行' : '本轮没有前端覆盖率数据'}${previousRound ? ` · 较 ${esc(previousRound)} ${fmtDelta(jsDelta)}` : ''}</p>
            <div class="links">
                <a class="btn" href="js-coverage/index.html">JS HTML 报告</a>
                <a class="btn" href="js-uncovered.txt">未覆盖行</a>
            </div>
        </div>
        <div class="card">
            <h3>本轮产物</h3>
            <p class="meta">Playwright 运行：<code>${esc(summary.playwright.run_id || '—')}</code></p>
            <p class="meta">流程文件：<code>${esc(summary.playwright.flow || '—')}</code></p>
            <p class="meta">覆盖率事件：${summary.coverage_scope.playwright_runs.length} 个页面流程</p>
            <div class="links">
                ${traceHref ? `<a class="btn" href="${traceHref}" target="_blank" rel="noopener">Trace Viewer</a>
                <a class="btn" href="/artifacts/runs/${encodeURIComponent(summary.playwright.run_id)}/" target="_blank" rel="noopener">运行产物</a>` : ''}
                <a class="btn" href="/rounds/${encodeURIComponent(summary.round_id)}/report/index.html">轮次报告</a>
            </div>
        </div>
    </div>

    <div class="section-title">用例设计元数据</div>
    <div class="card">
        <p>带设计元数据 ${designCheck.metadata_cases} / ${designCheck.total_cases} 条 · 带操作步骤 ${designCheck.operation_steps_cases} 条</p>
        <p class="meta">设计方法分布：${designMethodText}</p>
        ${designViolations}
        ${unitWarnings}
        <p class="meta" style="margin-top:8px">协议：<code>case_id</code>、<code>design_method</code>、<code>test_unit</code>、<code>test_point</code>（必须以「设计方法-」开头）、<code>case_kind</code>（positive / negative）、<code>operation_steps</code>。提供 <code>design_method</code> 时强校验其余字段；<code>DESIGN_STRICT=1</code> 时元数据错误会让本轮报告失败。</p>
    </div>

    <div class="section-title">下一轮补测建议</div>
    <div class="card">
        <p>优先补测以下未覆盖行；能从页面触发的先写页面用例，页面不可达的再补接口 / CLI。</p>
        ${suggestionHtml}
    </div>

    <div class="section-title">失败 / 未执行用例</div>
    <table>
        <thead><tr><th class="status-col">状态</th><th class="layer">层</th><th>用例</th><th>操作步骤</th><th>应该表现</th><th>实际表现</th></tr></thead>
        <tbody>${failureRows}</tbody>
    </table>

    <p class="meta" style="margin-top:20px">统计口径：通过率 = 通过用例 / 本轮全部用例（未执行也计入分母）；PHP 覆盖率包含本轮全部页面、API、CLI 与队列流量，JS 覆盖率包含本轮全部 Playwright 页面流程。前端步骤、接口用例与 CLI 用例分别记录，失败不中断后续用例。</p>
</div>
</body>
</html>`;
}

function buildSummary() {
  const frontendData = readJson(path.join(roundDir, 'frontend-cases.json'), null);
  const meta = runDir ? readJson(path.join(runDir, 'meta.json'), null) : null;
  const apiData = readJson(path.join(roundDir, 'api-results.json'), null);
  const cliData = readJson(path.join(roundDir, 'cli-results.json'), null);

  const layers = {
    frontend: normalizeLayer('前端', frontendData || frontendFromMeta(meta)),
    api: normalizeLayer('接口', apiData),
    cli: normalizeLayer('CLI', cliData),
  };

  const allCases = Object.values(layers).flatMap((layer) => layer.cases);
  const passed = allCases.filter((item) => item.status === 'passed').length;
  const failed = allCases.filter((item) => item.status === 'failed').length;
  const notRun = allCases.filter((item) => item.status === 'not_run').length;
  const issues = allCases.filter((item) => item.status !== 'passed');

  const registryRunIds = roundPlaywrightRunIds();
  const phpFullText = readText(path.join(roundDir, 'php-coverage-full.txt'));
  const phpBusinessText = readText(path.join(roundDir, 'php-coverage-business.txt'));
  const jsText = readText(path.join(roundDir, 'js-coverage.txt'));
  const pageFirst = pageFirstAudit(layers);
  const dataCheck = dataCheckAudit(layers);
  const designCheck = designAudit(layers);
  const previous = previousSummary();
  const coverage = {
    php_full: parsePhpCoverage(phpFullText),
    php_business: parsePhpCoverage(phpBusinessText),
    js: parseJsCoverage(jsText),
  };

  const summary = {
    round_id: roundId,
    finished_at: new Date().toLocaleString('zh-CN', { hour12: false }),
    layers,
    totals: {
      total: allCases.length,
      passed,
      failed,
      not_run: notRun,
      pass_rate: pct(passed, allCases.length),
      issues,
    },
    coverage,
    coverage_scope: {
      php: '本轮全部页面 / API / CLI / 队列执行',
      js: '本轮全部 Playwright 页面流程',
      php_layers: ['frontend', 'api', 'cli', 'worker'],
      js_layers: ['frontend'],
      playwright_runs: registryRunIds.length ? registryRunIds : (meta && meta.run_id ? [meta.run_id] : []),
    },
    coverage_delta: {
      previous_round_id: previous ? previous.round_id : '',
      php_business: previous ? deltaOf(coverage, previous.summary.coverage, 'php_business') : null,
      js: previous ? deltaOf(coverage, previous.summary.coverage, 'js') : null,
    },
    page_first: pageFirst,
    data_check: dataCheck,
    design_check: designCheck,
    next_round_suggestions: {
      php: uncoveredSuggestions(readText(path.join(roundDir, 'php-uncovered.txt')), 8),
      js: uncoveredSuggestions(readText(path.join(roundDir, 'js-uncovered.txt')), 8),
    },
    playwright: {
      run_id: meta ? meta.run_id : '',
      flow: meta ? meta.flow : '',
      run_dir: runDir,
    },
  };

  fs.writeFileSync(path.join(roundDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(roundDir, 'index.html'), renderHtml(summary));

  const layerLines = Object.values(layers).map((layer) =>
    `- ${layer.name}：${fmtPct(layer.pass_rate)}（${layer.passed}/${layer.total}）${layer.not_run ? '，未执行 ' + layer.not_run : ''}`
  ).join('\n');

  const issueLines = issues.length ? issues.map((item) =>
    `- [${item.status === 'not_run' ? '未执行' : '失败'}] ${item.layer} / ${item.name}\n  - 操作步骤：${item.operation_steps || '—'}\n  - 应该表现：${item.expected || '—'}\n  - 实际表现：${item.actual || '—'}`
  ).join('\n') : '- 无';

  const pageFirstLines = pageFirst.violations.length
    ? pageFirst.violations.map((item) => `- [${item.layer}] ${item.name}：${item.reason}`).join('\n')
    : '- 全部接口 / CLI 用例都已关联页面用例或说明页面不可达原因';

  const designMethodText = Object.keys(designCheck.method_counts || {}).length
    ? Object.entries(designCheck.method_counts).map(([name, count]) => `${name} ${count}`).join(' · ')
    : '暂无设计方法元数据';
  const unitWarnings = (designCheck.units_without_positive || []).length
    ? `- 以下测试单元只有负向用例，建议补正向：${designCheck.units_without_positive.slice(0, 20).map((unit) => unit.test_unit).join('、')}${designCheck.units_without_positive.length > 20 ? ' 等' : ''}`
    : '';

  const suggestionLines = [
    ...summary.next_round_suggestions.php.map((line) => `- [PHP] ${line}`),
    ...summary.next_round_suggestions.js.map((line) => `- [JS] ${line}`),
  ].join('\n') || '- 报告里没有未覆盖行明细';

  fs.writeFileSync(path.join(roundDir, 'summary.md'), `# 全量测试报告 ${summary.round_id}

- 全量通过率：${fmtPct(summary.totals.pass_rate)}（${passed}/${summary.totals.total}）
- 失败：${failed}
- 未执行：${notRun}

## 分层通过率

${layerLines}

## 数据落库校验

- 写数据用例：${dataCheck.mutating_cases}
- 已校验：${dataCheck.verified}；未校验：${dataCheck.unverified}

${dataCheck.violations.length ? dataCheck.violations.map((item) => `- [${item.layer}] ${item.name}：${item.reason}`).join('\n') : '- 全部已标记为写数据的用例都记录了数据库落库校验'}

## 用例设计元数据

- 带设计元数据：${designCheck.metadata_cases} / ${designCheck.total_cases}
- 带操作步骤：${designCheck.operation_steps_cases}
- 设计方法分布：${designMethodText}
${designCheck.violations.length ? designCheck.violations.map((item) => `- [${item.layer}] ${item.name}：${item.reason}`).join('\n') : '- 已提供的设计元数据自洽'}
${unitWarnings || ''}

## 覆盖率（本轮完整执行）

- 后端 PHP（业务口径）：${summary.coverage.php_business ? fmtPct(summary.coverage.php_business.percent) : '—'}；${summary.coverage_scope.php}
- 后端 PHP（完整口径）：${summary.coverage.php_full ? fmtPct(summary.coverage.php_full.percent) : '—'}
- 前端 JS：${summary.coverage.js ? fmtPct(summary.coverage.js.percent) : '—'}；${summary.coverage_scope.js}
- 较上一轮：${previous ? `${summary.coverage_delta.previous_round_id} · PHP ${fmtDelta(summary.coverage_delta.php_business)} · JS ${fmtDelta(summary.coverage_delta.js)}` : '暂无上一轮可比数据'}

## 页面穿透审计

- 页面用例：${pageFirst.frontend_cases}
- 接口 / CLI 用例：${pageFirst.api_cli_cases}
- 已关联页面：${pageFirst.via_page}；页面不可达说明：${pageFirst.unreachable}；未分类：${pageFirst.unclassified}

${pageFirstLines}

## 失败 / 未执行

${issueLines}

## 下一轮补测建议

${suggestionLines}

## 产物

- HTML 报告：index.html
- PHP 覆盖率：php-coverage/index.html
- JS 覆盖率：js-coverage/index.html
- 覆盖率趋势：coverage-trend.txt
- 下一轮计划：next-round-plan.md
- Playwright 运行：${summary.playwright.run_id || '—'}
`);

  if (strictPageFirst && !pageFirst.compliant) {
    console.error(`页面穿透审计未通过：${pageFirst.unclassified} 条接口 / CLI 用例未写 via_page 或 unreachable_reason`);
    process.exitCode = 1;
  }

  if (strictDataCheck && !dataCheck.compliant) {
    console.error(`数据落库校验未通过：${dataCheck.unverified} 条写数据用例缺少 db_verification`);
    process.exitCode = 1;
  }

  if (strictDesign && !designCheck.compliant) {
    console.error(`用例设计元数据校验未通过：${designCheck.violations.length} 条元数据错误`);
    process.exitCode = 1;
  }

  return summary;
}

const summary = buildSummary();
console.log(`全量通过率：${fmtPct(summary.totals.pass_rate)}（${summary.totals.passed}/${summary.totals.total}），失败 ${summary.totals.failed}，未执行 ${summary.totals.not_run}`);
console.log(`页面穿透：页面 ${summary.page_first.frontend_cases} / 关联 ${summary.page_first.via_page} / 不可达说明 ${summary.page_first.unreachable} / 未分类 ${summary.page_first.unclassified}`);
console.log(`落库校验：写数据 ${summary.data_check.mutating_cases} / 已校验 ${summary.data_check.verified} / 未校验 ${summary.data_check.unverified}`);
console.log(`设计元数据：${summary.design_check.metadata_cases}/${summary.design_check.total_cases} 条 · 操作步骤 ${summary.design_check.operation_steps_cases} 条 · 元数据错误 ${summary.design_check.violations.length} 条`);
console.log(`报告：${path.join(roundDir, 'index.html')}`);
