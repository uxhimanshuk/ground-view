import { STATIC_MODE } from '../sources/snapshots.js';

export const STATIC_REPO_URL = 'https://github.com/uxhimanshuk/ground-view';
export const STATIC_NOTE_ID = 'gv-static-note';

/**
 * Answer same-origin `/api/` requests with a local 404. The static demo has no
 * server, so a stray call (for example a search fallback) fails quietly
 * instead of reaching the network.
 * @param {typeof fetch} fetchImpl The fetch to wrap.
 * @param {string} [origin] The page origin; relative URLs resolve against it.
 */
export function guardApiFetch(fetchImpl, origin = 'http://localhost') {
  return function guardedFetch(input, init) {
    const raw = typeof input === 'string' ? input : input?.url;
    let target = null;
    try {
      target = new URL(String(raw), origin);
    } catch {
      target = null;
    }
    if (
      target &&
      target.origin === new URL(origin).origin &&
      /^\/(?:[^/]+\/)*api\//.test(target.pathname.replace(/^\/groundview/, ''))
    )
      return Promise.resolve(
        new Response('{"error":"static_demo"}', {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    return fetchImpl(input, init);
  };
}

/** Build the one-line about note (no framework, no template). */
export function createStaticNote(documentRef) {
  const note = documentRef.createElement('p');
  note.id = STATIC_NOTE_ID;
  note.append('Live demo. Feeds refresh every 30 minutes. ');
  const link = documentRef.createElement('a');
  link.href = STATIC_REPO_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Run locally';
  note.append(link, ' for voice and the original God’s Eye View layers.');
  return note;
}

/** Install the static demo's page-level behaviour. A no-op outside static mode. */
export function installStaticDemo({
  windowRef = globalThis.window,
  enabled = STATIC_MODE,
} = {}) {
  if (!enabled || !windowRef) return false;
  windowRef.fetch = guardApiFetch(
    windowRef.fetch.bind(windowRef),
    windowRef.location.href,
  );
  const mount = () => {
    if (!windowRef.document.getElementById(STATIC_NOTE_ID))
      windowRef.document.body.appendChild(createStaticNote(windowRef.document));
  };
  if (windowRef.document.body) mount();
  else windowRef.document.addEventListener('DOMContentLoaded', mount);
  return true;
}
