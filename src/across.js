// Resolve titles to Wikidata ids and group the same subject across editions.
import { createLimiter } from './attention.js';

const BATCH = 50;

/**
 * Map titles (with spaces) back through the API's normalized and redirects
 * arrays. Returns Map(title -> {qid, en}).
 */
export function parseResolved(titles, json) {
  const q = json?.query ?? {};
  const norm = new Map((q.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((q.redirects ?? []).map((r) => [r.from, r.to]));
  const pages = new Map();
  for (const p of q.pages ?? []) {
    if (p?.missing) continue;
    pages.set(p.title, {
      qid: p.pageprops?.wikibase_item ?? null,
      en: p.langlinks?.find((l) => l.lang === 'en')?.title ?? null,
    });
  }
  const out = new Map();
  for (const t of titles) {
    let cur = norm.get(t) ?? t;
    cur = redir.get(cur) ?? cur;
    const hit = pages.get(cur);
    if (hit) out.set(t, hit);
  }
  return out;
}

export function resolveUrl(code, titles) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    prop: 'pageprops|langlinks',
    ppprop: 'wikibase_item',
    lllang: 'en',
    lllimit: 'max',
    redirects: '1',
    titles: titles.join('|'),
  });
  return `https://${code}.wikipedia.org/w/api.php?${params}`;
}

/** Resolve one edition's titles. Never throws: failure yields an empty map. */
export async function resolveTitles(code, titles, {
  fetchImpl = (...a) => globalThis.fetch(...a),
  limit = createLimiter(),
} = {}) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += BATCH) {
    const chunk = titles.slice(i, i + BATCH);
    try {
      const res = await limit(() => fetchImpl(resolveUrl(code, chunk)));
      if (!res.ok) continue;
      for (const [k, v] of parseResolved(chunk, await res.json())) out.set(k, v);
    } catch {
      /* leave unresolved */
    }
  }
  return out;
}

/**
 * Group editions' top items by Wikidata id.
 * @param {{code:string, languageName:string,
 *   items:{title:string, views:number, qid?:?string, en?:?string}[]}[]} editions
 *   items are in rank order (the caller passes the top 25).
 * @returns {{shared: object[], only: object[]}}
 *   shared: items in 2+ editions, sorted by edition count then summed views.
 *   only: per edition, its best-ranked item that no other edition has.
 */
export function groupAcross(editions) {
  const groups = new Map();
  const keyOf = (ed, it) => it.qid || `${ed.code}:${it.title}`;
  for (const ed of editions) {
    for (const it of ed.items) {
      const key = keyOf(ed, it);
      let g = groups.get(key);
      if (!g) {
        g = { key, qid: it.qid || null, entries: [], english: null };
        groups.set(key, g);
      }
      if (g.entries.some((e) => e.code === ed.code)) continue;
      g.entries.push({
        code: ed.code,
        languageName: ed.languageName,
        title: it.title,
        views: it.views,
      });
      if (ed.code === 'en') g.english = it.title;
      else if (!g.english && it.en) g.langlinkEn = g.langlinkEn ?? it.en;
    }
  }
  const finish = (g) => {
    const top = g.entries.reduce((a, b) => (b.views > a.views ? b : a));
    return {
      key: g.key,
      qid: g.qid,
      title: g.english ?? g.langlinkEn ?? top.title,
      count: g.entries.length,
      codes: g.entries.map((e) => e.code),
      languages: g.entries.map((e) => e.languageName),
      views: g.entries.reduce((s, e) => s + e.views, 0),
      entries: g.entries,
    };
  };
  const shared = [...groups.values()]
    .filter((g) => g.entries.length >= 2)
    .map(finish)
    .sort((a, b) => b.count - a.count || b.views - a.views);
  const only = [];
  for (const ed of editions) {
    for (const it of ed.items) {
      const g = groups.get(keyOf(ed, it));
      if (g && g.entries.length === 1) {
        only.push({
          code: ed.code,
          languageName: ed.languageName,
          title: it.title,
          en: it.en && it.en !== it.title ? it.en : null,
          views: it.views,
        });
        break;
      }
    }
  }
  return { shared, only };
}
