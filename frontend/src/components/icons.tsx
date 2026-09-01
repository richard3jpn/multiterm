import type { JSX } from 'preact';

/**
 * 画面で使う9個だけをinline SVGで持つ（lucide-react 39MB の置き換え）。
 * パスデータは lucide v1.26.0（ISC）から採取。属性も lucide のデフォルトに合わせている。
 */
type IconProps = Omit<JSX.SVGAttributes<SVGSVGElement>, 'children'>;

function Icon({ children, ...props }: IconProps & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const Plus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Icon>
);

export const ChevronDown = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const Settings = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const Columns2 = (props: IconProps) => (
  <Icon {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 3v18" />
  </Icon>
);

export const Rows2 = (props: IconProps) => (
  <Icon {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 12h18" />
  </Icon>
);

export const X = (props: IconProps) => (
  <Icon {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);

export const Moon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
  </Icon>
);

export const Sun = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </Icon>
);

export const TerminalSquare = (props: IconProps) => (
  <Icon {...props}>
    <path d="m7 11 2-2-2-2" />
    <path d="M11 13h4" />
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  </Icon>
);

/** サイドバーの開閉。枠＋左寄りの縦線でサイドバーを表す（自作） */
export const PanelLeft = (props: IconProps) => (
  <Icon {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </Icon>
);
