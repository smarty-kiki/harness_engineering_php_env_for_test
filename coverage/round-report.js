/**
 * 单轮全量测试报告：合并前端步骤、接口用例、CLI 用例的通过率，
 * 以及本轮的前端 JS / 后端 PHP 覆盖率，生成 summary.json、summary.md 与 index.html。
 *
 * 用法：round-report <round_dir> [<playwright_run_dir>]
 *
 * 输入（均位于 round_dir）：
 *   frontend-cases.json / api-results.json / cli-results.json
 *   php-coverage-full.txt / php-coverage-business.txt / js-coverage.txt
 * 输出（写回 round_dir）：
 *   summary.json / summary.md / index.html
 *
 * 生成后的 round_dir 复制到 Playwright 运行目录的 round/ 下，8080 观测目录即可读取。
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (!args[0] && process.env.ROUND_DIR) {
  args[0] = process.env.ROUND_DIR;
}

if (!args[0] || args.includes('--help') || args.includes('-h')) {
  console.log(`用法：round-report <round_dir> [<playwright_run_dir>]

round_dir 需包含本轮测试结果：
  frontend-cases.json       前端用例（status: passed / failed / not_run）
  api-results.json          接口用例
  cli-results.json          CLI 用例
  php-coverage-full.txt     后端完整口径覆盖率文本
  php-coverage-business.txt 后端业务口径覆盖率文本
  js-coverage.txt           前端 V8 覆盖率文本

生成 summary.json、summary.md、index.html。
将整个 round_dir 复制到 Playwright 运行目录的 round/ 下，可从 8080 观测台查看。`);
  process.exit(args[0] ? 0 : 1);
}

const roundDir = path.resolve(args[0] || process.env.ROUND_DIR);
const runDir = args[1] ? path.resolve(args[1]) : '';

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
    })),
  };
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
        <td class="expected">${esc(item.expected || '—')}</td>
        <td class="actual">${esc(item.actual || '—')}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty">本轮没有失败或未执行的用例</td></tr>';

  const traceHref = summary.playwright.run_id
    ? '/trace/index.html?trace=' + encodeURIComponent('/artifacts/runs/' + summary.playwright.run_id + '/trace.zip')
    : '';

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
    .expected { min-width:220px; color:var(--muted); }
    .actual { min-width:240px; color:var(--err); word-break:break-word; }
    .badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11.5px; font-weight:600; white-space:nowrap; }
    .badge.ok { color:var(--ok); background:var(--ok-soft); }
    .badge.err { color:var(--err); background:var(--err-soft); }
    .badge.warn { color:var(--warn); background:var(--warn-soft); }
    .empty { color:var(--muted); text-align:center; }
    .meta { color:var(--muted); font-size:12px; }
    .meta code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--text); }
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

    <div class="section-title">覆盖率</div>
    <div class="coverage">
        <div class="card">
            <h3>后端 PHP 行覆盖率</h3>
            <div class="big">${summary.coverage.php_business ? fmtPct(summary.coverage.php_business.percent) : '—'}</div>
            <p>业务代码口径（排除模板 view 与测试环境 harness）；完整口径 ${summary.coverage.php_full ? fmtPct(summary.coverage.php_full.percent) : '—'}</p>
            <p>${summary.coverage.php_business ? summary.coverage.php_business.covered + ' / ' + summary.coverage.php_business.total + ' 行' : '本轮没有 PHP 覆盖率数据'}</p>
            <div class="links">
                <a class="btn" href="php-coverage/index.html">PHP HTML 报告</a>
                <a class="btn" href="php-uncovered.txt">未覆盖行</a>
            </div>
        </div>
        <div class="card">
            <h3>前端 JS 行覆盖率</h3>
            <div class="big">${summary.coverage.js ? fmtPct(summary.coverage.js.percent) : '—'}</div>
            <p>最近一次 Playwright 运行的 V8 精确覆盖率</p>
            <p>${summary.coverage.js ? summary.coverage.js.covered + ' / ' + summary.coverage.js.total + ' 行' : '本轮没有前端覆盖率数据'}</p>
            <div class="links">
                <a class="btn" href="js-coverage/index.html">JS HTML 报告</a>
                <a class="btn" href="js-uncovered.txt">未覆盖行</a>
            </div>
        </div>
        <div class="card">
            <h3>本轮产物</h3>
            <p class="meta">Playwright 运行：<code>${esc(summary.playwright.run_id || '—')}</code></p>
            <p class="meta">流程文件：<code>${esc(summary.playwright.flow || '—')}</code></p>
            <div class="links">
                ${traceHref ? `<a class="btn" href="${traceHref}" target="_blank" rel="noopener">Trace Viewer</a>
                <a class="btn" href="/artifacts/runs/${encodeURIComponent(summary.playwright.run_id)}/" target="_blank" rel="noopener">运行产物</a>` : ''}
            </div>
        </div>
    </div>

    <div class="section-title">失败 / 未执行用例</div>
    <table>
        <thead><tr><th class="status-col">状态</th><th class="layer">层</th><th>用例</th><th>应该表现</th><th>实际表现</th></tr></thead>
        <tbody>${failureRows}</tbody>
    </table>

    <p class="meta" style="margin-top:20px">统计口径：通过率 = 通过用例 / 本轮全部用例（未执行也计入分母）；覆盖率取本轮测试全部执行完后的快照。前端步骤、接口用例与 CLI 用例分别记录，失败不中断后续用例。</p>
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

  const phpFullText = readText(path.join(roundDir, 'php-coverage-full.txt'));
  const phpBusinessText = readText(path.join(roundDir, 'php-coverage-business.txt'));
  const jsText = readText(path.join(roundDir, 'js-coverage.txt'));

  const summary = {
    round_id: path.basename(roundDir),
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
    coverage: {
      php_full: parsePhpCoverage(phpFullText),
      php_business: parsePhpCoverage(phpBusinessText),
      js: parseJsCoverage(jsText),
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
    `- [${item.status === 'not_run' ? '未执行' : '失败'}] ${item.layer} / ${item.name}\n  - 应该表现：${item.expected || '—'}\n  - 实际表现：${item.actual || '—'}`
  ).join('\n') : '- 无';

  fs.writeFileSync(path.join(roundDir, 'summary.md'), `# 全量测试报告 ${summary.round_id}

- 全量通过率：${fmtPct(summary.totals.pass_rate)}（${passed}/${summary.totals.total}）
- 失败：${failed}
- 未执行：${notRun}

## 分层通过率

${layerLines}

## 覆盖率

- 后端 PHP（业务口径）：${summary.coverage.php_business ? fmtPct(summary.coverage.php_business.percent) : '—'}
- 后端 PHP（完整口径）：${summary.coverage.php_full ? fmtPct(summary.coverage.php_full.percent) : '—'}
- 前端 JS：${summary.coverage.js ? fmtPct(summary.coverage.js.percent) : '—'}

## 失败 / 未执行

${issueLines}

## 产物

- HTML 报告：index.html
- PHP 覆盖率：php-coverage/index.html
- JS 覆盖率：js-coverage/index.html
- Playwright 运行：${summary.playwright.run_id || '—'}
`);

  return summary;
}

const summary = buildSummary();
console.log(`全量通过率：${fmtPct(summary.totals.pass_rate)}（${summary.totals.passed}/${summary.totals.total}），失败 ${summary.totals.failed}，未执行 ${summary.totals.not_run}`);
console.log(`报告：${path.join(roundDir, 'index.html')}`);
