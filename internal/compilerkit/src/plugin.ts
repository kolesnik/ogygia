/**
 * The build-tool adapter: a Vite / rolldown / tsdown plugin that runs a compiler on each source
 * file before anything else sees it (`enforce: 'pre'`), and at the end of a bundle emits what
 * the compiles gathered (an asset such as a map of every machine) and passes on their warnings.
 *
 * @packageDocumentation
 */

/** What a compile of one file gives the plugin. */
export interface Compiled {
	readonly code: string;
	readonly map: unknown;
	/** What the build could not prove: each said once, at the bundle's end. */
	readonly warnings?: ReadonlyArray<string>;
}

/** The plugin's options. */
export interface PluginOptions<C extends Compiled> {
	readonly name: string;
	/** A file the compiler never sees. Default: anything but `.ts` sources outside `node_modules`. */
	readonly skip?: (file: string) => boolean;
	/** Compiles one file, or null when it has nothing to compile. */
	readonly compile: (code: string, file: string) => C | null;
	/** A build starts: the state the compiles share is reset. */
	readonly start?: () => void;
	/** Each compile's result, after the plugin took its code. */
	readonly took?: (compiled: C) => void;
	/** The bundle is written: emit what the compiles gathered. */
	readonly bundle?: (emit: (fileName: string, source: string) => void) => void;
}

/** Whether a file is not a TypeScript source the compiler reads. */
export function notSource(file: string): boolean {
	return !/\.[cm]?ts$/.test(file) || /\.d\.[cm]?ts$/.test(file) || file.includes('/node_modules/');
}

/** The plugin. */
export function macroPlugin<C extends Compiled>(options: PluginOptions<C>) {
	const warnings = new Set<string>();
	const skip = options.skip ?? notSource;
	return {
		name: options.name,
		enforce: 'pre' as const,
		buildStart() {
			warnings.clear();
			options.start?.();
		},
		transform: {
			order: 'pre' as const,
			handler(code: string, id: string): { code: string; map: C['map'] } | null {
				const file = id.split('?')[0]!;
				if (skip(file)) return null;
				const out = options.compile(code, file);
				if (out === null) return null;
				for (const w of out.warnings ?? []) warnings.add(w);
				options.took?.(out);
				return { code: out.code, map: out.map };
			}
		},
		generateBundle(this: {
			emitFile(file: { type: 'asset'; fileName: string; source: string }): void;
			warn(message: string): void;
		}) {
			for (const w of warnings) this.warn(w);
			options.bundle?.((fileName, source) => this.emitFile({ type: 'asset', fileName, source }));
		}
	};
}
