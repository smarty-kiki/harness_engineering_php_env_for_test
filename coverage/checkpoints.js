/**
 * 检查点统计。
 *
 * 一个用例可以包含多个检查点（页面提示、接口字段、数据库落库结果等）。
 * 用例结果对象可选的 checkpoints 字段优先：
 *   "checkpoints": [
 *     {"name": "页面出现成功提示", "status": "passed"},
 *     {"name": "project 表新增 1 行", "status": "failed", "expected": "1 行", "actual": "0 行"}
 *   ]
 *
 * 兼容旧用例的推导顺序：
 *   1. 显式 checkpoints（非空数组）；
 *   2. 没有显式 checkpoints 时，用例本身算 1 个检查点；db_verification.checks
 *      里的每一项再算 1 个检查点（页面 / 接口操作后的落库检查）；
 *   3. 都没有时，只有用例本身这 1 个检查点。
 *
 * status 只接受 passed / failed / not_run。not_run 表示计划了但没有执行，
 * 计入总数与未测试数，不计入已测试数。
 */

const CASE_LAYERS = [
  ['frontend', '前端'],
  ['api', '接口'],
  ['cli', 'CLI'],
];

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeStatus(value) {
  const status = text(value);
  return ['passed', 'failed', 'not_run'].includes(status) ? status : '';
}

function caseCheckpoints(item) {
  if (Array.isArray(item.checkpoints) && item.checkpoints.length > 0) {
    return item.checkpoints.map((checkpoint, index) => {
      const raw = checkpoint && typeof checkpoint === 'object' ? checkpoint : {};
      const status = normalizeStatus(raw.status);

      return {
        name: text(raw.name) || `检查点 ${index + 1}`,
        status,
        source: 'explicit',
        expected: text(raw.expected),
        actual: text(raw.actual),
      };
    });
  }

  const checkpoints = [{
    name: text(item.name) || '(未命名用例)',
    status: normalizeStatus(item.status),
    source: 'case',
    expected: text(item.expected),
    actual: text(item.actual),
  }];

  const dbVerification = item.db_verification;

  if (dbVerification && typeof dbVerification === 'object' && Array.isArray(dbVerification.checks)) {
    dbVerification.checks.forEach((check, index) => {
      const raw = check && typeof check === 'object' ? check : {};
      let status = normalizeStatus(raw.status);

      if (!status) {
        status = item.status === 'not_run'
          ? 'not_run'
          : (dbVerification.passed === false ? 'failed' : 'passed');
      }

      checkpoints.push({
        name: text(raw.name) || `落库检查 ${index + 1}`,
        status,
        source: 'db_verification',
        expected: text(raw.expect || raw.expected),
        actual: text(raw.actual),
      });
    });
  }

  return checkpoints;
}

/**
 * @param {Object<string,{cases?:Array}>} layers
 * @returns {Object} checkpoint audit
 */
function checkpointAudit(layers) {
  const byLayer = {};
  const violations = [];
  let total = 0;
  let tested = 0;
  let passed = 0;
  let failed = 0;
  let notTested = 0;
  let explicitCases = 0;
  let derivedCases = 0;

  for (const [key, label] of CASE_LAYERS) {
    const cases = layers && layers[key] && Array.isArray(layers[key].cases) ? layers[key].cases : [];
    const layerStat = { name: label, total: 0, tested: 0, passed: 0, failed: 0, not_tested: 0 };

    for (const item of cases) {
      if (!item || item.synthetic === true) continue;

      const explicit = Array.isArray(item.checkpoints) && item.checkpoints.length > 0;
      if (explicit) explicitCases++;
      else derivedCases++;

      for (const checkpoint of caseCheckpoints(item)) {
        total++;
        layerStat.total++;

        if (!checkpoint.status) {
          violations.push({
            layer: key,
            name: text(item.name) || '(未命名用例)',
            reason: `检查点「${checkpoint.name}」缺少合法状态（passed / failed / not_run）`,
          });
          failed++;
          layerStat.failed++;
          tested++;
          layerStat.tested++;
          continue;
        }

        if (checkpoint.status === 'not_run') {
          notTested++;
          layerStat.not_tested++;
          continue;
        }

        tested++;
        layerStat.tested++;

        if (checkpoint.status === 'failed') {
          failed++;
          layerStat.failed++;

          if (item.status === 'passed') {
            violations.push({
              layer: key,
              name: text(item.name) || '(未命名用例)',
              reason: `用例标记为通过，但检查点「${checkpoint.name}」未通过`,
            });
          }
        } else {
          passed++;
          layerStat.passed++;
        }
      }
    }

    byLayer[key] = layerStat;
  }

  return {
    total,
    tested,
    passed,
    failed,
    not_tested: notTested,
    pass_rate: tested > 0 ? Math.round((passed / tested) * 10000) / 100 : 0,
    explicit_cases: explicitCases,
    derived_cases: derivedCases,
    by_layer: byLayer,
    violations,
  };
}

module.exports = {
  CASE_LAYERS,
  caseCheckpoints,
  checkpointAudit,
};
