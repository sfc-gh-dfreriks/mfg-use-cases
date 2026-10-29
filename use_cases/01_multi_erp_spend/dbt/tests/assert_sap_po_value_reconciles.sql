-- Portability guarantee: for each selected SAP slot, canonical PO value equals the sum over the
-- native PO line table of whichever source system is selected. Returns rows on mismatch.
{% set sel = current_selection() %}
{% set native = {
  'ECC': ("ekpo", "NETWR"), 'S4': ("ekpo", "NETWR"),
  'BW': ("bic_azpur_o01", "ORDER_VAL"), 'BDC': ("purchaseorderitem", "NetAmount") } %}
WITH c AS (SELECT SOURCE_SLOT, SUM(NET_VALUE) AS V FROM {{ ref('po_line') }} WHERE SOURCE_SLOT LIKE 'SAP_%' GROUP BY 1),
n AS (
{% for slot in ['SAP_A', 'SAP_B'] if sel.get(slot) in native %}
  {% set t, col = native[sel[slot]] %}
  SELECT '{{ slot }}' AS SOURCE_SLOT, SUM({{ col }}) AS V
  FROM {{ source('src_' ~ sel[slot] | lower ~ '_' ~ slot[-1] | lower, t) }}
  {% if sel[slot] in ['ECC', 'S4'] %} WHERE COALESCE(LOEKZ, '') = '' {% endif %}
  {% if not loop.last %}UNION ALL{% endif %}
{% endfor %}
)
SELECT n.SOURCE_SLOT, n.V AS NATIVE_VALUE, c.V AS CANONICAL_VALUE
FROM n LEFT JOIN c ON c.SOURCE_SLOT = n.SOURCE_SLOT
WHERE ABS(COALESCE(c.V, 0) - n.V) > 0.01
