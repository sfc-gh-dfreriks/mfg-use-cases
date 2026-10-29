-- Canonical SUPPLIER: union of the adapters selected in var('selection').
{{ register_all_adapters('SUPPLIER') }}
{{ union_selected('SUPPLIER', canonical_columns('SUPPLIER')) }}
