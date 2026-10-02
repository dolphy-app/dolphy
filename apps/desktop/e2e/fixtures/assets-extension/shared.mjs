// Общая часть рамок фикстуры: подключает таблицу стилей, два изображения и шрифт
// расширения по адресу модуля и описывает результат в `data-role="assets-report"`.
const here = import.meta.url;

const settled = (node) =>
  new Promise((resolve) => {
    node.addEventListener('load', () => resolve('loaded'));
    node.addEventListener('error', () => resolve('error'));
  });

/**
 * `hosts` — куда добавить `<link>`: в тень и в документ (`@font-face` в тени
 * не действует, шрифт регистрирует только таблица на уровне документа).
 */
export const mountAssets = async (doc, container, hosts = [container]) => {
  const probe = doc.createElement('p');
  probe.className = 'probe';
  probe.dataset.role = 'probe';
  probe.textContent = 'Aa';
  const png = doc.createElement('img');
  png.dataset.role = 'png';
  png.alt = '';
  const svg = doc.createElement('img');
  svg.dataset.role = 'svg';
  svg.alt = '';
  const report = doc.createElement('div');
  report.dataset.role = 'assets-report';
  report.textContent = 'pending';
  container.append(probe, png, svg, report);

  const loading = [settled(png), settled(svg)];
  png.src = new URL('assets/pixel.png', here).href;
  svg.src = new URL('assets/shape.svg', here).href;
  for (const host of hosts) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('assets/panel.css', here).href;
    loading.push(settled(link));
    host.append(link);
  }
  const states = await Promise.all(loading);

  let font = 'missing';
  try {
    const faces = await doc.fonts.load('16px "Acme Font"', 'A');
    if (faces.length > 0 && doc.fonts.check('16px "Acme Font"', 'A')) {
      font = 'loaded';
    }
  } catch {
    font = 'error';
  }
  const color = doc.defaultView.getComputedStyle(probe).color;
  const result = {
    sheets: states.slice(2).join(','),
    css: color === 'rgb(1, 2, 3)' ? 'applied' : color,
    png: String(png.naturalWidth),
    svg: String(svg.naturalWidth),
    font,
  };
  Object.assign(report.dataset, result);
  report.textContent = Object.entries(result)
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');
};
