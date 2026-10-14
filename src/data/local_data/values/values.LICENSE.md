# Values layer data (Inglehart-Welzel cultural map)

`values.json` holds country-level aggregate scores only, never respondent-level
data. Nothing is estimated or imputed: a country WVS never scored (for example
Austria, Belgium, Denmark, Greece, Iceland, Ireland, Israel, Luxembourg, Malta,
Portugal) is absent and shows "No data".

## Source

World Values Survey Association. *WVS Wave 1 to 6 Key Aggregates* (2019),
developed by Christian Welzel. Downloaded from
https://www.worldvaluessurvey.org/WVSContents.jsp (file
`WVS_Wave_1_to_6_Key_Aggregates.zip`, retrieved 2026-10-14).

- `tradSecular` is `SVI_culmap`: traditional (negative) to secular-rational (positive).
- `survSelfExpr` is `EVI_culmap`: survival (negative) to self-expression (positive).
- Each country carries the survey `year` and `wave` of its latest scored survey,
  mostly wave 6 (2010 to 2014).

## Terms

WVS data is free for non-commercial use with citation of the source above.
Redistribution of the survey files themselves is not part of this repository;
only the derived country-level `values.json` is committed. Using Ground View
commercially needs the WVS Association's permission.

## Handling of the file's quirks

- Blank ISO3 codes on wave 6 rows are filled from other rows of the same WVS
  country number; thirteen countries whose rows never carry a code use the
  standard ISO 3166-1 alpha-3 code, listed in `scripts/build-values.mjs`.
- Germany uses the West German sample (flagged "West German sample" on the
  card); the East German sample is dropped. Northern Ireland is dropped (part of GBR).
- Where more than one latest row exists for a country, the newest year wins.

## Rebuilding

    python3 -I scripts/wvs-sav-to-csv.py "WVS Wave 1 to 6 Key Aggregates.sav" wvs-raw.csv
    node scripts/build-values.mjs wvs-raw.csv
