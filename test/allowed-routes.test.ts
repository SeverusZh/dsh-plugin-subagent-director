/**
 * TDD tests for the allowed-route selection model (alpha.4 client port).
 *
 * The alpha.4 client no longer has a full llm model catalog RPC
 * (connection.api.llm is gone); the settings page picks provider/model ONLY
 * from the routes the user has authorized in the official
 * `subagent-model-selection` section. These tests pin the pure option-building
 * logic that turns that route list into select options.
 */
import { describe, it, expect } from 'vitest';
import {
  allowedRouteLabel,
  buildRouteOptions,
  modelsForProvider,
  providerNames,
  type AllowedRoute,
} from '../src/client/allowed-routes.js';

const LISTED: readonly AllowedRoute[] = [
  { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
  { provider: 'pi-ai', model: 'gpt-5' },
];

describe('allowedRouteLabel', () => {
  it('combines provider and model into one readable route label', () => {
    expect(allowedRouteLabel({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBe(
      'deepseek-official/deepseek-v4-flash',
    );
  });
});

describe('buildRouteOptions', () => {
  it('maps every allowed route to an option with a stable label', () => {
    const options = buildRouteOptions(LISTED);
    expect(options).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', label: 'deepseek-official/deepseek-v4-flash' },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', label: 'deepseek-official/deepseek-v4-pro' },
      { provider: 'pi-ai', model: 'gpt-5', label: 'pi-ai/gpt-5' },
    ]);
  });

  it('deduplicates repeated exact routes', () => {
    expect(buildRouteOptions([...LISTED, { provider: 'pi-ai', model: 'gpt-5' }])).toHaveLength(3);
  });

  it('returns an empty list for an empty allowlist', () => {
    expect(buildRouteOptions([])).toEqual([]);
  });
});

describe('providerNames', () => {
  it('lists unique providers in first-seen order', () => {
    expect(providerNames(LISTED)).toEqual(['deepseek-official', 'pi-ai']);
  });
});

describe('modelsForProvider', () => {
  it('returns only the models of the selected provider', () => {
    const options = modelsForProvider(LISTED, 'deepseek-official');
    expect(options.map((o) => o.model)).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
  });

  it('returns an empty list for an unknown provider', () => {
    expect(modelsForProvider(LISTED, 'anthropic')).toEqual([]);
  });
});
