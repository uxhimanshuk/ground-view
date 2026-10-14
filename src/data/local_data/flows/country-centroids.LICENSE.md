# country-centroids.json

Country label points (one per sovereign state or territory with an ISO 3166-1 alpha-3 code, plus Kosovo as XKX) used as arc anchors by the Flows layers.

- **Source:** Natural Earth 10m admin-0 countries, `LABEL_X` / `LABEL_Y` plus names and codes, from <https://github.com/nvkelso/natural-earth-vector> at commit `ca96624a56bd078437bca8184e78163e5039ad19` (`geojson/ne_10m_admin_0_countries.geojson`, SHA-256 `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255`).
- **Licence:** public domain, <https://www.naturalearthdata.com/about/terms-of-use/>. No attribution is legally required; the app credits Natural Earth anyway.
- **Rebuild:** `node scripts/build-country-centroids.mjs`
- **Retrieved:** 2026-10-14
- **Changes:** coordinates rounded to 0.01 degrees, columns dropped to name, alternative names, M49 code and point. Dependencies that share a sovereign's ISO code in Natural Earth (for example Clipperton) are not separate entries.
