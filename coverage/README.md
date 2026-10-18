# 黑盒测试覆盖率使用指南（PHP + 前端）

本环境提供两类覆盖率：

- **PHP 覆盖率（PCOV）**：默认开启，页面、接口、CLI 命令和队列 worker 执行过的项目代码都会自动采集。
- **前端覆盖率（V8 precise coverage）**：按需开启，通过 cda 采集 Chrome 实际执行过的 JS，报告在容器内生成，项目代码零改动。

覆盖率用于判断黑盒测试是否覆盖到目标代码，不要用 phpunit 来统计。

## 标准使用流程

1. 开始一轮测试前执行 `coverage-reset` 清零。
2. 按真实入口测试：页面优先用 cda；接口用 curl；命令行和队列用 bash 触发；覆盖正常、边界和异常路径。
3. 执行 `coverage-report` 查看总覆盖率。
4. 执行 `coverage-report --show-uncovered` 查看可执行但未覆盖的行，根据未覆盖行补测，再复核。
5. 需要给人看时生成 HTML 或 Clover 报告。

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
coverage-report --html <目录>                     # HTML 报告
coverage-report --clover <文件>                   # Clover XML
coverage-report --help                            # 查看全部参数
```

- HTML 报告用于人工查看，输出目录由当次任务决定；生成的报告不要提交到 git。
- 终端输出没有数据时，先确认测试流量确实打到了应用；采集事件在 `/var/log/harness-coverage/`。
- 报告默认合并所有进程的事件，不需要在每个请求结束后手工触发落盘。

## 采集边界与性能

- 页面/API 在请求结束时落盘；长驻 CLI（如队列 worker）约每 2 秒落盘一次；FPM 长连接（如 SSE）在请求结束时才落盘。
- `coverage-reset` 只清除已落盘的数据；重置瞬间可能带入不到 2 秒的旧数据，属于正常现象。
- PCOV 只支持行覆盖率，不支持分支/路径覆盖率。
- 覆盖率常开有性能开销：CPU 密集型脚本约 2 倍，页面请求影响相对较小；不要为了覆盖率跳过正常测试步骤。
- 完全不需要覆盖率时，启动容器加 `HARNESS_COVERAGE=0`。

## 前端覆盖率（cda coverage）

由 cda 测试专属版采集 Chrome 的 V8 precise coverage；扩展启动采集时会保持 debugger 附着，结束后必须 `stop`。报告和原始数据都在容器内：

- 原始数据：`/var/log/harness-coverage/frontend/`（cda server 写入）
- 报告：`frontend-coverage-report` 生成，默认输出 JSON（`text` 为可读摘要、`files` 为逐文件覆盖）

### 标准流程

```bash
# 1. 清零 PHP + 前端两边的覆盖率数据
coverage-reset

# 2. 开启前端覆盖率（<nodeId> 从 cda list 拿）
cda coverage start <nodeId>

# 3. 用 cda 跑页面操作；也可以把多步操作写成一个序列
cda run <nodeId> --file flow.json

# 4. 结束采集（必须执行，否则调试通道会一直附着）
cda coverage stop <nodeId>

# 5. 查看前端报告
frontend-coverage-report
frontend-coverage-report --show-uncovered
frontend-coverage-report --show-uncovered --html /tmp/frontend-coverage
```

等价的底层命令是 `cda coverage report --root "$PRJ_HOME"`。

### 统计口径

- 只统计 **JS 行/函数覆盖率**，没有分支覆盖率。
- 外链脚本按 URL 映射到 `<PRJ_HOME>/public/<path>`；映射不到本地文件的第三方脚本不统计。
- 内联脚本报告为 `inline: /页面路径#源文本哈希`。
- `coverage start` 后进入跟随模式：cda 触达的 tab 自动纳入采集；导航前、加载后、约每 1.5 秒、停止/关闭 tab 时会把增量回传落盘。
- 覆盖率会话期间 Chrome 顶部有调试信息条，视口会矮一条；截图/坐标类断言要在同一口径下做。
- 跨域 iframe、Web Worker、Service Worker 和 source map 第一版不支持。
- 页面自己弹出的新 tab 只有在被后续 cda 命令触达后才会开始采集。
- 扩展更新后必须在 `chrome://extensions` 重新加载扩展。
