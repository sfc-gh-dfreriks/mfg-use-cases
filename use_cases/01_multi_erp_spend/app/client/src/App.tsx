import { useState } from 'react';
import { FilterProvider, useFilters } from '@/hooks/useFilters';
import Sidebar, { NAV_ITEMS, type PageId } from '@/components/Sidebar';
import AskCortex from '@/components/AskCortex';
import AskCortexPage from '@/pages/AskCortexPage';
import Overview from '@/pages/Overview';
import Suppliers from '@/pages/Suppliers';
import PriceVariance from '@/pages/PriceVariance';
import SupplierRisk from '@/pages/SupplierRisk';
import SupplierOptimization from '@/pages/SupplierOptimization';
import Contracts from '@/pages/Contracts';
import MatchPayments from '@/pages/MatchPayments';
import GoldenRecord from '@/pages/GoldenRecord';
import DataSources from '@/pages/DataSources';
import Lineage from '@/pages/Lineage';
import ASK_TOPICS from '@/ask_topics.json';
import { STATIC } from '@/lib/api';

// Ask Cortex: per-page topic (server TOPICS in routes/askCortex.ts) + suggested questions.
// Shared with scripts/export-static.mjs, which bakes an answer for each one for the public build.
const ASK: Record<string, { topic: string; suggestions: string[] }> = ASK_TOPICS.pages;

const PAGE_COMPONENTS: Record<PageId, React.FC<{ onNavigate?: (p: PageId) => void }>> = {
  'ask-cortex': AskCortexPage,
  overview: Overview,
  suppliers: Suppliers,
  'price-variance': PriceVariance,
  'supplier-risk': SupplierRisk,
  'supplier-optimization': SupplierOptimization,
  contracts: Contracts,
  'match-payments': MatchPayments,
  'golden-record': GoldenRecord,
  'data-sources': DataSources,
  lineage: Lineage,
};

function AppShell() {
  const [activePage, setActivePage] = useState<PageId>('overview');
  const navItem = NAV_ITEMS.find((n) => n.id === activePage)!;
  const Icon = navItem.icon;
  const PageComponent = PAGE_COMPONENTS[activePage];
  const { dataVersion } = useFilters();
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />
      <main className="ml-64 min-h-screen p-6">
        <div className="mb-6 flex items-center gap-3">
          <Icon className="h-6 w-6 text-sf-primary" />
          <h1 className="text-2xl font-bold text-sf-deeper">{navItem.label}</h1>
        </div>
        {STATIC && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            Public demo: a read-only snapshot of synthetic data (SAP A = ECC, SAP B = S/4HANA, all non-SAP sources on). Filters show an exact company
            selection, or all/one company with one category. Cortex answers are pre-generated for the suggested questions; the scenario model runs in your browser.
          </div>
        )}
        {ASK[activePage] && (
          <div className="mb-6">
            <AskCortex key={`${activePage}-${dataVersion}`} topic={ASK[activePage].topic}
              label={`Ask Cortex about ${navItem.label}`} suggestions={ASK[activePage].suggestions} />
          </div>
        )}
        <PageComponent onNavigate={setActivePage} />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <FilterProvider>
      <AppShell />
    </FilterProvider>
  );
}
