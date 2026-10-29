import React from 'react';
import { cn } from '@/lib/utils';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  Users,
  FileText,
  Building2,
  PieChart,
  Calculator,
  CreditCard,
  Calendar,
  Gauge,
  Activity,
  type LucideIcon,
} from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  icon?: LucideIcon;
  accent?: string;
  className?: string;
  /** Optional delta string e.g. "+12.3%" or "-$4.2K" */
  delta?: string;
  /** 'positive' = green, 'negative' = red, 'neutral' = gray */
  deltaType?: 'positive' | 'negative' | 'neutral';
  /** Array of numbers for a sparkline (last 6–12 values) */
  trend?: number[];
}

/** Tiny inline sparkline SVG */
function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const h = 24;
  const w = 64;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const isUp = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} className="mt-1.5">
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? '#10b981' : '#ef4444'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MetricCard({ title, value, icon: Icon, accent, className, delta, deltaType, trend }: MetricCardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border p-5 shadow-sm transition-transform hover:scale-[1.02]',
        accent ?? 'border-sf-primary/30 bg-gradient-to-br from-blue-50 to-sky-50',
        className
      )}
    >
      {Icon && (
        <div className="absolute -right-2 -top-2 opacity-10">
          <Icon className="h-16 w-16" />
        </div>
      )}
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      <p className="mt-1.5 text-3xl font-extrabold text-gray-900">{value}</p>
      {delta && (
        <p className={cn(
          'mt-1 text-xs font-semibold',
          deltaType === 'positive' ? 'text-emerald-600' : deltaType === 'negative' ? 'text-red-600' : 'text-gray-500'
        )}>
          {delta}
        </p>
      )}
      {trend && <Sparkline data={trend} />}
    </div>
  );
}

/** Money icon (all amounts are USD). */
export const CurrencyIcon = DollarSign;

export { DollarSign, TrendingUp, TrendingDown, Receipt, Users, FileText, Building2, PieChart, Calculator, CreditCard, Calendar, Gauge, Activity };
