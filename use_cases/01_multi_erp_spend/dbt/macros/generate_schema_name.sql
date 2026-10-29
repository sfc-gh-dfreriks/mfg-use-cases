-- Use the configured schema name as-is (ADAPTERS / SILVER / GOLD), not <target>_<schema>.
{% macro generate_schema_name(custom_schema_name, node) -%}
  {{ (custom_schema_name or target.schema) | trim | upper }}
{%- endmacro %}
