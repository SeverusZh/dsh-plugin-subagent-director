/**
 * dsh-plugin-subagent-director 消融运行脚本（ablation/run.mjs）
 *
 * 对每个变体：
 *   - code 变体（M1..M6）：git apply patch → 跑探针 → git apply -R 恢复；
 *   - 静态变体（M7/M8）：无 patch，直接跑探针。
 * 结果写入 ablation/results.json，并打印摘要。
 *
 * 注意：本仓库 lib/ 在 .gitignore 中（未跟踪），git checkout 无法恢复，
 * 因此恢复采用 git apply -R + ablation/variants/_pristine/ 原始副本兜底。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const CODE_VARIANTS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
const STATIC_VARIANTS = ['M7', 'M8'];
const ALL = [...CODE_VARIANTS, ...STATIC_VARIANTS];

/** 原始副本（lib/ 未跟踪，git checkout 不可用时的硬恢复来源）。 */
const PRISTINE = {
  'lib/index.js': path.join(here, 'variants', '_pristine', 'index.js'),
  'lib/delegation-tool.js': path.join(here, 'variants', '_pristine', 'delegation-tool.js'),
};

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
}

/** 预检：工作区 lib 文件必须与原始副本一致，避免脏状态污染结果。 */
function preflight() {
  for (const [rel, pri] of Object.entries(PRISTINE)) {
    if (!fs.existsSync(pri)) throw new Error(`pristine copy missing: ${pri}`);
    const target = path.join(root, rel);
    if (!fs.existsSync(target)) throw new Error(`target missing: ${target}`);
    const a = fs.readFileSync(target);
    const b = fs.readFileSync(pri);
    if (!a.equals(b)) {
      throw new Error(`working tree not pristine: ${rel} differs from ablation/variants/_pristine/ — restore it first`);
    }
  }
}

preflight();

const results = [];
for (const variant of ALL) {
  let applied = false;
  try {
    if (CODE_VARIANTS.includes(variant)) {
      run('git', ['apply', path.join('ablation', 'variants', variant + '.patch')]);
      applied = true;
    }
    const out = run('node', ['ablation/probe.mjs', variant]);
    const parsed = JSON.parse(out.trim().split('\n').pop());
    results.push(parsed);
    console.log(`${parsed.pass ? 'PASS' : 'FAIL'} ${variant}: ${parsed.note}`);
    for (const [k, v] of Object.entries(parsed.checks)) {
      if (v !== 'ok') console.log(`      ${k}: ${v}`);
    }
  } catch (err) {
    results.push({
      variant,
      loadOk: false,
      checks: { run: 'FAIL: ' + String(err?.message ?? err) },
      pass: false,
      note: 'run error',
    });
    console.log(`ERROR ${variant}: ${String(err?.message ?? err)}`);
  } finally {
    if (applied) {
      try {
        run('git', ['apply', '-R', path.join('ablation', 'variants', variant + '.patch')]);
      } catch (err) {
        console.warn(`git apply -R failed for ${variant}: ${String(err?.message ?? err)}`);
      }
      // 硬恢复兜底：lib/ 未跟踪，git checkout 不可用。
      for (const [rel, pri] of Object.entries(PRISTINE)) {
        fs.copyFileSync(pri, path.join(root, rel));
      }
    }
  }
}

fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(results, null, 2));
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} variants passed`);
