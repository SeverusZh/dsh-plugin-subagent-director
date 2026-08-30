/** Real-Cordis lifecycle coverage for the optional Web bridge entry. */
import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import {
  apply,
  inject,
  name,
} from '../src/bridge-entry.js';
import { SUBAGENT_DIRECTOR_ROUTE_PATH } from '../src/envelope.js';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

function provideBridgeCore(ctx: Context): void {
  ctx.provide('settings', {});
  ctx.provide('agents', {});
  ctx.provide('subagents', {});
}

describe('real cordis probe - optional Web bridge lifecycle', () => {
  it('activates headlessly, then attaches and disposes the route with webServer', async () => {
    const ctx = new Context();
    provideBridgeCore(ctx);

    const entry = ctx.plugin({ name, inject, apply }, {});
    await settle();

    // The loader entry must be ACTIVE even though its optional child fiber is
    // waiting for webServer. A PENDING entry fails headless startup audits.
    expect(entry.store).toBeDefined();
    expect(ctx.get('webServer')).toBeUndefined();

    const routes: unknown[] = [];
    let routeDisposals = 0;
    const removeWebServer = ctx.provide('webServer', {
      register: (route: unknown) => {
        routes.push(route);
        return () => {
          routeDisposals += 1;
        };
      },
    });
    await settle();

    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      kind: 'prefix',
      path: SUBAGENT_DIRECTOR_ROUTE_PATH,
    });

    await removeWebServer();
    await settle();
    expect(routeDisposals).toBe(1);

    await entry.dispose();
  });

  it('cleans up an attached route when the bridge entry unloads', async () => {
    const ctx = new Context();
    provideBridgeCore(ctx);
    let routeDisposals = 0;
    ctx.provide('webServer', {
      register: () => () => {
        routeDisposals += 1;
      },
    });

    const entry = ctx.plugin({ name, inject, apply }, {});
    await settle();
    expect(entry.store).toBeDefined();

    await entry.dispose();
    expect(routeDisposals).toBe(1);
  });
});
