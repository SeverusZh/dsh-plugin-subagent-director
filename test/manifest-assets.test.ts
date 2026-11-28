/**
 * Plugin manifest assets: the icon the Host embeds and the package entries that
 * expose it. Structure assertions mirror the Host reader
 * (dsh-app-boot/src/package-meta.ts): `icon` is a relative path for the package
 * root, subpath entries such as `/bridge` read `<specifier>/icon`, locale files
 * are read through `<specifier>/locale/*.json`, and an icon must stay inside its
 * package and under 256 KiB.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const icon = readFileSync(join(ROOT, 'icon.svg'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  icon?: string;
  files?: string[];
  exports?: Record<string, unknown>;
};

describe('plugin icon asset', () => {
  it('is a 36x36 transparent monochrome SVG with no text, backdrop, style, or animation', () => {
    expect(Buffer.byteLength(icon, 'utf8')).toBeLessThan(256 * 1024);
    expect(icon).toMatch(/<svg\b[^>]*\bwidth="36"[^>]*\bheight="36"/);
    expect(icon).toMatch(/viewBox="0 0 36 36"/);
    expect(icon).not.toMatch(/<text|<style|<script|<foreignObject|<animate|<set\b|<image|@keyframes/i);
    expect(icon).not.toMatch(/<rect/i);
    expect(icon).not.toMatch(/\bfill="(?!none")/);
    const strokes = [...icon.matchAll(/\bstroke="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(strokes).size).toBe(1);
    expect(strokes[0]).not.toBe('none');
    expect((icon.match(/<circle/g) ?? []).length).toBe(4);
    expect(icon).toMatch(/<path\b/);
  });

  it('is declared, exported, and packed for the package root and the bridge entry', () => {
    expect(pkg.icon).toBe('./icon.svg');
    expect(pkg.files).toContain('icon.svg');
    expect(pkg.files).toContain('locale/*.json');
    expect(pkg.exports?.['./icon']).toBe('./icon.svg');
    expect(pkg.exports?.['./locale/*.json']).toBe('./locale/*.json');
    expect(pkg.exports?.['./bridge/icon']).toBe('./icon.svg');
    expect(pkg.exports?.['./bridge/locale/*.json']).toBe('./locale/*.json');
  });

  it('resolves the icon and locale resources through the package exports', () => {
    const require = createRequire(import.meta.url);
    expect(require.resolve(pkg.name + '/icon')).toBe(join(ROOT, 'icon.svg'));
    expect(require.resolve(pkg.name + '/bridge/icon')).toBe(join(ROOT, 'icon.svg'));
    expect(require.resolve(pkg.name + '/locale/zh.json')).toBe(join(ROOT, 'locale/zh.json'));
    expect(require.resolve(pkg.name + '/bridge/locale/en.json')).toBe(join(ROOT, 'locale/en.json'));
  });
});

const HOST_ROOT = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules';
const HOST_APP_BOOT = join(HOST_ROOT, '@deepseek-ai/dsh-app-boot/lib/index.js');
const HOST_LOADER = join(HOST_ROOT, '@deepseek-ai/cordis-plugin-loader/lib/index.js');
const HOST_AVAILABLE = existsSync(HOST_APP_BOOT) && existsSync(HOST_LOADER);

describe.skipIf(!HOST_AVAILABLE)('host plugin-meta reader', () => {
  it('resolves the localized title, description, and icon of the main and bridge entries', async () => {
    const loader = (await import(/* @vite-ignore */ pathToFileURL(HOST_LOADER).href)) as {
      ModuleLoader: { fromInternal: unknown };
    };
    const host = (await import(/* @vite-ignore */ pathToFileURL(HOST_APP_BOOT).href)) as {
      readPluginMeta(specifier: string, parentURL: string):
        | { title?: Record<string, string>; description?: Record<string, string>; icon?: string; error?: string }
        | undefined;
    };
    const targets: Record<string, string> = {
      'dsh-plugin-subagent-director/locale/en.json': join(ROOT, 'locale/en.json'),
      'dsh-plugin-subagent-director/locale/zh.json': join(ROOT, 'locale/zh.json'),
      'dsh-plugin-subagent-director/package.json': join(ROOT, 'package.json'),
      'dsh-plugin-subagent-director/bridge/locale/en.json': join(ROOT, 'locale/en.json'),
      'dsh-plugin-subagent-director/bridge/locale/zh.json': join(ROOT, 'locale/zh.json'),
      'dsh-plugin-subagent-director/bridge/icon': join(ROOT, 'icon.svg'),
    };
    const original = loader.ModuleLoader.fromInternal;
    loader.ModuleLoader.fromInternal = () => ({
      version: 'v2',
      resolveSync(_parentURL: string, options: { specifier: string }): { url: string } {
        const target = targets[options.specifier];
        if (target === undefined) {
          const error = new Error('unmapped plugin resource ' + options.specifier) as Error & { code: string };
          error.code = 'ERR_MODULE_NOT_FOUND';
          throw error;
        }
        return { url: pathToFileURL(target).href };
      },
    });
    try {
      const parentURL = pathToFileURL(join(ROOT, 'package.json')).href;
      const main = host.readPluginMeta(pkg.name, parentURL);
      expect(main?.error).toBeUndefined();
      expect(main?.title).toMatchObject({ en: 'Subagent Director', zh: '子代理导演' });
      expect(main?.description?.zh).toContain('角色卡');
      expect(main?.icon).toMatch(/^data:image\/svg\+xml;base64,/);
      const decoded = Buffer.from((main?.icon ?? '').split(',')[1] ?? '', 'base64').toString('utf8');
      expect(decoded).toBe(icon);

      const bridge = host.readPluginMeta(pkg.name + '/bridge', parentURL);
      expect(bridge?.error).toBeUndefined();
      expect(bridge?.title?.zh).toBe('子代理导演');
      expect(bridge?.description?.zh).toContain('角色卡');
      expect(bridge?.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    } finally {
      loader.ModuleLoader.fromInternal = original;
    }
  });
});
