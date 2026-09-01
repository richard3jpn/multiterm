import type { JSX } from 'preact';

/** 画面で実際に使っているバリアントだけを持つ（shadcn/ui + cva + radix Slot の置き換え） */
type Variant = 'default' | 'outline' | 'ghost';
type Size = 'sm' | 'icon' | 'icon-sm';

const BASE =
  'inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0';

const VARIANTS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/80',
  outline:
    'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
  ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:hover:bg-muted/50',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1 px-2.5 text-[0.8rem] [&_svg]:size-3.5',
  icon: 'size-8 [&_svg]:size-4',
  'icon-sm': 'size-7 [&_svg]:size-3.5',
};

type ButtonProps = JSX.IntrinsicElements['button'] & {
  readonly variant?: Variant;
  readonly size?: Size;
};

export function Button({
  variant = 'default',
  size = 'sm',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...props} />;
}
