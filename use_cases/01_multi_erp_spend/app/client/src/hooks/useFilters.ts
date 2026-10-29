import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { fetchFilters } from '@/lib/api';

interface FilterContextType {
  companies: string[];
  selectedCompanies: string[];
  setSelectedCompanies: (v: string[]) => void;
  categories: string[];
  selectedCategories: string[];
  setSelectedCategories: (v: string[]) => void;
  /** Filters sent to the API: empty when everything is selected, so queries stay unfiltered. */
  apiCompanies: string[];
  apiCategories: string[];
  /** Bumped after a source rebuild so every page refetches. */
  dataVersion: number;
  reload: () => void;
  loading: boolean;
}

const FilterContext = createContext<FilterContextType>({
  companies: [], selectedCompanies: [], setSelectedCompanies: () => {},
  categories: [], selectedCategories: [], setSelectedCategories: () => {},
  apiCompanies: [], apiCategories: [], dataVersion: 0, reload: () => {}, loading: true,
});

export function FilterProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchFilters()
      .then((d) => {
        setCompanies(d.companies); setSelectedCompanies(d.companies);
        setCategories(d.categories); setSelectedCategories(d.categories);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  const reload = useCallback(() => { load(); setDataVersion((v) => v + 1); }, [load]);

  const apiCompanies = selectedCompanies.length === companies.length ? [] : selectedCompanies;
  const apiCategories = selectedCategories.length === categories.length ? [] : selectedCategories;
  return React.createElement(FilterContext.Provider, {
    value: { companies, selectedCompanies, setSelectedCompanies, categories, selectedCategories, setSelectedCategories,
             apiCompanies, apiCategories, dataVersion, reload, loading },
  }, children);
}

export function useFilters() { return useContext(FilterContext); }

/** Page data that follows the sidebar filters and source rebuilds. */
export function usePageDeps() {
  const f = useFilters();
  const empty = (f.companies.length > 0 && f.selectedCompanies.length === 0) || (f.categories.length > 0 && f.selectedCategories.length === 0);
  return { ...f, empty, deps: [f.apiCompanies.join('|'), f.apiCategories.join('|'), f.dataVersion] };
}
