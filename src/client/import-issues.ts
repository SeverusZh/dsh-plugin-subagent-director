/**
 * Localized rendering for structured import issues.
 *
 * The Host attaches a stable `code`, the offending `field`, the `path`, and
 * interpolation `params`; its `message` is English technical text and must
 * never reach the panel. Unknown codes fall back to one localized sentence so
 * a newer Host can still be understood.
 */
import type { SubagentDirectorKey } from './locales.js';
import { withReplacement } from './text.js';

/** The issue fields the panel needs; `code` stays a string so unknown codes render a fallback. */
export interface ImportIssueView {
  index: number;
  code: string;
  id?: string;
  field?: string;
  path?: Array<string | number>;
  params?: Readonly<Record<string, string | number>>;
}

/** Zod issue codes the Host forwards as `params.reason`, mapped to page copy. */
const FIELD_REASONS: Record<string, SubagentDirectorKey> = {
  too_small: 'importReasonTooSmall',
  too_big: 'importReasonTooBig',
  invalid_type: 'importReasonType',
  invalid_format: 'importReasonFormat',
  invalid_string: 'importReasonFormat',
  invalid_value: 'importReasonValue',
  invalid_union: 'importReasonShape',
  unrecognized_keys: 'importReasonUnknownKeys',
};

function reasonText(t: (key: SubagentDirectorKey) => string, issue: ImportIssueView): string {
  const reason = issue.params?.reason;
  if (typeof reason !== 'string') return t('importReasonUnknown');
  const key = FIELD_REASONS[reason];
  return key === undefined ? t('importReasonUnknown') : t(key);
}

function issueBody(t: (key: SubagentDirectorKey) => string, issue: ImportIssueView): string {
  switch (issue.code) {
    case 'not-an-object':
      return t('importIssueNotObject');
    case 'unsupported-format-version':
      return withReplacement(t('importIssueFormatVersion'), {
        version: issue.params?.version ?? '-',
        maxVersion: issue.params?.maxVersion ?? '-',
      });
    case 'missing-cards-array':
      return t('importIssueMissingCards');
    case 'missing-card-object':
      return t('importIssueMissingCard');
    case 'too-many-cards':
      return withReplacement(t('importIssueTooManyCards'), {
        count: issue.params?.count ?? '-',
        max: issue.params?.max ?? '-',
      });
    case 'invalid-field': {
      const reason = reasonText(t, issue);
      return issue.field === undefined
        ? withReplacement(t('importIssueInvalidFieldGeneric'), { reason })
        : withReplacement(t('importIssueInvalidField'), { field: issue.field, reason });
    }
    case 'invalid-card-id':
      return t('importIssueInvalidCardId');
    case 'reserved-card-id':
      return t('importIssueReservedCardId');
    case 'reserved-card-source':
      return t('importIssueReservedCardSource');
    default:
      return t('importIssueUnknown');
  }
}

/**
 * Render one issue as a single localized line: position or id, the localized
 * problem, then the structured path when the Host supplied one.
 */
export function formatImportIssue(
  t: (key: SubagentDirectorKey) => string,
  issue: ImportIssueView,
): string {
  const parts: string[] = [];
  parts.push(issue.id !== undefined && issue.id !== '' ? issue.id : '#' + String(issue.index + 1));
  parts.push(issueBody(t, issue));
  if (issue.path !== undefined && issue.path.length > 0) {
    parts.push(withReplacement(t('importIssuePath'), { path: issue.path.join('.') }));
  }
  return parts.join(' · ');
}
