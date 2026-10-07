import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const Counter = ({ name }: { name: string }) => {
  const [count, setCount] = useState(0);
  return (
    <button
      type="button"
      onClick={() => flushSync(() => setCount(count + 1))}
    >
      Hello, {name}: {count}
    </button>
  );
};

export const mount = (el: HTMLElement) => {
  const root = createRoot(el);
  flushSync(() => root.render(<Counter name="world" />));
  return () => flushSync(() => root.unmount());
};
