/**
 * One shared DOM card for the Pulse layers. Overlay-host cards carry a single
 * click target; Pulse cards list several source links, so they are plain DOM.
 * Every string is written with textContent and every link is re-validated as
 * http(s), so a record can never inject markup.
 */

const STYLE_ID = 'pulse-card-style';
const CARD_ID = 'pulse-card';

const CSS = `
#${CARD_ID} {
  position: fixed;
  left: 50%;
  bottom: 120px;
  transform: translateX(-50%);
  z-index: 60;
  box-sizing: border-box;
  width: min(420px, calc(100vw - 32px));
  max-height: 60vh;
  overflow-y: auto;
  padding: 12px 14px 10px;
  border-radius: 6px;
  border: 1px solid rgba(165, 188, 199, 0.35);
  border-left: 4px solid var(--pulse-accent, #f2a65a);
  background: rgba(10, 14, 18, 0.92);
  color: #e6edf1;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  backdrop-filter: blur(6px);
}
#${CARD_ID}[hidden] { display: none; }
#${CARD_ID} .pulse-card-head { display: flex; gap: 8px; align-items: flex-start; }
#${CARD_ID} .pulse-card-title { flex: 1; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
#${CARD_ID} .pulse-card-close {
  flex: none; min-width: 24px; min-height: 24px; cursor: pointer;
  color: inherit; background: transparent; border: 1px solid rgba(165, 188, 199, 0.35); border-radius: 4px;
}
#${CARD_ID} .pulse-card-sub { opacity: 0.75; margin-top: 2px; }
#${CARD_ID} ul { list-style: none; margin: 8px 0 0; padding: 0; }
#${CARD_ID} li { margin: 3px 0; display: flex; gap: 8px; justify-content: space-between; }
#${CARD_ID} li .pulse-card-note { opacity: 0.7; white-space: nowrap; }
#${CARD_ID} a { color: #9fd3ff; text-decoration: underline; overflow-wrap: anywhere; }
#${CARD_ID} .pulse-card-line { margin-top: 6px; }
#${CARD_ID} .pulse-card-meta { margin-top: 8px; opacity: 0.75; font-size: 11px; }
#${CARD_ID} .pulse-card-caveat { margin-top: 4px; font-size: 11px; opacity: 0.9; }
`;

/** Accept only http(s) URLs for rendered links. */
function safeHref(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

let owner = null;
let element = null;

function ensureElement(doc) {
  if (element && element.ownerDocument === doc && element.isConnected)
    return element;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
  element = doc.createElement('section');
  element.id = CARD_ID;
  element.hidden = true;
  element.setAttribute('role', 'region');
  element.setAttribute('aria-live', 'polite');
  doc.body.appendChild(element);
  return element;
}

function text(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = String(value);
  return node;
}

/**
 * Show a card for `ownerId`.
 * @param {string} ownerId Layer id; only the owner may hide the card later.
 * @param {{title: string, subtitle?: string, accent?: string,
 *   lines?: string[], links?: Array<{text: string, href: string, note?: string}>,
 *   source?: string, asOf?: string, caveat?: string}} model
 * @param {{document?: Document, onClose?: function}} [options]
 */
export function showPulseCard(ownerId, model, options = {}) {
  const doc = options.document ?? globalThis.document;
  if (!doc?.body) return false;
  const card = ensureElement(doc);
  owner = ownerId;
  card.replaceChildren();
  card.setAttribute('aria-label', `${model.title} details`);
  card.style.setProperty('--pulse-accent', model.accent || '#f2a65a');

  const head = doc.createElement('div');
  head.className = 'pulse-card-head';
  head.appendChild(text(doc, 'div', 'pulse-card-title', model.title));
  const close = text(doc, 'button', 'pulse-card-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close details');
  close.addEventListener('click', () => {
    hidePulseCard(ownerId, { document: doc });
    options.onClose?.();
  });
  head.appendChild(close);
  card.appendChild(head);

  if (model.subtitle)
    card.appendChild(text(doc, 'div', 'pulse-card-sub', model.subtitle));
  for (const line of model.lines || [])
    card.appendChild(text(doc, 'div', 'pulse-card-line', line));

  const links = (model.links || []).filter((link) => safeHref(link.href));
  if (links.length) {
    const list = doc.createElement('ul');
    for (const link of links) {
      const item = doc.createElement('li');
      const anchor = text(doc, 'a', '', link.text);
      anchor.href = safeHref(link.href);
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      item.appendChild(anchor);
      if (link.note)
        item.appendChild(text(doc, 'span', 'pulse-card-note', link.note));
      list.appendChild(item);
    }
    card.appendChild(list);
  }

  const meta = [
    model.source && `Source: ${model.source}`,
    model.asOf && `As of ${model.asOf}`,
  ]
    .filter(Boolean)
    .join(' · ');
  if (meta) card.appendChild(text(doc, 'div', 'pulse-card-meta', meta));
  if (model.caveat)
    card.appendChild(text(doc, 'div', 'pulse-card-caveat', model.caveat));
  card.hidden = false;
  return true;
}

/** Hide the card if `ownerId` still owns it. */
export function hidePulseCard(ownerId, options = {}) {
  if (owner !== ownerId || !element) return;
  element.hidden = true;
  element.replaceChildren();
  owner = null;
}

/** Remove the card from the page (tests and teardown). */
export function destroyPulseCard() {
  element?.remove();
  element = null;
  owner = null;
}
