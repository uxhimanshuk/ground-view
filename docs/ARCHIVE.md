# The full version

Until 15 October 2026 Ground View was a fork of God's Eye View with ten sociological layers on its CesiumJS engine. It is preserved, unchanged, on the [`archive/full-v1`](https://github.com/uxhimanshuk/ground-view/tree/archive/full-v1) branch and the `v1-full` tag.

The layers were grouped into three lenses.

| Lens | Layer | Source |
| --- | --- | --- |
| Pulse | Unrest | GDELT 2.0 event files |
| Pulse | Attention | Wikimedia pageviews, 22 editions |
| Pulse | Disaster alerts | GDACS |
| Flows | Refugees | UNHCR |
| Flows | Migrant stock | UN DESA, 2024 |
| Flows | Remittances | World Bank and KNOMAD, 2021 |
| Structure | Indicators | World Bank |
| Structure | Values | World Values Survey, waves 1 to 6 |
| Structure | Languages | Glottolog 5.3 |
| Structure | News tone | GDELT 2.0 event files |

It also kept the original project's layers (flights, ships, satellites, cameras, street level and others) in a collapsed section, a guided tour called "A day on Earth", a voice assistant, and the original test suite of about 6,500 tests.

## Why it was cut

Ten layers answered ten questions, and none of them clearly. Attention was the most distinctive and the most current, so the new version is built around it alone, with protest reports kept as a faint context layer. Several of the other layers relied on old data (values from surveys up to 2014, remittances from 2021) or repeated what better tools already do.

To run the full version, check out the branch and follow its README. It needs Node 24.
