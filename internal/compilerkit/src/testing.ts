/**
 * Test helpers for a compiler built on the kit: a refusal checked by its message (and its place),
 * and an input's output as text for a snapshot.
 *
 *   check(() => compile(bad)).fails('x.ts:3:5  `$hot` …')
 *   expect(output(compile, source)).toMatchSnapshot()
 *
 * @packageDocumentation
 */

/** What a check of a compile says. */
export interface Checked {
	/** The compile throws, and its message holds `message` (or matches it). Returns the message. */
	fails(message: string | RegExp): string;
	/** The compile does not throw. Returns what it gave. */
	passes(): unknown;
}

/** Runs `run` for a check. */
export function check(run: () => unknown): Checked {
	return {
		fails(message) {
			let thrown: unknown;
			try {
				run();
			} catch (error) {
				thrown = error;
			}
			if (thrown === undefined)
				throw new Error(`the compile did not fail; wanted: ${String(message)}`);
			const said = thrown instanceof Error ? thrown.message : String(thrown);
			const holds = typeof message === 'string' ? said.includes(message) : message.test(said);
			if (!holds)
				throw new Error(
					`the compile failed otherwise.
  wanted: ${String(message)}
  said:   ${said}`
				);
			return said;
		},
		passes() {
			return run();
		}
	};
}

/** The text a compile makes of `source`: its code, or `(nothing to compile)`. */
export function output<O extends { readonly code: string }>(
	compile: (source: string) => O | null,
	source: string
): string {
	return compile(source)?.code ?? '(nothing to compile)';
}
