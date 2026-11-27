import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function read(name: string): Record<string, string> {
  return JSON.parse(readFileSync(fileURLToPath(new URL('../locale/' + name + '.json', import.meta.url)), 'utf8')) as Record<string, string>;
}

describe('plugin manifest locale files', () => {
  it('carry a title and description for English and Chinese', () => {
    for (const name of ['en', 'zh']) {
      const copy = read(name);
      expect(copy.title?.trim().length).toBeGreaterThan(0);
      expect(copy.description?.trim().length).toBeGreaterThan(0);
    }
  });

  it('share the same key set so DSH can resolve either locale', () => {
    expect(Object.keys(read('zh')).sort()).toEqual(Object.keys(read('en')).sort());
  });
});
