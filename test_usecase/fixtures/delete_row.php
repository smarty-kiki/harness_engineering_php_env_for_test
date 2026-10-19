<?php
/**
 * 通用破坏性测试辅助：物理删除一条底层数据。
 *
 * 运行：php fixtures/delete_row.php --table=<表名> --id=<正整数>
 * 输出：JSON { table, id, deleted }
 *
 * 这是通用工具，不包含任何具体项目的表名或级联规则。项目若有子表 / 关联记录，
 * 请在项目自己的测试夹具中先清理，或自行扩展本脚本的副本。
 */

chdir(getenv('PRJ_HOME') ?: getcwd());

include 'bootstrap.php';

$options = [];

foreach (array_slice($argv, 1) as $arg) {
    if (preg_match('/^--([^=]+)=(.*)$/', $arg, $match)) {
        $options[$match[1]] = $match[2];
    }
}

$table = $options['table'] ?? '';
$id = (int) ($options['id'] ?? 0);

if (! preg_match('/^[a-z_][a-z0-9_]*$/', $table) || $id <= 0) {
    fwrite(STDERR, "usage: delete_row.php --table=<table_name> --id=<positive>\n");
    exit(2);
}

$deleted = (int) db_delete('delete from `'.$table.'` where id = :id', [':id' => $id]);

echo json_encode(['table' => $table, 'id' => $id, 'deleted' => $deleted], JSON_UNESCAPED_UNICODE)."\n";
