# 轮次报告、验收审计与 8080 实时观测

测试以「轮次」为单位：写用例前登记轮次，执行中持续更新状态，结束后把前端 / 接口 / CLI 结果、PHP / JS 整轮覆盖率、页面穿透与落库校验审计合成一份报告并归档。测试套件本身属于项目，不随 harness 镜像发布；**轮次状态、报告生成与观测台属于 harness，随镜像提供**。

## 1. 数据流

```
round-status start（写用例阶段）
        │
        ▼
/var/log/harness-coverage/rounds/<轮次>/status.json   ← 8080 每 3 秒轮询
        │
测试套件执行（run-all.sh 复用 active 轮次）
  ├─ 前端 Playwright ──> frontend-cases.json + 运行目录（meta.json / trace.zip / 截图 / 录像 / events）
  ├─ 接口测试 ────────> api-results.json
  ├─ CLI 测试 ────────> cli-results.json
  └─ 覆盖率命令 ──────> php-coverage-full.txt / php-coverage-business.txt / js-coverage.txt
        │
        ▼
round-report <round_dir> <run_dir>
        │
        ▼
summary.json / summary.md / index.html
        │
        ├─ round-status publish  → 轮次注册目录的 summary.json（趋势立即读取）
        ├─ coverage-trend        → 下一轮计划
        └─ round-status finish   → summary + report/ 归档，状态置为 done
        │
        ▼
8080 /  +  /rounds/<轮次>/report/index.html  +  coverage-trend
```

报告生成器入口：

- 容器命令：`round-report <round_dir> [<playwright_run_dir>]`
- 镜像内源码：`/usr/local/share/harness/coverage/round-report.js`

轮次注册与状态命令：

- `round-status start|update|heartbeat|active|publish|finish|show|list`
- 源码：`/usr/local/share/harness/coverage/round-status.js`，状态模型：`round-state.js`

## 2. 轮次输入

`round_dir` 是本轮报告的工作目录（`reports/rounds/<轮次>/`），需要以下文件。**某一层结果文件缺失时，报告会把该层记为 1 条「未执行」用例，仍计入通过率分母**，不会悄悄从分母里消失。

| 文件 | 来源 | 说明 |
|------|------|------|
| `frontend-cases.json` | 页面测试 | `{ cases: [...] }`；缺失时退化为读取 Playwright `meta.json` 的 `steps` |
| `api-results.json` | 接口测试 | 同上 |
| `cli-results.json` | CLI 测试 | 同上 |
| `php-coverage-full.txt` | `coverage-report --only-summary` | 需含 `行覆盖率：xx.xx%（覆盖数 / 总数）` |
| `php-coverage-business.txt` | `coverage-report --exclude view,...` | 业务口径；轮次主展示使用这一份 |
| `js-coverage.txt` | `frontend-coverage-report --round <轮次>` | 需含 `合计 xx.xx% (覆盖数/总数)` |
| `php-coverage/` / `js-coverage/` | HTML 报告目录 | 报告内入口；缺失时按钮 404 |
| `php-uncovered.txt` / `js-uncovered.txt` | 未覆盖行文本 | 生成下一轮建议 |
| `frontend-meta.json` | 运行信息副本（可选） | `run_dir/meta.json` 的归档副本 |

用例对象：

```json
{
  "layer": "api",
  "name": "接口：创建项目后落库",
  "status": "passed",
  "duration_ms": 32,
  "expected": "项目创建成功且数据库存在记录",
  "actual": "接口返回成功，数据库记录字段正确",
  "operation_steps": "1、提交创建项目请求；2、查询 project 表；3、核对名称与状态",
  "case_id": "PMS-项目-001",
  "system": "项目管理系统",
  "module": "项目",
  "design_method": "场景检查",
  "test_unit": "创建项目按钮",
  "test_point": "场景检查-合法名称创建项目并落库",
  "case_kind": "positive",
  "checkpoints": [
    {"name": "接口返回 code=0", "status": "passed"},
    {"name": "project 表新增 1 行", "status": "failed", "expected": "1 行", "actual": "0 行"}
  ],
  "via_page": "页面：创建项目",
  "mutates_data": true,
  "db_verification": {
    "passed": true,
    "checks": [
      {"table": "project", "id": 900001, "expect": "name=测试项目, status=1", "actual": "name=测试项目, status=1"}
    ]
  }
}
```

- `status`：`passed` / `failed` / `not_run`；失败和未执行必须写 `expected` 与 `actual`。
- **页面优先**：接口 / CLI 用例二选一写 `via_page`（页面用例名，必须能在本轮前端用例中找到）或 `unreachable_reason`（页面不可达的具体原因）。
- **落库校验**：任何写数据的用例（新增、修改、删除、状态流转，以及应被拒绝的写入）写 `mutates_data: true`，并提供非空的 `db_verification`。可以是说明字符串、检查项数组，或 `{ checks: [...], detail, actual, passed }` 对象；仅接口返回成功不算校验。
- **系统 / 模块（一二级分类）**：`system` 是一级分类（业务系统 / 一级模块），`module` 是二级分类。8080 的用例列表按这两级生成左侧模块树、右侧用例列表；未填写的用例归入「未归类 / 未分模块」。提供 `design_method` 时必须同时提供 `system` 与 `module`。
- **设计元数据（可选，推荐）**：`case_id`、`system`、`module`、`design_method`、`test_unit`、`test_point`、`case_kind`、`operation_steps`。提供 `design_method` 时，报告会校验方法是否合法、`test_point` 是否以「设计方法-」开头、是否同时给出系统 / 模块 / `test_unit` / `operation_steps`，并统计各设计方法、各测试单元的正向 / 负向用例与只有负向用例的测试单元。未提供元数据的旧用例保持兼容。
- **检查点（可选，推荐）**：`checkpoints` 是数组，每项 `{name, status, expected?, actual?}`，`status` 为 `passed` / `failed` / `not_run`。用例内部检查多个结果时使用；未提供时，以 `db_verification.checks` 的每一项为检查点；两者都没有时该用例没有检查点，不计入检查点统计。报告与 8080 会统计总检查点、已测试、通过、未通过、未测试数。
- 前端 `frontend-cases.json` 由流程在完成页面操作与数据库校验后写入；接口 / CLI 测试同理。

## 3. 生成、发布与归档

`run-all.sh` 已经串好整个流程，通常无需手动执行：

```bash
round-status start --name=<名称> --suite-dir=/var/www/test_usecase   # 写用例阶段，8080 立即出现
/var/www/test_usecase/run-all.sh
```

`run-all.sh` 会复用 active 轮次，依次更新 `preparing → seeding → frontend → api → cli → coverage → reporting → done`，然后：

1. 调用 `round-report` 生成本轮报告；
2. `round-status publish` 把 `summary.json` 写入轮次注册目录；
3. `coverage-trend` 生成趋势与 `next-round-plan.md`；
4. `round-status finish` 把 `summary.json` 与整个 `report/` 目录归档，状态置为 `done`。

手动生成与归档：

```bash
# 1. 生成报告（round_dir 是工作目录；run_dir 可选）
round-report /tmp/my-round /var/log/harness-coverage/playwright/runs/<run_id>

# 2. 发布摘要（趋势工具与 8080 读取），需要严格审计就加 --strict-page-first / --strict-data-check / --strict-design
round-status publish --id=<轮次> --summary=/tmp/my-round/summary.json

# 3. 生成下一轮计划
coverage-trend --plan /tmp/my-round/next-round-plan.md

# 4. 归档报告并结束轮次
round-status finish --id=<轮次> --summary=/tmp/my-round/summary.json \
    --report-dir=/tmp/my-round \
    --report-url=/rounds/<轮次>/report/index.html
```

注意：

- `finish` 会整体同步 `--report-dir` 到 `/var/log/harness-coverage/rounds/<轮次>/report/`，包括覆盖率 HTML、未覆盖行与补测计划；重新归档会替换旧报告，不会覆盖其他轮次。
- `publish` 只同步，不改变轮次状态，适合在趋势分析前先写入摘要。
- 严格审计：`run-all` 默认 `AUDIT_STRICT=1`；单独执行 `round-report` 时用 `--strict-page-first`、`--strict-data-check` 与 `--strict-design`（或 `PAGE_FIRST_STRICT=1` / `DATA_CHECK_STRICT=1` / `DESIGN_STRICT=1`）。未通过时报告仍会生成，但退出码为 1，`run-all` 最终失败。
- 兼容旧观测台：`run-all` 仍会把报告复制到 Playwright 运行目录的 `round/`（约定目录）。轮次注册目录才是 8080 与趋势工具的权威来源；没有 `round/` 不影响轮次展示。
- `summary.json` 必须能通过 `JSON.parse`；发布前可用 `node -e "JSON.parse(require('fs').readFileSync('...','utf8'))"` 校验。

## 4. summary.json 契约

8080 观测台、`coverage-trend` 与下一轮计划按以下字段读取（字段名不能改）：

```json
{
  "round_id": "20261021-101500",
  "finished_at": "2026/10/21 10:25:00",
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
      "available": true,
      "total": 137,
      "passed": 134,
      "failed": 3,
      "not_run": 0,
      "pass_rate": 97.81,
      "cases": [
        {
          "layer": "前端",
          "name": "页面：创建项目",
          "status": "passed",
          "mutates_data": true,
          "db_verification": {"passed": true, "detail": "project 表记录字段正确"}
        }
      ]
    },
    "api": {"name": "接口", "available": true, "cases": []},
    "cli": {"name": "CLI", "available": false, "cases": []}
  },
  "coverage": {
    "php_full": {"percent": 42.16, "covered": 5819, "total": 13796},
    "php_business": {"percent": 81.60, "covered": 5819, "total": 7129},
    "js": {"percent": 60.39, "covered": 6299, "total": 10574}
  },
  "coverage_scope": {
    "php": "本轮全部页面 / API / CLI / 队列执行",
    "js": "本轮全部 Playwright 页面流程",
    "php_layers": ["frontend", "api", "cli", "worker"],
    "js_layers": ["frontend"],
    "playwright_runs": ["20261021-101000-round"]
  },
  "coverage_delta": {
    "previous_round_id": "20261020-203000",
    "php_business": 2.35,
    "js": 4.1
  },
  "page_first": {
    "frontend_cases": 137,
    "api_cli_cases": 56,
    "via_page": 41,
    "unreachable": 15,
    "unclassified": 0,
    "compliant": true,
    "violations": []
  },
  "data_check": {
    "mutating_cases": 48,
    "verified": 48,
    "unverified": 0,
    "compliant": true,
    "violations": []
  },
  "design_check": {
    "compliant": true,
    "total_cases": 193,
    "metadata_cases": 120,
    "operation_steps_cases": 120,
    "method_counts": {"场景检查": 40, "边界值": 30},
    "case_kind_counts": {"positive": 70, "negative": 50, "unlabeled": 0},
    "units": [],
    "units_without_positive": [],
    "modules": [
      {"system": "项目管理系统", "module": "项目", "total": 24, "passed": 23, "failed": 1, "not_run": 0}
    ],
    "unclassified_cases": 73,
    "violations": []
  },
  "checkpoints": {
    "total": 166,
    "tested": 166,
    "passed": 166,
    "failed": 0,
    "not_tested": 0,
    "pass_rate": 100,
    "explicit_cases": 0,
    "derived_cases": 118,
    "cases_without_checkpoints": 113,
    "by_layer": {
      "frontend": {"name": "前端", "total": 27, "tested": 27, "passed": 27, "failed": 0, "not_tested": 0},
      "api": {"name": "接口", "total": 139, "tested": 139, "passed": 139, "failed": 0, "not_tested": 0},
      "cli": {"name": "CLI", "total": 0, "tested": 0, "passed": 0, "failed": 0, "not_tested": 0}
    },
    "violations": []
  },
  "next_round_suggestions": {
    "php": ["controller/foo.php: 未覆盖行 ……"],
    "js": ["public/assets/app.js: 未覆盖行 ……"]
  },
  "playwright": {
    "run_id": "20261021-101000-round",
    "flow": "/path/to/flow.js",
    "run_dir": "/var/log/harness-coverage/playwright/runs/..."
  }
}
```

说明：

- `pass_rate` 与 `percent` 都是 **0–100 的百分数**，不是 0–1 小数；`coverage_delta` 是百分点差（`+2.35` 表示提高 2.35 个百分点）。
- `totals.total` 是三层用例总数；未执行用例计入总数，所以通过率 = `passed / total`。
- `layers` 的三层都要有 `name`、`available`、`passed`、`total`、`cases`；`cases` 内每条要有 `layer`、`name`、`status`。缺失层由报告补一条 `synthetic` 的 1 条未执行用例。
- `page_first` 与 `data_check` 的 `violations` 是未达标的用例清单；`compliant` 为 false 时，严格模式会让报告失败。
- `design_check` 记录设计元数据审计结果；`modules` 是有系统 / 模块分类的用例分布，`unclassified_cases` 是未填写两级分类的用例数。
- `checkpoints` 记录检查点统计：`total` 为总数，`tested` 为已执行，`failed` 为未通过，`not_tested = total - tested`；`explicit_cases` / `derived_cases` 分别表示显式提供 `checkpoints` 与按落库检查推导的用例数；`cases_without_checkpoints` 表示没有检查点的用例数。
- `coverage_scope` 说明覆盖率不是按测试层切开：PHP 含页面 / API / CLI / 队列，JS 含本轮全部页面流程。
- `next_round_suggestions` 由未覆盖行文本生成，`coverage-trend --plan` 用它写下一轮计划。
- `issues` 是 `cases` 中非 `passed` 项的汇总；问题本身就是失败用例，不另设“已知问题”区。

## 5. 8080 实时观测

观测台把「轮次注册目录」与旧的 Playwright 运行目录合并展示：

| 地址 | 数据来源与行为 |
|------|----------------|
| `/` | 每轮一张卡片。轮次来自 `/rounds-json/`，读取 `status.json`；已归档的显示全量通过率、PHP/JS 覆盖率、页面穿透 / 落库审计、分层计数与报告按钮。执行中的轮次每 3 秒刷新，显示当前阶段、运行时长、分层进度、实时覆盖率与心跳 |
| `/rounds-json/` | 轮次目录 JSON，观测台发现新轮次 |
| `/rounds/<轮次>/status.json` | 实时状态：`state`、`layers`、`coverage`、`page_first`、`data_check` 等 |
| `/rounds/<轮次>/summary.json` | 归档摘要（趋势工具与观测台读取） |
| `/rounds/<轮次>/report/index.html` | 全量测试报告，含覆盖率入口、审计、失败清单与下一轮建议 |
| `/rounds/<轮次>/plan.md` | 开始轮次时登记的补测计划 |
| `/rounds-json/` + `/runs-json/` | 观测台合并两类来源；被轮次引用的 Playwright 运行不再重复成卡片 |
| `/artifacts/runs/<run_id>/trace.zip` | Playwright Trace；观测台链接为 `/trace/index.html?trace=/artifacts/runs/<run_id>/trace.zip` |
| `/js-coverage/` | 最近一次 Playwright 运行的 JS 覆盖率快照；整轮合并覆盖率看轮次报告 |
| `/php-coverage/` | 最近一次 `coverage-report --html` 发布的 PHP 覆盖率快照 |
| `/reports/` | PHP / JS 覆盖率快照总览，同一页切换 |
| `/coverage/` | **故意不提供**（返回 404）；前端覆盖率统一用 `/js-coverage/` 或轮次报告 |

**轮次从编写用例阶段就存在**：执行 `round-status start` 后，即使还没跑任何测试，8080 也会出现「编写用例中」的卡片；执行 `run-all` 后状态、分层计数、覆盖率和当前步骤持续更新，直到 `done` / `failed`。不需要等报告生成完才看到记录。

**轮次卡片的信息分组**：第一行是轮次标识、状态、名称与时间；第二行是用例通过率与 PHP / JS 覆盖率（含增量）；第三行是审计结论与前端 / 接口 / CLI 分层计数。检查点统计在展开后的面板、模块浏览器与全量报告中显示。失败原因、覆盖口径、流程文件与运行目录等排查信息默认收进「失败摘要」折叠或 info 说明图标，点击后展开；信息位置与所属区块保持不变。

打开「用例」时展示**系统 / 模块浏览器**：左侧是一级系统与二级模块树（显示通过数 / 总数、失败数，可折叠、可点击筛选），右侧是当前系统或模块的用例列表；选中一级系统会聚合其下所有模块，选中「全部用例」则显示整轮。每条用例显示所属系统 / 模块、层、操作步骤，有设计元数据的显示编号 / 设计方法 / 测试单元 / 测试点；检查点逐条一行显示「检查点：名称 · 状态」，未通过的检查点标红，失败或未执行项按「期望 → 检查点 → 实际」的顺序排列；接口 / CLI 用例显示 `via_page` 或不可达原因；写数据用例显示「落库已校验 / 未校验」，设计元数据异常单独提示。未填写系统 / 模块的用例归入「未归类 / 未分模块」。旧运行目录没有 `summary.json` 时，回退为 `meta.json` 的前端步骤与前端覆盖率，不显示全量用例按钮。

**检查点统计**：展开后的面板 head 与模块浏览器右侧会显示「检查点 总 X · 已测试 Y · 未通过 Z · 未测试 W」。用例提供 `checkpoints` 时以其为准；否则以 `db_verification.checks` 的每一项为检查点；两者都没有时该用例没有检查点，不计入统计。用例行里的检查点使用左右结构：左侧固定「检查点：」标签，右侧逐行列出每个检查点及状态，未通过标红；全量报告中有独立「检查点统计」区，失败清单也会显示每个失败用例未通过的检查点。

**全量报告中的用例明细**：`index.html` 的「用例明细」区与 8080 使用同一套 `system / module` 分类，左侧为系统 / 模块树、右侧为用例列表，支持点击一级系统聚合、点击二级模块筛选；每条用例显示状态、检查点、操作步骤、期望 / 实际、设计元数据与落库校验结果。报告是静态文件，筛选交互由内联脚本完成，不依赖 8080 服务。

**统计口径**：卡片上的「前端用例 134/137」「接口用例 50/52」等分层计数，分子是通过的**用例数**、分母是本层用例总数；一条用例内部的多条断言 / 检查点单独统计在 `checkpoints`，不进入用例通过率分母。一条 `runCase` / 一个结果对象就是一条用例。

## 6. 通用测试平台与项目测试

harness 镜像在 `/var/www/test_usecase` 提供**通用**测试平台骨架：

- 目录结构、`run-all.sh` 单轮编排、`fixtures/db_check.php`、`fixtures/delete_row.php`、`fixtures/rollback_probe.sh` 属于通用工具，随镜像发布。
- **具体项目的测试用例、造数脚本、清理脚本和报告不进入 harness 仓库**；放在运行期目录或挂载进容器的项目目录（如项目的 `tests/e2e/`），不要只放 `/tmp`。
- 项目测试按约定路径接入：`tests/frontend/flow.js`、`tests/api/run.js`、`tests/cli/run.js`，以及可选的 `fixtures/seed.php` / `fixtures/cleanup.php` / `fixtures/prepare.sh`；结果文件写入 `$ROUND_DIR` 下的约定 JSON。
- `reports/` 是运行期数据，容器重建会清空；每轮报告归档到 `/var/log/harness-coverage/rounds/`，8080 与趋势工具读取这一份。
- 测试设计方法、页面优先、落库校验、异常 / 破坏性边界与迭代停止条件见 `/usr/local/share/harness/test_usecase/TEST_DESIGN.md`。
