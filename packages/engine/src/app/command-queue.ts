export interface CommandQueue {
  /** Выполняет задачи строго по одной, в порядке постановки. */
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  /** Завершается, когда все поставленные к этому моменту задачи закончены. */
  idle(): Promise<void>;
}

/** Очередь — цепочка промисов: ошибка задачи не рвёт цепочку. */
export const createCommandQueue = (): CommandQueue => {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.catch(() => null);
    return result;
  };
  const idle = async (): Promise<void> => {
    await tail;
  };
  return { enqueue, idle };
};
