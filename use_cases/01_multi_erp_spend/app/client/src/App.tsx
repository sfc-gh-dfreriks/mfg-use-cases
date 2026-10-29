import { useState } from 'react';
import { FilterProvider, useFilters } from '@/hooks/useFilters';
import Sidebar, { NAV_ITEMS, type PageId } from '@/components/Sidebar';
import AskCortex from '@/components/AskCortex';
import AskCortexPage from '@/pages/AskCortexPage';
import Overview from '@/pages/Overview';
import Suppliers from '@/pages/Suppliers';
import PriceVariance from '@/pages/PriceVariance';
import SupplierRisk from '@/pages/SupplierRisk';
import Contracts from '@/pages/Contracts';
import MatchPayments from '@/pages/MatchPayments';
import GoldenRecord from '@/pages/GoldenRecord';
import DataSources from '@/pages/DataSources';
import Lineage from '@/pages/Lineage';

// Ask Cortex: per-page topic (server TOPICS in routes/askCortex.ts) + suggested questions.
const ASK: Record<string, { topic: string; suggestions: string[] }> = {
  overview: { topic: 'overview', suggestions: ['Which company and ERP drive most of our spend?', 'How has spend trended by quarter?'] },
  suppliers: { topic: 'suppliers', suggestions: ['Is our supplier base too concentrated?', 'Which top suppliers have low contract coverage?'] },
  'price-variance': { topic: 'price', suggestions: ['Which plant pays the most above the best price?', 'Where is price variance not explained by commodity indices?'] },
  'supplier-risk': { topic: 'risk', suggestions: ['Which high-spend suppliers are the biggest risk?', 'How exposed are we to single-source sub-tier suppliers?'] },
  contracts: { topic: 'contracts', suggestions: ['Where is maverick spend highest?', 'Which suppliers should we put under contract first?'] },
  'match-payments': { topic: 'match', suggestions: ['Where are three-way match exceptions concentrated?', 'How much early-payment discount are we losing?'] },
  'golden-record': { topic: 'golden', suggestions: ['How reliable is the supplier deduplication?', 'Which suppliers do we buy from in several ERPs?'] },
  'data-sources': { topic: 'sources', suggestions: ['What does each selected ERP contribute?', 'What do we lose by reading SAP from BDC instead of S/4HANA?'] },
};

const PAGE_COMPONENTS: Record<PageId, React.FC<{ onNavigate?: (p: PageId) => void }>> = {
  'ask-cortex': AskCortexPage,
  overview: Overview,
  suppliers: Suppliers,
  'price-variance': PriceVariance,
  'supplier-risk': SupplierRisk,
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
