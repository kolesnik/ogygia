/**
 * A compiler as named steps with typed input and output, run in order: `collect → layout →
 * generate`. Each step has one job; what one gives, the next takes, and the types hold the order.
 *
 *   const compile = pipeline(
 *     step('collect', (files: Files) => files.map(collect)),
 *     step('layout', layout),
 *     step('generate', generate),
 *   )
 *   compile.run(files)
 *
 * @packageDocumentation
 */

/** One step: its name, and what it makes of its input. */
export interface Step<I, O> {
	readonly name: string;
	readonly run: (input: I) => O;
}

/** Names a step. */
export function step<I, O>(name: string, run: (input: I) => O): Step<I, O> {
	return Object.freeze({ name, run });
}

/** Steps run in order, as one step; its name lists theirs. */
export function pipeline<A, B>(a: Step<A, B>): Step<A, B>;
export function pipeline<A, B, C>(a: Step<A, B>, b: Step<B, C>): Step<A, C>;
export function pipeline<A, B, C, D>(a: Step<A, B>, b: Step<B, C>, c: Step<C, D>): Step<A, D>;
export function pipeline<A, B, C, D, E>(
	a: Step<A, B>,
	b: Step<B, C>,
	c: Step<C, D>,
	d: Step<D, E>
): Step<A, E>;
export function pipeline(...steps: ReadonlyArray<Step<unknown, unknown>>): Step<unknown, unknown> {
	return step(steps.map((s) => s.name).join(' → '), (input) =>
		steps.reduce((value, s) => s.run(value), input)
	);
}
