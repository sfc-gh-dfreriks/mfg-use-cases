-- Category labels that are not the parent's material-group codes (NetSuite classes, Coupa
-- commodities with no match) are classified once with AI_CLASSIFY. Stored as a table because
-- dynamic tables cannot call AI functions; rebuilt only for values not seen before.
{{ config(materialized='incremental', unique_key='RAW_CATEGORY', schema='SILVER') }}
WITH ref AS (SELECT MATERIAL_GROUP, MATERIAL_GROUP_TEXT FROM {{ source('src_third_party', 'ref_material_group') }}),
raw AS (
  SELECT DISTINCT COALESCE(p.MATERIAL_GROUP, p.ITEM_TEXT) AS RAW_CATEGORY
  FROM {{ ref('po_line') }} p
  WHERE COALESCE(p.MATERIAL_GROUP, p.ITEM_TEXT) IS NOT NULL
    AND COALESCE(p.MATERIAL_GROUP, '') NOT IN (SELECT MATERIAL_GROUP FROM ref)
  {% if is_incremental() %} AND COALESCE(p.MATERIAL_GROUP, p.ITEM_TEXT) NOT IN (SELECT RAW_CATEGORY FROM {{ this }}) {% endif %}
),
labels AS (SELECT ARRAY_AGG(MATERIAL_GROUP_TEXT) WITHIN GROUP (ORDER BY MATERIAL_GROUP) AS L FROM ref),
c AS (SELECT r.RAW_CATEGORY, AI_CLASSIFY(r.RAW_CATEGORY, l.L):labels[0]::STRING AS LABEL FROM raw r CROSS JOIN labels l)
SELECT c.RAW_CATEGORY, ref.MATERIAL_GROUP, c.LABEL AS MATERIAL_GROUP_TEXT, 'AI_CLASSIFY' AS METHOD, CURRENT_TIMESTAMP() AS CLASSIFIED_AT
FROM c LEFT JOIN ref ON ref.MATERIAL_GROUP_TEXT = c.LABEL
