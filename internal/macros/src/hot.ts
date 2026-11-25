/**
 * The places a `$hot` function allocates on purpose, each named with its reason. A hot function
 * names one with `$hot.allow('<name>', expr)`; any other allocation in it fails the build. The list
 * is closed: a new exception is a change to this table, reviewed like code.
 *
 * @packageDocumentation
 */
export const HOT_EXCEPTIONS: Readonly<Record<string, string>> = {
	grow: 'an array pushed to past its length grows its backing store, amortized: one allocation per doubling, not per call'
};

/** The DOM calls that force a layout (a style and layout flush) when the page changed since the
 *  last one. */
export const LAYOUT_CALLS: ReadonlySet<string> = new Set([
	'getBoundingClientRect',
	'getClientRects',
	'getComputedStyle',
	'elementFromPoint',
	'elementsFromPoint',
	'scrollIntoView',
	'focus'
]);

/** The DOM reads that force a layout. */
export const LAYOUT_READS: ReadonlySet<string> = new Set([
	'offsetTop',
	'offsetLeft',
	'offsetWidth',
	'offsetHeight',
	'offsetParent',
	'clientTop',
	'clientLeft',
	'clientWidth',
	'clientHeight',
	'scrollTop',
	'scrollLeft',
	'scrollWidth',
	'scrollHeight',
	'innerText'
]);

/** Methods that never allocate, on any receiver they exist on. */
export const PURE_METHODS: ReadonlySet<string> = new Set([
	'charCodeAt',
	'codePointAt',
	'pop',
	'includes',
	'indexOf',
	'lastIndexOf',
	'contains',
	'hasAttribute'
]);
