/**
 * A bench file's own stand-ins for Node's globals. A run of many bench files takes off every
 * global a file installed when it moves to the next one (internal/heisenbench/src/preload.ts
 * `BenchWorld`); a global Node itself has is put back only when the file replaced it here, which
 * keeps Node's own in this record for the run to restore.
 */
const REPLACED = Symbol.for('ogygia.bench-world.replaced');

/** Node's global `name` is `value` for this bench file's cases; the next file gets Node's back. */
export function replace_global(name: string, value: unknown): void {
	const g = globalThis as unknown as Record<string | symbol, unknown>;
	const replaced = (g[REPLACED] ??= new Map()) as Map<string, PropertyDescriptor>;
	const own = Object.getOwnPropertyDescriptor(g, name);
	if (own !== undefined && !replaced.has(name)) replaced.set(name, own);
	g[name] = value;
}
