/**
 * dsh-plugin-subagent-director 消融探针（ablation/probe.mjs）
 *
 * 用法：node ablation/probe.mjs <variant-id>   （M1..M8）
 *
 * 对每个变体在真实 Cordis Context 上挂载插件主条目（lib/index.js，code 变体
 * 假设 patch 已应用），断言：
 *   - loadOk：apply 不抛错；
 *   - 负向（ablationEffective）：被消融模块的功能确实消失；
 *   - 正向（corePass）：保留模块的核心功能仍可用。
 * M7/M8 为静态验证变体（bridge-entry 独立条目 / client 独立构建），无 patch。
 *
 * 输出：单行 JSON { variant, loadOk, checks, pass, note }。
 */
import { Context } from '@deepseek-ai/cordis';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { name as pluginName, inject as pluginInject, apply } from '../lib/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** Let cordis fiber loads / reactivations settle (they resolve in microtasks). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/* ------------------------------------------------------------------ *
 * Stubs（与 test/alpha4-probe.test.ts 同构）
 * ------------------------------------------------------------------ */

function settingsStub(selection) {
  const store = new Map();
  store.set('subagent-director', {});
  if (selection !== undefined) store.set('subagent-model-selection', selection);
  const registered = [];
  const scope = (ns) => ({
    get: () => store.get(ns),
    watch: () => () => {},
    update: async () => {},
    replace: async () => {},
  });
  return {
    store,
    registered,
    register(ns, _schema, _opts) {
      registered.push(ns);
      return scope(ns);
    },
    installSection(_owner, ns, _schema, entry, hooks) {
      registered.push(ns);
      if (!store.has(ns)) store.set(ns, entry);
      hooks.setSource(() => store.get(ns));
      hooks.onChange();
    },
    get(ns) {
      return store.get(ns);
    },
    describe: () => [],
    mutate: async () => {},
    update: async () => {},
    replace: async () => {},
  };
}

function subagentsStub() {
  const calls = [];
  const provider = { name: 'spawn', capabilities: { persona: true, toolFilter: true, depthLimit: true } };
  const start = async (name, request) => {
    calls.push({ name, request });
    return {
      id: 'run-1',
      result: Promise.resolve({ stopReason: 'completed', output: [] }),
      dispose: async () => {},
    };
  };
  return {
    calls,
    provider,
    start,
    startContinuable: async () => ({ childId: 'child-1' }),
    getProvider: () => provider,
    drainContinuableChildren: async () => {},
  };
}

function captureTools() {
  const defs = [];
  return {
    defs,
    register: (def) => {
      defs.push(def);
      return () => {};
    },
  };
}

/** The bare ToolRunContext-shaped execution object for direct execute calls. */
function execContext() {
  return { agent: { name: 'parent', options: {} }, signal: new AbortController().signal };
}

/** Mount the plugin entry on a real Context with the stub services. */
async function mount(ctx, opts = {}) {
  const tools = captureTools();
  const settings = settingsStub(opts.selection);
  const subagents = subagentsStub();
  const sections = [];
  const commands = [];
  ctx.provide('tools', { register: tools.register });
  ctx.provide('subagents', subagents);
  ctx.provide('llm', { listProviders: () => [{ id: 'cli' }, { id: 'rogue' }] });
  ctx.provide('settings', settings);
  if (opts.systemPrompt) {
    ctx.provide('systemPrompt', {
      section: (def) => {
        sections.push(def);
        return () => {};
      },
    });
  }
  if (opts.commands) {
    ctx.provide('commands', {
      register: (def) => {
        commands.push(def);
        return () => {};
      },
    });
  }
  await ctx.plugin({ name: pluginName, inject: pluginInject, apply }, {});
  await settle();
  return { tools, settings, subagents, sections, commands };
}

/* ------------------------------------------------------------------ *
 * 静态检查辅助
 * ------------------------------------------------------------------ */

function readSource(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/* ------------------------------------------------------------------ *
 * 变体矩阵
 * ------------------------------------------------------------------ */

const VARIANTS = {
  M1: {
    note: '移除 delegation 工具注册（mount 中 createDelegationTool）→ subagent_role 未注册，close_subagent 保留',
    setup: {},
    async run(ctx, s) {
      const checks = {};
      checks['subagent_role-absent'] = s.tools.defs.some((d) => d.name === 'subagent_role')
        ? 'FAIL: subagent_role 仍被注册（消融未生效）'
        : 'ok';
      checks['close_subagent-present'] = s.tools.defs.some((d) => d.name === 'close_subagent')
        ? 'ok'
        : 'FAIL: close_subagent 缺失（保留模块被破坏）';
      return checks;
    },
  },
  M2: {
    note: '移除 close_subagent 工具注册 → close_subagent 未注册，subagent_role 保留',
    setup: {},
    async run(ctx, s) {
      const checks = {};
      checks['close_subagent-absent'] = s.tools.defs.some((d) => d.name === 'close_subagent')
        ? 'FAIL: close_subagent 仍被注册（消融未生效）'
        : 'ok';
      checks['subagent_role-present'] = s.tools.defs.some((d) => d.name === 'subagent_role')
        ? 'ok'
        : 'FAIL: subagent_role 缺失（保留模块被破坏）';
      return checks;
    },
  },
  M3: {
    note: '移除 applyGuidance 调用 → roles 指引 section 未注册，工具保留',
    setup: { systemPrompt: true },
    async run(ctx, s) {
      const checks = {};
      checks['roles-section-absent'] = s.sections.some((sec) => sec.name === 'subagent-director:roles')
        ? 'FAIL: roles 指引 section 仍被注册（消融未生效）'
        : 'ok';
      checks['subagent_role-present'] = s.tools.defs.some((d) => d.name === 'subagent_role')
        ? 'ok'
        : 'FAIL: subagent_role 缺失（保留模块被破坏）';
      checks['close_subagent-present'] = s.tools.defs.some((d) => d.name === 'close_subagent')
        ? 'ok'
        : 'FAIL: close_subagent 缺失（保留模块被破坏）';
      return checks;
    },
  },
  M4: {
    note: '移除 applyOrchestrate 调用 → /orchestrate 命令未注册，工具保留',
    setup: { commands: true },
    async run(ctx, s) {
      const checks = {};
      checks['orchestrate-command-absent'] = s.commands.some((c) => c.name === 'orchestrate')
        ? 'FAIL: /orchestrate 命令仍被注册（消融未生效）'
        : 'ok';
      checks['subagent_role-present'] = s.tools.defs.some((d) => d.name === 'subagent_role')
        ? 'ok'
        : 'FAIL: subagent_role 缺失（保留模块被破坏）';
      checks['close_subagent-present'] = s.tools.defs.some((d) => d.name === 'close_subagent')
        ? 'ok'
        : 'FAIL: close_subagent 缺失（保留模块被破坏）';
      return checks;
    },
  },
  M5: {
    note: '移除 createSettingsSnapshot/installDirectorSettings → settings 命名空间未注册；工具注册保留但 delegation execute 级联失败（getSettings 未定义）',
    setup: {},
    async run(ctx, s) {
      const checks = {};
      checks['settings-ns-absent'] = s.settings.registered.includes('subagent-director')
        ? 'FAIL: settings 命名空间仍被注册（消融未生效）'
        : 'ok';
      checks['subagent_role-present'] = s.tools.defs.some((d) => d.name === 'subagent_role')
        ? 'ok'
        : 'FAIL: subagent_role 缺失（保留模块被破坏）';
      checks['close_subagent-present'] = s.tools.defs.some((d) => d.name === 'close_subagent')
        ? 'ok'
        : 'FAIL: close_subagent 缺失（保留模块被破坏）';
      // 级联记录：delegation execute 依赖 getSettings，消融后应抛错（文档化依赖）。
      const tool = s.tools.defs.find((d) => d.name === 'subagent_role');
      try {
        await tool.execute({ description: 'probe', prompt: 'p' }, execContext());
        checks['delegation-execute-cascade'] = 'FAIL: delegation execute 未抛错（预期级联失败）';
      } catch (err) {
        checks['delegation-execute-cascade'] = 'ok (cascade: ' + String(err?.message ?? err).slice(0, 80) + ')';
      }
      return checks;
    },
  },
  M6: {
    note: '移除 delegation-tool 内 resolveRoute 使用 → 路由解析消失（agentOptions 不再透传、授权列表约束失效），工具本身可用',
    setup: { selection: { enabled: true, allowedModels: [{ provider: 'cli', model: 'claude' }] } },
    async run(ctx, s) {
      const checks = {};
      const tool = s.tools.defs.find((d) => d.name === 'subagent_role');
      if (!tool) {
        checks['subagent_role-present'] = 'FAIL: subagent_role 缺失';
        return checks;
      }
      checks['subagent_role-present'] = 'ok';
      // 负向：显式 cli/claude（在授权列表内）不再解析为 agentOptions。
      const result = await tool.execute(
        { description: 'probe', prompt: 'p', provider: 'cli', model: 'claude' },
        execContext(),
      );
      const request = s.subagents.calls[0]?.request;
      checks['route-resolution-gone'] = request?.agentOptions === undefined
        ? 'ok'
        : 'FAIL: agentOptions 仍被透传 ' + JSON.stringify(request?.agentOptions);
      checks['delegation-execute-works'] = result?.kind === 'foreground' && result?.runId === 'run-1'
        ? 'ok'
        : 'FAIL: delegation execute 结果异常 ' + JSON.stringify(result);
      checks['close_subagent-present'] = s.tools.defs.some((d) => d.name === 'close_subagent')
        ? 'ok'
        : 'FAIL: close_subagent 缺失';
      // 独立性静态检查：route-resolver 不依赖主条目。
      const rr = readSource('lib/route-resolver.js');
      checks['route-resolver-independent'] = /from\s*['"][^'"]*index\.js['"]/.test(rr)
        ? 'FAIL: route-resolver 引用了主条目'
        : 'ok';
      return checks;
    },
  },
  M7: {
    note: 'bridge-entry 是独立插件条目（不 import 主条目），消融=不挂载该条目；主条目无 webServer 依赖',
    setup: {},
    async run(ctx, s) {
      const checks = {};
      const bridge = readSource('lib/bridge-entry.js');
      const main = readSource('lib/index.js');
      checks['bridge-entry-independent'] = /from\s*['"][^'"]*index\.js['"]/.test(bridge)
        ? 'FAIL: bridge-entry 引用了主条目'
        : 'ok';
      checks['main-entry-no-bridge'] = /import\s+[^;]*bridge-entry/.test(main)
        ? 'FAIL: 主条目引用了 bridge-entry'
        : 'ok';
      checks['bridge-entry-exports'] =
        bridge.includes("name = 'subagent-director-bridge'") &&
        bridge.includes("'webServer'") &&
        bridge.includes("'settings'")
          ? 'ok'
          : 'FAIL: bridge-entry 导出不符合独立条目形态';
      checks['main-entry-no-webServer'] = /ctx\.(get\(['"]webServer['"]\)|webServer)/.test(main)
        ? 'FAIL: 主条目代码使用了 webServer'
        : 'ok';
      checks['subagent_role-present'] = s.tools.defs.some((d) => d.name === 'subagent_role')
        ? 'ok'
        : 'FAIL: subagent_role 缺失';
      checks['close_subagent-present'] = s.tools.defs.some((d) => d.name === 'close_subagent')
        ? 'ok'
        : 'FAIL: close_subagent 缺失';
      return checks;
    },
  },
  M8: {
    note: 'client 为独立构建产物（scripts/build-client.mjs），主条目不依赖 client；浏览器 bundle 在 Node 中不可加载',
    setup: {},
    async run(ctx, s) {
      const checks = {};
      const main = readSource('lib/index.js');
      checks['main-entry-no-client-import'] = /import\s+[^;]*['"][^'"]*client/.test(main)
        ? 'FAIL: 主条目引用了 client 产物'
        : 'ok';
      const buildScript = readSource('scripts/build-client.mjs');
      checks['client-built-separately'] =
        buildScript.includes('src/client/index.ts') && buildScript.includes('lib/client/index.js')
          ? 'ok'
          : 'FAIL: build-client.mjs 未独立构建 client';
      try {
        await import(pathToFileURL(path.join(root, 'lib/client/index.js')).href);
        checks['client-bundle-browser-only'] = 'FAIL: client bundle 在 Node 中可加载（非浏览器产物）';
      } catch (err) {
        checks['client-bundle-browser-only'] = 'ok (browser-only: ' + String(err?.name ?? err).slice(0, 40) + ')';
      }
      checks['subagent_role-present'] = s.tools.defs.some((d) => d.name === 'subagent_role')
        ? 'ok'
        : 'FAIL: subagent_role 缺失';
      checks['close_subagent-present'] = s.tools.defs.some((d) => d.name === 'close_subagent')
        ? 'ok'
        : 'FAIL: close_subagent 缺失';
      return checks;
    },
  },
};

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

const variantId = process.argv[2];
if (!variantId || !VARIANTS[variantId]) {
  console.error('usage: node ablation/probe.mjs <variant-id>');
  console.error('variants: ' + Object.keys(VARIANTS).join(', '));
  process.exit(2);
}

const variant = VARIANTS[variantId];
const result = { variant: variantId, loadOk: false, checks: {}, pass: false, note: variant.note };

let ctx;
let stubs;
try {
  ctx = new Context();
  stubs = await mount(ctx, variant.setup);
  result.loadOk = true;
} catch (err) {
  result.checks.load = 'FAIL: ' + String(err?.message ?? err);
  console.log(JSON.stringify(result));
  process.exit(0);
}

try {
  result.checks = await variant.run(ctx, stubs);
} catch (err) {
  result.checks.scenario = 'FAIL: ' + String(err?.message ?? err);
}

await ctx.dispose?.();
result.pass = Object.values(result.checks).every((v) => v === 'ok' || v.startsWith('ok'));
console.log(JSON.stringify(result));
