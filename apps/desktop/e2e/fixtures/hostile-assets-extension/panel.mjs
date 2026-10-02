// «Враждебная» панель: пробует загрузить чужие скрипт, таблицу стилей, изображения и шрифт
// разными путями (import, link, img, CSS @import, url(), @font-face), а также манифест и README.
// Каждая проба выводит строку `<проба>: blocked|reachable` в `[data-probe]`.
const VICTIM = 'dolphy-ext://acme.assets';
const SELF = new URL('./', import.meta.url).href.replace(/\/$/, '');
const WAIT_MS = 2500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settled = (node, parent) =>
  Promise.race([
    new Promise((resolve) => {
      node.addEventListener('load', () => resolve('reachable'));
      node.addEventListener('error', () => resolve('blocked'));
      parent.append(node);
    }),
    delay(WAIT_MS).then(() => 'blocked'),
  ]);

const viaImport = async (url) => {
  try {
    await import(url);
    return 'reachable';
  } catch {
    return 'blocked';
  }
};
const viaLink = (url) => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  return settled(link, document.head);
};
const viaImg = (url) => {
  const img = document.createElement('img');
  img.src = url;
  return settled(img, document.body);
};
const viaStyle = async (css, check) => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  await delay(WAIT_MS);
  return check();
};
// таблица, подключённая через @import, применилась к элементу с классом `name`
const viaImportRule = (url, name, color) =>
  viaStyle(`@import url(${url});`, () => {
    const probe = document.createElement('div');
    probe.className = name;
    document.body.append(probe);
    const applied = getComputedStyle(probe).color === color;
    probe.remove();
    return applied ? 'reachable' : 'blocked';
  });
// картинку из `url()` загрузкой не проверить: событий у неё нет. Пробы идут по очереди, и
// запрет CSP на `img-src` за время пробы значит, что запрос остановлен
let imgViolations = 0;
document.addEventListener('securitypolicyviolation', (event) => {
  if (event.effectiveDirective === 'img-src') imgViolations += 1;
});
const viaBackground = async (url) => {
  const before = imgViolations;
  const box = document.createElement('div');
  box.style.cssText = `width:4px;height:4px;background-image:url(${url})`;
  document.body.append(box);
  await delay(1000);
  return imgViolations > before ? 'blocked' : 'reachable';
};
const viaFontFace = async (family, url) => {
  const style = document.createElement('style');
  style.textContent = `@font-face { font-family: ${family}; src: url(${url}) format('woff2'); }`;
  document.head.append(style);
  const face = [...document.fonts].find((item) => item.family === family);
  try {
    await Promise.race([face.load(), delay(WAIT_MS)]);
  } catch {
    return 'blocked';
  }
  return face.status === 'loaded' ? 'reachable' : 'blocked';
};
const viaFetch = async (url) => {
  try {
    await fetch(url);
    return 'reachable';
  } catch {
    return 'blocked';
  }
};

const probes = [
  // контроль: свои ресурсы доступны, значит пробы измеряют именно CSP и протокол
  ['control: own png via img', () => viaImg(`${SELF}/assets/own.png`)],
  ['control: own css via link', () => viaLink(`${SELF}/assets/own.css`)],
  ['control: own css via @import', () => viaImportRule(`${SELF}/assets/own-import.css`, 'own-import', 'rgb(7, 8, 9)')],
  ['control: own png via css url()', () => viaBackground(`${SELF}/assets/own.png`)],
  ['control: own font via @font-face', () => viaFontFace('OwnFont', `${SELF}/assets/own.woff2`)],
  // чужое расширение
  ['other: script via import()', () => viaImport(`${VICTIM}/shared.mjs`)],
  ['other: main via import()', () => viaImport(`${VICTIM}/main.mjs`)],
  ['other: css via link', () => viaLink(`${VICTIM}/assets/panel.css`)],
  ['other: png via img', () => viaImg(`${VICTIM}/assets/pixel.png`)],
  ['other: svg via img', () => viaImg(`${VICTIM}/assets/shape.svg`)],
  ['other: font via @font-face', () => viaFontFace('StolenFont', `${VICTIM}/assets/font.woff2`)],
  ['other: css via @import', () => viaImportRule(`${VICTIM}/assets/panel.css`, 'probe', 'rgb(1, 2, 3)')],
  ['other: png via css url()', () => viaBackground(`${VICTIM}/assets/pixel.png`)],
  // манифест и README: не отдаются никому, в том числе своему расширению
  ['other: extension.json via link', () => viaLink(`${VICTIM}/extension.json`)],
  ['other: README.md via img', () => viaImg(`${VICTIM}/README.md`)],
  ['own: extension.json via import()', () => viaImport(`${SELF}/extension.json`)],
  ['own: extension.json via link', () => viaLink(`${SELF}/extension.json`)],
  ['own: README.md via img', () => viaImg(`${SELF}/README.md`)],
  ['own: extension.json via fetch', () => viaFetch(`${SELF}/extension.json`)],
];

export default {
  mount(container) {
    const evil = document.createElement('button');
    evil.textContent = 'Открыть SVG';
    evil.addEventListener('click', () => {
      // страница SVG заменяет рамку: скрипты в ней не должны выполниться
      window.location.href = `${SELF}/assets/evil.svg`;
    });
    container.append(evil);
    const lines = probes.map(([name]) => {
      const line = document.createElement('div');
      line.dataset.probe = name;
      line.textContent = `${name}: pending`;
      container.append(line);
      return line;
    });
    void (async () => {
      for (const [index, [name, run]] of probes.entries()) {
        lines[index].textContent = `${name}: ${await run()}`;
      }
    })();
  },
};
