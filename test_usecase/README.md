# 综合测试平台（通用骨架）

本目录随 harness 镜像提供，是一个**项目无关**的测试平台骨架：负责轮次登记、单轮编排、覆盖率汇总、全量报告与 8080 展示。具体项目的测试用例、造数脚本、清理脚本和运行报告属于项目自身，**不进入 harness 仓库**，运行时放在 `/var/www/test_usecase`（挂载或手动添加）即可。

测试用例的设计方法、页面优先原则、落库校验、异常边界清单、破坏性测试角度和迭代停止条件见 [TEST_DESIGN.md](TEST_DESIGN.md)（镜像内 `/usr/local/share/harness/test_usecase/TEST_DESIGN.md`）。

## 目录结构

```
run-all.sh                  # 通用单轮编排入口
fixtures/                   # 通用夹具
  db_check.php              # 只读查询 + 行数/字段断言，校验数据是否落库
  delete_row.php            # 通用按表/ID 物理删除，模拟底层数据丢失
  rollback_probe.sh         # 隔离数据库验证 migrate:rollback
lib/                        # 预留通用脚本目录
tests/
  frontend/                 # 项目提供 flow.js
  api/                      # 项目提供 run.js
  cli/                      # 项目提供 run.js
state/                      # 造数输出（运行期）
reports/rounds/             # 轮次工作目录（运行期）
```

`state/`、`reports/`、`tests/` 下的具体项目文件不随镜像发布。

## 一轮的生命周期

一轮测试从「开始写用例」就成立，不等到执行才有记录：

```bash
# 1. 写用例前登记；此时 8080 已显示「编写用例中」
round-status start --name=checkout --suite-dir=/var/www/test_usecase \
    [--plan=/path/to/previous-next-round-plan.md]

# 2. 编写 tests/ 下的三层用例与 fixtures/ 数据准备
#    页面优先；接口 / CLI 写 via_page 或 unreachable_reason；写数据用例写 db_verification

# 3. 执行；复用 active 轮次（NEW_ROUND=1 强制新开）
/var/www/test_usecase/run-all.sh

# 4. 查看报告、覆盖率趋势与下一轮计划
coverage-trend
coverage-trend --plan /var/www/test_usecase/reports/rounds/<轮次>/next-round-plan.md
```

`run-all.sh` 自动推进并持续更新状态：`planning → preparing → seeding → frontend → api → cli → coverage → reporting → done`；中途异常标记 `failed`。每一阶段、每一层的计数与当前步骤都会写进轮次注册目录，8080 实时读取。

若上一轮已经 `done`，`run-all.sh` 会新建轮次；若上一轮还在 `planning`（用例还没写完就准备执行）或执行中，则复用该轮次。用 `ROUND_ID` 指定轮次，用 `NEW_ROUND=1` 忽略 active 强制新建。对同一测试套件再次执行 `round-status start` 时，上一轮未结束的轮次会被标记为「已中断 / 被新一轮替代」，不会一直显示为进行中。

## 约定接口

`run-all.sh` 通过约定路径发现项目测试，文件存在即执行：

| 路径 | 作用 |
|------|------|
| `fixtures/prepare.sh` | 每轮开始前执行，可做队列重置、环境准备 |
| `fixtures/seed.php` | 造数；可用 `TEST_TAG` / `PW_TAG` 作为本轮唯一标签 |
| `fixtures/cleanup.php` / `fixtures/cleanup.sh` | 退出时清理测试数据 |
| `tests/frontend/flow.js` | Playwright 流程；从环境变量 `ROUND_DIR` 读取输出目录 |
| `tests/api/run.js` | 接口测试；向 `$ROUND_DIR/api-results.json` 写结果 |
| `tests/cli/run.js` | CLI 测试；向 `$ROUND_DIR/cli-results.json` 写结果 |

结果文件格式：

```json
{
  "layer": "api",
  "total": 3,
  "passed": 2,
  "failed": 1,
  "cases": [
    {
      "layer": "api",
      "name": "创建项目后落库",
      "status": "passed",
      "duration_ms": 12,
      "expected": "项目创建成功且数据库存在记录",
      "actual": "接口返回成功，数据库记录字段正确",
      "via_page": "页面：创建项目",
      "mutates_data": true,
      "db_verification": {
        "passed": true,
        "checks": [{"table": "project", "id": 900001, "expect": "status=1", "actual": "status=1"}]
      }
    },
    {
      "layer": "api",
      "name": "并发邀请触发冷却",
      "status": "passed",
      "unreachable_reason": "页面无法构造并发请求",
      "mutates_data": true,
      "db_verification": {"passed": true, "detail": "邀请表只新增 1 条记录"}
    }
  ]
}
```

前端流程需向 `$ROUND_DIR/frontend-cases.json` 写同样的结构（`layer` 为 `frontend`）。失败和未执行用例必须保留 `expected` / `actual`；不要把它们从通过率分母中移除。

### 用例元数据约定

- **页面优先**：接口 / CLI 用例二选一写 `via_page`（本轮页面用例名）或 `unreachable_reason`（页面不可达原因）。没有归类的用例会被报告标记为「页面穿透未分类」。
- **数据落库校验**：凡会写数据的用例（新增、修改、删除、状态流转，以及应被拒绝的写入请求）标记 `mutates_data: true`，并提供非空 `db_verification`。可以写说明字符串、检查项数组，或 `{ checks: [...], detail, actual, passed }` 对象。
- 校验要发生在页面 / 接口操作之后，直接查询数据库确认字段值、行数和软删除状态；**不能只看页面提示或接口返回成功**。被拒绝的写入要确认数据库没有新增或改动。
- 页面流程、接口测试、CLI 测试都使用同一约定；`fixtures/db_check.php` 是通用查询工具。
- **设计元数据（可选，推荐）**：`case_id`（全局唯一）、`system`（一级系统 / 模块）、`module`（二级模块）、`design_method`（设计方法）、`test_unit`（最小测试单元）、`test_point`（必须以「设计方法-」开头）、`case_kind`（`positive` / `negative`）、`operation_steps`（操作步骤文本，报告与 8080 都会展示）。提供 `design_method` 时必须同时提供 `system`、`module`、`test_unit`、`test_point` 与 `operation_steps`；同一测试单元建议先有正向用例再补负向。8080 的用例列表按 `system / module` 生成左侧模块树、右侧用例列表，未填写归入「未归类 / 未分模块」。
- **检查点（通过用例必填）**：用例结果可带 `checkpoints: [{name, status, expected?, actual?}]`，`status` 为 `passed` / `failed` / `not_run`。检查点是细粒度对比点：按钮 / 标签文字、数字变化、列表条数与数据、字段值等；`expected` / `actual` 只描述整体页面 / 流程结果。测试 runner 会自动把断言与落库检查记录为检查点；通过用例至少要有 1 个，缺少时 `CHECKPOINT_STRICT=1` 本轮失败。

三项审计在 `run-all.sh` 中默认严格（`AUDIT_STRICT=1`）；迁移旧用例时可设 `AUDIT_STRICT=0`，或用 `PAGE_FIRST_STRICT=1` / `DATA_CHECK_STRICT=1` / `DESIGN_STRICT=1` 单独控制。

## 运行

```bash
# PRJ_HOME 指向项目根目录（容器启动时已设置）
export PRJ_HOME=/var/www/your-project
/var/www/test_usecase/run-all.sh

# 前端默认有头运行，可在 8080 的实时画面观察；不需要观察时加 --headless
/var/www/test_usecase/run-all.sh --headless
```

可选环境变量：

- `BASE_URL`：项目地址，默认 `http://127.0.0.1`
- `COVERAGE_EXCLUDE`：PHP 覆盖率排除目录，如 `view,some_env_dir`；默认不排除
- `TEST_TAG`：本轮造数标签，默认轮次号
- `TEST_SUITE_DIR`：平台目录，默认脚本所在目录
- `ROUND_ID` / `NEW_ROUND`：复用指定轮次 / 强制新建
- `HEADLESS=1`：前端无头运行；默认有头，便于实时画面观察
- `AUDIT_STRICT`：默认 1，页面穿透、落库校验、用例设计元数据或检查点未通过时本轮失败
- `PAGE_FIRST_STRICT` / `DATA_CHECK_STRICT` / `DESIGN_STRICT` / `CHECKPOINT_STRICT`：单独覆盖四项审计；未填写设计元数据的旧用例不会被判错，但通过用例必须有检查点
- `REQUIRE_PAGE_FIRST=1`：旧版页面穿透严格开关的别名

每轮流程：

1. 复用或新建轮次，状态置为 `preparing`
2. 执行 `fixtures/prepare.sh`（若存在）、清理旧数据、`coverage-reset`
3. 状态置为 `seeding`，执行 `fixtures/seed.php`（若存在）
4. 状态置为 `frontend`，执行页面流程；结束时回写前端计数与 Playwright 运行目录
5. 状态置为 `api`，执行接口用例；再置为 `cli`，执行 CLI 用例
6. 状态置为 `coverage`，生成本轮 PHP / JS 覆盖率并回写数字
7. 状态置为 `reporting`，调用 `round-report`，再生成趋势与下一轮计划
8. `round-status finish` 归档报告并结束轮次，状态置为 `done`
9. 执行清理脚本

任一层失败不中断后续层；最终通过率 = 通过用例 / 全部用例（未执行也计入分母），存在失败、未执行或审计未通过时退出码为 1。

## 通用夹具

- `fixtures/db_check.php --sql="select ..." [--expect-rows=N] [--expect-json='{"列":"值"}']`：只读查询数据库并断言行数 / 字段，用于页面或接口操作后的落库校验；只允许单条 `select` / `with` 查询。
- `fixtures/delete_row.php --table=<表名> --id=<id>`：物理删除一条数据，模拟绕过应用的数据丢失。项目如有子表 / 关联，请复制后在项目测试夹具中加级联。
- `fixtures/rollback_probe.sh`：复制项目到临时目录、创建临时数据库，执行真实 `migrate:rollback`，验证 down SQL、migrations 批次删除和无批次时再次回滚安全退出；不触碰主项目数据库。

破坏性用例通常无法用代码覆盖率锚定，应按边界场景设计；它们同样计入全量通过率，失败 / 未执行会出现在统一清单中。

## 报告与 8080

- 轮次状态、摘要与报告归档在 `/var/log/harness-coverage/rounds/<轮次>/`；8080 读取 `status.json` 实时展示，读取 `summary.json` 展示归档结果。
- 完整报告契约（输入、`summary.json` 字段、审计规则、发布与回退）见 harness 的 `coverage/round-report.md`。
- 覆盖率口径、轮次命令、趋势分析和 8080 入口见 `coverage/README.md`。
