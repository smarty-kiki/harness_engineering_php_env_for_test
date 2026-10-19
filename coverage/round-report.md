# 单轮全量测试报告与 8080 观测台

本文说明「一轮测试」如何把前端、接口、CLI 三层结果和 PHP / JS 覆盖率合成一份报告，以及 8080 观测台如何读取和展示它。测试套件本身是项目相关的，不随 harness 镜像发布；**报告生成器与观测台属于 harness，随镜像提供**。

## 1. 数据流

```
测试套件执行
  ├─ 前端 Playwright ──> frontend-cases.json + Playwright 运行目录（meta.json / trace.zip / 截图 / 录像）
  ├─ 接口测试 ────────> api-results.json
  ├─ CLI 测试 ────────> cli-results.json
  └─ 覆盖率命令 ──────> php-coverage-full.txt / php-coverage-business.txt / js-coverage.txt
                              │
                              ▼
                    round-report <round_dir> <run_dir>
                              │
                              ▼
              round_dir/summary.json + summary.md + index.html
                              │
                     复制到运行目录的 round/
                              │
                              ▼
              8080 观测台（/）自动读取并展示该轮
```

报告生成器有两份等价入口：

- 容器命令：`round-report <round_dir> [<playwright_run_dir>]`
- 镜像内源码：`/usr/local/share/harness/coverage/round-report.js`（也可直接 `node` 执行）

测试套件可以在容器没有安装新命令时直接调用源码路径；二者输出的格式一致。

## 2. 输入文件

`round_dir` 是本轮报告的工作目录，需要以下文件（缺失的层会被记为 1 条「未执行」用例，仍计入通过率分母）：

| 文件 | 来源 | 说明 |
|------|------|------|
| `frontend-cases.json` | 前端测试 | `{ cases: [{ name, status, expected, actual, duration_ms }] }`，`status` 为 `passed` / `failed` / `not_run` |
| `api-results.json` | 接口测试 | 同上 |
| `cli-results.json` | CLI 测试 | 同上 |
| `php-coverage-full.txt` | `coverage-report` 完整口径 | 需含 `行覆盖率：xx.xx%（覆盖数 / 总数）` |
| `php-coverage-business.txt` | `coverage-report --exclude view,...` 业务口径 | 同上 |
| `js-coverage.txt` | `frontend-coverage-report` | 需含 `合计 xx.xx% (覆盖数/总数)` |
| `php-coverage/` | PHP HTML 报告目录 | 供报告内「PHP HTML 报告」链接使用 |
| `js-coverage/` | JS HTML 报告目录 | 供报告内「JS HTML 报告」链接使用 |
| `php-uncovered.txt` / `js-uncovered.txt` | 未覆盖行文本 | 供报告内链接使用 |

`<playwright_run_dir>` 可选；传入后会从该目录的 `meta.json` 读取 `run_id` 与流程文件名，用于报告里的 Trace Viewer 链接和运行信息。若 `frontend-cases.json` 不存在，会退化为读取 `meta.json` 的 `steps`（只看前端）。

## 3. 生成与发布

```bash
# 1. 在测试套件的工作目录生成 summary.json / summary.md / index.html
round-report /tmp/my-round /var/log/harness-coverage/playwright/runs/<run_id>

# 2. 把可发布的报告复制进该轮 Playwright 运行目录
mkdir -p /var/log/harness-coverage/playwright/runs/<run_id>/round
cp -r /tmp/my-round/summary.json \
      /tmp/my-round/summary.md \
      /tmp/my-round/index.html \
      /tmp/my-round/php-coverage \
      /tmp/my-round/js-coverage \
      /tmp/my-round/php-uncovered.txt \
      /tmp/my-round/js-uncovered.txt \
      /var/log/harness-coverage/playwright/runs/<run_id>/round/
```

注意：

- `round/` 是约定目录名，8080 只认这个位置。
- `summary.json` 必须能通过 `JSON.parse`；发布前可用 `node -e "JSON.parse(require('fs').readFileSync('...','utf8'))"` 校验。
- 覆盖率 HTML 目录要一起复制，否则报告内的覆盖率按钮会 404。
- 报告是测试完成后的快照；重新跑一轮就重新生成并复制，**不要覆盖历史轮次的 round/**。
- 没有 `round/summary.json` 的运行目录仍会显示在 8080 上，但只能回退到 `meta.json` 的前端步骤与前端覆盖率；不会显示「全量用例」和「全量测试报告」按钮。

## 4. summary.json 契约

8080 观测台按以下字段读取（字段名不能改）：

```json
{
  "round_id": "20261020-003243",
  "finished_at": "2026/10/20 00:37:00",
  "totals": {
    "total": 193,
    "passed": 188,
    "failed": 5,
    "not_run": 0,
    "pass_rate": 97.41,
    "issues": []
  },
  "layers": {
    "frontend": {
      "name": "前端",
      "total": 137,
      "passed": 134,
      "failed": 3,
      "not_run": 0,
      "pass_rate": 97.81,
      "cases": [
        {
          "layer": "前端",
          "name": "系统仓库：无系统空态不产生前端运行时错误",
          "status": "failed",
          "duration_ms": 1200,
          "expected": "期望没有前端运行时错误",
          "actual": "Cannot read properties of null (reading 'addEventListener')"
        }
      ]
    },
    "api": { "name": "接口", "cases": [] },
    "cli": { "name": "CLI", "cases": [] }
  },
  "coverage": {
    "php_full": { "percent": 42.16, "covered": 5819, "total": 13796 },
    "php_business": { "percent": 81.60, "covered": 5819, "total": 7129 },
    "js": { "percent": 60.39, "covered": 6299, "total": 10574 }
  },
  "playwright": {
    "run_id": "20261020-010000-test-20261020-010000",
    "flow": "/path/to/flow.js",
    "run_dir": "/var/log/harness-coverage/playwright/runs/..."
  }
}
```

说明：

- `pass_rate` 与 `percent` 都是 **0–100 的百分数**，不是 0–1 小数。
- `totals.total` 是三层用例总数；未执行用例计入总数，所以通过率 = `passed / total`。
- `layers` 的三层都要有 `name`、`passed`、`total`、`cases`；`cases` 内每条要有 `layer`、`name`、`status`。失败/未执行用例建议带 `expected` 与 `actual`，观测台展开时会显示。
- `coverage` 按上表提供两份 PHP 口径；完整口径只作参考，业务口径用于主展示。
- `issues` 是 `cases` 中非 `passed` 项的汇总，供报告表格使用；它不是「已知问题」区，问题本身就是失败用例。

## 5. 8080 观测台行为

| 地址 | 数据来源与行为 |
|------|----------------|
| `/` | 每轮一行；读取运行目录 `meta.json` 与 `round/summary.json`。有 summary 时显示全量通过率、PHP/JS 覆盖率、失败/未执行数，按钮为 `Trace Viewer`、`全量用例（N）`、`全量测试报告`；无 summary 时回退为前端用例信息 |
| `/runs-json/` | 运行目录列表 JSON，目录页用它发现新轮次 |
| `/artifacts/runs/<run_id>/round/index.html` | 全量测试报告；报告内的 PHP / JS 覆盖率入口在此页内，外层不再单独放覆盖率按钮 |
| `/artifacts/runs/<run_id>/trace.zip` | Playwright Trace；观测台链接为 `/trace/index.html?trace=/artifacts/runs/<run_id>/trace.zip` |
| `/js-coverage/` | 最近一次 Playwright 运行的 JS 覆盖率快照 |
| `/php-coverage/` | 最近一次 `coverage-report --html` 发布的 PHP 覆盖率快照 |
| `/reports/` | 前端 / 后端覆盖率总览，同一页切换 |
| `/coverage/` | **故意不提供**（返回 404）；旧的 `/coverage/` 路由没有重定向，前端覆盖率统一用 `/js-coverage/` |

展开「全量用例（N）」时按 `前端 / 接口 / CLI` 分组展示全部用例；失败或未执行项显示「期望 / 实际」。收起后的按钮文案是「收起用例」。

## 6. 通用测试平台骨架与项目测试

harness 镜像在 `/var/www/test_usecase` 提供的是**通用**测试平台骨架：

- 目录结构、`run-all.sh` 单轮编排、`fixtures/rollback_probe.sh`、`fixtures/delete_row.php` 属于通用工具，随镜像发布。
- **具体项目的测试用例、造数脚本、清理脚本和报告不进入 harness 仓库**；把它们放在运行期目录或挂载进容器的项目目录（如项目的 `tests/e2e/`），不要只放 `/tmp`。
- 项目测试按约定路径接入：`tests/frontend/flow.js`、`tests/api/run.js`、`tests/cli/run.js`，以及可选的 `fixtures/seed.php` / `fixtures/cleanup.php` / `fixtures/prepare.sh`；结果文件需写入 `$ROUND_DIR` 下的约定 JSON。
- `state/` 与 `reports/` 是运行期数据，容器重建会清空；每轮报告同时复制到 Playwright 运行目录的 `round/`，可从 8080 回看。
- 每轮结束由 `run-all.sh` 调用 `round-report` 生成报告。
- 覆盖率口径与命令见同目录 `README.md`；前端运行器参数见 `/usr/local/share/harness/playwright/` 与 `README.md`。
