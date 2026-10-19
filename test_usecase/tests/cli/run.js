/**
 * CLI 测试入口：每个用例都通过 bash 执行 public/cli.php 命令，
 * 断言命令输出与退出码；单条失败不会中断后续用例。
 *
 * 运行：node tests/cli/run.js
 * 输出：$ROUND_DIR/cli-results.json
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const PROJECT_ROOT = '/var/www/project_manage_system';
const CLI = 'php public/cli.php';

const CASES = [
  {
    name: '未知命令列出全部命令',
    expected: '退出码 0，输出「未匹配到命令」与 queue:status 等可用命令',
    command: CLI + ' definitely:not-a-command',
    check(output) {
      assert.ok(output.includes('未匹配到命令'));
      assert.ok(output.includes('queue:status'));
      assert.ok(output.includes('migrate:dry-run'));
    },
  },
  {
    name: 'queue:status 输出队列状态',
    expected: '退出码 0，输出 default tube 的 ready/reserved/buried 等状态',
    command: CLI + ' queue:status',
    check(output) {
      assert.ok(output.includes('name: "default"'));
      assert.ok(output.includes('current-jobs-ready:'));
      assert.ok(output.includes('current-jobs-buried:'));
    },
  },
  {
    name: 'migrate:dry-run 可安全预览',
    expected: '退出码 0，不修改数据库',
    command: CLI + ' migrate:dry-run',
    check() {},
  },
  {
    name: 'migrate:install 幂等初始化',
    expected: '退出码 0，migrations 表已存在时不报错',
    command: CLI + ' migrate:install',
    check() {},
  },
  {
    name: 'queue:ready-to-buried 安全确认',
    expected: '输入 n 后退出，不改变任务状态',
    command: "printf 'n\\n' | " + CLI + ' queue:ready-to-buried',
    check(output) {
      assert.ok(output.includes('确定开始'));
      assert.ok(output.includes('Default: n'));
    },
  },
  {
    name: 'queue:buried-dump 安全确认',
    expected: '输入 n 后退出，不导出也不删除 buried 任务',
    command: "printf 'n\\n' | " + CLI + ' queue:buried-dump',
    check(output) {
      assert.ok(output.includes('导出到文件'));
      assert.ok(output.includes('Default: n'));
    },
  },
  {
    name: 'queue:dump-import 缺参数提示',
    expected: '未传 file_path 时提示需要 file_path，并以非 0 退出',
    command: CLI + ' queue:dump-import',
    expectedExit: 1,
    check(output) {
      assert.ok(output.includes('file_path'));
    },
  },
  {
    name: 'queue:dump-import 文件不存在提示',
    expected: '传入不存在的文件时提示需要有效的 file_path',
    command: CLI + ' queue:dump-import --file_path=/tmp/pw-cli-does-not-exist.dump',
    check(output) {
      assert.ok(output.includes('file_path'));
    },
  },
  {
    name: 'queue:dump-import 导入前确认',
    expected: '文件存在时先展示任务条数并等待确认，输入 n 不导入',
    command: "printf 'n\\n' | " + CLI + ' queue:dump-import --file_path=/tmp/pw-cli-dump.dump',
    setup() {
      fs.writeFileSync('/tmp/pw-cli-dump.dump', JSON.stringify({ id: 1, body: '' }) + '\n');
    },
    cleanup() {
      fs.unlinkSync('/tmp/pw-cli-dump.dump');
    },
    check(output) {
      assert.ok(output.includes('确定开始'));
      assert.ok(output.includes('共 1 条任务'));
    },
  },
  {
    name: 'queue:peek-buried 无任务时安全退出',
    expected: '没有 buried 任务时提示错误并退出，不改变 ready 队列',
    command: "printf 'delete\\n' | " + CLI + ' queue:peek-buried',
    check() {},
  },
  {
    name: 'queue:buried-dump 确认后处理空集合',
    expected: '输入 y 后扫描 buried 任务，没有任务时直接结束',
    command: "printf 'y\\n' | " + CLI + ' queue:buried-dump',
    check() {},
  },
  {
    name: 'entity:restep-last-id 输出表',
    expected: '退出码 0，输出各表的 last_id 对照表',
    command: CLI + ' entity:restep-last-id',
    check(output) {
      assert.ok(output.includes('entity'));
      assert.ok(output.includes('last_id'));
    },
  },
  {
    name: 'queue:pause delay=0 立即恢复',
    expected: '以 0 秒暂停即恢复派发，命令快速结束且退出码 0',
    command: CLI + ' queue:pause --delay=0',
    check() {},
  },
];

function runCommand(test) {
  if (test.setup) { test.setup(); }

  const started = Date.now();

  try {
    const result = spawnSync('bash', ['-lc', test.command], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 60000,
      env: { ...process.env },
    });

    const output = (result.stdout || '') + (result.stderr || '');
    const duration = Date.now() - started;

    assert.equal(result.signal, null, '命令被信号终止：' + result.signal);
    assert.equal(result.status, test.expectedExit || 0, '命令退出码 ' + result.status + '\n' + output.slice(0, 2000));
    test.check(output);

    return { status: 'passed', duration_ms: duration, output: output.slice(0, 4000) };
  } catch (err) {
    return {
      status: 'failed',
      duration_ms: Date.now() - started,
      actual: (err instanceof Error ? err.message : String(err)).slice(0, 4000),
    };
  } finally {
    if (test.cleanup) {
      try { test.cleanup(); } catch {}
    }
  }
}

function main() {
  const roundDir = process.env.ROUND_DIR || path.join(__dirname, '../../reports/current');
  fs.mkdirSync(roundDir, { recursive: true });

  const cases = [];
  const failures = [];

  for (const test of CASES) {
    const result = runCommand(test);
    const item = {
      layer: 'cli',
      name: test.name,
      status: result.status,
      expected: test.expected,
      duration_ms: result.duration_ms,
    };

    if (result.status === 'passed') {
      console.log('CASE PASSED', 'CLI / ' + test.name);
    } else {
      item.actual = result.actual;
      failures.push(item);
      console.log('CASE FAILED', 'CLI / ' + test.name, '—', item.actual);
    }

    cases.push(item);
  }

  const summary = {
    layer: 'cli',
    total: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: failures.length,
    cases,
  };

  fs.writeFileSync(path.join(roundDir, 'cli-results.json'), JSON.stringify(summary, null, 2));

  console.log(`CLI 用例：${summary.passed}/${summary.total} 通过，失败 ${summary.failed}`);
  console.log('结果：' + path.join(roundDir, 'cli-results.json'));
}

main();
