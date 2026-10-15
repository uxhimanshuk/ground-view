# Vendored libraries

Loaded with classic script tags (UMD globals). No CDN at runtime.

| Name | Version | Licence | Source |
| --- | --- | --- | --- |
| d3-geo | 3.1.1 | ISC | https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/dist/d3-geo.min.js |
| d3-array | 3.2.4 | ISC | https://cdn.jsdelivr.net/npm/d3-array@3.2.4/dist/d3-array.min.js |
| topojson-client | 3.1.0 | ISC | https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js |

d3-array is required by d3-geo and is loaded first.

## Data

`../data/land-110m.json` is the Natural Earth 110m land layer as TopoJSON, from
https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json (world-atlas 2.0.2, ISC). Natural Earth data is in the public domain.
