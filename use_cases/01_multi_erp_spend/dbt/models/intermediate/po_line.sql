-- Canonical PO_LINE: union of the adapters selected in var('selection').
{{ register_all_adapters('PO_LINE') }}
{{ union_selected('PO_LINE', canonical_columns('PO_LINE')) }}
