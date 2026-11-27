/** Small inline icon set for the Subagent Director surfaces, drawn with
 * currentColor and the official focus/contrast conventions. */
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconPlus(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function IconSearch(props: IconProps): JSX.Element {
  return <Icon {...props}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Icon>;
}

export function IconUpload(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 16V4m0 0 4 4m-4-4L8 8" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Icon>;
}

export function IconDownload(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 4v12m0 0 4-4m-4 4-4-4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></Icon>;
}

export function IconStar(props: IconProps & { filled?: boolean }): JSX.Element {
  const { filled, ...rest } = props;
  return (
    <Icon {...rest} fill={filled === true ? 'currentColor' : 'none'}>
      <path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.4l6-.9L12 3Z" />
    </Icon>
  );
}

export function IconMore(props: IconProps): JSX.Element {
  return <Icon {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></Icon>;
}

export function IconEdit(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="m13.5 6.5 3 3" /></Icon>;
}

export function IconTrash(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" /><path d="M10 11v5m4-5v5" /></Icon>;
}

export function IconCopy(props: IconProps): JSX.Element {
  return <Icon {...props}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></Icon>;
}

export function IconCheck(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m5 12 4.5 4.5L19 7" /></Icon>;
}

export function IconX(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

export function IconSpark(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 3v4m0 10v4M3 12h4m10 0h4" /><path d="m5.6 5.6 2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8" /></Icon>;
}

export function IconFolder(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M3 7a1 1 0 0 1 1-1h6l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /></Icon>;
}

export function IconWarning(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5m0 3h.01" /></Icon>;
}

export function IconChevron(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m9 6 6 6-6 6" /></Icon>;
}

export function IconRefresh(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></Icon>;
}

export function IconLayers(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 18 9 5 9-5" /></Icon>;
}

export function IconShield(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 3 4 6v6c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V6l-8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></Icon>;
}
