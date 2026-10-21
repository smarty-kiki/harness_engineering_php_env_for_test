# 黑盒测试覆盖率使用指南（PHP + 前端）

本环境提供两类覆盖率：

- **PHP 覆盖率（PCOV）**：默认开启，页面、接口、CLI 命令和队列 worker 执行过的项目代码都会自动采集。
- **前端覆盖率（V8 precise coverage）**：用 Playwright 在容器内驱动独立 Chromium，采集实际执行过的 JS；页面操作、截图、录像、trace 与报告一次完成，项目代码零改动。

覆盖率用于判断黑盒测试是否覆盖到目标代码，不要用 phpunit 来统计。

## 1. 轮次：统一单位与统计口径

**一轮测试以「轮次」为单位**：从开始写用例就存在，到全量报告归档结束。用例、状态、覆盖率、Trace、补测计划都挂在同一个轮次下，8080 观测台只按轮次展示。

```bash
# 写用例前先登记轮次，8080 立即可见（run-all 会复用这个 active 轮次）
round-status start --name=checkout --suite-dir=/var/www/test_usecase

# 执行过程中 run-all 自动更新；手动补测时可单独更新
round-status update --id=<轮次> --state=frontend --message="执行页面流程" \
    --layer=frontend --layer-state=running --total=20 --passed=18 --failed=2

round-status active --suite-dir=/var/www/test_usecase   # 当前未结束的轮次
round-status list                                       # 全部轮次
round-status show --id=<轮次>                           # 单个轮次状态 JSON

# 报告生成后发布摘要与报告目录，然后归档轮次
round-status publish --id=<轮次> --summary=<summary.json> --report-dir=<round_dir>
round-status finish --id=<轮次> --summary=<summary.json> --report-dir=<round_dir> \
    --report-url=/rounds/<轮次>/report/index.html
```

轮次状态与归档目录：

```
/var/log/harness-coverage/rounds/<轮次>/
  status.json      实时状态（8080 每 3 秒轮询正在执行的轮次）
  summary.json     本轮报告摘要（趋势与下一轮计划读取）
  plan.md          开始轮次时写入的补测计划（可选）
  report/          index.html、summary.md、覆盖率 HTML 与未覆盖行
```

**覆盖率口径按整轮计算，不按测试层切开**：

- **PHP**：本轮全部页面、API、CLI 与队列执行产生的代码覆盖，累计到下一次 `coverage-reset`。不是“接口覆盖率”或“CLI 覆盖率”。
- **JS**：本轮全部 Playwright 页面流程合并后的 V8 覆盖率，用 `frontend-coverage-report --round <轮次>` 统计；单次运行报告仍可用 `--run` 单独查看，但轮次报告与迭代判断使用合并结果。
- 轮次之间不累计（PHP 在每轮开始时 reset），否则无法判断这一轮补测是否有效。

### 页面优先与落库校验

一轮的用例必须满足两条硬约束，报告会单独审计：

1. **页面优先**：同一行为先写页面用例；接口 / CLI 只补页面不可达或难以稳定触发的分支。接口 / CLI 用例要么写 `via_page`（对应页面用例名），要么写 `unreachable_reason`（页面不可达原因）。
2. **写数据必查库**：凡会写数据的用例（新增、修改、删除、状态流转，以及应被拒绝的写入请求），标记 `mutates_data: true`，并在 `db_verification` 记录数据库中的实际结果。仅页面提示或接口返回成功不算通过；被拒绝的请求要确认数据库没有多出数据。

字段与报告契约见 `round-report.md`。`run-all.sh` 默认开启两项审计（`AUDIT_STRICT=1`），未通过会让本轮失败；单独跑 `round-report` 时用 `--strict-page-first` / `--strict-data-check`，或设置 `PAGE_FIRST_STRICT=1` / `DATA_CHECK_STRICT=1`。

页面流程里可以用通用查询工具核对落库：

```bash
HARNESS_COVERAGE=0 php /var/www/test_usecase/fixtures/db_check.php \
  --sql="select id,name,status from project where id = 900001" \
  --expect-rows=1 \
  --expect-json='{"name":"测试项目","status":"1"}'
```

## 2. 标准使用流程

1. 写用例前执行 `round-status start`（带上 `--suite-dir`），轮次立即出现在 8080；有上一轮计划就传 `--plan`。
2. 按真实入口写用例：页面用 Playwright，接口用 curl / Node，命令用 bash；**先页面穿透，再补页面不可达分支**。写数据的用例同步写落库校验。
3. 执行 `/var/www/test_usecase/run-all.sh`。它复用当前 active 轮次，按准备 → 造数 → 前端 → 接口 → CLI → 覆盖率 → 报告推进状态，结束时归档到轮次注册目录。
4. 看本轮报告：全量通过率、页面穿透审计、落库校验、PHP / JS 整轮覆盖率、未覆盖行。执行 `coverage-trend` 查看相对上一轮的增量。
5. 依据未覆盖行生成下一轮计划，补页面流程优先；重复直到覆盖率停滞（默认连续 2 轮 PHP 业务口径与 JS 增量都小于 0.5 个百分点），或未覆盖行已没有可通过现有入口触达的代码。

```bash
# 上一轮结束后：查看趋势并生成下一轮计划
coverage-trend
coverage-trend --json
coverage-trend --plan /var/www/test_usecase/reports/rounds/<轮次>/next-round-plan.md
```

`coverage-trend` 读取轮次注册目录的 `summary.json`，对比 PHP 业务口径与 JS 覆盖率；`--threshold` 调整停滞阈值，`--window` 调整连续轮数。下一轮不要平均撒网：优先补计划里列出的未覆盖文件与页面可达路径。

## 3. PHP 覆盖率

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

- 默认统计项目根目录下全部 PHP 文件，自动排除 `vendor`、`node_modules`、`.git`、`tests`、`test`、`frame`、`project`。
- `frame/` 是 php-vibe-coding-frame 的框架核心，`project/` 是部署/环境配置，不属于业务代码，不要手工加回来。
- 完整回归不要传 `--include`，默认范围就是完整项目；只有针对某个功能做聚焦测试时，才用 `coverage-report --include <源码目录>`。
- `interceptor/` 等业务目录会自动纳入；Blade 项目的 `view/` 源模板由编译后的代码执行，通常显示 0%，看业务代码覆盖率时加 `--exclude view`。
- 报告开头会打印“统计范围 / 排除目录”，先核对口径再看百分比；测试过程中可随时执行，数据累计到下一次 `coverage-reset`。
- HTML 报告省略目录时发布到 `/var/log/harness-coverage/php-report/`，由 8080 的 `/php-coverage/` 提供浏览；显式指定目录时输出到该目录。报告是生成时的快照，不会随请求自动刷新，生成的报告不要提交到 git。

## 4. 前端测试与覆盖率（Playwright）

前端测试在容器内用 Playwright 驱动独立 Chromium，不依赖宿主机 Chrome，也不使用 cda 扩展。页面操作、截图、录像、trace 和 V8 精确覆盖率在同一次运行里完成。

### 4.1 标准流程

```bash
# 1. 复制流程模板并按项目实际页面改
cp /usr/local/share/harness/playwright/flow-example.js /tmp/flow.js
vim /tmp/flow.js

# 2. 运行（有头模式，测试过程中可在 8080 实时看画面）
playwright-run /tmp/flow.js

# 3. 查看前端覆盖率：单次运行 / 整轮合并
frontend-coverage-report
frontend-coverage-report --run <运行目录名>
frontend-coverage-report --round <轮次>          # 本轮全部 Playwright 运行
frontend-coverage-report --round <轮次> --show-uncovered
frontend-coverage-report --round <轮次> --html /tmp/frontend-coverage
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

`--round` 会读取轮次注册目录里记录的 `playwright_runs`，合并这些运行的 `events/`；一轮有多个页面流程时，轮次报告只呈现合并后的 JS 覆盖率。单次 `playwright-run` 仍会生成自己的报告，二者口径不同，不要相加。

不在 `run-all` 里、手工补跑页面流程时，要把运行目录记到当前轮次，否则整轮 JS 覆盖率不会包含这次运行：

```bash
round-status update --id=<轮次> --playwright-run=/var/log/harness-coverage/playwright/runs/<运行目录>
```

### 4.2 流程文件

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

### 4.3 统计口径

- 只统计 **JS 行/函数覆盖率**，没有分支覆盖率。
- 外链脚本按 URL 映射到 `<PRJ_HOME>/public/<path>`；映射不到本地文件的第三方脚本不统计。
- 内联脚本报告为 `inline: /页面路径#源文本哈希`；采集时会排除 Playwright/浏览器注入的匿名脚本。
- 单次运行报告按一次运行统计；轮次报告用 `--round` 合并本轮全部运行，不跨轮次累计。
- `coverage-reset` 只清 PHP 采集事件，不删除已经生成的 trace、录像和前端报告。
- 跨域 iframe、Web Worker、Service Worker 和 source map 暂不支持。
- 同一时间只允许一个 `playwright-run`（共用一块 Xvfb 屏幕和 trace viewer）；第二个会直接报错退出。
- 实时画面只能看到**有头**浏览器；`--headless` 运行不会在 Xvfb 上显示窗口，8080 会看到黑屏。`run-all.sh` 默认有头，需要静默运行时再加 `--headless` 或 `HEADLESS=1`。
- 流程创建了测试账号时，跑完要清理数据库与 Redis 会话，避免污染环境。

## 5. 观测入口（8080）

容器内 nginx 单独监听 8080，与项目 80 端口互不影响；宿主机需要在启动容器时映射 `-p 8080:8080`：

| 地址 | 内容 |
|------|------|
| `http://127.0.0.1:8080/` | 观测台：实时画面 + 测试轮次（编写中即出现，执行中持续刷新，含分层进度、覆盖率、审计、Trace、报告） |
| `http://127.0.0.1:8080/live` | 只读实时画面（noVNC） |
| `http://127.0.0.1:8080/rounds/` | 轮次注册目录：`status.json`、`summary.json`、`report/`、补测计划 |
| `http://127.0.0.1:8080/rounds-json/` | 轮次目录 JSON，观测台用它发现新轮次 |
| `http://127.0.0.1:8080/artifacts/` | Playwright 产物列表，`latest/` 是最近一次运行 |
| `http://127.0.0.1:8080/js-coverage/` | 最近一次运行的前端（JS / V8）HTML 覆盖率报告；整轮合并结果在轮次报告里 |
| `http://127.0.0.1:8080/php-coverage/` | 后端（PHP）HTML 覆盖率报告快照 |
| `http://127.0.0.1:8080/reports/` | PHP / JS 覆盖率快照总览，同一页切换 |
| `http://127.0.0.1:8080/trace/` | 最近一次运行的 Trace Viewer |

- 轮次卡片在 `round-status start` 后立即出现；执行期间 3 秒刷新，结束后 15 秒刷新一次。状态、当前阶段、分层计数、覆盖率数字都会更新。
- 打开「用例」可查看分层用例；失败项显示期望 / 实际，接口 / CLI 用例显示页面穿透关系，写数据用例显示落库校验状态。
- 没有轮次记录的旧 Playwright 运行仍会显示，回退为 `meta.json` 的前端步骤与 `/artifacts/runs/<id>/round/` 报告。
- 每轮报告契约、发布方式与回退规则见 `round-report.md`；轮次计划与趋势见 `coverage-trend --help`。

## 6. 采集边界与性能

- 页面/API 在请求结束时落盘；长驻 CLI（如队列 worker）约每 2 秒落盘一次；FPM 长连接（如 SSE）在请求结束时才落盘。
- `coverage-reset` 只清除已落盘的数据；重置瞬间可能带入不到 2 秒的旧数据，属于正常现象。
- PCOV 只支持行覆盖率，不支持分支/路径覆盖率。
- 覆盖率常开有性能开销：CPU 密集型脚本约 2 倍，页面请求影响相对较小；不要为了覆盖率跳过正常测试步骤。
- 完全不需要覆盖率时，启动容器加 `HARNESS_COVERAGE=0`。
