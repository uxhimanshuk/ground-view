import { formatCount, formatUtcDate } from '../pulse/format.js';

export const ATTENTION_ACCENT = '#7fb8e6';
export const ATTENTION_OUTLINE = '#10324d';
export const ATTENTION_CAVEAT = 'Pageviews include some automated traffic.';

/** Marker size grows gently with the edition's top article views. */
export function attentionPointSize(row) {
  const top = row.articles[0]?.views || 1;
  return (
    Math.round(Math.min(20, 8 + 1.4 * Math.log10(Math.max(1, top)) * 2) * 10) /
    10
  );
}

export function attentionStyle(row) {
  return {
    pixelSize: attentionPointSize(row),
    color: ATTENTION_ACCENT,
    outline: ATTENTION_OUTLINE,
  };
}

/** Every edition is labelled: there are only about twenty. */
export function attentionLabel(row) {
  return {
    title: row.languageName,
    accent: ATTENTION_ACCENT,
    priority: row.articles[0]?.views || 0,
  };
}

export function buildAttentionCard(row, meta) {
  return {
    title: `READING · ${row.languageName}`,
    subtitle: `${row.project}.org · ${formatUtcDate(Date.parse(row.date))}`,
    accent: ATTENTION_ACCENT,
    lines: [`Most-read articles on ${row.date} (UTC), pinned to ${row.anchor}`],
    links: row.articles.map((article, index) => ({
      text: `${index + 1}. ${article.title}`,
      href: article.url,
      note: `${formatCount(article.views)} views`,
    })),
    source: 'Wikimedia pageviews',
    asOf: formatUtcDate(Date.parse(row.date)),
    caveat: `${ATTENTION_CAVEAT} The point marks a language heartland, not every place the language is read.`,
  };
}

/** One record per language community; `value` is its top article's views. */
export function mapAttentionAnalystRecord(row) {
  const top = row.articles[0];
  return {
    id: row.stableId,
    kind: 'attention',
    name: row.languageName,
    country: row.country,
    value: top?.views ?? null,
    unit: 'views',
    language: row.languageName,
    project: row.project,
    topArticle: top?.title ?? null,
    topViews: top?.views ?? null,
    articles: row.articles.map((article) => article.title).join('; '),
    dateMs: Date.parse(row.date),
    lat: row.lat,
    lon: row.lon,
  };
}

export function attentionStats(meta) {
  return {
    partial: meta.partial === true,
    ...(meta.stale === true ? { stale: true } : {}),
    asOf: Date.parse(meta.date),
    coverage: 'Large Wikipedia editions, previous UTC day',
  };
}
