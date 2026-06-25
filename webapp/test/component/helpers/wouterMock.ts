// A small, faithful stand-in for `wouter` for jsdom component tests.
//
// Why this exists: under the vitest jsdom config, `wouter` resolves its internal
// `react` import to the *real* React package (the preact→react alias that the
// @preact/preset-vite plugin injects for the app build is not applied to wouter's
// already-resolved node_modules import). Rendering real wouter therefore throws
// "Cannot read properties of null (reading 'useContext')" because there is no
// React renderer. Rather than fight the resolver, we mock `wouter` with a tiny
// preact-native implementation that reproduces exactly the routing surface the
// app-shell components rely on:
//   - <Switch>      renders the FIRST matching <Route> child (wouter semantics)
//   - <Route path>  renders its children only when path === window.location.pathname
//                   (the shell only uses exact, param-free paths)
//   - <Link href>   renders an <a> and navigates via history.pushState on click,
//                   re-rendering subscribed Route/Switch instances.
//
// Tests opt in with: vi.mock('wouter', () => createWouterMock());
//
// Limitations vs. real wouter (acceptable for these orchestration tests): only
// exact string paths, no route params/regex, no nested base routers.
export async function createWouterMock() {
  // Use dynamic import (not require) so we get the SAME preact instance the
  // renderer uses; a CJS require resolves a duplicate module whose hook state is
  // disconnected (manifests as "Cannot read properties of undefined (reading
  // '__H')").
  const { useReducer, useEffect } = await import('preact/hooks');
  const { toChildArray, h } = await import('preact');

  const listeners = new Set<() => void>();

  function navigate(to: string) {
    window.history.pushState(null, '', to);
    listeners.forEach((l) => l());
  }

  // Subscribe a component to location changes and return the current pathname.
  function useLoc(): string {
    const [, force] = useReducer((c: number) => c + 1, 0);
    useEffect(() => {
      const update = () => force();
      listeners.add(update);
      window.addEventListener('popstate', update);
      return () => {
        listeners.delete(update);
        window.removeEventListener('popstate', update);
      };
    }, []);
    return window.location.pathname;
  }

  function Route(props: { path?: string; children?: unknown }) {
    const loc = useLoc();
    if (props.path !== undefined && props.path !== loc) return null;
    if (typeof props.children === 'function') return (props.children as (p: unknown) => unknown)({});
    return (props.children as never) ?? null;
  }

  function Switch(props: { children?: unknown }) {
    const loc = useLoc();
    const kids = toChildArray(props.children as never) as Array<{ props?: { path?: string } }>;
    for (const child of kids) {
      const p = child?.props?.path;
      if (p === undefined || p === loc) return child as never;
    }
    return null;
  }

  function Link(props: { href: string; children?: unknown; className?: string; [k: string]: unknown }) {
    const { href, children, className, ...rest } = props;
    return h(
      'a',
      {
        ...rest,
        href,
        className,
        onClick: (e: Event) => {
          e.preventDefault();
          navigate(href);
        },
      },
      children as never
    );
  }

  return {
    Route,
    Switch,
    Link,
    useLocation: () => [window.location.pathname, navigate] as const,
    Router: (p: { children?: unknown }) => p.children as never,
    Redirect: () => null,
    navigate,
  };
}
