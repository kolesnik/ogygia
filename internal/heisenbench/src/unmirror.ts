/**
 * A bench report's paths as the source files they count: a core file with macros runs from its
 * compiled mirror (`.heisenbench/macros/<mode>/<path>`, ./macros.ts), and every id names `<path>`.
 */
const MIRRORED_RE = /\.heisenbench\/macros\/(?:dev|prod)\//g;

/** `text` with each mirror path named as the source file it compiles. */
export function unmirror(text: string): string {
	return text.replaceAll(MIRRORED_RE, '');
}
