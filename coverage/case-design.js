/**
 * 测试用例设计元数据校验。
 *
 * 用例结果文件里的可选字段：
 *   case_id          全局唯一，推荐「系统-模块-序号」
 *   system           一级分类：业务系统 / 一级模块
 *   module           二级分类：系统下的具体模块
 *   design_method    设计方法，必须来自 DESIGN_METHODS
 *   test_unit        最小测试单元（输入框 / 按钮 / 业务逻辑 / 前置入口等）
 *   test_point       测试点，命名为「设计方法-设计内容」
 *   case_kind        positive / negative，用于检查测试单元是否有正向用例
 *   operation_steps  操作步骤，中文分号分隔
 *
 * 只有提供任意设计元数据的用例才进入校验；未提供元数据的旧用例保持兼容。
 * 提供 design_method 时，必须同时提供 system、module、test_unit、test_point 与 operation_steps。
 * 校验只检查“已提供的元数据是否自洽”，不要求所有项目一次性补齐。
 */

const DESIGN_METHODS = [
  '场景检查',
  '等价类划分',
  '边界值',
  '判定表',
  '因果图',
  '状态迁移',
  '正交试验',
  '错误推测',
  '异常推测',
  '流程分析',
  '随机测试',
  '探索式测试',
];

const CASE_KINDS = ['positive', 'negative'];

function text(value) {
  return String(value == null ? '' : value).trim();
}

function hasAnyDesignField(item) {
  return !!(
    text(item.case_id)
    || text(item.system)
    || text(item.module)
    || text(item.design_method)
    || text(item.test_unit)
    || text(item.test_point)
    || text(item.case_kind)
  );
}

/**
 * @param {Object<string,{cases?:Array}>} layers
 * @returns {Object} design_check
 */
function designAudit(layers) {
  const allCases = [];

  for (const layer of ['frontend', 'api', 'cli']) {
    const cases = layers && layers[layer] && Array.isArray(layers[layer].cases) ? layers[layer].cases : [];

    for (const item of cases) {
      if (item && item.synthetic !== true) {
        allCases.push({ layer, item });
      }
    }
  }

  const violations = [];
  const caseIds = new Map();
  const methodCounts = {};
  const kindCounts = { positive: 0, negative: 0, unlabeled: 0 };
  const units = new Map();
  const modules = new Map();
  let metadataCases = 0;
  let operationStepsCases = 0;
  let unclassifiedCases = 0;

  for (const { layer, item } of allCases) {
    const name = text(item.name) || '(未命名用例)';
    const caseId = text(item.case_id);
    const system = text(item.system);
    const module = text(item.module);
    const designMethod = text(item.design_method);
    const testUnit = text(item.test_unit);
    const testPoint = text(item.test_point);
    const caseKind = text(item.case_kind);
    const operationSteps = text(item.operation_steps);

    if (operationSteps !== '') operationStepsCases++;

    if (system !== '' && module !== '') {
      const key = system + '|' + module;
      const status = text(item.status) || 'not_run';

      if (!modules.has(key)) {
        modules.set(key, { system, module, total: 0, passed: 0, failed: 0, not_run: 0 });
      }

      const entry = modules.get(key);
      entry.total++;
      if (status === 'passed') entry.passed++;
      else if (status === 'failed') entry.failed++;
      else entry.not_run++;
    } else {
      unclassifiedCases++;
    }

    if (!hasAnyDesignField(item)) {
      continue;
    }

    metadataCases++;

    if (caseId !== '') {
      if (caseIds.has(caseId)) {
        violations.push({ layer, name, reason: `case_id 重复：${caseId}（另一条：${caseIds.get(caseId)}）` });
      } else {
        caseIds.set(caseId, name);
      }
    }

    if (system === '') {
      if (module !== '') {
        violations.push({ layer, name, reason: '提供 module 时缺少 system' });
      } else if (designMethod !== '') {
        violations.push({ layer, name, reason: '提供 design_method 时缺少 system 与 module' });
      }
    } else if (module === '' && designMethod !== '') {
      violations.push({ layer, name, reason: '提供 design_method 时缺少 module' });
    }

    if (designMethod !== '') {
      if (!DESIGN_METHODS.includes(designMethod)) {
        violations.push({ layer, name, reason: `未知设计方法：${designMethod}` });
      } else {
        methodCounts[designMethod] = (methodCounts[designMethod] || 0) + 1;
      }

      if (testPoint === '') {
        violations.push({ layer, name, reason: '提供 design_method 时缺少 test_point' });
      } else if (designMethod !== '' && !testPoint.startsWith(designMethod + '-')) {
        violations.push({ layer, name, reason: `test_point 未以「${designMethod}-」开头：${testPoint}` });
      }

      if (testUnit === '') {
        violations.push({ layer, name, reason: '提供 design_method 时缺少 test_unit' });
      }

      if (operationSteps === '') {
        violations.push({ layer, name, reason: '提供 design_method 时缺少 operation_steps' });
      }
    } else if (testPoint !== '') {
      violations.push({ layer, name, reason: '提供 test_point 时缺少 design_method' });
    }

    if (caseKind !== '') {
      if (!CASE_KINDS.includes(caseKind)) {
        violations.push({ layer, name, reason: `case_kind 只能是 positive / negative：${caseKind}` });
      } else {
        kindCounts[caseKind]++;
      }
    } else {
      kindCounts.unlabeled++;
    }

    if (testUnit !== '') {
      const key = layer + '|' + testUnit;

      if (!units.has(key)) {
        units.set(key, { layer, test_unit: testUnit, total: 0, positive: 0, negative: 0, unlabeled: 0 });
      }

      const unit = units.get(key);
      unit.total++;
      unit[caseKind === 'positive' ? 'positive' : caseKind === 'negative' ? 'negative' : 'unlabeled']++;
    }
  }

  const unitRows = Array.from(units.values());
  const unitsWithoutPositive = unitRows
    .filter((unit) => unit.total > 0 && (unit.positive > 0 || unit.negative > 0) && unit.positive === 0)
    .map((unit) => ({ layer: unit.layer, test_unit: unit.test_unit, total: unit.total, positive: unit.positive, negative: unit.negative }));
  const moduleRows = Array.from(modules.values()).sort((a, b) =>
    a.system.localeCompare(b.system, 'zh-CN') || a.module.localeCompare(b.module, 'zh-CN'));

  return {
    compliant: violations.length === 0,
    total_cases: allCases.length,
    metadata_cases: metadataCases,
    operation_steps_cases: operationStepsCases,
    method_counts: methodCounts,
    case_kind_counts: kindCounts,
    units: unitRows,
    units_without_positive: unitsWithoutPositive,
    modules: moduleRows,
    unclassified_cases: unclassifiedCases,
    violations,
  };
}

module.exports = {
  DESIGN_METHODS,
  CASE_KINDS,
  designAudit,
};
