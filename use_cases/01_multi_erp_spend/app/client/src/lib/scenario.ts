// Browser copy of the scenario model in server/src/routes/optimize.ts (simulate), used by the static
// public build where there is no server. scripts/export-static.mjs checks both give the same result.
export interface ScenarioInputs {
  cats: {
    category: string; spend: number; tail_suppliers: number; tail_spend: number; maverick: number; on_contract: number;
    price: number; high_risk: number; suppliers: number;
  }[];
  discountLost: number;
  suppliers: number;
}
export type LeverValues = Record<string, number>;

export function simulate(base: ScenarioInputs, L: LeverValues) {
  const v = (k: string) => L[k] ?? 0;
  const byCat = base.cats.map((c) => {
    const price = v('price_capture') * c.price;
    const f = c.spend > 0 ? 1 - price / c.spend : 1;
    const maverick = v('maverick_capture') * c.maverick * f * v('contract_discount');
    const tail = v('tail_consolidation') * c.tail_spend * f * v('tail_discount');
    const switching = v('risk_shift') * c.high_risk * f * v('switching_premium');
    return {
      category: c.category, spend: c.spend, price, maverick, tail, switching, net: price + maverick + tail - switching,
      suppliers_removed: Math.round(v('tail_consolidation') * c.tail_suppliers),
      high_risk_after: c.high_risk * (1 - v('risk_shift')), maverick_after: c.maverick * (1 - v('maverick_capture')),
      on_contract_after: c.on_contract + v('maverick_capture') * c.maverick,
    };
  });
  const sum = (k: keyof (typeof byCat)[number]) => byCat.reduce((a, r) => a + (r[k] as number), 0);
  const tot = (k: keyof ScenarioInputs['cats'][number]) => base.cats.reduce((a, r) => a + (r[k] as number), 0);
  const discounts = v('discount_capture') * base.discountLost;
  const spend = tot('spend');
  const pairs = tot('suppliers');
  const removedPairs = sum('suppliers_removed');
  const levers = { price: sum('price'), maverick: sum('maverick'), tail: sum('tail'), discounts, switching: -sum('switching') };
  const savings = levers.price + levers.maverick + levers.tail + levers.discounts + levers.switching;
  const suppliersAfter = Math.max(0, Math.round(base.suppliers * (1 - (pairs ? removedPairs / pairs : 0))));
  return {
    baseline: {
      spend, savings: 0, suppliers: base.suppliers, supplier_category_pairs: pairs,
      high_risk_spend: tot('high_risk'), maverick_spend: tot('maverick'),
      on_contract_pct: spend ? tot('on_contract') / spend : 0, discount_lost: base.discountLost,
    },
    scenario: {
      spend: spend - savings, savings, savings_pct: spend ? savings / spend : 0, suppliers: suppliersAfter,
      supplier_category_pairs: pairs - removedPairs, high_risk_spend: sum('high_risk_after'), maverick_spend: sum('maverick_after'),
      on_contract_pct: spend ? sum('on_contract_after') / spend : 0, discount_lost: base.discountLost - discounts,
    },
    levers,
    by_category: byCat.filter((r) => Math.abs(r.net) > 0).sort((a, b) => b.net - a.net),
  };
}
