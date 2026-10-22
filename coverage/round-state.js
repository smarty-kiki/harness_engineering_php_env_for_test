/**
 * 测试轮次状态：以「轮次」为 harness 的统一单位。
 *
 * 一轮从开始写用例时就存在，状态保存在覆盖率运行目录下，8080 直接读取：
 *   <HARNESS_COVERAGE_DIR>/rounds/<round_id>/status.json
 *
 * 完整报告发布后还会写入：
 *   <...>/rounds/<round_id>/summary.json
 *   <...>/rounds/<round_id>/report/（index.html、覆盖率 HTML、未覆盖行等）
 *
 * run-all、round-status 与 round-report 共用本文件的读写和派生逻辑，
 * 不在各命令里各自维护一份轮次状态。
 */

const fs = require('fs');
const path = require('path');

const COVERAGE_DIR = process.env.HARNESS_COVERAGE_DIR || '/var/log/harness-coverage';
const ROUNDS_DIR = path.join(COVERAGE_DIR, 'rounds');

const STATE_LABELS = {
  planning: '编写用例中',
  preparing: '准备环境中',
  seeding: '造数中',
  frontend: '前端测试中',
  api: '接口测试中',
  cli: 'CLI 测试中',
  coverage: '统计覆盖率',
  reporting: '生成报告中',
  done: '已完成',
  failed: '失败',
  interrupted: '已中断',
};

const ACTIVE_STATES = new Set([
  'planning', 'preparing', 'seeding', 'frontend', 'api', 'cli', 'coverage', 'reporting',
]);

const LAYER_NAMES = ['frontend', 'api', 'cli'];
const LAYER_STATES = new Set(['pending', 'running', 'done', 'failed', 'skipped']);

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  return slug || 'round';
}

function timestampId(date = new Date()) {
  const two = (value) => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    two(date.getMonth() + 1),
    two(date.getDate()),
  ].join('') + '-' + [two(date.getHours()), two(date.getMinutes()), two(date.getSeconds())].join('');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function roundPaths(roundId) {
  const dir = path.join(ROUNDS_DIR, roundId);

  return {
    dir,
    status: path.join(dir, 'status.json'),
    summary: path.join(dir, 'summary.json'),
    report: path.join(dir, 'report'),
    plan: path.join(dir, 'plan.md'),
  };
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function stateLabel(state) {
  return STATE_LABELS[state] || state || '未知状态';
}

function isFinal(state) {
  return !ACTIVE_STATES.has(state);
}

function emptyLayers() {
  return Object.fromEntries(LAYER_NAMES.map((name) => [
    name,
    { state: 'pending', total: 0, passed: 0, failed: 0, not_run: 0, current_step: '' },
  ]));
}

function normalizeLayerPatch(layer, patch = {}) {
  const merged = Object.assign({}, layer || {}, patch);

  if (merged.state && !LAYER_STATES.has(merged.state)) {
    merged.state = 'pending';
  }

  for (const key of ['total', 'passed', 'failed', 'not_run']) {
    if (merged[key] !== undefined) {
      merged[key] = Math.max(0, Number(merged[key]) || 0);
    }
  }

  if (merged.current_step !== undefined) {
    merged.current_step = String(merged.current_step || '');
  }

  return merged;
}

function normalizeStatus(status) {
  const layers = emptyLayers();

  for (const name of LAYER_NAMES) {
    layers[name] = normalizeLayerPatch(layers[name], status.layers ? status.layers[name] : {});
  }

  const runs = [];
  const seenRuns = new Set();

  for (const run of Array.isArray(status.playwright_runs) ? status.playwright_runs : []) {
    const value = String(run || '');
    const key = path.basename(value);

    if (!value || seenRuns.has(key)) continue;

    seenRuns.add(key);
    runs.push(value);
  }

  const defaults = {
    round_id: '',
    name: '',
    state: 'planning',
    state_label: stateLabel('planning'),
    message: '',
    started_at: nowIso(),
    updated_at: nowIso(),
    heartbeat_at: nowIso(),
    suite_dir: '',
    round_dir: '',
    playwright_runs: [],
    layers,
    coverage: { php_full: null, php_business: null, js: null },
    coverage_scope: {
      php: '本轮全部页面 / API / CLI / 队列执行',
      js: '本轮全部 Playwright 页面流程',
    },
    coverage_delta: null,
    next_round_suggestions: null,
    page_first: null,
    data_check: null,
    design_check: null,
    totals: null,
    summary_path: '',
    report_url: '',
    plan_url: '',
    error: null,
  };

  const normalized = Object.assign({}, defaults, status, {
    layers,
    playwright_runs: runs,
    coverage: Object.assign({}, defaults.coverage, status.coverage || {}),
    coverage_scope: Object.assign({}, defaults.coverage_scope, status.coverage_scope || {}),
  });

  // 兼容早期状态文件里 coverage_scope 只记录成 'round' 的写法
  if (normalized.coverage_scope.php === 'round') {
    normalized.coverage_scope.php = defaults.coverage_scope.php;
  }
  if (normalized.coverage_scope.js === 'round') {
    normalized.coverage_scope.js = defaults.coverage_scope.js;
  }

  return normalized;
}

function readRound(roundId) {
  const paths = roundPaths(roundId);
  const status = readJson(paths.status);

  return status ? normalizeStatus(status) : null;
}

function listRounds() {
  ensureDir(ROUNDS_DIR);

  return fs.readdirSync(ROUNDS_DIR)
    .map((name) => readRound(name))
    .filter(Boolean)
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
}

function writeActivePointer(suiteDir, roundId) {
  if (!suiteDir) return;

  const reportsDir = path.join(suiteDir, 'reports', 'rounds');
  ensureDir(reportsDir);
  fs.writeFileSync(path.join(reportsDir, '.active'), roundId + '\n');
}

function clearActivePointer(suiteDir, roundId) {
  if (!suiteDir) return;

  const file = path.join(suiteDir, 'reports', 'rounds', '.active');

  try {
    if (fs.readFileSync(file, 'utf-8').trim() === roundId) {
      fs.unlinkSync(file);
    }
  } catch {
    // 没有指针即可
  }
}

function createRound(options = {}) {
  let roundId = options.id || `${timestampId()}${options.name ? '-' + slugify(options.name) : ''}`;
  let suffix = 2;

  while (readRound(roundId)) {
    roundId = `${options.id || timestampId()}${options.name ? '-' + slugify(options.name) : ''}-${suffix}`;
    suffix++;
  }

  const paths = roundPaths(roundId);
  const roundDir = options.roundDir || (options.suiteDir ? path.join(options.suiteDir, 'reports', 'rounds', roundId) : '');

  ensureDir(paths.dir);
  if (roundDir) ensureDir(roundDir);

  if (options.plan) {
    fs.writeFileSync(paths.plan, String(options.plan));
  }

  const status = normalizeStatus({
    round_id: roundId,
    name: options.name || 'round',
    state: options.state || 'planning',
    state_label: stateLabel(options.state || 'planning'),
    message: options.message || '',
    suite_dir: options.suiteDir || '',
    round_dir: roundDir,
    plan_url: options.plan ? `/rounds/${roundId}/plan.md` : '',
  });

  writeJsonAtomic(paths.status, status);
  writeActivePointer(options.suiteDir, roundId);

  return status;
}

function applyPatch(status, patch = {}) {
  const next = Object.assign({}, status);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    if (key === 'layer' && typeof value === 'object') {
      continue;
    }

    if (key === 'layers' && value && typeof value === 'object') {
      next.layers = Object.assign({}, next.layers);

      for (const name of LAYER_NAMES) {
        if (value[name]) {
          next.layers[name] = normalizeLayerPatch(next.layers[name], value[name]);
        }
      }

      continue;
    }

    if (['coverage', 'coverage_scope', 'page_first', 'totals'].includes(key) && value && typeof value === 'object') {
      next[key] = Object.assign({}, next[key] || {}, value);
      continue;
    }

    next[key] = value;
  }

  if (patch.state && !patch.state_label) {
    next.state_label = stateLabel(patch.state);
  }

  if (patch.playwright_run) {
    const runs = Array.isArray(next.playwright_runs) ? next.playwright_runs.slice() : [];
    const value = String(patch.playwright_run);

    if (value) {
      const existed = runs.some((run) => run === value || path.basename(String(run)) === path.basename(value));

      if (!existed) runs.push(value);
    }

    next.playwright_runs = runs;
  }

  delete next.playwright_run;

  next.updated_at = nowIso();
  next.heartbeat_at = next.updated_at;

  return normalizeStatus(next);
}

function updateRound(roundId, patch = {}) {
  const current = readRound(roundId);

  if (!current) {
    throw new Error(`轮次不存在：${roundId}`);
  }

  const next = applyPatch(current, patch);
  writeJsonAtomic(roundPaths(roundId).status, next);

  return next;
}

function heartbeat(roundId, message) {
  return updateRound(roundId, message === undefined ? {} : { message });
}

function finishRound(roundId, options = {}) {
  const paths = roundPaths(roundId);
  const summary = options.summaryPath ? readJson(options.summaryPath) : readJson(paths.summary);
  const patch = {
    state: options.failed ? 'failed' : 'done',
    message: options.message || '',
    error: options.failed ? (options.error || options.message || '本轮执行失败') : null,
    summary_path: options.summaryPath || paths.summary,
    report_url: options.reportUrl || '',
    round_dir: options.roundDir || undefined,
  };

  if (summary) {
    patch.totals = summary.totals || null;
    patch.coverage = summary.coverage || null;
    patch.page_first = summary.page_first || null;
    patch.data_check = summary.data_check || null;
    patch.design_check = summary.design_check || null;
    patch.coverage_scope = summary.coverage_scope || { php: 'round', js: 'round' };
    patch.coverage_delta = summary.coverage_delta || null;
    patch.next_round_suggestions = summary.next_round_suggestions || null;
    patch.layers = Object.fromEntries(LAYER_NAMES.map((name) => {
      const layer = summary.layers ? summary.layers[name] : null;

      if (!layer) return [name, { state: 'skipped' }];

      return [name, Object.assign({}, layer, {
        state: layer.available === false ? 'skipped' : 'done',
      })];
    }));

    if (summary.playwright && summary.playwright.run_id) {
      patch.playwright_run = summary.playwright.run_id;
    }
  }

  if (options.reportDir) {
    publishReportToRegistry(roundId, options.reportDir);
  }

  const next = updateRound(roundId, patch);
  clearActivePointer(next.suite_dir, roundId);

  return next;
}

function activeRound(suiteDir) {
  if (suiteDir) {
    const file = path.join(suiteDir, 'reports', 'rounds', '.active');

    try {
      const roundId = fs.readFileSync(file, 'utf-8').trim();
      const status = readRound(roundId);

      if (status && !isFinal(status.state) && (!status.suite_dir || status.suite_dir === suiteDir)) {
        return status;
      }
    } catch {
      // 没有 active 指针时继续扫描
    }
  }

  const active = listRounds()
    .filter((status) => !isFinal(status.state))
    .filter((status) => !suiteDir || !status.suite_dir || status.suite_dir === suiteDir)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  return active[0] || null;
}

function publishSummaryToRegistry(roundId, summaryPath) {
  const paths = roundPaths(roundId);
  const summary = readJson(summaryPath);

  if (!summary) return null;

  writeJsonAtomic(paths.summary, summary);

  return summary;
}

// 报告目录整体同步到注册目录：8080、趋势工具与归档只读这一份。
function publishReportToRegistry(roundId, sourceDir) {
  if (!sourceDir) return null;

  const source = path.resolve(String(sourceDir));
  const target = roundPaths(roundId).report;

  if (!fs.existsSync(source)) return null;
  if (source === path.resolve(target)) return target;

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, force: true });

  return target;
}

function previousSummary(roundId) {
  const rounds = listRounds()
    .filter((status) => status.round_id !== roundId)
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));

  for (let index = rounds.length - 1; index >= 0; index--) {
    const status = rounds[index];
    const summary = readJson(roundPaths(status.round_id).summary) || readJson(path.join(roundPaths(status.round_id).report, 'summary.json'));

    if (summary) {
      return { round_id: status.round_id, summary };
    }
  }

  return null;
}

module.exports = {
  COVERAGE_DIR,
  ROUNDS_DIR,
  STATE_LABELS,
  LAYER_NAMES,
  ACTIVE_STATES,
  stateLabel,
  isFinal,
  roundPaths,
  readRound,
  listRounds,
  createRound,
  updateRound,
  heartbeat,
  finishRound,
  activeRound,
  publishSummaryToRegistry,
  publishReportToRegistry,
  previousSummary,
  timestampId,
};
