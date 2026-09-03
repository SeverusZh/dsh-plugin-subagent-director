/**
 * Tool-set picker shared by the role editor and the add-role form.
 *
 * A compact row that expands into: a search box, select-all / deselect-all
 * (scoped to the CURRENT filter — tools hidden by the search are never
 * touched), a live "selected / total" count, and a checkbox grid of the
 * filtered tools. Collapsed, it shows the label, the count, and a chevron
 * toggle so a large catalog (hundreds of MCP tools) stays compact.
 */

import { useMemo, useState } from 'react';
import type { SubagentDirectorKey } from './locales.js';
import {
  addToolNames,
  filterToolNames,
  removeToolNames,
  toggleToolName,
} from './toolset-logic.js';
import { fieldLabelStyle, ghostButtonStyle, textInputStyle, token } from './ui.js';

export interface ToolSetPickerProps {
  /** All model-visible tool names (the catalog). */
  tools: readonly string[];
  /** Currently selected (allow-list) tool names. */
  selected: readonly string[];
  /** Commit the new allow list. */
  onChange: (allow: string[]) => void;
  /** Section copy; may accept interpolation params. */
  t: (key: SubagentDirectorKey, params?: Record<string, string | number>) => string;
}

const style: { [key: string]: React.CSSProperties } = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  count: {
    color: token.labelTertiary,
    fontSize: 11,
    lineHeight: '16px',
  },
  search: {
    ...textInputStyle,
    height: 26,
    fontSize: 12,
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 260,
    overflowY: 'auto',
    border: '1px solid ' + token.border,
    borderRadius: 6,
    padding: '6px 8px',
    background: token.bgLayer1,
  },
  item: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: token.labelSecondary,
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 4,
  },
  hint: {
    color: token.labelTertiary,
    fontSize: 11,
    lineHeight: '15px',
  },
  toggle: {
    ...ghostButtonStyle,
    height: 24,
    fontSize: 12,
    padding: '0 8px',
  },
};

/** Render the searchable, select-all capable tool-set picker. */
export function ToolSetPicker({ tools, selected, onChange, t }: ToolSetPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(true);

  const filtered = useMemo(() => filterToolNames(tools, query), [tools, query]);
  const filteredSet = useMemo(() => new Set(filtered), [filtered]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((name) => selected.includes(name));

  if (tools.length === 0) {
    return (
      <div style={style.root}>
        <label style={fieldLabelStyle}>{t('toolFilter')}</label>
        <span style={style.hint}>{t('toolFilterEmpty')}</span>
      </div>
    );
  }

  return (
    <div style={style.root}>
      <div style={style.head}>
        <label style={fieldLabelStyle}>{t('toolFilter')}</label>
        <span style={style.count}>
          {t('toolFilterCount', { count: selected.length, total: tools.length })}
        </span>
        <button type="button" style={style.toggle} onClick={() => setOpen((o) => !o)}>
          {open ? t('toolFilterCollapse') : t('toolFilterExpand')}
        </button>
      </div>
      {open ? (
        <>
          <input
            style={style.search}
            value={query}
            placeholder={t('toolFilterSearch')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              style={ghostButtonStyle}
              disabled={filtered.length === 0 || allFilteredSelected}
              onClick={() => onChange(addToolNames(selected, filtered))}
            >
              {t('toolFilterSelectAll')}
            </button>
            <button
              type="button"
              style={ghostButtonStyle}
              disabled={filtered.length === 0 || !filtered.some((name) => selected.includes(name))}
              onClick={() => onChange(removeToolNames(selected, filtered))}
            >
              {t('toolFilterDeselectAll')}
            </button>
          </div>
          {filtered.length === 0 ? (
            <span style={style.hint}>{t('toolFilterNoMatch')}</span>
          ) : (
            <div style={style.grid}>
              {filtered.map((name) => (
                <label key={name} style={style.item}>
                  <input
                    type="checkbox"
                    checked={selected.includes(name)}
                    onChange={() => onChange(toggleToolName(selected, name))}
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
        </>
      ) : null}
      <span style={style.hint}>
        {selected.length === 0 ? t('toolFilterNone') : t('toolFilterHint')}
      </span>
    </div>
  );
}
