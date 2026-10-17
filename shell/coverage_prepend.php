<?php

// 黑盒覆盖率采集器：通过 auto_prepend_file 挂到所有 PHP 入口（FPM / CLI）。
// 采集到的数据按进程追加到 spool 目录，由 coverage-report 汇总、coverage-reset 清空。
// 这里的任何异常都不能影响业务代码，采集失败时静默跳过。

if (! extension_loaded('pcov') || ! function_exists('pcov\start')) {
    return;
}

// 允许单次命令跳过采集（报告、重置等工具自身也用这种方式避开）
if (getenv('HARNESS_COVERAGE') === '0') {
    return;
}

$sapi = PHP_SAPI;

if (! in_array($sapi, ['fpm-fcgi', 'cgi-fcgi', 'cli', 'cli-server'], true)) {
    return;
}

$script = $_SERVER['SCRIPT_FILENAME'] ?? ($argv[0] ?? '');
$script_base = $script !== '' ? strtolower(basename($script)) : '';

// 不采集工具与包管理进程：它们不是黑盒业务入口
if (in_array($script_base, [
    'coverage-report',
    'coverage-report.php',
    'coverage-reset',
    'composer',
    'composer.phar',
    'phpunit',
    'phpunit.phar',
], true)) {
    return;
}

if ($script !== '' && strpos(str_replace('\\', '/', $script), '/vendor/bin/') !== false) {
    return;
}

// CLI 只采集项目目录内的脚本（phpunit、composer 等系统工具不采集）
if ($sapi === 'cli' || $sapi === 'cli-server') {
    $project = getenv('PRJ_HOME');

    if ($project) {
        $project_real = realpath($project);

        if ($project_real !== false && $script !== '') {
            $script_real = realpath($script) ?: $script;
            $script_real = str_replace('\\', '/', $script_real);
            $project_prefix = rtrim(str_replace('\\', '/', $project_real), '/').'/';

            if ($script_real !== $project_real && strpos($script_real, $project_prefix) !== 0) {
                return;
            }
        }
    }
}

$spool = getenv('HARNESS_COVERAGE_DIR') ?: '/var/log/harness-coverage';

if (! is_dir($spool)) {
    @mkdir($spool, 0777, true);
}

if (! is_dir($spool) || ! is_writable($spool)) {
    return;
}

// 事件标签：HTTP 记录方法与路径，CLI 记录脚本与子命令（去掉可能含敏感信息的参数）
$label = '';

if ($sapi === 'fpm-fcgi' || $sapi === 'cgi-fcgi') {
    $method = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
    $path = (string) ($_SERVER['REQUEST_URI'] ?? '');

    if ($path !== '') {
        $path = parse_url($path, PHP_URL_PATH) ?: $path;
    }

    $label = trim($method.' '.$path);
} else {
    $label = $script !== '' ? basename($script) : 'cli';
    $arg = $argv[1] ?? '';

    if ($arg !== '' && ! str_starts_with($arg, '-') && preg_match('/^[A-Za-z0-9:_\.\/-]{1,80}$/', $arg)) {
        $label .= ' '.$arg;
    }
}

$label = mb_substr($label, 0, 200);
$spool_file = $spool.'/'.$sapi.'-'.getmypid().'.ndjson';

// 把自上次 flush 以来的覆盖数据写入 spool，然后清空 PCOV 的本次采集数据
$flush = function () use ($spool_file, $label) {
    static $busy = false;

    if ($busy) {
        return;
    }

    $busy = true;

    try {
        $files = pcov\waiting();

        if ($files) {
            $data = pcov\collect(\pcov\inclusive, $files);

            pcov\clear();

            if (is_array($data) && $data) {
                $event = [
                    'time' => microtime(true),
                    'sapi' => PHP_SAPI,
                    'label' => $label,
                    'lines' => $data,
                ];

                $json = json_encode($event, JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);

                if ($json !== false) {
                    @file_put_contents($spool_file, $json."\n", FILE_APPEND | LOCK_EX);
                }
            }
        }
    } catch (\Throwable $e) {
        // 采集失败不影响业务
    }

    $busy = false;
};

pcov\start();

register_shutdown_function(function () use ($flush) {
    if (function_exists('pcntl_alarm')) {
        @pcntl_alarm(0);
    }

    $flush();
});

// 长驻 CLI（队列 worker 等）定期 flush：报告接近实时，且 reset 后能尽快从零开始
if (($sapi === 'cli' || $sapi === 'cli-server')
    && function_exists('pcntl_alarm')
    && function_exists('pcntl_signal')
    && function_exists('pcntl_async_signals')) {
    $interval = (int) (getenv('HARNESS_COVERAGE_FLUSH_INTERVAL') ?: 2);

    if ($interval > 0) {
        pcntl_async_signals(true);

        pcntl_signal(SIGALRM, function () use ($flush, $interval) {
            $flush();
            pcntl_alarm($interval);
        });

        pcntl_alarm($interval);
    }
}
