/**
 * A tiny signatures module for the ambient-types test.
 *
 * @packageDocumentation
 */

/** A point, as the macros read one. */
type XY = { readonly x: number; readonly y: number };

/** Twice a number. */
export declare function $twice(value: number): number;

/** Points as plain arithmetic. */
export declare namespace $geo {
	/** A point's length. */
	function length(p: XY): number;
}

/** A size, exported for its docs: a helper, not a global. */
export type Size = { readonly width: number };
