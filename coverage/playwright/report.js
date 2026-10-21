/**
 * Playwright 前端覆盖率报告：把 run.js 落盘的 V8 增量事件汇总成 Istanbul 覆盖率。
 *
 * 事件目录里每个 JSON 是「两次 takePreciseCoverage 之间的增量」：
 *   { page_url, timestamp, scripts: [...], inline_sources: [...] }
 * 外链脚本按 URL 映射到 <root>/public/<path>；内联脚本按页面路径 + 源码哈希命名。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const v8toIstanbul = require('v8-to-istanbul');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

function loadEvents(target) {
  // 一轮可能包含多次 Playwright 运行；传入目录数组时合并所有事件
  const dirs = Array.isArray(target) ? target : [target];
  const events = [];

  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;

    const names = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();

    for (const name of names) {
      try {
        const event = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
        if (Array.isArray(event?.scripts)) events.push(event);
      } catch {
        // 跳过写到一半的文件；报告不应因单个坏文件整体失败
      }
    }
  }

  return events;
}

function toSummaryPart(summary) {
  return {
    pct: summary && summary.pct !== 'Unknown' ? `${Number(summary.pct).toFixed(2)}%` : '-',
    covered: summary ? Number(summary.covered) || 0 : 0,
    total: summary ? Number(summary.total) || 0 : 0,
  };
}

function compressLines(lines) {
  // Istanbul 不同版本的 getUncoveredLines() 可能返回数组或对象，两种都支持
  const raw = Array.isArray(lines) ? lines : Object.keys(lines);

  const nums = raw
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const out = [];
  let start = null;
  let prev = null;

  for (const n of nums) {
    if (start === null) {
      start = n;
      prev = n;
      continue;
    }

    if (prev !== null && n === prev + 1) {
      prev = n;
      continue;
    }

    out.push(start === prev ? String(start) : `${start}-${prev}`);
    start = n;
    prev = n;
  }

  if (start !== null) out.push(start === prev ? String(start) : `${start}-${prev}`);

  return out;
}

function sanitizePagePath(pagePath) {
  const slug = pagePath.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_');

  return (slug || 'root').slice(0, 80);
}

function inlineKey(pagePath, source) {
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 8);

  return {
    key: `inline/${sanitizePagePath(pagePath)}/${hash}.js`,
    label: `inline: ${pagePath || '/'}#${hash}`,
  };
}

function resolveWebFile(webRoot, scriptUrl) {
  let url;
  try {
    url = new URL(scriptUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!relative) return null;

  const webRootAbs = path.resolve(webRoot);
  const abs = path.resolve(webRootAbs, relative);

  if (abs !== webRootAbs && !abs.startsWith(webRootAbs + path.sep)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;

  return abs;
}

function isInlineScript(script, pageUrl) {
  if (!script.url) return true;
  if (!pageUrl) return false;
  if (script.url === pageUrl) return true;

  // 行内脚本的 URL 有时带 fragment（例如页面 URL#...），按去掉 fragment 的形态再比一次
  try {
    const a = new URL(script.url);
    const b = new URL(pageUrl);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

function textReport(files, totals, events, scriptCount, showUncovered) {
  const lines = [];
  lines.push(`前端覆盖率（事件 ${events}，脚本 ${scriptCount}）`);

  const width = Math.max(20, Math.min(52, ...files.map((f) => f.file.length)));
  lines.push(`${'文件'.padEnd(width)}  行                    函数`);

  for (const file of files) {
    const label = file.file.length > width ? `${file.file.slice(0, width - 1)}…` : file.file.padEnd(width);
    const linePart = `${file.lines.pct} (${file.lines.covered}/${file.lines.total})`;
    const fnPart = `${file.functions.pct} (${file.functions.covered}/${file.functions.total})`;
    lines.push(`${label}  ${linePart.padEnd(20)}  ${fnPart}`);
  }

  lines.push(
    `${'合计'.padEnd(width)}  ${`${totals.lines.pct} (${totals.lines.covered}/${totals.lines.total})`.padEnd(20)}  ${totals.functions.pct} (${totals.functions.covered}/${totals.functions.total})`,
  );

  if (showUncovered) {
    const uncovered = files.filter((f) => f.uncovered_lines.length > 0);

    if (uncovered.length > 0) {
      lines.push('');
      lines.push('未覆盖行：');

      for (const file of uncovered) {
        lines.push(`  ${file.file}: ${file.uncovered_lines.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

async function generateCoverageReport(options) {
  const dirs = Array.isArray(options.dirs)
    ? options.dirs.map((dir) => path.resolve(dir))
    : (options.dir ? [path.resolve(options.dir)] : []);
  const root = path.resolve(options.root);
  const webRoot = path.resolve(options.webRoot || path.join(root, 'public'));
  const excludes = options.exclude && options.exclude.length > 0 ? options.exclude : ['node_modules', '.git'];

  const events = loadEvents(dirs);
  const coverageMap = libCoverage.createCoverageMap({});
  const labels = new Map();
  const sourceCache = new Map();
  const sourceByKey = new Map();
  const warnings = new Set();
  const seenKeys = new Set();

  for (const event of events) {
    const pageUrl = event.page_url || '';
    let pagePath = '';

    try {
      pagePath = new URL(pageUrl).pathname || '/';
    } catch {
      pagePath = '';
    }

    const inlineByScript = new Map();
    for (const item of event.inline_sources || []) {
      if (item && item.scriptId && typeof item.source === 'string') inlineByScript.set(item.scriptId, item);
    }

    for (const script of event.scripts || []) {
      if (!script || !Array.isArray(script.functions) || script.functions.length === 0) continue;

      let key = '';
      let label = '';
      let source = '';

      if (isInlineScript(script, pageUrl)) {
        const inline = inlineByScript.get(script.scriptId);

        if (!inline) {
          warnings.add('有行内脚本没有拿到源码，已跳过（页面切换过快时可能出现，补测一次即可）');
          continue;
        }

        const info = inlineKey(pagePath, inline.source);
        key = info.key;
        label = info.label;
        source = inline.source;
      } else {
        const abs = resolveWebFile(webRoot, script.url);

        if (!abs) continue;

        const relative = path.relative(root, abs).split(path.sep).join('/');

        if (excludes.some((ex) => ex && relative.includes(ex))) continue;

        key = relative;
        label = relative;

        if (sourceCache.has(abs)) {
          source = sourceCache.get(abs);
        } else {
          try {
            source = fs.readFileSync(abs, 'utf-8');
            sourceCache.set(abs, source);
          } catch {
            warnings.add(`无法读取脚本源码：${relative}`);
            continue;
          }
        }
      }

      try {
        const converter = v8toIstanbul(key, 0, { source });
        await converter.load();
        converter.applyCoverage(script.functions);
        coverageMap.merge(converter.toIstanbul());
        labels.set(key, label);
        sourceByKey.set(key, source);
        seenKeys.add(key);
      } catch (err) {
        warnings.add(`脚本覆盖率转换失败：${key} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const files = [];
  const totalSummary = libCoverage.createCoverageSummary();

  for (const key of coverageMap.files().sort()) {
    const fileCoverage = coverageMap.fileCoverageFor(key);
    const summary = fileCoverage.toSummary();

    totalSummary.merge(summary);

    files.push({
      file: labels.get(key) || key,
      lines: toSummaryPart(summary.lines),
      functions: toSummaryPart(summary.functions),
      statements: toSummaryPart(summary.statements),
      uncovered_lines: compressLines(fileCoverage.getUncoveredLines()),
    });
  }

  const totals = {
    lines: toSummaryPart(totalSummary.lines),
    functions: toSummaryPart(totalSummary.functions),
    statements: toSummaryPart(totalSummary.statements),
  };

  const result = {
    text: '',
    files,
    totals,
    events: events.length,
    scripts: seenKeys.size,
    warnings: Array.from(warnings),
  };

  result.text = files.length > 0
    ? textReport(files, totals, events.length, seenKeys.size, options.showUncovered === true)
    : `没有前端覆盖率数据（事件 ${events.length}）。请用 playwright-run 运行测试流程后再查看。`;

  if (options.html) {
    const htmlDir = path.resolve(options.html);

    fs.mkdirSync(htmlDir, { recursive: true });

    // 行内脚本的 key 是「页面路径 + 源码哈希」的虚拟路径，磁盘上不存在对应文件；
    // 必须把采集事件里的源码交给 Istanbul，否则详情页会打印 source lookup 的异常堆栈。
    const context = libReport.createContext({
      dir: htmlDir,
      coverageMap,
      sourceFinder: (file) => {
        if (sourceByKey.has(file)) return sourceByKey.get(file);
        return fs.readFileSync(path.resolve(root, file), 'utf8');
      },
    });
    reports.create('html', { subdir: '' }).execute(context);
    result.html_path = htmlDir;
  }

  if (options.clover) {
    const cloverPath = path.resolve(options.clover);

    fs.mkdirSync(path.dirname(cloverPath), { recursive: true });

    const context = libReport.createContext({ dir: path.dirname(cloverPath), coverageMap });
    reports.create('clover', { file: path.basename(cloverPath) }).execute(context);
    result.clover_path = cloverPath;
  }

  return result;
}

module.exports = { generateCoverageReport, loadEvents };
