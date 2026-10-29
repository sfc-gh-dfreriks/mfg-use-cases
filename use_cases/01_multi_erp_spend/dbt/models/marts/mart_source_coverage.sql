-- What each selected source contributes to each canonical object (drives the Data Sources screen
-- and the lineage page). Objects a source system cannot supply show 0 rows.
{{ config(materialized='table') }}
{% set objs = ['SUPPLIER','PO_LINE','GOODS_RECEIPT','INVOICE_LINE','PAYMENT','CONTRACT_ITEM','PRICE_CONDITION'] %}
{% for o in objs %}
SELECT '{{ o }}' AS OBJECT_NAME, SOURCE_SLOT, SOURCE_SYSTEM, COUNT(*) AS ROW_COUNT FROM {{ ref(o | lower) }} GROUP BY 2, 3
{% if not loop.last %}UNION ALL{% endif %}
{% endfor %}
