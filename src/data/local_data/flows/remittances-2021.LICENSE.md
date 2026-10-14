# remittances-2021.json

Trimmed bilateral remittance estimates for 2021, sending country by receiving country, USD millions.

- **Source:** KNOMAD / World Bank Bilateral Remittance Matrix 2021 (December 2022 version), estimated from migrant stocks, host-country incomes and origin-country incomes (method: Ratha and Shaw, 2007). It is the latest matrix published; KNOMAD has issued no newer one.
- **Official URL:** <https://www.knomad.org/sites/default/files/2022-12/bilateral_remittance_matrix_2021_0.xlsx>. knomad.org now answers that path with its home page, so the file was retrieved from the Internet Archive snapshot of the same official URL: <https://web.archive.org/web/2023/https://www.knomad.org/sites/default/files/2022-12/bilateral_remittance_matrix_2021_0.xlsx>
- **Licence:** World Bank Open Data terms, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Cite as KNOMAD/World Bank Bilateral Remittance Matrix 2021, December 2022.
- **Changes:** reduced to pairs of at least USD 50 million plus each receiver's five largest senders; values rounded to 0.1 USD million; WORLD totals and footnotes dropped; Channel Islands omitted (no country feature).
- **Caveat:** these are analytical estimates, not reported flows. India-Pakistan, Lebanon-Israel and Azerbaijan-Armenia corridors are assumed zero by the authors. Informal channels are not captured.
- **Rebuild:** `node scripts/build-remittances.mjs`
- **Retrieved:** 2026-10-14
