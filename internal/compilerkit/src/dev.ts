/**
 * Development only: code behind the check every app bundler folds (`process.env.NODE_ENV` set to
 * `'production'`), so a production bundle drops it and whatever only it reaches.
 *
 * @packageDocumentation
 */
import type { N } from './ast.ts';
import type { Emitter } from './emitter.ts';

/** The development check, as output writes it. */
export const DEV_CHECK = "process.env.NODE_ENV !== 'production'";

/** Puts `node` (a call that is a statement) behind the development check: `DEV_CHECK && node`. */
export function devOnly(emitter: Emitter, node: N): void {
	emitter.s.appendLeft(node.start, `${DEV_CHECK} && `);
}
