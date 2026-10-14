# migrant-stock-2024.json

Trimmed international migrant stock, destination by origin, mid-year 2024.

- **Source:** United Nations Department of Economic and Social Affairs, Population Division (2024). International Migrant Stock 2024, Table 1 (both sexes, 2024 column) of `undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx`.
- **URL:** <https://www.un.org/development/desa/pd/sites/www.un.org.development.desa.pd/files/undesa_pd_2024_ims_stock_by_sex_destination_and_origin.xlsx>
- **Licence:** [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/). Suggested citation: United Nations Department of Economic and Social Affairs, Population Division (2024). International Migrant Stock 2024. POP/DB/MIG/Stock/Rev.2024.
- **Changes:** reduced to country-to-country pairs of at least 50,000 people plus each destination's five largest origins; regional aggregates and overseas territories without their own Natural Earth country feature (Reunion, Mayotte, Guadeloupe, Martinique, French Guiana, Channel Islands) are omitted. Values are integers as published.
- **Rebuild:** `node scripts/build-migrant-stock.mjs` (the UN server needs a browser User-Agent).
- **Retrieved:** 2026-10-14
