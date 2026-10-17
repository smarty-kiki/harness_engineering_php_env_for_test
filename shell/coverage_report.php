<?php

use SebastianBergmann\CodeCoverage\CodeCoverage;
use SebastianBergmann\CodeCoverage\Data\RawCodeCoverageData;
use SebastianBergmann\CodeCoverage\Driver\PcovDriver;
use SebastianBergmann\CodeCoverage\Filter;
use SebastianBergmann\CodeCoverage\Report\Clover;
use SebastianBergmann\CodeCoverage\Report\Html\Facade as HtmlFacade;
use SebastianBergmann\CodeCoverage\Report\Text;
use SebastianBergmann\CodeCoverage\Report\Thresholds;

$autoload = '/usr/share/php/SebastianBergmann/CodeCoverage/autoload.php';

if (! is_file($autoload)) {
    fwrite(STDERR, "找不到 php-codecoverage：{$autoload}\n");
    exit(1);
}

require $autoload;

function coverage_report_usage(): void
{
    $usage = <<<TEXT
用法：coverage-report [选项]

把 /var/log/harness-coverage 下由页面、接口、CLI、队列 worker 产生的覆盖事件
合并成一份黑盒测试覆盖率报告。

选项：
  --include <路径>       统计的源码目录或文件，可多次指定或逗号分隔；默认项目根目录
  --exclude <名称>       排除的目录名或路径片段，可多次指定或逗号分隔
  --show-uncovered       列出可执行但未覆盖的行号
  --only-summary         只输出汇总，不列出每个文件
  --html <目录>          生成 HTML 报告
  --clover <文件>        生成 Clover XML 报告
  -h, --help             显示帮助

示例：
  coverage-report
  coverage-report --include domain,controller,util
  coverage-report --show-uncovered --include src
  coverage-report --html /tmp/coverage-html --clover /tmp/coverage.xml
TEXT;

    echo $usage, "\n";
}

function coverage_report_paths(string $value): array
{
    $paths = [];

    foreach (explode(',', $value) as $path) {
        $path = trim($path);

        if ($path !== '') {
            $paths[] = $path;
        }
    }

    return $paths;
}

function coverage_report_resolve(string $path, string $project): string
{
    if ($path === '' || $path[0] === '/') {
        return $path;
    }

    $candidate = rtrim($project, '/').'/'.$path;

    return file_exists($candidate) ? $candidate : $path;
}

function coverage_report_is_excluded(string $path, array $exclude_names, array $exclude_fragments): bool
{
    $path = str_replace('\\', '/', $path);
    $segments = array_map('strtolower', explode('/', $path));

    foreach ($exclude_names as $name => $unused) {
        if (in_array($name, $segments, true)) {
            return true;
        }
    }

    foreach ($exclude_fragments as $fragment) {
        if (str_contains($path, $fragment)) {
            return true;
        }
    }

    return false;
}

function coverage_report_scan(array $includes, array $excludes, string $project): array
{
    $exclude_names = [];
    $exclude_fragments = [];

    foreach ($excludes as $exclude) {
        $exclude = trim(str_replace('\\', '/', $exclude), '/');

        if ($exclude === '') {
            continue;
        }

        if (str_contains($exclude, '/')) {
            $exclude_fragments[] = '/'.$exclude.'/';
        } else {
            $exclude_names[strtolower($exclude)] = true;
        }
    }

    $files = [];

    foreach ($includes as $include) {
        $include = coverage_report_resolve($include, $project);
        $real = realpath($include);

        if ($real === false) {
            continue;
        }

        if (is_file($real)) {
            if (strtolower(pathinfo($real, PATHINFO_EXTENSION)) === 'php') {
                $files[$real] = true;
            }

            continue;
        }

        if (! is_dir($real)) {
            continue;
        }

        try {
            $directory = new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS);
        } catch (\Throwable $e) {
            continue;
        }

        // 在进入目录前就剪掉 vendor / node_modules / .git 等，避免无谓遍历
        $filtered = new RecursiveCallbackFilterIterator(
            $directory,
            function (SplFileInfo $current) use ($exclude_names, $exclude_fragments): bool {
                $path = str_replace('\\', '/', $current->getPathname());

                if (coverage_report_is_excluded($path, $exclude_names, $exclude_fragments)) {
                    return false;
                }

                return true;
            }
        );

        try {
            $iterator = new RecursiveIteratorIterator($filtered);

            foreach ($iterator as $file) {
                if (! $file->isFile() || strtolower($file->getExtension()) !== 'php') {
                    continue;
                }

                $path = $file->getRealPath();

                if ($path === false) {
                    continue;
                }

                $path = str_replace('\\', '/', $path);

                if (! coverage_report_is_excluded($path, $exclude_names, $exclude_fragments)) {
                    $files[$path] = true;
                }
            }
        } catch (\Throwable $e) {
            continue;
        }
    }

    $files = array_keys($files);
    sort($files);

    return $files;
}

function coverage_report_relative(string $path, string $project): string
{
    $path = str_replace('\\', '/', $path);
    $prefix = rtrim(str_replace('\\', '/', $project), '/').'/';

    return str_starts_with($path, $prefix) ? substr($path, strlen($prefix)) : $path;
}

$project = getenv('PRJ_HOME') ?: getcwd();
$spool = getenv('HARNESS_COVERAGE_DIR') ?: '/var/log/harness-coverage';

$includes = [];
$excludes = ['vendor', 'node_modules', '.git', 'tests', 'test'];
$html = null;
$clover = null;
$show_uncovered = false;
$only_summary = false;

$args = array_slice($argv, 1);

for ($i = 0; $i < count($args); $i++) {
    $arg = $args[$i];

    switch (true) {
        case $arg === '-h' || $arg === '--help':
            coverage_report_usage();
            exit(0);
        case $arg === '--include':
            if (! isset($args[$i + 1])) {
                fwrite(STDERR, "--include 缺少路径\n");
                exit(2);
            }
            $includes = array_merge($includes, coverage_report_paths($args[++$i]));
            break;
        case str_starts_with($arg, '--include='):
            $includes = array_merge($includes, coverage_report_paths(substr($arg, 10)));
            break;
        case $arg === '--exclude':
            if (! isset($args[$i + 1])) {
                fwrite(STDERR, "--exclude 缺少名称\n");
                exit(2);
            }
            $excludes = array_merge($excludes, coverage_report_paths($args[++$i]));
            break;
        case str_starts_with($arg, '--exclude='):
            $excludes = array_merge($excludes, coverage_report_paths(substr($arg, 10)));
            break;
        case $arg === '--html':
            if (! isset($args[$i + 1])) {
                fwrite(STDERR, "--html 缺少目录\n");
                exit(2);
            }
            $html = $args[++$i];
            break;
        case str_starts_with($arg, '--html='):
            $html = substr($arg, 7);
            break;
        case $arg === '--clover':
            if (! isset($args[$i + 1])) {
                fwrite(STDERR, "--clover 缺少文件\n");
                exit(2);
            }
            $clover = $args[++$i];
            break;
        case str_starts_with($arg, '--clover='):
            $clover = substr($arg, 9);
            break;
        case $arg === '--show-uncovered':
            $show_uncovered = true;
            break;
        case $arg === '--only-summary':
            $only_summary = true;
            break;
        default:
            fwrite(STDERR, "未知参数：{$arg}\n");
            coverage_report_usage();
            exit(2);
    }
}

if (! $includes) {
    $includes = [$project];
}

$files = coverage_report_scan($includes, $excludes, $project);

if (! $files) {
    fwrite(STDERR, "没有找到要统计的 PHP 文件，请用 --include 指定源码目录\n");
    exit(1);
}

if (! extension_loaded('pcov')) {
    fwrite(STDERR, "PCOV 扩展未加载，无法生成覆盖率报告\n");
    exit(1);
}

$filter = new Filter;
$filter->includeFiles($files);

$coverage = new CodeCoverage(new PcovDriver($filter), $filter);

$included = array_fill_keys($files, true);
$realpath_cache = [];
$merged = [];
$event_count = 0;
$sapi_counts = [];
$first_time = null;
$last_time = null;

foreach (glob($spool.'/*.ndjson') ?: [] as $spool_file) {
    $handle = @fopen($spool_file, 'rb');

    if (! $handle) {
        continue;
    }

    @flock($handle, LOCK_SH);

    while (($line = fgets($handle)) !== false) {
        $event = json_decode($line, true);

        if (! is_array($event) || empty($event['lines']) || ! is_array($event['lines'])) {
            continue;
        }

        $event_count++;
        $sapi = (string) ($event['sapi'] ?? 'unknown');
        $sapi_counts[$sapi] = ($sapi_counts[$sapi] ?? 0) + 1;

        $time = (float) ($event['time'] ?? 0);
        $first_time = $first_time === null ? $time : min($first_time, $time);
        $last_time = $last_time === null ? $time : max($last_time, $time);

        foreach ($event['lines'] as $file => $line_flags) {
            if (! is_array($line_flags)) {
                continue;
            }

            if (! array_key_exists($file, $realpath_cache)) {
                $realpath_cache[$file] = realpath($file) ?: $file;
            }

            $file = $realpath_cache[$file];

            if (! isset($included[$file])) {
                continue;
            }

            foreach ($line_flags as $line_no => $flag) {
                $line_no = (int) $line_no;
                $existing = $merged[$file][$line_no] ?? null;

                if ($existing === null || ($flag === 1 && $existing !== 1)) {
                    $merged[$file][$line_no] = $flag;
                }
            }
        }
    }

    @flock($handle, LOCK_UN);
    fclose($handle);
}

if ($event_count === 0) {
    echo "暂无覆盖率数据（spool: {$spool}）。\n";
    echo "先运行 coverage-reset，然后通过页面、接口或 CLI 触发代码，再执行 coverage-report。\n";
    exit(0);
}

try {
    $coverage->append(RawCodeCoverageData::fromXdebugWithoutPathCoverage($merged), 'blackbox');
    $data = $coverage->getData();
} catch (\Throwable $e) {
    fwrite(STDERR, "合并覆盖率数据失败：".$e->getMessage()."\n");
    exit(1);
}

$executable_lines = 0;
$covered_lines = 0;
$uncovered_by_file = [];

foreach ($data->lineCoverage() as $file => $lines) {
    foreach ($lines as $line_no => $tests) {
        if ($tests === null) {
            continue;
        }

        $executable_lines++;

        if (! empty($tests)) {
            $covered_lines++;
        } else {
            $uncovered_by_file[$file][] = (int) $line_no;
        }
    }
}

foreach ($uncovered_by_file as &$line_numbers) {
    sort($line_numbers);
}

unset($line_numbers);

ksort($sapi_counts);
$sapi_parts = [];

foreach ($sapi_counts as $sapi => $count) {
    $sapi_parts[] = $sapi.' '.$count;
}

printf("覆盖率事件：%d（%s），源码文件：%d\n", $event_count, implode('，', $sapi_parts), count($files));

if ($first_time !== null && $last_time !== null) {
    printf("采集时间：%s ~ %s\n", date('Y-m-d H:i:s', (int) $first_time), date('Y-m-d H:i:s', (int) $last_time));
}

$percent = $executable_lines > 0 ? $covered_lines * 100 / $executable_lines : 0;

printf("行覆盖率：%.2f%%（%d / %d）\n", $percent, $covered_lines, $executable_lines);

if ($show_uncovered) {
    echo "\n未覆盖行：\n";

    if (! $uncovered_by_file) {
        echo "  所有可执行行均已覆盖。\n";
    } else {
        ksort($uncovered_by_file);
        $printed_files = 0;

        foreach ($uncovered_by_file as $file => $line_numbers) {
            if ($printed_files >= 100) {
                echo "  …… 其余文件已省略，可用 --include 缩小统计范围\n";
                break;
            }

            $count = count($line_numbers);
            $shown = array_slice($line_numbers, 0, 80);
            $more = $count > count($shown) ? ' …… 另有 '.($count - count($shown)).' 行' : '';

            printf("  %s：%s%s\n", coverage_report_relative($file, $project), implode(', ', $shown), $more);
            $printed_files++;
        }
    }
}

echo (new Text(Thresholds::default(), true, $only_summary))->process($coverage, false);

if ($html !== null) {
    $html = coverage_report_resolve($html, $project);

    if (! is_dir($html)) {
        @mkdir($html, 0777, true);
    }

    try {
        (new HtmlFacade(' Harness Coverage'))->process($coverage, $html);
        echo "\nHTML 报告：".rtrim($html, '/')."/index.html\n";
    } catch (\Throwable $e) {
        fwrite(STDERR, "生成 HTML 报告失败：".$e->getMessage()."\n");
    }
}

if ($clover !== null) {
    $clover = coverage_report_resolve($clover, $project);
    $dir = dirname($clover);

    if (! is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    try {
        (new Clover)->process($coverage, $clover, 'Harness Coverage');
        echo "Clover 报告：{$clover}\n";
    } catch (\Throwable $e) {
        fwrite(STDERR, "生成 Clover 报告失败：".$e->getMessage()."\n");
    }
}
