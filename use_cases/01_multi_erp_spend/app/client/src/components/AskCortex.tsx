import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, Loader2, X, Send } from 'lucide-react';
import { askCortex, type AskCortexRequest } from '@/lib/api';
import { cn } from '@/lib/utils';

interface AskCortexProps extends AskCortexRequest {
  /** Button label; defaults to "Ask Cortex". */
  label?: string;
  /** Suggested follow-up questions shown as chips. */
  suggestions?: string[];
  className?: string;
  /** Compact = small inline button (table rows, cards). */
  compact?: boolean;
}

/**
 * "Ask Cortex" — analyses the data on screen in context. The server gathers
 * authoritative SQL facts for the topic and asks Cortex COMPLETE to explain
 * them, so answers cite real suppliers, categories and amounts.
 */
export default function AskCortex({ topic, args, label = 'Ask Cortex', suggestions = [], className, compact }: AskCortexProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function run(q?: string) {
    abort.current?.abort();
    abort.current = new AbortController();
    setOpen(true);
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await askCortex({ topic, args, question: q }, abort.current.signal));
    } catch (e: any) {
      if (e.message !== 'cancelled') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(compact ? 'inline-block' : 'w-full', className)}>
      <button
        onClick={() => run()}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg font-semibold text-white shadow-sm transition hover:opacity-90',
          'bg-gradient-to-r from-sf-primary to-indigo-500',
          compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'
        )}
      >
        <Sparkles className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        {label}
      </button>

      {open && (
        <div className={cn('mt-3 rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-white to-sky-50/60 p-4 shadow-sm',
          compact && 'fixed inset-x-0 bottom-0 z-50 mx-auto mb-6 max-w-3xl max-h-[70vh] overflow-y-auto shadow-2xl')}>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-bold text-indigo-700">
              <Sparkles className="h-4 w-4" /> Cortex analysis
            </span>
            <button onClick={() => { abort.current?.abort(); setOpen(false); }} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {busy && (
            <p className="flex items-center gap-2 py-3 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Gathering live data and analysing…
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {answer && (
            <div className="cortex-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
            </div>
          )}

          {!busy && (
            <div className="mt-3 space-y-2 border-t border-indigo-100 pt-3">
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => { setQuestion(s); run(s); }}
                      className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-xs text-indigo-700 hover:bg-indigo-50">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={(e) => { e.preventDefault(); if (question.trim()) run(question); }} className="flex gap-2">
                <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a follow-up about this analysis…"
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
                <button type="submit" className="rounded-lg bg-indigo-500 px-3 text-white hover:bg-indigo-600">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
