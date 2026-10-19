# 综合测试平台（通用骨架）

本目录随 harness 镜像提供，是一个**项目无关**的测试平台骨架：负责单轮编排、覆盖率汇总、全量报告生成和 8080 展示。具体项目的测试用例、造数脚本、清理脚本和运行报告属于项目自身，**不进入 harness 仓库**，运行时放在 `/var/www/test_usecase`（挂载或手动添加）即可。

## 目录结构

```
run-all.sh                  # 通用单轮编排入口
fixtures/                   # 通用夹具（rollback_probe.sh、delete_row.php）
  rollback_probe.sh         # 隔离数据库验证 migrate:rollback
  delete_row.php            # 通用按表/ID 物理删除，项目可自行扩展级联
lib/                        # 预留通用脚本目录
tests/
  frontend/                 # 项目提供 flow.js
  api/                      # 项目提供 run.js
  cli/                      # 项目提供 run.js
state/                      # 造数输出（运行期）
reports/                    # 轮次报告（运行期）
```

`state/`、`reports/`、`tests/` 下的具体项目文件不随镜像发布。

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
      "name": "用例名",
      "status": "failed",
      "expected": "应该表现",
      "actual": "实际表现",
      "duration_ms": 12
    }
  ]
}
```

前端流程需向 `$ROUND_DIR/frontend-cases.json` 写同样的结构（`layer` 为 `frontend`）。失败和未执行用例必须保留 `expected` / `actual`；不要把它们从通过率分母中移除。

## 运行

```bash
# PRJ_HOME 指向项目根目录（容器启动时已设置）
export PRJ_HOME=/var/www/your-project
/var/www/test_usecase/run-all.sh

# 透传 playwright-run 参数
/var/www/test_usecase/run-all.sh --headed
```

可选环境变量：

- `BASE_URL`：项目地址，默认 `http://127.0.0.1`
- `COVERAGE_EXCLUDE`：PHP 覆盖率排除目录，如 `view,some_env_dir`；默认不排除
- `TEST_TAG`：本轮造数标签，默认轮次号
- `TEST_SUITE_DIR`：平台目录，默认脚本所在目录

每轮流程：

1. 执行 `fixtures/prepare.sh`（若存在）
2. 清理旧数据、`coverage-reset`
3. 执行 `fixtures/seed.php`（若存在）
4. 执行前端 / 接口 / CLI 三层测试
5. 生成 PHP / JS 覆盖率报告
6. 用 `round-report` 生成 `summary.json`、`summary.md`、`index.html`
7. 把 `round/` 复制到 Playwright 运行目录，8080 自动展示
8. 执行清理脚本

任一层失败不中断后续层；最终通过率 = 通过用例 / 全部用例（未执行也计入分母），存在失败或未执行时退出码为 1。

## 破坏性测试通用工具

- `fixtures/delete_row.php --table=<表名> --id=<id>`：物理删除一条数据，模拟绕过应用的数据丢失。项目如有子表/关联，请复制后在项目测试夹具中加级联。
- `fixtures/rollback_probe.sh`：复制项目到临时目录、创建临时数据库，执行真实 `migrate:rollback`，验证 down SQL、migrations 批次删除和无批次时再次回滚安全退出；不触碰主项目数据库。

破坏性用例通常无法用代码覆盖率锚定，应按边界场景设计；它们同样计入全量通过率，失败 / 未执行会出现在统一清单中。

## 报告与 8080

完整报告契约见 harness 的 `coverage/round-report.md`；8080 观测台读取每轮 Playwright 运行目录的 `round/summary.json`。
