/**
 * The one oxc parser: rolldown's, the one Vite bundles and `@ogygia/compiler` parses app code with,
 * so ogygia's build loads one oxc and every compiler reads the same tree.
 *
 * @packageDocumentation
 */
export { parseSync } from 'rolldown/utils';
