-- Canonical INVOICE_LINE: union of the adapters selected in var('selection').
{{ register_all_adapters('INVOICE_LINE') }}
{{ union_selected('INVOICE_LINE', canonical_columns('INVOICE_LINE')) }}
