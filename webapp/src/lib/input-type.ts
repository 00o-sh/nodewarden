import type { HTMLInputTypeAttribute } from 'preact';

/**
 * Props for an `<input>` whose `type` switches at runtime (e.g. a
 * show/hide-password toggle), spread as `<input {...inputTypeProps(...)} />`.
 *
 * Preact 11 types `<input>` as a union discriminated on `type`, so that each
 * input type only accepts the ARIA roles valid for it. A bare
 * `type={cond ? 'text' : 'password'}` widens to `'text' | 'password'`, which
 * matches no single member of that union and fails to typecheck. Returning a
 * union of `{ type }` objects instead lets TypeScript check the element once
 * per possible type, keeping the role checking intact and rendering a single
 * DOM node, so focus and caret survive the toggle.
 */
export function inputTypeProps<A extends HTMLInputTypeAttribute, B extends HTMLInputTypeAttribute>(
  condition: boolean,
  whenTrue: A,
  whenFalse: B
): { type: A } | { type: B } {
  return condition ? { type: whenTrue } : { type: whenFalse };
}
