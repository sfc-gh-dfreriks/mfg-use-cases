-- Canonical PAYMENT: union of the adapters selected in var('selection').
{{ register_all_adapters('PAYMENT') }}
{{ union_selected('PAYMENT', canonical_columns('PAYMENT')) }}
