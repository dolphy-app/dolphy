// Панель на React (`reactComponent`) и вставка на чистом DOM (`defineMountable`) в якорь «Плана на сегодня».
// Собирается `dolphy-ext build` с пресетом `react`: react и react-dom входят в бандл.
import { useEffect, useState } from 'react';
import {
  anchorSelector,
  defineClient,
  defineMountable,
} from '@dolphy-app/extension-sdk';
import {
  reactComponent,
  useApp,
  useInjection,
  useLocale,
  usePanel,
  useRpc,
  useTheme,
} from '@dolphy-app/extension-sdk/react';
import { greetRpc } from './shared/rpc.ts';

/** Счётчики, которые e2e читает со страницы окна: сколько раз создавался и убирался компонент. */
const counters = (): { created: number; unmounted: number; domCleanups: number } => {
  const key = '__reactExtension';
  const holder = globalThis as Record<string, unknown>;
  holder[key] ??= { created: 0, unmounted: 0, domCleanups: 0 };
  return holder[key] as { created: number; unmounted: number; domCleanups: number };
};

counters();

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const Bomb = () => {
  throw new Error('react render boom');
};

const Panel = () => {
  const app = useApp();
  const greet = useRpc(greetRpc);
  const panel = usePanel();
  const theme = useTheme();
  const locale = useLocale();
  const [instance] = useState(() => (counters().created += 1));
  const [result, setResult] = useState('');
  const [clicks, setClicks] = useState(0);
  const [broken, setBroken] = useState(false);
  useEffect(
    () => () => {
      counters().unmounted += 1;
    },
    [],
  );
  if (broken) return <Bomb />;
  return (
    <div data-testid="react-panel">
      <p data-role="instance">Экземпляр {instance}</p>
      <p data-role="panel-id">{panel.panelId}</p>
      <p data-role="props">{JSON.stringify(panel.props ?? null)}</p>
      <p data-role="theme">Тема: {theme.id}</p>
      <p data-role="locale">Язык: {locale}</p>
      <p data-role="clicks">Нажатий {clicks}</p>
      <p data-role="result">{result}</p>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        Нажать
      </button>
      <button type="button" onClick={() => app.notify('Привет из React')}>
        Уведомить
      </button>
      <button
        type="button"
        onClick={() => {
          greet({ name: 'React' }).then(
            (reply) => setResult(`ok ${reply.text}`),
            (error: unknown) => setResult(`Ошибка: ${message(error)}`),
          );
        }}
      >
        Поздороваться
      </button>
      <button type="button" onClick={() => setBroken(true)}>
        Сломать
      </button>
    </div>
  );
};

const Card = () => {
  const theme = useTheme();
  const injection = useInjection();
  const [broken, setBroken] = useState(false);
  if (broken) return <Bomb />;
  return (
    <div data-testid="react-injection">
      <p data-role="theme">Тема: {theme.id}</p>
      <p data-role="position">{injection.position}</p>
      <button type="button" onClick={() => setBroken(true)}>
        Сломать вставку
      </button>
    </div>
  );
};

/** Вставка без фреймворка: только DOM и `MountContext`. */
const DomCard = defineMountable((el, ctx) => {
  const card = document.createElement('div');
  card.dataset['testid'] = 'react-dom-injection';
  const theme = document.createElement('p');
  theme.dataset['role'] = 'theme';
  const locale = document.createElement('p');
  locale.dataset['role'] = 'locale';
  const showTheme = () => {
    theme.textContent = `Тема: ${ctx.theme.id}`;
  };
  const showLocale = () => {
    locale.textContent = `Язык: ${ctx.locale}`;
  };
  showTheme();
  showLocale();
  card.append(theme, locale);
  el.append(card);
  const stops = [ctx.onTheme(showTheme), ctx.onLocale(showLocale)];
  return () => {
    for (const stop of stops) stop();
    card.remove();
    counters().domCleanups += 1;
  };
});

export const client = defineClient((c) => {
  c.addPanel({
    id: 'acme.react.main',
    title: { en: 'React panel', ru: 'React-панель' },
    component: reactComponent(Panel),
  });
  c.addInjection({
    id: 'acme.react.card',
    target: anchorSelector('dailyPlan'),
    component: reactComponent(Card),
  });
  c.addInjection({
    id: 'acme.react.dom',
    target: anchorSelector('dailyPlan'),
    component: DomCard,
  });
});
