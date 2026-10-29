-- Canonical PRICE_CONDITION: union of the adapters selected in var('selection').
{{ register_all_adapters('PRICE_CONDITION') }}
{{ union_selected('PRICE_CONDITION', canonical_columns('PRICE_CONDITION')) }}
