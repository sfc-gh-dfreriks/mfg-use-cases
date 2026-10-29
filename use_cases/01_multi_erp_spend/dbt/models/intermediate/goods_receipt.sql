-- Canonical GOODS_RECEIPT: union of the adapters selected in var('selection').
{{ register_all_adapters('GOODS_RECEIPT') }}
{{ union_selected('GOODS_RECEIPT', canonical_columns('GOODS_RECEIPT')) }}
