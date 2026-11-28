/**
 * Import dialog localization: every structured issue code renders page copy,
 * unknown codes fall back, and file read failures never surface browser text.
 * The technical host `message` is carried by the wire but must not render.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardImportIssue } from '../src/card-types.js';
import { ImportFailure, ImportIssues, readImportFiles } from '../src/client/ImportDialog.js';
import { formatImportIssue, type ImportIssueView } from '../src/client/import-issues.js';
import { en } from '../src/client/locales.js';

const t = (key: keyof typeof en): string => en[key];

function issue(overrides: Partial<ImportIssueView> & { code: string }): ImportIssueView {
  return { index: 0, ...overrides };
}

describe('import issue formatter', () => {
  it('localizes every structured code and keeps position and path', () => {
    const cases: Array<[ImportIssueView, string]> = [
      [issue({ code: 'not-an-object', index: 1 }), 'Not a JSON object.'],
      [issue({ code: 'unsupported-format-version', path: ['version'], params: { version: 3, maxVersion: 2 } }), 'Format version 3 is not supported; the maximum is 2.'],
      [issue({ code: 'missing-cards-array', path: ['cards'] }), 'The collection envelope has no cards array.'],
      [issue({ code: 'missing-card-object', path: ['card'] }), 'The card envelope has no card object.'],
      [issue({ code: 'too-many-cards', params: { count: 501, max: 500 } }), '501 cards exceed the import limit of 500.'],
      [issue({ code: 'invalid-field', field: 'name', params: { reason: 'too_small' } }), 'The name field is invalid: too short or empty.'],
      [issue({ code: 'invalid-field', field: 'model', params: { reason: 'something-new' } }), 'The model field is invalid: the value is not valid.'],
      [issue({ code: 'invalid-field', params: { reason: 'invalid_type' } }), 'The card content is invalid: wrong type.'],
      [issue({ code: 'invalid-card-id', id: 'Bad Id' }), 'The card id is invalid.'],
      [issue({ code: 'reserved-card-id', id: 'director' }), 'This id is reserved for the built-in Director card.'],
      [issue({ code: 'reserved-card-source' }), 'The source cannot be builtin; it is reserved for code-defined cards.'],
    ];
    for (const [value, text] of cases) {
      expect(formatImportIssue(t, value)).toContain(text);
    }
    expect(formatImportIssue(t, issue({
      code: 'invalid-field',
      field: 'model',
      path: ['model', 'provider'],
      params: { reason: 'too_big' },
    }))).toContain('path: model.provider');
  });

  it('falls back for unknown codes and prefers the card id over the index', () => {
    const rendered = formatImportIssue(t, issue({ code: 'future-code', id: 'alpha' }));
    expect(rendered).toContain('alpha');
    expect(rendered).toContain('This entry could not be imported; check its content and format.');
    expect(formatImportIssue(t, issue({ code: 'future-code', index: 4 }))).toContain('#5');
  });

  it('never renders a host message passed alongside a known code', () => {
    const withMessage = {
      ...issue({ code: 'reserved-card-source' }),
      message: 'Host runtime says this field is reserved.',
    } as ImportIssueView & { message: string };
    expect(formatImportIssue(t, withMessage)).not.toContain('Host runtime');
  });
});

describe('import issue list', () => {
  it('renders localized known-code rows, the issue count, and no host message', () => {
    const issues = [
      { index: 0, code: 'unsupported-format-version', path: ['version'], params: { version: 9, maxVersion: 2 }, message: 'Unsupported card format version 9.' },
      { index: 1, code: 'invalid-field', field: 'name', path: ['name'], params: { reason: 'too_small' }, message: 'name: Too small' },
    ] as unknown as CardImportIssue[];
    const html = renderToStaticMarkup(createElement(ImportIssues, { issues, t }));
    expect(html).toContain('2 issues');
    expect(html).toContain('Format version 9 is not supported; the maximum is 2.');
    expect(html).toContain('The name field is invalid: too short or empty.');
    expect(html).toContain('path: version');
    expect(html).not.toContain('Unsupported card format version');
    expect(html).not.toContain('Too small');
  });

  it('falls back to one localized sentence for unknown codes', () => {
    const issues = [
      { index: 0, code: 'mystery', message: 'Some future English diagnostic.' },
    ] as unknown as CardImportIssue[];
    const html = renderToStaticMarkup(createElement(ImportIssues, { issues, t }));
    expect(html).toContain('This entry could not be imported; check its content and format.');
    expect(html).not.toContain('Some future English diagnostic.');
  });
});

describe('import file reading', () => {
  const file = (name: string, size: number, text: () => Promise<string>) => ({ name, size, text });

  it('collapses a browser read failure into a localized key', async () => {
    const outcome = await readImportFiles(
      [file('cards.json', 10, async () => { throw new Error('EACCES: permission denied'); })],
      1024,
    );
    expect(outcome).toEqual({ ok: false, failure: 'importReadFailed' });
    if (outcome.ok) throw new Error('expected a failed read');
    const html = renderToStaticMarkup(createElement(ImportFailure, { text: t(outcome.failure) }));
    expect(html).toContain('Could not read the selected file. Try again.');
    expect(html).not.toContain('EACCES');
    expect(html).not.toContain('permission denied');
  });

  it('reads accepted files and rejects oversize input', async () => {
    const ok = await readImportFiles([
      file('a.json', 4, async () => 'A'),
      file('b.json', 5, async () => 'B'),
    ], 1024);
    expect(ok).toEqual({ ok: true, contents: ['A', 'B'], names: ['a.json', 'b.json'] });
    expect(await readImportFiles([file('big.json', 2048, async () => '')], 1024))
      .toEqual({ ok: false, failure: 'importFileTooLarge' });
  });
});
