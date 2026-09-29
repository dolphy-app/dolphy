/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface Window {
  // expose in the `electron/preload/index.ts`
  lms: import('../shared/bridge.ts').LmsBridge;
}
