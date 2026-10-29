import { Sparkles } from 'lucide-react';
import AskCortex from '@/components/AskCortex';
import ASK_TOPICS from '@/ask_topics.json';

const SUGGESTIONS = ASK_TOPICS.askCortexPage.suggestions;

export default function AskCortexPage() {
  return (
    <div className="max-w-4xl space-y-4">
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-white to-sky-50/60 p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold text-indigo-700">
          <Sparkles className="h-4 w-4" /> Cortex multi-ERP spend analysis
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Ask a question across spend, golden suppliers, price variance between plants, supplier risk, contracts and payments. Cortex answers from live facts
          over the dbt gold layer, so answers follow whichever SAP and non-SAP sources are selected on Data Sources. All data is synthetic; supplier risk, ESG
          and PPI figures are representative third-party data.
        </p>
      </div>
      <AskCortex topic="general" label="Analyse global spend and supplier risk" suggestions={SUGGESTIONS} />
    </div>
  );
}
