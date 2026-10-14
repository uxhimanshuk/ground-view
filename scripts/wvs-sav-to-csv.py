#!/usr/bin/env python3
"""Dump the columns Ground View needs from the WVS Wave 1 to 6 Key Aggregates
SPSS file to a plain CSV, with no cleaning (scripts/build-values.mjs does that).

Requirements: Python 3, pandas, pyreadstat.
Usage: python3 -I scripts/wvs-sav-to-csv.py "WVS Wave 1 to 6 Key Aggregates.sav" wvs-raw.csv

The .sav and the zip it ships in are not committed; only the derived
src/data/local_data/values/values.json is.
"""
import sys

import pyreadstat

COLUMNS = [
    "ctrnum",
    "country",
    "ccodealp",
    "year",
    "wave",
    "latest",
    "SVI_culmap",
    "EVI_culmap",
]


def main(src, dst):
    df, _meta = pyreadstat.read_sav(src, apply_value_formats=False)
    df[COLUMNS].to_csv(dst, index=False)
    print(f"wrote {len(df)} rows to {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
