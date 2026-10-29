import { LayoutDashboard, Truck, Scale, ShieldAlert, FileCheck2, Receipt, Fingerprint, Database, GitBranch, Check, Sparkles, Target } from 'lucide-react';
import { useFilters } from '@/hooks/useFilters';
import { cn } from '@/lib/utils';

export type PageId = 'ask-cortex' | 'overview' | 'suppliers' | 'price-variance' | 'supplier-risk' | 'supplier-optimization' | 'contracts' | 'match-payments'
  | 'golden-record' | 'data-sources' | 'lineage';

export interface NavItem { id: PageId; label: string; icon: React.ElementType; }

export const NAV_ITEMS: NavItem[] = [
  { id: 'ask-cortex', label: 'Ask Cortex', icon: Sparkles },
  { id: 'overview', label: 'Executive Dashboard', icon: LayoutDashboard },
  { id: 'suppliers', label: 'Spend by Supplier', icon: Truck },
  { id: 'price-variance', label: 'Price Variance Across Plants', icon: Scale },
  { id: 'supplier-risk', label: 'Supplier Risk', icon: ShieldAlert },
  { id: 'supplier-optimization', label: 'Supplier Optimization', icon: Target },
  { id: 'contracts', label: 'Contracts & Maverick Spend', icon: FileCheck2 },
  { id: 'match-payments', label: '3-Way Match & Payments', icon: Receipt },
  { id: 'golden-record', label: 'Supplier Golden Record', icon: Fingerprint },
  { id: 'data-sources', label: 'Data Sources', icon: Database },
  { id: 'lineage', label: 'Sources & Lineage (dbt)', icon: GitBranch },
];

interface SidebarProps { activePage: PageId; onNavigate: (page: PageId) => void; }

function FilterGroup({ label, items, selected, setSelected }: {
  label: string; items: string[]; selected: string[]; setSelected: (v: string[]) => void;
}) {
  const toggle = (item: string) =>
    setSelected(selected.includes(item) ? selected.filter((s) => s !== item) : [...selected, item]);
  return (
    <div className="border-t border-white/10 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-sf-pale/70">{label}</span>
        <div className="flex gap-2 text-[10px]">
          <button onClick={() => setSelected([...items])} className="text-sf-light hover:underline">All</button>
          <button onClick={() => setSelected([])} className="text-sf-light hover:underline">None</button>
        </div>
      </div>
      <div className="max-h-28 space-y-0.5 overflow-y-auto">
        {items.map((it) => {
          const checked = selected.includes(it);
          return (
            <button key={it} onClick={() => toggle(it)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-sf-pale/80 hover:bg-white/5">
              <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border',
                checked ? 'border-sf-primary bg-sf-primary' : 'border-sf-pale/40')}>
                {checked && <Check className="h-2.5 w-2.5 text-white" />}
              </span>
              <span className="truncate">{it}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { companies, selectedCompanies, setSelectedCompanies, categories, selectedCategories, setSelectedCategories } = useFilters();
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-gradient-to-b from-sf-dark to-sf-deeper text-white">
      <div className="flex flex-col gap-1.5 border-b border-white/10 px-5 py-4">
        <img src={`${import.meta.env.BASE_URL}snowflake_logo.svg`} alt="Snowflake" className="h-7 w-auto self-start" />
        <span className="text-lg font-bold leading-tight tracking-tight text-white">Multi-ERP Spend &amp; Supplier Risk</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon; const active = activePage === item.id;
            return (
              <li key={item.id}>
                <button onClick={() => onNavigate(item.id)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    active ? 'bg-sf-primary/20 text-sf-light font-medium' : 'text-sf-pale/80 hover:bg-white/5 hover:text-white')}>
                  <Icon className="h-4 w-4 shrink-0" />{item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <FilterGroup label="Company" items={companies} selected={selectedCompanies} setSelected={setSelectedCompanies} />
      <FilterGroup label="Category" items={categories} selected={selectedCategories} setSelected={setSelectedCategories} />
      <div className="border-t border-white/10 px-5 py-3">
        <p className="text-[10px] leading-relaxed text-sf-pale/50">SAP ECC · S/4HANA · BW · BDC · Oracle · D365 · NetSuite · Coupa<br />dbt medallion · Cortex Agent · USD</p>
      </div>
    </aside>
  );
}
