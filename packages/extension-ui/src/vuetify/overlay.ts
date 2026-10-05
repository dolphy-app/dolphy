/**
 * An open dialog, menu or tooltip is drawn inside the frame and is clipped by its
 * border. The frame of the `answer`, `markdown` and `widget` modes is as tall as its
 * content, so a component asks the app for more: the `dolphy-overlay` event (frame
 * protocol) with the height it needs, `null` when nothing is open. The app limits
 * the height to the window; the `panel` mode fills the frame and ignores the event.
 *
 * Several overlays can be open at once: the largest request wins.
 */

export const OVERLAY_EVENT = 'dolphy-overlay';

const requests = new Map<symbol, number>();
let sent: number | null = null;

const needed = (): number | null =>
  requests.size === 0 ? null : Math.max(...requests.values());

/** Tells the app how tall the frame must be for the overlay `key`; `null` — the overlay is closed. */
export const requestOverlayHeight = (
  doc: Document,
  key: symbol,
  height: number | null,
): void => {
  if (height === null) requests.delete(key);
  else requests.set(key, Math.max(0, Math.ceil(height)));
  const next = needed();
  if (next === sent) return;
  sent = next;
  doc.dispatchEvent(
    new CustomEvent(OVERLAY_EVENT, {
      detail: { height: next },
      bubbles: true,
      composed: true,
    }),
  );
};
