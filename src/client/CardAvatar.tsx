/** Shared card avatar: the configured glyph, or the name initial as fallback. */
import type { JSX } from 'react';
import { cardAccentOf, cardInitial, type CardAccent } from '../card-types.js';

export interface CardAvatarProps {
  name: string;
  /** Configured avatar glyph; blank falls back to the name initial. */
  emoji?: string;
  accent?: CardAccent;
  /** Identity for the deterministic accent fallback when `accent` is absent. */
  id?: string;
  size?: 'md' | 'lg';
}

/** Render one card avatar with the shared accent and typography. */
export function CardAvatar(props: CardAvatarProps): JSX.Element {
  const { name, emoji, accent, id, size = 'md' } = props;
  const resolved = accent ?? cardAccentOf({ id: id ?? name, accent: undefined });
  const glyph = emoji !== undefined && emoji !== '' ? emoji : cardInitial(name);
  return (
    <div
      className={'sd-card-avatar sd-accent-' + resolved + (size === 'lg' ? ' is-lg' : '')}
      aria-hidden="true"
    >
      {glyph}
    </div>
  );
}
