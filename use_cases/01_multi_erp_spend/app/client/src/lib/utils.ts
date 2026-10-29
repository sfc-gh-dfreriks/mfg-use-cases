import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** USD with B / M / K suffixes. */
export function formatDollar(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '$0';
  const v = Math.abs(value);
  if (v >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null) return '–';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: value < 10 ? 3 : 2 })}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0%';
  return value.toFixed(1) + '%';
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '0';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
