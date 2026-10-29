import type { ReactNode } from 'react';

/** Shared loading / error / empty states so every page behaves the same. */
export default function PageState({ loading, error, empty, children }: {
  loading: boolean; error: string | null; empty?: boolean; children: ReactNode;
}) {
  if (empty) return <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">Select at least one company and category.</div>;
  if (error) return <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">Error: {error}</div>;
  if (loading) return <div className="grid grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-200" />)}</div>;
  return <>{children}</>;
}
