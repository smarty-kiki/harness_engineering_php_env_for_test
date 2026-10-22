/**
 * 检查点统计。
 *
 * 一个用例可以包含多个检查点（页面提示、接口字段、数据库落库结果等）。
 * 用例结果对象可选的 checkpoints 字段优先：
 *   "checkpoints": [
 *     {"name": "页面出现成功提示", "status": "passed"},
 *     {"name": "业务表新增 1 行", "status": "failed", "expected": "1 行", "actual": "0 行"}
 *   ]
 *
 * 检查点来源顺序：
 *   1. 显式 checkpoints（非空数组）；
 *   2. 没有显式 checkpoints 时，db_verification.checks 里的每一项算 1 个检查点
 *      （页面 / 接口操作后的落库检查）；
 *   3. 两者都没有时，该用例没有检查点，不用「整体结果」占位，也不计入检查点统计。
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

  const checkpoints = [];
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

      const expectText = text(raw.expect || raw.expected);
      const table = text(raw.table);

      checkpoints.push({
        name: text(raw.name) || (expectText ? (table ? table + '：' : '') + expectText : `落库检查 ${index + 1}`),
        status,
        source: 'db_verification',
        expected: expectText,
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
  let casesWithoutCheckpoints = 0;

  for (const [key, label] of CASE_LAYERS) {
    const cases = layers && layers[key] && Array.isArray(layers[key].cases) ? layers[key].cases : [];
    const layerStat = { name: label, total: 0, tested: 0, passed: 0, failed: 0, not_tested: 0 };

    for (const item of cases) {
      if (!item || item.synthetic === true) continue;

      const checkpoints = caseCheckpoints(item);
      const explicit = Array.isArray(item.checkpoints) && item.checkpoints.length > 0;

      if (explicit) explicitCases++;
      else if (checkpoints.length > 0) derivedCases++;
      else casesWithoutCheckpoints++;

      for (const checkpoint of checkpoints) {
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
    cases_without_checkpoints: casesWithoutCheckpoints,
    by_layer: byLayer,
    violations,
  };
}

/**
 * 通过用例必须至少记录 1 个检查点。
 * 失败 / 未执行用例可能在进入第一个检查点之前就失败，此时由用例级 expected / actual
 * 说明整体页面 / 流程问题；它们不计入“通过用例缺少检查点”的违规。
 */
function checkpointCoverageAudit(layers) {
  const violations = [];
  let passedCases = 0;
  let withCheckpoints = 0;

  for (const [key, label] of CASE_LAYERS) {
    const cases = layers && layers[key] && Array.isArray(layers[key].cases) ? layers[key].cases : [];

    for (const item of cases) {
      if (!item || item.synthetic === true || item.status !== 'passed') continue;

      passedCases++;

      if (Array.isArray(item.checkpoints) && item.checkpoints.length > 0) {
        withCheckpoints++;
      } else {
        violations.push({
          layer: key,
          layer_name: label,
          name: text(item.name) || '(未命名用例)',
          reason: '通过用例没有记录检查点',
        });
      }
    }
  }

  return {
    passed_cases: passedCases,
    with_checkpoints: withCheckpoints,
    missing: violations.length,
    compliant: violations.length === 0,
    violations,
  };
}

module.exports = {
  CASE_LAYERS,
  caseCheckpoints,
  checkpointAudit,
  checkpointCoverageAudit,
};
