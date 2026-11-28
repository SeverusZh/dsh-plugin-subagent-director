/**
 * Cross-entry integration probe: the main entry provides the card service, the
 * separate bridge entry resolves it at request time, and a real Cordis context
 * carries both. This is the production composition that unit stubs cannot
 * prove: service visibility, bridge dependency resolution, and a card-list RPC
 * response in one path.
 */
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { createMemoryDomain } from './card-fixtures.js';
import { name as pluginName, inject as pluginInject, apply, Config } from '../src/index.js';
import { name as bridgeName, inject as bridgeInject, apply as bridgeApply, Config as BridgeConfig } from '../src/bridge-entry.js';
import type { CardService } from '../src/card-store.js';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

function callRoute(route: { handler: (req: unknown, res: ServerResponse) => void | Promise<void> }, url: string, body: unknown): Promise<{ code: number; body: string }> {
  const request = new EventEmitter() as unknown as {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  request.method = 'POST';
  request.url = url;
  request.headers = { 'content-type': 'application/json', host: '127.0.0.1:3090' };
  const response = { code: 200, body: '' };
  const res = {
    writeHead: (code: number) => { response.code = code; },
    end: (chunk?: unknown) => { if (chunk !== undefined) response.body += String(chunk); },
    headersSent: false,
    destroy: () => {},
  } as unknown as ServerResponse;
  const promise = Promise.resolve(route.handler(request, res));
  setImmediate(() => {
    (request as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(body), 'utf8'));
    (request as unknown as EventEmitter).emit('end');
  });
  return promise.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return response;
  });
}

describe('bridge + main entry integration', () => {
  it('resolves the card service across entries and answers cardList', async () => {
    const ctx = new Context();
    const memory = createMemoryDomain();
    let route: { handler: (req: unknown, res: ServerResponse) => void | Promise<void> } | undefined;

    const provider = {
      name: 'spawn',
      capabilities: { agentOptions: true, agentPreset: true, outputSchema: false, depthLimit: true },
      inheritsParentContext: false,
      prepareContinuable: async () => ({}),
    };
    ctx.provide('storageDomain', memory.facility as never);
    ctx.provide('tools', { register: () => () => {}, include: () => () => {} });
    ctx.provide('subagents', {
      getProvider: (name: string) => (name === 'spawn' ? provider : undefined),
      startActivation: async () => ({ childId: 'generated', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose: async () => {} }),
    } as never);
    ctx.provide('llm', { listProviders: () => [{ id: 'p' }] });
    ctx.provide('settings', {
      configure: () => () => {},
      describe: () => [],
      mutate: async () => {},
    } as never);
    ctx.provide('webServer', {
      register: (value: typeof route) => {
        route = value;
        return () => {};
      },
    } as never);
    ctx.provide('agents', { get: () => undefined } as never);

    void ctx.plugin({ name: pluginName, inject: pluginInject, apply, Config }, {});
    await settle();
    const cards = (ctx as unknown as { get(name: string): unknown }).get('subagentDirectorCards') as CardService;
    expect(cards).toBeDefined();
    await cards.ready();
    await cards.put(
      { id: 'bridge-card', name: 'Bridge Card', delegationGuidance: 'Bridge guideline.', systemPrompt: 'Bridge prompt.' },
      { create: true },
    );

    void ctx.plugin({ name: bridgeName, inject: bridgeInject, apply: bridgeApply, Config: BridgeConfig }, {});
    await settle();
    expect(route).toBeDefined();

    const response = await callRoute(route!, '/subagent-director/cardList', {
      type: 'client-request',
      rpcId: 'bridge-cards-1',
      method: 'cardList',
      payload: {},
    });
    expect(response.code).toBe(200);
    const parsed = JSON.parse(response.body) as {
      result: { ok: boolean; value?: { cards: Array<{ id: string }> } };
    };
    expect(parsed.result.ok).toBe(true);
    expect(parsed.result.value?.cards.map((card) => card.id)).toContain('bridge-card');
  });
});
