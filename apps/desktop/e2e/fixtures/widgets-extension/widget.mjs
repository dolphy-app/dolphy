// Виджеты для e2e: карточка с курсом и счётчиком, короткий и длинный по высоте.
const VERSION = '1.0.0';

const make = (doc, tag, text, attributes = {}) => {
  const node = doc.createElement(tag);
  node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  return node;
};

const card = (container, ctx) => {
  const doc = container.ownerDocument;
  const course = make(doc, 'p', '', { 'data-role': 'course' });
  const showCourse = ({ courseId }) => {
    course.textContent = `Курс: ${courseId ?? 'все'}`;
  };
  showCourse(ctx.context);
  ctx.onContextChange(showCourse);
  const result = make(doc, 'p', '', { 'data-role': 'result' });
  const attempt = async (command) => {
    try {
      const value = await ctx.call(command);
      result.textContent = `ok ${JSON.stringify(value ?? null)}`;
    } catch (error) {
      result.textContent = `Ошибка: ${error.message}`;
    }
  };
  const button = (label, command) => {
    const node = make(doc, 'button', label);
    node.addEventListener('click', () => attempt(command));
    return node;
  };
  const box = make(doc, 'div', '');
  box.style.height = '120px';
  // поля абзацев не должны «выпадать» из блока и менять высоту рамки
  box.style.display = 'flow-root';
  box.append(
    make(doc, 'p', `Карточка v${VERSION}`, { 'data-role': 'version' }),
    course,
    result,
    button('Прибавить', 'acme.widgets.count'),
    button('Чужая команда', 'acme.victim.mark'),
  );
  container.append(box);
};

const short = (container) => {
  container.append(make(container.ownerDocument, 'p', 'Коротко'));
};

const tall = (container) => {
  const doc = container.ownerDocument;
  const box = make(doc, 'div', 'Длинное содержимое');
  box.style.height = '600px';
  box.setAttribute('data-role', 'tall');
  container.append(box);
};

const widgets = {
  'acme.widgets.card': card,
  'acme.widgets.short': short,
  'acme.widgets.tall': tall,
};

export default {
  mount(container, ctx) {
    widgets[ctx.widgetId](container, ctx);
  },
};
