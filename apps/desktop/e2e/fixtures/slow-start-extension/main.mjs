// activate() не завершается никогда: приложение должно остановить ожидание по сроку активации.
export default {
  activate() {
    return new Promise(() => {});
  },
};
