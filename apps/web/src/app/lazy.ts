import { lazy, type ComponentType } from 'react';

/** A screen loaded on first visit. Screens use named exports, React.lazy wants a default one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- React.lazy's own constraint
type AnyComponent = ComponentType<any>;

export function page<M extends Record<K, AnyComponent>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy<M[K]>(async () => ({ default: (await load())[name] }));
}
