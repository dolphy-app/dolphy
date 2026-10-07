import { defineMountable } from './define-entry.ts';
import type { MountContext, Mountable, AppApi } from './define-entry.ts';
import type { ExtensionEngine } from '@dolphy-app/engine-contract';
import type {
  AppLocale,
  AppTheme,
  InjectionHandle,
  PanelHandle,
  RpcContract,
} from '@dolphy-app/extension-api';
import {
  Component,
  createContext,
  createElement,
  StrictMode,
  useContext,
  useMemo,
} from 'react';
import type { ComponentType, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** What `reactComponent` gives its tree: the context and the values that change. */
interface DolphyState {
  readonly ctx: MountContext<unknown, unknown>;
  readonly theme: AppTheme;
  readonly locale: AppLocale;
}

const DolphyContext = createContext<DolphyState | null>(null);

const useDolphyState = (hook: string): DolphyState => {
  const state = useContext(DolphyContext);
  if (state === null) {
    throw new Error(
      `${hook}() works inside a component that reactComponent() draws, there is no Dolphy context here`,
    );
  }
  return state;
};

/**
 * The `MountContext` of the component drawn by `reactComponent`. `Props` and
 * `Handle` are the ones of the surface: pick them by the way the component is
 * registered. Only inside a component that `reactComponent` draws.
 */
export const useMountContext = <
  Props = unknown,
  Handle = undefined,
>(): MountContext<Props, Handle> => {
  const { ctx } = useDolphyState('useMountContext');
  // the context holds `MountContext<unknown, unknown>`; the caller names the surface it was registered for
  return ctx as MountContext<Props, Handle>;
};

/** The window API, the same object as `useApp()` of a Vue component. Only inside a component that `reactComponent` draws. */
export const useApp = (): AppApi => useDolphyState('useApp').ctx.app;

/** The engine client of the window, the same object as `useEngine()` of a Vue component. Only inside a component that `reactComponent` draws. */
export const useEngine = (): ExtensionEngine =>
  useDolphyState('useEngine').ctx.engine;

/**
 * Binds the contract to the server part of this extension, as `useRpc` of a
 * Vue component does: the returned function validates the input and the
 * answer with the contract and rejects with an `Error` on a failure. The
 * function is stable while the contract is. Only inside a component that
 * `reactComponent` draws.
 */
export const useRpc = <Input, Output>(
  contract: RpcContract<Input, Output>,
): ((input: Input) => Promise<Output>) => {
  const { ctx } = useDolphyState('useRpc');
  return useMemo(
    () => (input: Input) => ctx.callRpc(contract, input),
    [ctx, contract],
  );
};

/**
 * The handle of the panel the component is drawn for: `panelId`, `props`,
 * `context` (the current values; the component renders again when they change)
 * and `call` for the commands of this extension. Only inside a panel.
 */
export const usePanel = <
  Commands extends string = string,
>(): PanelHandle<Commands> => {
  const { handle } = useDolphyState('usePanel').ctx;
  if (typeof handle !== 'object' || handle === null || !('panelId' in handle)) {
    throw new Error(
      'usePanel() works inside a panel component that the app draws, there is no panel here',
    );
  }
  // the panel handle is the only one with a panel id; its commands are the ones of this extension
  return handle as PanelHandle<Commands>;
};

/** The handle of the injected component: the `target` element and the `position`. Only inside a component that `client.addInjection` registered. */
export const useInjection = (): InjectionHandle => {
  const { handle } = useDolphyState('useInjection').ctx;
  if (
    typeof handle !== 'object' ||
    handle === null ||
    !('target' in handle) ||
    !('position' in handle)
  ) {
    throw new Error(
      'useInjection() works inside an injected component that the app draws, there is no injection here',
    );
  }
  // an object with `target` and `position` is the injection handle
  return handle as InjectionHandle;
};

/** The theme the window shows; the component renders again when it changes. Only inside a component that `reactComponent` draws. */
export const useTheme = (): AppTheme => useDolphyState('useTheme').theme;

/** The language of the window; the component renders again when it changes. Only inside a component that `reactComponent` draws. */
export const useLocale = (): AppLocale => useDolphyState('useLocale').locale;

interface BoundaryProps {
  readonly onError: (error: unknown) => void;
  readonly children?: ReactNode;
}

interface BoundaryState {
  readonly failed: boolean;
}

/** Catches the errors of the render, reports them to the app and draws nothing: the app shows its own card in place of the element. */
class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export interface ReactComponentOptions {
  /** Draws the component inside `React.StrictMode`; default `false`. */
  strictMode?: boolean;
}

/**
 * Wraps a React component into a `Mountable`: the app gives it an element, the
 * adapter draws `<Component {...ctx.props} />` into it with `createRoot`, draws
 * it again when the props, the theme or the language change and unmounts the
 * root on cleanup. An error of the render goes to `ctx.reportError`. Inside
 * the component `useApp`, `useEngine`, `useRpc`, `usePanel`, `useInjection`,
 * `useTheme`, `useLocale` and `useMountContext` work. `Props` and `Handle` are
 * those of the surface the component is registered for, such as
 * `PanelProps` and `PanelHandle`.
 */
/*#__NO_SIDE_EFFECTS__*/
export const reactComponent = <Props extends object, Handle = undefined>(
  component: ComponentType<Props>,
  options: ReactComponentOptions = {},
): Mountable<Props, Handle> =>
  defineMountable<Props, Handle>((el, ctx) => {
    let alive = true;
    const root = createRoot(el, {
      onCaughtError: () => undefined,
      onUncaughtError: (error) => ctx.reportError(error),
    });
    const render = (): void => {
      if (!alive) return;
      const state: DolphyState = {
        ctx,
        theme: ctx.theme,
        locale: ctx.locale,
      };
      const tree = createElement(
        DolphyContext.Provider,
        { value: state },
        createElement(
          ErrorBoundary,
          { onError: ctx.reportError },
          createElement(component, ctx.props),
        ),
      );
      flushSync(() => {
        root.render(
          options.strictMode === true
            ? createElement(StrictMode, null, tree)
            : tree,
        );
      });
    };
    render();
    const stops = [
      ctx.onProps(render),
      ctx.onTheme(render),
      ctx.onLocale(render),
    ];
    return () => {
      alive = false;
      for (const stop of stops) stop();
      root.unmount();
    };
  });
