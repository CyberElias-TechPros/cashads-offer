'use client';

import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './feedback';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'dark' | 'link';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-150 select-none disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 dark:bg-brand-500 dark:text-brand-950 dark:hover:bg-brand-400',
  secondary: 'bg-surface text-fg border border-line shadow-sm hover:bg-surface-2 hover:border-line-strong',
  ghost: 'text-fg hover:bg-surface-3',
  outline: 'border border-brand-600/40 text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:border-brand-400/40 dark:hover:bg-brand-500/10',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  dark: 'bg-fg text-bg hover:opacity-90',
  link: 'text-brand-700 dark:text-brand-300 underline-offset-4 hover:underline px-0 h-auto',
};

const sizes: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-xs rounded-lg',
  sm: 'h-9 px-3.5 text-sm rounded-xl',
  md: 'h-11 px-5 text-sm rounded-xl',
  lg: 'h-13 px-7 text-base rounded-2xl',
  icon: 'h-10 w-10 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
