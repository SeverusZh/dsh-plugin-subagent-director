/**
 * Plugin manifest locale files follow the Host's plugin-meta reader
 * (dsh-app-boot/src/package-meta.ts:137-142): display text lives under `meta`,
 * and every `*.json` in `locale/` is treated as a language dictionary.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOCALE_DIR = fileURLToPath(new URL('../locale/', import.meta.url));

interface LocaleDictionary {
  meta?: { title?: unknown; description?: unknown };
}

function read(name: string): LocaleDictionary {
  return JSON.parse(readFileSync(LOCALE_DIR + name + '.json', 'utf8')) as LocaleDictionary;
}

describe('plugin manifest locale files', () => {
  it('declares display text under meta, the shape the host reads', () => {
    for (const name of ['en', 'zh']) {
      const dictionary = read(name);
      expect(Object.keys(dictionary)).toEqual(['meta']);
      const meta = dictionary.meta;
      expect(meta).toBeTypeOf('object');
      expect((meta?.title as string).trim().length).toBeGreaterThan(0);
      expect((meta?.description as string).trim().length).toBeGreaterThan(0);
    }
    expect((read('zh').meta?.title as string)).toBe('子代理导演');
    expect((read('en').meta?.title as string)).toBe('Subagent Director');
  });

  it('uses language ids as filenames and keeps both dictionaries in sync', () => {
    const files = readdirSync(LOCALE_DIR).filter((name) => name.endsWith('.json')).sort();
    expect(files).toEqual(['en.json', 'zh.json']);
    for (const file of files) {
      expect(file.slice(0, -'.json'.length)).toMatch(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u);
    }
    expect(Object.keys(read('zh').meta ?? {}).sort()).toEqual(Object.keys(read('en').meta ?? {}).sort());
  });
});
