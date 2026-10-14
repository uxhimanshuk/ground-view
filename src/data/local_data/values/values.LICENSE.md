# Values layer data (Inglehart-Welzel cultural map)

Status: PLACEHOLDER. `values.json` ships with zero countries. No scores were
fabricated and none were estimated from other data.

## What goes here

Country-level aggregate scores only, on two dimensions:

- traditional versus secular-rational values (`tradSecular`)
- survival versus self-expression values (`survSelfExpr`)

## Licensing

World Values Survey (WVS) data is free for non-commercial use with citation.
Only country-level aggregate scores may be bundled, never respondent-level
data. A real table must carry the full citation of its source, for example:

> Haerpfer, C., Inglehart, R., Moreno, A., Welzel, C., Kizilova, K.,
> Diez-Medrano J., Lagos, M., Norris, P., Ponarin, E. & Puranen B. (eds.).
> World Values Survey: Round Seven, Country-Pooled Datafile. Madrid, Spain
> & Vienna, Austria: JD Systems Institute & WVSA Secretariat.
> doi.org/10.14281/18241.24

Use the citation that matches the table you actually load, and record its URL
and retrieval date in `DATA_SOURCES.md`.

## How to fill it

Prepare a CSV with the header `iso3,name,year,wave,tradSecular,survSelfExpr`
taken from a published table, then run:

    node scripts/build-values.mjs path/to/table.csv "Full citation" "https://source-url"

The script rewrites `values.json` and clears the placeholder flag.
