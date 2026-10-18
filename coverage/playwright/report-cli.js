#!/usr/bin/env node
/**
 * 前端覆盖率报告命令行。
 *
 * 默认读取最近一次 Playwright 运行（playwright/latest）的 events 目录，
 * 汇总成文本；也可以指定某次运行，或输出 HTML / Clover。
 */

const fs = require('fs');
const path = require('path');
const { generateCoverageReport } = require('./report');

function usage() {
  console.error(`用法：frontend-coverage-report [options]

Options:
  --run <id|dir>     指定运行（默认 latest；可传运行目录名或完整路径）
  --root <dir>       项目根目录（默认 $PRJ_HOME 或当前目录）
  --web-root <dir>   URL → 本地文件的根目录（默认 <root>/public）
  --html <dir>       输出 HTML 报告到指定目录
  --clover <file>    输出 Clover XML 到指定文件
  --show-uncovered   列出未覆盖行
  --help             显示帮助`);
}

function parseArgs(argv) {
  const options = {
    run: null,
    root: process.env.PRJ_HOME || process.cwd(),
    webRoot: null,
    html: null,
    clover: null,
    showUncovered: false,
    coverageDir: process.env.HARNESS_COVERAGE_DIR || '/var/log/harness-coverage',
  };

  const need = (flag, i) => {
    if (i + 1 >= argv.length) {
      console.error(`${flag} 缺少参数`);
      process.exit(2);
    }
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      case '--run':
        options.run = need(argv[i], i);
        i++;
        break;
      case '--root':
        options.root = need(argv[i], i);
        i++;
        break;
      case '--web-root':
        options.webRoot = need(argv[i], i);
        i++;
        break;
      case '--html':
        options.html = need(argv[i], i);
        i++;
        break;
      case '--clover':
        options.clover = need(argv[i], i);
        i++;
        break;
      case '--show-uncovered':
        options.showUncovered = true;
        break;
      default:
        console.error(`未知参数：${argv[i]}`);
        usage();
        process.exit(2);
    }
  }

  return options;
}

function resolveRunDir(options) {
  const outBase = path.join(path.resolve(options.coverageDir), 'playwright');

  if (!options.run) {
    const latest = path.join(outBase, 'latest');

    if (!fs.existsSync(latest)) {
      throw new Error(`还没有 Playwright 运行记录（${latest} 不存在）。先执行 playwright-run <flow.js>。`);
    }

    return fs.realpathSync(latest);
  }

  if (options.run.includes('/')) {
    return path.resolve(options.run);
  }

  const candidate = path.join(outBase, 'runs', options.run);

  if (!fs.existsSync(candidate)) {
    throw new Error(`运行不存在：${options.run}`);
  }

  return fs.realpathSync(candidate);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDir = resolveRunDir(options);
  const eventsDir = path.join(runDir, 'events');

  if (!fs.existsSync(eventsDir)) {
    throw new Error(`运行目录里没有 events/：${runDir}`);
  }

  const report = await generateCoverageReport({
    dir: eventsDir,
    root: options.root,
    webRoot: options.webRoot,
    showUncovered: options.showUncovered,
    html: options.html,
    clover: options.clover,
  });

  console.log(report.text);

  if (report.warnings.length > 0) {
    console.log('');
    console.log('警告：');
    for (const warning of report.warnings) console.log(`  ${warning}`);
  }

  if (report.html_path) console.log(`\nHTML 报告：${report.html_path}`);
  if (report.clover_path) console.log(`Clover 报告：${report.clover_path}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
