/**
 * ogygia's macros, in walk order: at each node the first macro whose pass takes it owns it.
 *
 * @packageDocumentation
 */
import type { Macro } from 'ogygia-internal-compilerkit';
import type { Compiler } from './compiler.ts';

/** Every macro, in walk order. */
export const MACROS: ReadonlyArray<Macro<Compiler>> = [];
