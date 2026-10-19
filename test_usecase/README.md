# 综合测试平台

从真实使用入口测试项目代码，覆盖 Playwright 前端、接口、CLI 三层，并统一统计通过率与覆盖率。平台源码位于 `/var/www/test_usecase`，随 harness 镜像提供。

## 目录结构

```
run-all.sh                  # 单轮全量执行入口
state/                      # 造数产出的 state.json / extra.json
fixtures/                   # 造数、清理、会话、队列模拟等测试辅助 PHP
tests/
  frontend/
    flow.js                 # Playwright 流程入口
    lib/core.js             # 页面与请求辅助
    cases/                  # 按模块拆分的前端用例步骤
  api/
    run.js                  # 接口测试入口（失败不中断）
    lib/api.js              # 请求、断言、会话辅助
    cases/                  # 按领域拆分的接口用例
  cli/
    run.js                  # CLI 测试入口（通过 bash 执行 public/cli.php）
lib/
  report-round.js           # 三层结果合并 + 覆盖率汇总 + HTML/Markdown 报告
reports/
  rounds/<轮次>/            # 每轮：summary.json / index.html / 覆盖率 / 未覆盖行
  latest -> 最近一轮
  legacy/                   # 重组前的旧产物
```

## 设计原则

- 页面能覆盖的逻辑优先用 Playwright 从页面穿透测试。
- 页面测不到或不好测的场景（协议、参数矩阵、越权、SSE、分页边界等）走 API。
- CLI 命令通过 bash 执行 `php public/cli.php ...` 测试。
- 任一条用例失败都不会中断后续用例；报告记录「应该表现 / 实际表现」。
- 通过率 = 通过用例数 / 本轮全部用例数；未执行也计入分母。
- 覆盖率在全部三层用例执行完后统一采集：PHP 为业务代码口径（排除模板 view 与测试环境 harness），JS 为 Playwright 单轮 V8 覆盖率。

## 运行

```bash
/var/www/test_usecase/run-all.sh
```

每轮会：

1. 清理旧数据并重新造数
2. `coverage-reset`
3. 执行前端 Playwright 流程
4. 执行接口测试
5. 执行 CLI 测试
6. 生成 PHP / JS 覆盖率报告
7. 用 `round-report` 合并三层结果生成 `reports/rounds/<轮次>/index.html`
8. 清理测试数据

`state/` 与 `reports/` 是运行期数据，会随容器重建清空；报告同时复制到该轮 Playwright 运行目录的 `round/`，可从 8080 回看。平台源码由 harness 镜像提供，版本管理在 harness 仓库的 `test_usecase/` 目录。

## 相关地址

报告同时会复制到该轮 Playwright 产物的 `round/` 目录，因此可从 8080 查看：

- 目录页：`http://127.0.0.1:8080/`
- 本轮全量报告：`http://127.0.0.1:8080/artifacts/runs/<run_id>/round/index.html`
- PHP 覆盖率：`http://127.0.0.1:8080/php-coverage/`（最新快照）
- JS 覆盖率：`http://127.0.0.1:8080/js-coverage/`（最近一次 Playwright 运行）
