#!/usr/bin/env node
/**
 * 轮次状态命令：一轮测试从「编写用例」开始就登记到 8080 观测台。
 *
 *   round-status start --name=<名称> [--suite-dir=<测试套件目录>] [--plan=<plan.md>]
 *   round-status update --id=<轮次> --state=frontend --message=... [--layer=frontend ...]
 *   round-status heartbeat --id=<轮次> [--message=...]
 *   round-status active [--suite-dir=<测试套件目录>] [--json]
 *   round-status publish --id=<轮次> [--summary=<summary.json>] [--report-dir=<目录>]
 *   round-status finish --id=<轮次> --summary=<summary.json> [--report-dir=<目录>] [--failed]
 *   round-status show --id=<轮次>
 *   round-status list [--json]
 *
 * run-all 会自动 start / update / finish；手动写用例时先执行 start，
 * 轮次会立即出现在 8080 的「测试轮次」区，执行期间持续更新。
 */

const fs = require('fs');
const path = require('path');
const state = require('./round-state');

function parseArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (!arg.startsWith('--')) continue;

    const equal = arg.indexOf('=');

    if (equal >= 0) {
      options[arg.slice(2, equal)] = arg.slice(equal + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];

    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      i++;
    } else {
      options[key] = true;
    }
  }

  return options;
}

function requireOption(options, name) {
  const value = options[name] ?? process.env[name.toUpperCase().replace(/-/g, '_')];

  if (!value || value === true) {
    throw new Error(`缺少 --${name}`);
  }

  return String(value);
}

function numberOption(options, name) {
  if (options[name] === undefined) return undefined;

  const value = Number(options[name]);

  return Number.isFinite(value) ? value : undefined;
}

function suiteDirOption(options) {
  return options['suite-dir'] ? path.resolve(options['suite-dir']) : (process.env.TEST_SUITE_DIR ? path.resolve(process.env.TEST_SUITE_DIR) : '');
}

function coveragePercent(value) {
  const number = Number(value);

  return Number.isFinite(number) ? { percent: number } : undefined;
}

function print(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (typeof value === 'string') {
    console.log(value);
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

function start(options) {
  const suiteDir = suiteDirOption(options);
  const name = options.name || 'round';
  const roundDir = options['round-dir'] ? path.resolve(options['round-dir']) : '';
  let plan = '';

  if (options.plan && options.plan !== true) {
    plan = fs.readFileSync(path.resolve(String(options.plan)), 'utf-8');
  }

  // 同一套件开始新一轮时，上一轮若还在编写 / 执行，标记为被替代，避免 8080 留下永远“进行中”的记录
  if (suiteDir) {
    const previous = state.activeRound(suiteDir);

    if (previous) {
      state.updateRound(previous.round_id, {
        state: 'interrupted',
        message: '被新一轮替代：' + (options.id ? String(options.id) : name),
      });
    }
  }

  const status = state.createRound({
    id: options.id ? String(options.id) : '',
    name,
    suiteDir,
    roundDir,
    plan,
    state: 'planning',
    message: options.message || '开始编写本轮测试用例',
  });

  if (options.json) {
    print(status, true);
  } else {
    console.log(status.round_id);
  }
}

function update(options) {
  const roundId = requireOption(options, 'id');
  const layer = options.layer && options.layer !== true ? String(options.layer) : '';

  const patch = {};

  if (options.state) patch.state = String(options.state);
  if (options.message !== undefined) patch.message = String(options.message);
  if (options['round-dir']) patch.round_dir = path.resolve(String(options['round-dir']));
  if (options['suite-dir']) patch.suite_dir = path.resolve(String(options['suite-dir']));
  if (options['playwright-run']) patch.playwright_run = path.resolve(String(options['playwright-run']));

  if (options['coverage-php-full'] !== undefined) {
    patch.coverage = Object.assign({}, patch.coverage, { php_full: coveragePercent(options['coverage-php-full']) });
  }

  if (options['coverage-php-business'] !== undefined) {
    patch.coverage = Object.assign({}, patch.coverage, { php_business: coveragePercent(options['coverage-php-business']) });
  }

  if (options['coverage-js'] !== undefined) {
    patch.coverage = Object.assign({}, patch.coverage, { js: coveragePercent(options['coverage-js']) });
  }

  if (layer) {
    const layerPatch = {};

    if (options['layer-state']) layerPatch.state = String(options['layer-state']);
    if (options['current-step'] !== undefined) layerPatch.current_step = String(options['current-step']);
    if (options.total !== undefined) layerPatch.total = numberOption(options, 'total');
    if (options.passed !== undefined) layerPatch.passed = numberOption(options, 'passed');
    if (options.failed !== undefined) layerPatch.failed = numberOption(options, 'failed');
    if (options['not-run'] !== undefined) layerPatch.not_run = numberOption(options, 'not-run');

    patch.layers = { [layer]: layerPatch };
  }

  const status = state.updateRound(roundId, patch);

  print(status, options.json);
}

function active(options) {
  const status = state.activeRound(suiteDirOption(options));

  if (options.json) {
    print(status, true);
    return;
  }

  if (status) {
    console.log(status.round_id);
  }
}

function publish(options) {
  const roundId = requireOption(options, 'id');
  const summaryPath = options.summary && options.summary !== true ? path.resolve(String(options.summary)) : '';
  const reportDir = options['report-dir'] && options['report-dir'] !== true ? path.resolve(String(options['report-dir'])) : '';
  const result = {};

  if (summaryPath) {
    result.summary = state.publishSummaryToRegistry(roundId, summaryPath) ? summaryPath : '';
  }

  if (reportDir) {
    result.report = state.publishReportToRegistry(roundId, reportDir) || '';
  }

  print(result, options.json);
}

function heartbeat(options) {
  const roundId = requireOption(options, 'id');
  const status = state.heartbeat(roundId, options.message === undefined ? undefined : String(options.message));

  print(status, options.json);
}

function finish(options) {
  const roundId = requireOption(options, 'id');
  const summaryPath = options.summary && options.summary !== true ? path.resolve(String(options.summary)) : '';

  if (summaryPath) {
    state.publishSummaryToRegistry(roundId, summaryPath);
  }

  const status = state.finishRound(roundId, {
    summaryPath,
    failed: options.failed === true || options.failed === 'true',
    message: options.message ? String(options.message) : '',
    error: options.error ? String(options.error) : '',
    reportUrl: options['report-url'] ? String(options['report-url']) : '',
    roundDir: options['round-dir'] ? path.resolve(String(options['round-dir'])) : '',
    reportDir: options['report-dir']
      ? path.resolve(String(options['report-dir']))
      : (options['round-dir'] ? path.resolve(String(options['round-dir'])) : ''),
  });

  print(status, options.json);
}

function show(options) {
  const status = state.readRound(requireOption(options, 'id'));

  if (!status) {
    throw new Error(`轮次不存在：${requireOption(options, 'id')}`);
  }

  print(status, true);
}

function list(options) {
  const rounds = state.listRounds();

  if (options.json) {
    print(rounds, true);
    return;
  }

  if (!rounds.length) {
    console.log('还没有测试轮次记录');
    return;
  }

  console.log('轮次                            状态        开始时间                  通过率');
  for (const round of rounds) {
    const rate = round.totals && round.totals.total > 0
      ? `${(round.totals.pass_rate || 0).toFixed(2)}% (${round.totals.passed}/${round.totals.total})`
      : '—';

    console.log(
      String(round.round_id).padEnd(32)
      + String(round.state_label || round.state).padEnd(12)
      + String(round.started_at).padEnd(26)
      + rate
    );
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);

  if (!command || ['help', '--help', '-h'].includes(command)) {
    console.log('用法：round-status <start|update|heartbeat|active|publish|finish|show|list> [选项]');
    console.log('详见 /usr/local/share/harness/coverage/README.md 的「轮次状态」章节。');
    process.exit(command ? 0 : 1);
  }

  switch (command) {
    case 'start':
      start(options);
      break;
    case 'update':
      update(options);
      break;
    case 'heartbeat':
      heartbeat(options);
      break;
    case 'active':
      active(options);
      break;
    case 'publish':
      publish(options);
      break;
    case 'finish':
      finish(options);
      break;
    case 'show':
      show(options);
      break;
    case 'list':
      list(options);
      break;
    default:
      throw new Error(`未知子命令：${command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
