-- Union the staging adapters selected in var('selection') for one canonical object.
-- SAP slots pick one system type; non-SAP slots are true/false. Objects with no selected
-- adapter (e.g. goods receipts when every SAP slot is BDC) return an empty, typed result.
{% macro current_selection() %}
  {#- --vars wins; otherwise the selection saved by the Data Sources screen. -#}
  {%- set sel = var('selection', none) -%}
  {%- if sel is none and execute -%}
    {%- set rows = run_query("SELECT SOURCE_SLOT, SYSTEM_CODE, ENABLED FROM " ~ target.database ~ ".CONFIG.SOURCE_SELECTION") -%}
    {%- set sel = {} -%}
    {%- for r in rows -%}
      {%- if r[0].startswith('SAP_') -%}{%- do sel.update({r[0]: (r[1] if r[2] else false)}) -%}
      {%- else -%}{%- do sel.update({r[0]: r[2]}) -%}{%- endif -%}
    {%- endfor -%}
  {%- endif -%}
  {{ return(sel or {}) }}
{% endmacro %}

{% macro selected_adapters(object_name) %}
  {%- set reg = adapter_registry()[object_name] -%}
  {%- set sel = current_selection() -%}
  {%- set picked = [] -%}
  {%- for slot, systems in reg.items() -%}
    {%- set choice = sel.get(slot) -%}
    {%- if choice is string and choice in systems -%}
      {%- do picked.append(systems[choice]) -%}
    {%- elif choice is sameas true and (systems | length) == 1 -%}
      {%- do picked.append(systems.values() | first) -%}
    {%- endif -%}
  {%- endfor -%}
  {{ return(picked) }}
{% endmacro %}

{% macro union_selected(object_name, columns) %}
  {%- set picked = selected_adapters(object_name) -%}
  {%- if picked | length == 0 %}
    SELECT {% for c, t in columns %}NULL::{{ t }} AS {{ c }}{{ "," if not loop.last }}{% endfor %} WHERE FALSE
  {%- else -%}
    {%- for m in picked %}
    SELECT {% for c, t in columns %}{{ c }}::{{ t }} AS {{ c }}{{ "," if not loop.last }}{% endfor %} FROM {{ ref(m) }}
    {% if not loop.last %}UNION ALL{% endif %}
    {%- endfor -%}
  {%- endif %}
{% endmacro %}

-- Every staging model is referenced from the intermediate layer even when not selected, so the
-- lineage graph always shows all adapters. This comment-only dependency does not run SQL.
{% macro register_all_adapters(object_name) %}
  {%- for slot, systems in adapter_registry()[object_name].items() -%}
    {%- for code, m in systems.items() %}
  -- depends_on: {{ ref(m) }}
    {%- endfor -%}
  {%- endfor %}
{% endmacro %}
