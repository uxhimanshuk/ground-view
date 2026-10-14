import { isArticleTitle } from './heartlands.js';

export const TOP_ARTICLE_COUNT = 5;

const DATE_PATTERN = /^\d{4}-\d\d-\d\d$/;

/** Readable title: underscores to spaces. */
export function displayTitle(title) {
  return String(title).replace(/_/g, ' ');
}

/** Article URL on the edition's own host. */
export function articleUrl(code, title) {
  return `https://${code}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

/**
 * Turn one Wikimedia top-pageviews payload into a row for a language edition.
 * Utility pages are filtered out and the top five articles kept. Returns null
 * for a payload that does not have the documented shape, or whose articles
 * are all utility pages.
 * @param {object} heartland Entry from LANGUAGE_HEARTLANDS.
 * @param {object} payload Parsed `.../metrics/pageviews/top/...` JSON.
 * @returns {?object}
 */
export function normalizeTopArticles(heartland, payload) {
  const item = payload?.items?.[0];
  if (!item || !Array.isArray(item.articles)) return null;
  const date = `${item.year}-${item.month}-${item.day}`;
  if (!DATE_PATTERN.test(date) || !Number.isFinite(Date.parse(date)))
    return null;
  const articles = [];
  for (const entry of item.articles) {
    if (
      typeof entry?.article !== 'string' ||
      !Number.isFinite(entry.views) ||
      entry.views < 0
    )
      return null;
    if (
      articles.length < TOP_ARTICLE_COUNT &&
      isArticleTitle(entry.article, heartland)
    )
      articles.push({
        title: displayTitle(entry.article),
        views: Math.floor(entry.views),
        url: articleUrl(heartland.code, entry.article),
      });
  }
  if (!articles.length) return null;
  return {
    stableId: `attention:${heartland.code}`,
    code: heartland.code,
    project: `${heartland.code}.wikipedia`,
    languageName: heartland.languageName,
    anchor: heartland.anchor,
    country: heartland.country,
    lon: heartland.lon,
    lat: heartland.lat,
    date,
    articles,
  };
}
