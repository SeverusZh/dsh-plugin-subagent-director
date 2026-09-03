/**
 * Compatibility guard for the DSH alpha.4/alpha.5 host line.
 *
 * Regression test for the reported bug: the published beta still imported
 * `@deepseek-ai/dsh-client-runtime/client` (7 places). That package is
 * rc-era only — npm's newest is 0.1.1-rc.2 and alpha.4/alpha.5 hosts do not
 * ship it — so the client bundle's runtime `require(...)` fails at load and
 * the whole client half (settings page, model dock, close action) is dead on
 * alpha hosts.
 *
 * The guard scans the client sources and the manifest for any residual
 * reference to the rc-era runtime package. It must stay empty; the alpha
 * equivalents are `@deepseek-ai/dsh-client-store` (store runtime),
 * `@deepseek-ai/dsh-client-ui-conversation` / `@deepseek-ai/dsh-client-ui-chat`
 * (conversation record/view types) and
 * `@deepseek-ai/dsh-api-session-controller` (session snapshot types).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Recursively list files under a directory (no symlink following). */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Every file that must never reference the rc-era client runtime. */
function scannedFiles(): string[] {
  const files = listFiles(join(ROOT, 'src', 'client'));
  files.push(join(ROOT, 'package.json'));
  return files;
}

/** Lines that still reference the rc-era runtime package. */
function offenders(): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const file of scannedFiles()) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes('dsh-client-runtime')) {
        hits.push({ file: relative(ROOT, file), line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return hits;
}

describe('alpha.4/alpha.5 host compatibility', () => {
  it('client sources and manifest never reference the rc-era dsh-client-runtime package', () => {
    const hits = offenders();
    expect(hits).toEqual([]);
  });

  it('the client store imports createSnapshotStore from dsh-client-store (the alpha runtime)', () => {
    const store = readFileSync(join(ROOT, 'src', 'client', 'store.ts'), 'utf8');
    expect(store).toMatch(/from '@deepseek-ai\/dsh-client-store'/);
  });

  it('the client entry types its context as the cordis Context (alpha pattern)', () => {
    const entry = readFileSync(join(ROOT, 'src', 'client', 'index.ts'), 'utf8');
    expect(entry).toMatch(/Context as ClientContext.*@deepseek-ai\/cordis/);
  });
});
