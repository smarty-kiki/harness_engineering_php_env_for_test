#!/usr/bin/env node
/**
 * 有头 Playwright 测试运行器：一个流程文件 = 一次运行，产物自包含在一个目录里。
 *
 * 产物目录（默认）：/var/log/harness-coverage/playwright/runs/<时间戳>-<名称>/
 *   trace.zip        Playwright Trace Viewer 可直接打开
 *   run.webm         单页面流程的录像（多页面时在 videos/ 下）
 *   screenshots/     流程截图
 *   events/          V8 精确覆盖率增量事件（供 report.js 汇总）
 *   report/          HTML 覆盖率报告
 *   coverage.txt     文本覆盖率报告
 *   meta.json        运行信息、流程返回值、错误与页面错误
 *
 * 观测入口由 nginx 8080 提供（见 config/nginx_playwright.conf）：
 *   /            只读 live view（noVNC）
 *   /artifacts/  产物（latest/ 指向最近一次运行）
 *   /js-coverage/ 最近一次运行的 HTML 覆盖率报告
 *   /trace/      最近一次运行的 Trace Viewer
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const { generateCoverageReport } = require('./report');

const PUBLIC_URL = process.env.HARNESS_PUBLIC_URL || 'http://127.0.0.1:8080';

function usage() {
  console.error(`用法：playwright-run <flow.js> [options]

一次运行会在覆盖率目录下生成 trace、录像、截图和前端覆盖率报告。

Options:
  --root <dir>       项目根目录（默认 $PRJ_HOME 或当前目录）
  --web-root <dir>   URL → 本地文件的根目录（默认 <root>/public）
  --base-url <url>   被测站点地址（默认 $BASE_URL 或 http://127.0.0.1）
  --name <name>      运行名称（用于产物目录名）
  --linger <秒>      流程结束后保留浏览器的时间，便于观察最终画面
  --no-video         不录像
  --headless         无头模式（默认有头，供 live view 观察）
  --help             显示帮助

流程文件导出 async function({ page, context, baseUrl, screenshot, step, takeCoverage, log, setMeta })`);
}

function parseArgs(argv) {
  const options = {
    flow: null,
    root: process.env.PRJ_HOME || process.cwd(),
    webRoot: null,
    baseUrl: process.env.BASE_URL || 'http://127.0.0.1',
    name: null,
    linger: 0,
    video: true,
    headless: false,
    coverageDir: process.env.HARNESS_COVERAGE_DIR || '/var/log/harness-coverage',
  };

  const need = (flag, i) => {
    if (i + 1 >= argv.length) {
      console.error(`${flag} 缺少参数`);
      usage();
      process.exit(2);
    }
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      case '--root':
        options.root = need(arg, i);
        i++;
        break;
      case '--web-root':
        options.webRoot = need(arg, i);
        i++;
        break;
      case '--base-url':
        options.baseUrl = need(arg, i);
        i++;
        break;
      case '--name':
        options.name = need(arg, i);
        i++;
        break;
      case '--linger':
        options.linger = Number(need(arg, i));
        i++;
        break;
      case '--no-video':
        options.video = false;
        break;
      case '--headless':
        options.headless = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`未知参数：${arg}`);
          usage();
          process.exit(2);
        }
        if (options.flow) {
          console.error(`只能指定一个流程文件（已有 ${options.flow}，又收到 ${arg}）`);
          process.exit(2);
        }
        options.flow = arg;
    }
  }

  if (!options.flow) {
    usage();
    process.exit(2);
  }

  if (!Number.isFinite(options.linger) || options.linger < 0) {
    console.error('--linger 必须是非负秒数');
    process.exit(2);
  }

  return options;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function stamp(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function slugify(value) {
  const slug = String(value || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return slug || 'flow';
}

/**
 * 同一块 Xvfb 屏幕和 trace viewer 只能被一个运行占用，用锁文件避免并发运行互相干扰。
 * 进程异常退出留下的陈旧锁（PID 已不存在）会自动清理。
 */
function acquireRunLock(outBase) {
  const lockPath = path.join(outBase, '.run.lock');

  const writeLock = () => {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    process.on('exit', () => {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // 已清理
      }
    });
  };

  try {
    writeLock();
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    let otherPid = 0;
    try {
      otherPid = parseInt(fs.readFileSync(lockPath, 'utf-8'), 10);
    } catch {
      // 锁文件刚好被删掉
    }

    if (Number.isFinite(otherPid) && otherPid > 1 && processAlive(otherPid)) {
      throw new Error(`已有 playwright-run 在运行（pid ${otherPid}）。同一时间只允许一个前端测试运行，等它结束再试。`);
    }

    fs.unlinkSync(lockPath);
    writeLock();
  }
}

function makeRunDir(runsDir, name) {
  const base = `${stamp(new Date())}-${slugify(name)}`;
  let candidate = path.join(runsDir, base);
  let seq = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(runsDir, `${base}-${seq}`);
    seq++;
  }

  return candidate;
}

function ensureDisplay(headless) {
  if (headless) return;

  process.env.DISPLAY = process.env.DISPLAY || ':99';

  const match = /^:(\d+)/.exec(process.env.DISPLAY || '');
  if (match && !fs.existsSync(`/tmp/.X11-unix/X${match[1]}`)) {
    throw new Error(
      `DISPLAY=${process.env.DISPLAY} 没有对应的 X server。请确认 live view 服务已启动（supervisor 的 playwright-live-view），或用 --headless 运行。`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const flowPath = path.resolve(options.flow);

  if (!fs.existsSync(flowPath)) {
    throw new Error(`流程文件不存在：${flowPath}`);
  }

  const flow = require(flowPath);

  if (typeof flow !== 'function') {
    throw new Error('流程文件必须 module.exports 一个 async function');
  }

  const root = path.resolve(options.root);
  const webRoot = options.webRoot ? path.resolve(options.webRoot) : path.join(root, 'public');
  const outBase = path.join(path.resolve(options.coverageDir), 'playwright');
  const runsDir = path.join(outBase, 'runs');

  fs.mkdirSync(runsDir, { recursive: true });
  acquireRunLock(outBase);

  const runDir = makeRunDir(runsDir, options.name || path.basename(flowPath));
  const screenshotsDir = path.join(runDir, 'screenshots');
  const eventsDir = path.join(runDir, 'events');
  const reportDir = path.join(runDir, 'report');
  const videosDir = path.join(runDir, 'videos');

  for (const dir of [screenshotsDir, eventsDir, reportDir, videosDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  ensureDisplay(options.headless);

  const startedAt = new Date();
  const meta = {
    run_id: path.basename(runDir),
    flow: flowPath,
    root,
    web_root: webRoot,
    base_url: options.baseUrl,
    started_at: startedAt.toISOString(),
    headless: options.headless,
    video: options.video,
    steps: [],
    page_errors: [],
    console_errors: [],
  };

  const log = (...args) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
  const setMeta = (patch) => Object.assign(meta, patch);
  let currentStep = null;

  log('run dir', runDir);
  log('flow', flowPath);

  let browser;
  let context;
  let mainPage;
  let tracingStarted = false;
  let flowError = null;
  let flowResult;

  try {
    browser = await chromium.launch({
      headless: options.headless,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1600,1000'],
    });

    const contextOptions = { viewport: { width: 1440, height: 860 } };

    if (options.video) {
      contextOptions.recordVideo = { dir: videosDir, size: { width: 1440, height: 860 } };
    }

    context = await browser.newContext(contextOptions);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    tracingStarted = true;

    mainPage = await context.newPage();

    const pageStates = new Map();
    let eventSeq = 0;

    async function takeCoverage(page, reason) {
      const state = pageStates.get(page);

      if (!state || !state.client || state.closed || state.unavailable) return;

      state.chain = state.chain
        .then(async () => {
          if (state.closed) return;

          let coverage;

          try {
            coverage = await state.client.send('Profiler.takePreciseCoverage');
          } catch (err) {
            log(`coverage take (${reason}) 失败：${err.message}`);
            return;
          }

          if (!coverage || !Array.isArray(coverage.result)) return;

          let inlineTexts = [];

          try {
            inlineTexts = await page.evaluate(() =>
              Array.from(document.scripts)
                .filter((script) => !script.src)
                .map((script) => (script.textContent || '').trim()),
            );
          } catch {
            // 页面正在导航/已关闭，拿不到当前文档的内联脚本
          }

          const inlineSet = new Set(inlineTexts.filter(Boolean));
          const pageUrl = page.isClosed() ? state.lastUrl : page.url();
          const scripts = [];
          const inlineSources = [];

          for (const script of coverage.result) {
            const url = script.url || '';
            let inline = !url;

            if (!inline && pageUrl) {
              try {
                const a = new URL(url);
                const b = new URL(pageUrl);
                inline = a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
              } catch {
                inline = false;
              }
            }

            if (inline) {
              let source = '';

              try {
                const result = await state.client.send('Debugger.getScriptSource', { scriptId: script.scriptId });
                if (typeof result.scriptSource === 'string') source = result.scriptSource.trim();
              } catch {
                // 拿不到源码的内联脚本由报告侧跳过
              }

              // 只保留真正出现在 HTML 里的内联脚本，丢掉 Playwright/浏览器注入的匿名脚本
              if (!source || !inlineSet.has(source)) continue;

              scripts.push(script);
              inlineSources.push({ scriptId: script.scriptId, url: script.url, source });
              continue;
            }

            if (!url.startsWith('http://') && !url.startsWith('https://')) continue;

            scripts.push(script);
          }

          if (scripts.length === 0) return;

          eventSeq++;
          const event = {
            page_url: pageUrl,
            timestamp: new Date().toISOString(),
            reason,
            scripts,
            inline_sources: inlineSources,
          };

          fs.writeFileSync(path.join(eventsDir, `${String(eventSeq).padStart(3, '0')}.json`), JSON.stringify(event, null, 2));
          log(`coverage take (${reason}) scripts=${scripts.length} inlineSources=${inlineSources.length}`);
        })
        .catch((err) => log('coverage take 异常：', err.message));
    }

    async function instrumentPage(page) {
      if (pageStates.has(page)) return pageStates.get(page);

      const state = {
        client: null,
        closed: false,
        unavailable: false,
        lastUrl: '',
        chain: Promise.resolve(),
      };

      pageStates.set(page, state);

      page.on('close', () => {
        state.closed = true;
      });

      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) state.lastUrl = frame.url();
      });

      page.on('pageerror', (err) => {
        if (meta.page_errors.length < 50) {
          meta.page_errors.push({ page_url: page.url(), message: err.message });
        }
      });

      page.on('console', (msg) => {
        if (msg.type() === 'error' && meta.console_errors.length < 50) {
          meta.console_errors.push({ page_url: page.url(), message: msg.text() });
        }
      });

      try {
        state.client = await context.newCDPSession(page);
        await state.client.send('Page.enable');
        await state.client.send('Debugger.enable');
        await state.client.send('Profiler.enable');
        await state.client.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      } catch (err) {
        state.unavailable = true;
        log(`页面覆盖率不可用：${err.message}`);
        return state;
      }

      state.lastUrl = page.url();
      page.on('load', () => {
        void takeCoverage(page, 'load');
      });

      return state;
    }

    context.on('page', (page) => {
      void instrumentPage(page);
    });

    await instrumentPage(mainPage);

    // 页面切换前后都需要取一次：load 时能拿到当前页的内联脚本，定时取避免 SPA 操作丢增量
    const coverageTimer = setInterval(() => {
      for (const page of context.pages()) {
        void takeCoverage(page, 'interval');
      }
    }, 3000);

    const api = {
      page: mainPage,
      context,
      browser,
      baseUrl: options.baseUrl,
      runDir,
      log,
      setMeta,
      takeCoverage: (reason = 'manual') => takeCoverage(mainPage, reason),
      screenshot: async (name) => {
        const file = path.join(screenshotsDir, `${slugify(name)}.png`);
        await mainPage.screenshot({ path: file });
        log('screenshot', file);
        return file;
      },
      step: async (name, fn) => {
        const step = { name, started_at: new Date().toISOString(), status: 'running' };
        meta.steps.push(step);
        currentStep = step;
        log(`STEP ${name}`);

        try {
          const value = await fn();
          step.status = 'ok';
          step.duration_ms = Date.now() - new Date(step.started_at).getTime();
          currentStep = null;
          return value;
        } catch (err) {
          step.status = 'error';
          step.error = err instanceof Error ? err.message : String(err);
          throw err;
        }
      },
    };

    try {
      flowResult = await flow(api);
    } catch (err) {
      flowError = err;
    }

    clearInterval(coverageTimer);

    if (options.linger > 0) {
      log(`保留最终画面 ${options.linger}s`);
      await mainPage.waitForTimeout(options.linger * 1000).catch(() => {});
    }

    await Promise.all(context.pages().map((page) => takeCoverage(page, 'final')));

    if (!mainPage.isClosed()) {
      await mainPage.screenshot({ path: path.join(screenshotsDir, '99-final.png') }).catch(() => {});
    }

    if (tracingStarted) {
      await context.tracing.stop({ path: path.join(runDir, 'trace.zip') }).catch((err) => log('trace 保存失败：', err.message));
    }
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  // 单页面流程把录像整理成 run.webm；多页面时保留 videos/ 下的分页面录像
  if (fs.existsSync(videosDir)) {
    const videos = fs.readdirSync(videosDir).filter((name) => name.endsWith('.webm'));

    if (videos.length === 1) {
      fs.renameSync(path.join(videosDir, videos[0]), path.join(runDir, 'run.webm'));
      fs.rmdirSync(videosDir);
    }
  }

  const report = await generateCoverageReport({
    dir: eventsDir,
    root,
    webRoot,
    showUncovered: true,
    html: reportDir,
  });

  fs.writeFileSync(path.join(runDir, 'coverage.txt'), report.text);

  meta.finished_at = new Date().toISOString();
  meta.result = flowResult === undefined ? null : flowResult;
  meta.coverage = {
    events: report.events,
    scripts: report.scripts,
    totals: report.totals,
    warnings: report.warnings,
  };

  if (currentStep) {
    meta.error = { step: currentStep.name, message: flowError ? flowError.message : currentStep.error };
  } else if (flowError) {
    meta.error = { step: null, message: flowError.message };
  }

  fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));

  // latest 指向最近一次运行；产物和报告入口都通过它访问
  const latestLink = path.join(outBase, 'latest');
  const latestTmp = path.join(outBase, '.latest.tmp');

  try {
    fs.unlinkSync(latestTmp);
  } catch {
    // 不存在即可
  }

  fs.symlinkSync(path.relative(outBase, runDir), latestTmp, 'dir');
  fs.renameSync(latestTmp, latestLink);

  if (fs.existsSync(path.join(runDir, 'trace.zip'))) {
    await ensureTraceViewer(outBase, path.join(runDir, 'trace.zip'));
  }

  console.log('');
  console.log(report.text);

  if (report.warnings.length > 0) {
    console.log('');
    console.log('警告：');
    for (const warning of report.warnings) console.log(`  ${warning}`);
  }

  console.log('');
  log(`产物目录: ${runDir}`);
  log(`画面（只读）: ${PUBLIC_URL}/`);
  log(`产物入口: ${PUBLIC_URL}/artifacts/latest/`);
  log(`覆盖率报告: ${PUBLIC_URL}/js-coverage/`);
  log(`Trace Viewer: ${PUBLIC_URL}/trace/`);

  if (flowError) {
    console.error('');
    console.error(flowError.stack || flowError.message);

    if (meta.error) {
      console.error(`失败步骤：${meta.error.step || '(流程顶层)'}`);
    }

    process.exitCode = 1;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 每次运行后重启 trace viewer，指向本次的 trace.zip；进程脱离 runner 独立存活 */
async function ensureTraceViewer(outBase, tracePath) {
  const pidFile = path.join(outBase, 'trace-viewer.pid');
  const logFile = path.join(outBase, 'trace-viewer.log');

  try {
    const oldPid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);

    if (Number.isFinite(oldPid) && oldPid > 1 && processAlive(oldPid)) {
      process.kill(oldPid, 'SIGTERM');

      // 等旧进程让出 9323，否则新 viewer 会因端口占用直接退出
      for (let i = 0; i < 20 && processAlive(oldPid); i++) await sleep(100);

      if (processAlive(oldPid)) process.kill(oldPid, 'SIGKILL');
    }
  } catch {
    // 没有旧进程或已退出
  }

  try {
    const cli = path.join(__dirname, 'node_modules', 'playwright', 'cli.js');

    if (!fs.existsSync(cli)) {
      console.warn(`Trace Viewer 未启动：找不到 ${cli}`);
      return;
    }

    const fd = fs.openSync(logFile, 'a');
    const child = spawn(
      process.execPath,
      [cli, 'show-trace', '-h', '127.0.0.1', '-p', '9323', tracePath],
      { detached: true, stdio: ['ignore', fd, fd] },
    );

    child.unref();
    fs.writeFileSync(pidFile, String(child.pid));
    fs.closeSync(fd);
  } catch (err) {
    console.warn(`Trace Viewer 启动失败：${err.message}`);
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
