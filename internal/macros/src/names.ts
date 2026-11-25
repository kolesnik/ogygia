/**
 * The names ogygia's macros own or will own (decisions-for-review #3): a plain list, so a tool that
 * must not load the compiler (the lint plugin) reads it. Every macro's names are in it (a test
 * holds that).
 *
 * @packageDocumentation
 */

/** Every `$` name reserved for ogygia's macros. */
export const MACRO_NAMES: ReadonlyArray<string> = [
	'$await',
	'$build',
	'$decisions',
	'$dev',
	'$err',
	'$hot',
	'$layout',
	'$machine',
	'$rules',
	'$scope',
	'$warn'
];
