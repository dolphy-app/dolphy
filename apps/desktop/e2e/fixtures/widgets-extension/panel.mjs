// Панель для e2e виджетов: показывает курс из ctx.context.
export default {
  mount(container, ctx) {
    const doc = container.ownerDocument;
    const course = doc.createElement('p');
    course.setAttribute('data-role', 'course');
    const show = ({ courseId }) => {
      course.textContent = `Курс: ${courseId ?? 'все'}`;
    };
    show(ctx.context);
    ctx.onContextChange(show);
    container.append(course);
  },
};
