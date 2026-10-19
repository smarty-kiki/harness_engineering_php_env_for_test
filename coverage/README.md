# 黑盒测试覆盖率使用指南（PHP + 前端）

本环境提供两类覆盖率：

- **PHP 覆盖率（PCOV）**：默认开启，页面、接口、CLI 命令和队列 worker 执行过的项目代码都会自动采集。
- **前端覆盖率（V8 precise coverage）**：用 Playwright 在容器内驱动独立 Chromium，采集实际执行过的 JS；页面操作、截图、录像、trace 与报告一次完成，项目代码零改动。

覆盖率用于判断黑盒测试是否覆盖到目标代码，不要用 phpunit 来统计。

## 标准使用流程

1. 开始一轮测试前执行 `coverage-reset` 清零。
2. 按真实入口测试：需要自动化、截图、录像或前端覆盖率的页面测试用 `playwright-run`；临时查看页面用 cda；接口用 curl；命令行和队列用 bash 触发；覆盖正常、边界和异常路径。
3. 执行 `coverage-report` 查看总覆盖率。
4. 执行 `coverage-report --show-uncovered` 查看可执行但未覆盖的行，根据未覆盖行补测，再复核。
5. 需要给人看时执行 `coverage-report --html` 发布到 8080 的 `/php-coverage/`，或生成 Clover 报告；前端报告每次 `playwright-run` 自动生成。

测试过程中可以随时执行 `coverage-report` 查看当前累计结果，不需要等整轮测试结束；报告会累计到下一次 `coverage-reset`。

## 统计口径

- 默认统计项目根目录下全部 PHP 文件，自动排除 `vendor`、`node_modules`、`.git`、`tests`、`test`、`frame`、`project`。
- `frame/` 是 php-vibe-coding-frame 的框架核心，`project/` 是部署/环境配置，不属于业务代码，不要手工加回来。
- 完整回归不要传 `--include`，默认范围就是完整项目；只有针对某个功能做聚焦测试时，才用 `coverage-report --include <源码目录>`。
- `interceptor/` 等业务目录会自动纳入，不需要特殊配置。
- Blade 项目的 `view/` 源模板由编译后的代码执行，源模板通常显示 0%；看业务代码覆盖率时加 `--exclude view`。
- 报告开头会打印“统计范围 / 排除目录”，先核对口径再看百分比。

## 报告命令

```bash
coverage-report                                   # 完整项目汇总
coverage-report --only-summary                    # 只看汇总
coverage-report --show-uncovered                  # 列出未覆盖行
coverage-report --exclude view --show-uncovered   # 业务代码口径（不含模板）
coverage-report --include src,app                 # 聚焦某次测试
coverage-report --html                            # 发布到 8080 的 /php-coverage/
coverage-report --html <目录>                     # HTML 报告到指定目录
coverage-report --clover <文件>                   # Clover XML
coverage-report --help                            # 查看全部参数
```

- HTML 报告用于人工查看。省略目录时发布到 `/var/log/harness-coverage/php-report/`，由 8080 的 `/php-coverage/` 提供浏览；显式指定目录时输出到该目录。生成的报告不要提交到 git。
- 后端 HTML 报告是执行命令时的快照，不会随请求自动刷新；测试后重新执行 `coverage-report --html` 即可更新 8080 上的页面。
- 终端输出没有数据时，先确认测试流量确实打到了应用；采集事件在 `/var/log/harness-coverage/`。
- 报告默认合并所有进程的事件，不需要在每个请求结束后手工触发落盘。

## 采集边界与性能

- 页面/API 在请求结束时落盘；长驻 CLI（如队列 worker）约每 2 秒落盘一次；FPM 长连接（如 SSE）在请求结束时才落盘。
- `coverage-reset` 只清除已落盘的数据；重置瞬间可能带入不到 2 秒的旧数据，属于正常现象。
- PCOV 只支持行覆盖率，不支持分支/路径覆盖率。
- 覆盖率常开有性能开销：CPU 密集型脚本约 2 倍，页面请求影响相对较小；不要为了覆盖率跳过正常测试步骤。
- 完全不需要覆盖率时，启动容器加 `HARNESS_COVERAGE=0`。

## 前端测试与覆盖率（Playwright）

前端测试在容器内用 Playwright 驱动独立 Chromium，不依赖宿主机 Chrome，也不使用 cda 扩展。页面操作、截图、录像、trace 和 V8 精确覆盖率在同一次运行里完成。

### 标准流程

```bash
# 1. 复制流程模板并按项目实际页面改
cp /usr/local/share/harness/playwright/flow-example.js /tmp/flow.js
vim /tmp/flow.js

# 2. 运行（有头模式，测试过程中可在 8080 实时看画面）
playwright-run /tmp/flow.js

# 3. 查看前端覆盖率
frontend-coverage-report
frontend-coverage-report --show-uncovered
frontend-coverage-report --html /tmp/frontend-coverage
```

每次运行在 `/var/log/harness-coverage/playwright/runs/<时间戳>-<名称>/` 下生成独立产物，`playwright/latest` 指向最近一次：

| 文件 | 内容 |
|------|------|
| `trace.zip` | Playwright Trace Viewer（动作、前后截图、DOM 快照、网络、Console、源码） |
| `run.webm` | 录像；多页面流程在 `videos/` 下按页面分别保存 |
| `screenshots/` | 流程截图，`99-final.png` 是结束时的页面 |
| `events/` | V8 覆盖率增量事件（`report.js` 的输入） |
| `report/` | HTML 覆盖率报告 |
| `coverage.txt` | 文本覆盖率报告 |
| `meta.json` | 运行信息、步骤耗时与状态、页面错误、Console 错误、覆盖率汇总 |

### 流程文件

流程文件导出 async function，运行器把已经开好录像、trace 和覆盖率采集的对象传进来：

```js
module.exports = async function ({ page, baseUrl, screenshot, step, takeCoverage, log, setMeta }) {
    await step('打开首页', async () => {
        await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
        await screenshot('01-home');
    });

    // 按项目实际页面继续写操作……
};
```

- `page` / `context` / `browser`：Playwright 对象；`page` 是主页面。
- `screenshot(name)`：保存到 `screenshots/`，返回文件路径。
- `step(name, fn)`：记录步骤名称与耗时；抛错时 `meta.json` 会写明失败步骤。
- `takeCoverage(reason)`：手动采集一次覆盖率；页面 `load`、每 3 秒、流程结束时会自动采集。
- `log(...)`：带时间戳的运行日志；`setMeta({...})`：写入 `meta.json` 的自定义字段。
- 返回值会写进 `meta.json` 的 `result`。

常用参数：`--linger 30`（结束后保留画面 30 秒）、`--headless`（无头）、`--no-video`、`--root`、`--web-root`、`--base-url`、`--name`。

### 观测入口（8080）

容器内 nginx 单独监听 8080，与项目 80 端口互不影响；宿主机需要在启动容器时映射 `-p 8080:8080`：

| 地址 | 内容 |
|------|------|
| `http://127.0.0.1:8080/` | 观测目录页：实时画面 + 测试轮次（每轮含用例通过率、Trace、覆盖率报告） |
| `http://127.0.0.1:8080/live` | 只读实时画面（noVNC） |
| `http://127.0.0.1:8080/artifacts/` | 产物列表，`latest/` 是最近一次运行 |
| `http://127.0.0.1:8080/js-coverage/` | 最近一次运行的前端（JS / V8）HTML 覆盖率报告 |
| `http://127.0.0.1:8080/php-coverage/` | 后端（PHP）HTML 覆盖率报告快照 |
| `http://127.0.0.1:8080/reports/` | 覆盖率总览，同一页切换前端 / 后端报告 |
| `http://127.0.0.1:8080/trace/` | 最近一次运行的 Trace Viewer |

`/js-coverage/` 随每次 `playwright-run` 自动更新；`/php-coverage/` 不是实时的，需要在容器内执行 `coverage-report --html` 发布。`/reports/` 只是统一入口，两套报告统计口径不同（前端按单次运行，后端累计到下一次 `coverage-reset`），数字不能相加。

live view 使用 `x11vnc -viewonly`，只能观察、不能远程操作；需要交互就把操作写进流程文件。trace.zip 也可以下载到本地用 `npx playwright show-trace trace.zip` 打开。

### 统计口径

- 只统计 **JS 行/函数覆盖率**，没有分支覆盖率。
- 外链脚本按 URL 映射到 `<PRJ_HOME>/public/<path>`；映射不到本地文件的第三方脚本不统计。
- 内联脚本报告为 `inline: /页面路径#源文本哈希`；采集时会排除 Playwright/浏览器注入的匿名脚本。
- 每次运行独立统计，不跨运行累计；补测时直接再跑一次流程。
- `coverage-reset` 只清 PHP 采集事件，不删除已经生成的 trace、录像和前端报告。
- 跨域 iframe、Web Worker、Service Worker 和 source map 暂不支持。
- 同一时间只允许一个 `playwright-run`（共用一块 Xvfb 屏幕和 trace viewer）；第二个会直接报错退出。
- 流程创建了测试账号时，跑完要清理数据库与 Redis 会话，避免污染环境。
