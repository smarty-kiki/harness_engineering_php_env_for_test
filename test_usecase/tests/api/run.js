/**
 * 接口测试入口：按「页面无法覆盖 / 不适合从页面覆盖」的场景组织用例，
 * 每个用例独立执行并记录 expected / actual，单条失败不会中断后续用例。
 *
 * 运行：node tests/api/run.js
 * 输出：$ROUND_DIR/api-results.json
 */
const fs = require('fs');
const path = require('path');
const { createContext } = require('./lib/api');

const MODULES = [
  ['认证与会话', './cases/auth'],
  ['团队与权限', './cases/team_access'],
  ['工作项与版本', './cases/works_versions'],
  ['测试用例管理', './cases/test_cases'],
  ['助手与开放接口', './cases/agent_open_api'],
  ['SSE / 版本号 / 流水线', './cases/misc'],
];

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  const roundDir = process.env.ROUND_DIR || path.join(__dirname, '../../reports/current');
  fs.mkdirSync(roundDir, { recursive: true });

  const ctx = createContext();
  const cases = [];
  const failures = [];

  for (const [group, file] of MODULES) {
    let tests;

    try {
      tests = require(file);
    } catch (err) {
      const item = {
        group,
        name: group + ' 用例加载',
        status: 'failed',
        expected: '用例模块可以正常加载',
        actual: messageOf(err),
      };
      cases.push(item);
      failures.push(item);
      console.log('CASE FAILED', item.name, item.actual);
      continue;
    }

    for (const test of tests) {
      const started = Date.now();
      try {
        await test.run(ctx);
        cases.push({
          group,
          name: test.name,
          status: 'passed',
          expected: test.expected,
          duration_ms: Date.now() - started,
        });
        console.log('CASE PASSED', group + ' / ' + test.name);
      } catch (err) {
        const item = {
          group,
          name: test.name,
          status: 'failed',
          expected: test.expected,
          actual: messageOf(err),
          duration_ms: Date.now() - started,
        };
        cases.push(item);
        failures.push(item);
        console.log('CASE FAILED', group + ' / ' + test.name, '—', item.actual);
      }
    }
  }

  const summary = {
    layer: 'api',
    total: cases.length,
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: failures.length,
    cases,
  };

  fs.writeFileSync(path.join(roundDir, 'api-results.json'), JSON.stringify(summary, null, 2));

  console.log(`API 用例：${summary.passed}/${summary.total} 通过，失败 ${summary.failed}`);
  console.log('结果：' + path.join(roundDir, 'api-results.json'));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
