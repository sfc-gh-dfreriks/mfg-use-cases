-- Canonical CONTRACT_ITEM: union of the adapters selected in var('selection').
{{ register_all_adapters('CONTRACT_ITEM') }}
{{ union_selected('CONTRACT_ITEM', canonical_columns('CONTRACT_ITEM')) }}
