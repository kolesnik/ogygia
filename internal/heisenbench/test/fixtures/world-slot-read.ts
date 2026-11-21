// What world-slot.bench.ts counts: a walk of the process slot it joined (test: preload.test.ts).
const g = globalThis as unknown as Record<symbol, unknown>;

/** Joins the slot (as a plugin joins core's shared hooks at load). */
export function join_slot(): void {
	const joined = (g[Symbol.for('ogygia.bench-world.joined')] ??= []) as object[];
	joined.push({ copy: joined.length });
}

/** Walks every member of the slot. */
export function read_slot(): number {
	let n = 0;
	for (const j of g[Symbol.for('ogygia.bench-world.joined')] as object[])
		n += Object.keys(j).length;
	return n;
}
