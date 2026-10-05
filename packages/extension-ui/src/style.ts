/**
 * The kit stylesheet. Colours and the font come from the CSS variables the app
 * sends to every extension frame (`--v-theme-*`, `--v-border-*`, see the
 * `theme` message of the frame protocol); the second argument of every `var()`
 * is a light-theme fallback for a page that has no theme (tests, a browser).
 * The variables hold `r, g, b` triplets, so they go into `rgb()`/`rgba()`.
 */

const STYLE_ID = 'dolphy-ui-kit';

const colour = (name: string, fallback: string, alpha?: number): string =>
  alpha === undefined
    ? `rgb(var(--v-theme-${name}, ${fallback}))`
    : `rgba(var(--v-theme-${name}, ${fallback}), ${alpha})`;

const SURFACE = colour('surface', '255, 255, 255');
const BACKGROUND = colour('background', '245, 246, 251');
const TEXT = colour('on-surface', '0, 0, 0');
const TEXT_ON_BACKGROUND = colour('on-background', '0, 0, 0');
const LINE = colour('on-surface', '0, 0, 0', 0.5);
const SOFT_LINE =
  'rgba(var(--v-border-color, 0, 0, 0), var(--v-border-opacity, 0.12))';
const PRIMARY = colour('primary', '25, 118, 210');
const ON_PRIMARY = colour('on-primary', '255, 255, 255');
const ERROR = colour('error', '176, 0, 32');
const HOVER = colour('on-surface', '0, 0, 0', 0.08);
const SELECTED = colour('primary', '25, 118, 210', 0.16);

const FOCUS = `outline: 2px solid ${PRIMARY}; outline-offset: 2px;`;

export const STYLES = `
body:has(.dui){background:${BACKGROUND};color:${TEXT_ON_BACKGROUND};padding:16px}
.dui,.dui *{box-sizing:border-box}
.dui-card{background:${SURFACE};color:${TEXT};border:1px solid ${SOFT_LINE};border-radius:8px;padding:16px;margin:0 0 16px}
.dui-card>:last-child{margin-bottom:0}
.dui-title{font-size:16px;font-weight:600;line-height:1.4;margin:0 0 8px}
.dui-text{opacity:.75;margin:0 0 8px}
.dui-empty{background:${SURFACE};color:${TEXT};border:1px dashed ${LINE};border-radius:8px;padding:24px 16px;text-align:center}
.dui-empty>:last-child{margin-bottom:0}
.dui-button{appearance:none;font:inherit;font-weight:500;min-height:36px;min-width:36px;padding:6px 16px;border-radius:6px;border:1px solid ${LINE};background:${SURFACE};color:${TEXT};cursor:pointer}
.dui-button:hover:not(:disabled){background:${HOVER}}
.dui-button--primary{background:${PRIMARY};border-color:${PRIMARY};color:${ON_PRIMARY}}
.dui-button--primary:hover:not(:disabled){background:${PRIMARY};filter:brightness(1.12)}
.dui-button--danger{border-color:${ERROR};color:${ERROR}}
.dui-button--danger:hover:not(:disabled){background:${colour('error', '176, 0, 32', 0.12)}}
.dui-button:disabled,.dui-toggle:disabled,.dui-input:disabled{cursor:not-allowed;opacity:.6}
.dui-button:focus-visible,.dui-input:focus-visible,.dui-toggle:focus-visible,.dui-item:focus-visible{${FOCUS}}
.dui-field{display:flex;flex-direction:column;gap:4px;margin:0 0 12px}
.dui-label{font-weight:500}
.dui-hint{opacity:.75;font-size:13px}
.dui-error{color:${ERROR};font-size:13px}
.dui-input{font:inherit;min-height:36px;padding:6px 10px;border-radius:6px;border:1px solid ${LINE};background:${SURFACE};color:${TEXT};width:100%}
.dui-input[aria-invalid="true"]{border-color:${ERROR};border-width:2px}
.dui-toggle{appearance:none;display:flex;align-items:center;gap:10px;min-height:36px;padding:4px 0;margin:0 0 12px;border:0;background:none;color:inherit;cursor:pointer;text-align:left}
.dui-track{position:relative;flex:none;width:40px;height:22px;border-radius:11px;border:2px solid ${LINE};background:transparent}
.dui-track::after{content:"";position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:${LINE};transition:transform .12s}
.dui-toggle[aria-checked="true"] .dui-track{background:${PRIMARY};border-color:${PRIMARY}}
.dui-toggle[aria-checked="true"] .dui-track::after{background:${ON_PRIMARY};transform:translateX(18px)}
.dui-list{list-style:none;margin:0 0 12px;padding:0;background:${SURFACE};color:${TEXT};border:1px solid ${LINE};border-radius:8px;overflow:hidden}
.dui-item{padding:8px 12px;cursor:pointer;border-bottom:1px solid ${SOFT_LINE}}
.dui-item:last-child{border-bottom:0}
.dui-item:hover:not([aria-disabled="true"]){background:${HOVER}}
.dui-item[aria-selected="true"]{background:${SELECTED};font-weight:600}
.dui-item[aria-disabled="true"]{opacity:.6;cursor:not-allowed}
.dui-item .dui-text{font-weight:400;margin:0}
.dui-item:focus-visible{outline-offset:-2px}
@media (prefers-reduced-motion:reduce){.dui-track::after{transition:none}}
`.replaceAll('\n', '');

/** Inserts the stylesheet into the document once; later calls and a second bundled copy of the kit find the element. */
export const ensureStyles = (doc: Document): void => {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).append(style);
};
