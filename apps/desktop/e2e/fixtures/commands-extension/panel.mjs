// Панель для e2e: показывает свойства и счётчик, вызывает команды своего расширения.
const VERSION = '1.0.0';

export default {
  mount(container, ctx) {
    const doc = container.ownerDocument;
    const make = (tag, text, attributes = {}) => {
      const node = doc.createElement(tag);
      node.textContent = text;
      for (const [name, value] of Object.entries(attributes)) {
        node.setAttribute(name, value);
      }
      return node;
    };
    const props = make('p', '', { 'data-role': 'props' });
    const count = make('p', 'Счётчик: —', { 'data-role': 'count' });
    const result = make('p', '', { 'data-role': 'result' });
    const showProps = (value) => {
      props.textContent = `Свойства: ${JSON.stringify(value ?? null)}`;
    };
    showProps(ctx.props);
    ctx.onProps(showProps);

    const attempt = async (command, onValue) => {
      try {
        const value = await ctx.call(command);
        result.textContent = 'ok';
        onValue?.(value);
      } catch (error) {
        result.textContent = `Ошибка: ${error.message}`;
      }
    };
    const button = (label, action) => {
      const node = make('button', label);
      node.addEventListener('click', action);
      return node;
    };

    container.append(
      make('h2', `Панель приветствий v${VERSION}`),
      make('p', ctx.panelId, { 'data-role': 'panel-id' }),
      props,
      count,
      result,
      button('Прибавить', () =>
        attempt('acme.commands.bump', (value) => {
          count.textContent = `Счётчик: ${value.count}`;
        }),
      ),
      button('Уведомить', () => attempt('acme.commands.greet')),
      button('Открыть снова', () => attempt('acme.commands.open')),
      button('Сломать', () => attempt('acme.commands.boom')),
      button('Чужая команда', () => attempt('acme.victim.mark')),
      button('Подделка', () => {
        // сообщение в обход ctx.call: поле extensionId приложение не читает
        window.parent.postMessage(
          {
            dolphyFrame: 1,
            type: 'panel-call',
            callId: 'forged',
            command: 'acme.victim.mark',
            extensionId: 'acme.victim',
          },
          '*',
        );
      }),
      button('Враждебные клавиши', () => {
        // клавиши привязок приложения и своего расширения: событиями в рамке и сообщениями родителю
        for (const key of ['G', '9']) {
          for (const target of [doc, doc.activeElement ?? doc.body]) {
            target.dispatchEvent(
              new KeyboardEvent('keydown', {
                key,
                code: `Key${key}`,
                ctrlKey: true,
                metaKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
              }),
            );
          }
          for (const message of [
            { type: 'shortcut', key: `mod+shift+${key.toLowerCase()}` },
            { type: 'keydown', key, ctrlKey: true, metaKey: true, shiftKey: true },
            { type: 'shortcut', key: 'mod+shift+k' },
            { type: 'command', command: 'app:go:courses' },
          ]) {
            window.parent.postMessage({ dolphyFrame: 1, ...message }, '*');
          }
        }
        result.textContent = 'sent';
      }),
      make('input', '', { 'aria-label': 'Поле панели' }),
    );
  },
};
