/**
 * Decision tables: a choice over a few finite inputs, decided for every combination at build.
 * The plans are stored in index order (the last input varies fastest), so a lookup at run time
 * is one index into an array. Two checks hold a table: every rule holds on every row, and every
 * input changes the plan for some combination of the others (one that never does is dead).
 *
 * @packageDocumentation
 */

/** Each input's name and its options, in declared order. */
export type Axes = ReadonlyArray<readonly [string, ReadonlyArray<unknown>]>;

/** A rule a table's rows must hold, given each row's input and plan. */
export type Rule = (row: { input: object; plan: unknown }) => boolean;

/** Every row's plan, in index order. */
export function decideAll(axes: Axes, decide: (input: object) => unknown): Array<unknown> {
	const out: Array<unknown> = [];
	const rows = (at: number, input: Record<string, unknown>): void => {
		if (at === axes.length) {
			out.push(decide({ ...input }));
			return;
		}
		for (const option of axes[at]![1]) rows(at + 1, { ...input, [axes[at]![0]]: option });
	};
	rows(0, {});
	return out;
}

/** The input of row `index`. */
export function inputAt(axes: Axes, index: number): Record<string, unknown> {
	const sizes = axes.map(([, o]) => o.length);
	const at: Array<number> = [];
	for (let f = axes.length - 1; f >= 0; f--) {
		at[f] = index % sizes[f]!;
		index = Math.floor(index / sizes[f]!);
	}
	return Object.fromEntries(axes.map(([k, o], f) => [k, o[at[f]!]]));
}

/** The first problem of a table, worded for a build error, or null when it holds. */
export function tableProblem(
	name: string,
	axes: Axes,
	values: ReadonlyArray<unknown>,
	rules: Readonly<Record<string, Rule>>
): string | null {
	for (const [rule, holds] of Object.entries(rules))
		for (let i = 0; i < values.length; i++)
			if (holds({ input: inputAt(axes, i), plan: values[i] }) !== true)
				return `${name}: the rule "${rule}" does not hold for ${JSON.stringify(inputAt(axes, i))} (plan ${JSON.stringify(values[i])}).`;
	const sizes = axes.map(([, o]) => o.length);
	let stride = 1;
	for (let f = axes.length - 1; f >= 0; f--) {
		const n = sizes[f]!;
		let live = false;
		for (let i = 0; i < values.length && !live; i++) {
			if (Math.floor(i / stride) % n !== 0) continue;
			for (let v = 1; v < n && !live; v++)
				if (JSON.stringify(values[i]) !== JSON.stringify(values[i + v * stride])) live = true;
		}
		if (!live) return `${name}: the input "${axes[f]![0]}" never changes the plan: delete it.`;
		stride *= n;
	}
	return null;
}
