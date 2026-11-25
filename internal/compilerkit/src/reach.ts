/**
 * Reachability over a graph the caller describes: from a start, along edges, to the first node
 * that is a target. A compiler builds its graph (functions and the calls between them, say) and
 * says what it means to reach something; this finds the path, shortest first. A call graph of
 * named functions across modules is one such graph, read from the source: a compiler marks some
 * functions where they are defined and proves no marked one reaches another kind.
 *
 * @packageDocumentation
 */
import { walk } from 'zimmerframe';
import type { N } from './ast.ts';
import { relativeImports, type Import } from './modules.ts';

/** How the walk sees a graph: a node's key (two nodes with one key are one node), where it
 *  leads, whether it is a target, and whether a path may go on through it (a node the walk may
 *  not cross ends that path there, unreported). */
export interface Graph<T> {
	readonly key: (node: T) => string;
	readonly next: (node: T) => Iterable<T>;
	readonly found: (node: T) => boolean;
	readonly crosses?: (node: T) => boolean;
}

/**
 * The shortest path from `start` to a node `graph.found` names, `start` first and that node last,
 * or null when none is reachable. `start` itself is never a target; a node `crosses` refuses is
 * reached but not walked past.
 */
export function pathTo<T>(start: T, graph: Graph<T>): Array<T> | null {
	const seen = new Set<string>([graph.key(start)]);
	const from = new Map<string, T>();
	let wave: Array<T> = [start];
	while (wave.length !== 0) {
		const next: Array<T> = [];
		for (const node of wave) {
			if (node !== start && graph.crosses?.(node) === false) continue;
			for (const to of graph.next(node)) {
				const k = graph.key(to);
				if (seen.has(k)) continue;
				seen.add(k);
				from.set(k, node);
				if (graph.found(to)) {
					const path: Array<T> = [to];
					for (let back = from.get(k); back !== undefined;) {
						path.unshift(back);
						back = from.get(graph.key(back));
					}
					return path;
				}
				next.push(to);
			}
		}
		wave = next;
	}
	return null;
}

/** A function a module defines by name, as a call graph reads it: its mark (how the compiler
 *  marked it where it is defined), the names its own body calls, and the first thing of note in
 *  that body (what a proof looks for), or null. */
export interface Defined<M> {
	readonly name: string;
	readonly file: string;
	readonly mark: M;
	readonly calls: ReadonlyArray<string>;
	readonly note: string | null;
	readonly node: N;
}

/** A module's named functions and the names it imports from relative modules. */
export interface Functions<M> {
	readonly file: string;
	readonly defined: ReadonlyMap<string, Defined<M>>;
	readonly imports: ReadonlyMap<string, Import>;
}

/** How a compiler reads its functions. */
export interface FunctionRules<M> {
	/** A function declaration's mark. */
	readonly plain: M;
	/** A top-level const's initializer: its mark and the function it holds (a function expression
	 *  or an arrow; anything else is no function). */
	readonly mark: (init: N) => { readonly mark: M; readonly fn: N };
	/** A part of a body not read (an exception that covers it). */
	readonly skip?: (node: N) => boolean;
	/** What is of note at a node of a body (`path`: the nodes it sits in), or null. */
	readonly note?: (node: N, path: ReadonlyArray<N>) => string | null;
}

function bodyOf<M>(
	body: N,
	rules: FunctionRules<M>
): { calls: Array<string>; note: string | null } {
	const calls: Array<string> = [];
	let note: string | null = null;
	walk(body, null, {
		_(n: N, { next, path }) {
			if (rules.skip?.(n) === true) return;
			if (n.type === 'CallExpression' && n.callee.type === 'Identifier') calls.push(n.callee.name);
			note ??= rules.note?.(n, path) ?? null;
			next();
		}
	});
	return { calls, note };
}

/** The functions `program` (the module at `file`) defines by name at its top, and its relative
 *  imports. */
export function functionsOf<M>(file: string, program: N, rules: FunctionRules<M>): Functions<M> {
	const defined = new Map<string, Defined<M>>();
	for (const node of program.body as Array<N>) {
		const d = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
		if (d?.type === 'FunctionDeclaration' && d.id !== null) {
			const name: string = d.id.name;
			defined.set(name, {
				name,
				file,
				mark: rules.plain,
				...bodyOf(d.body, rules),
				node: d
			});
		}
		if (d?.type === 'VariableDeclaration')
			for (const v of d.declarations) {
				if (v.id.type !== 'Identifier') continue;
				const { mark, fn } = rules.mark(v.init);
				if (fn?.type !== 'FunctionExpression' && fn?.type !== 'ArrowFunctionExpression') continue;
				const name: string = v.id.name;
				defined.set(name, {
					name,
					file,
					mark,
					...bodyOf(fn.body, rules),
					node: fn
				});
			}
	}
	return { file, defined, imports: relativeImports(file, program) };
}

/**
 * The calls between named functions across modules: from the module being compiled, through the
 * relative imports, each module read once (`load`, by import path: null when no file is there).
 */
export class CallGraph<M> {
	readonly here: Functions<M>;
	readonly #load: (file: string) => Functions<M> | null;
	readonly #modules = new Map<string, Functions<M>>();

	constructor(here: Functions<M>, load: (file: string) => Functions<M> | null) {
		this.here = here;
		this.#load = load;
	}

	/** The module at `file` (empty when no file is there). */
	module(file: string): Functions<M> {
		if (file === this.here.file) return this.here;
		const known = this.#modules.get(file);
		if (known !== undefined) return known;
		const made = this.#load(file);
		if (made === null) return { file, defined: new Map(), imports: new Map() };
		this.#modules.set(file, made);
		return made;
	}

	/** Where a name of `module` comes from: the module and its name there (itself, or what it
	 *  imports). */
	origin(module: Functions<M>, name: string): { module: Functions<M>; name: string } {
		const imported = module.imports.get(name);
		return imported === undefined
			? { module, name }
			: { module: this.module(imported.from), name: imported.name };
	}

	/** The function a name called in `module` is (its own, or one it imports), or null. */
	definedAt(module: Functions<M>, name: string): Defined<M> | null {
		const at = this.origin(module, name);
		return at.module.defined.get(at.name) ?? null;
	}

	/** The functions `fn` calls by name that the graph knows. */
	callees(fn: Defined<M>): Array<Defined<M>> {
		const module = this.module(fn.file);
		const out: Array<Defined<M>> = [];
		for (const name of fn.calls) {
			const to = this.definedAt(module, name);
			if (to !== null) out.push(to);
		}
		return out;
	}

	/**
	 * The shortest call path from `root` to a function `found` names (`root` first), or null: the
	 * proof that nothing reachable from a marked set reaches another, and the path when something
	 * does. A function `crosses` refuses is reached but not walked past.
	 */
	pathFrom(
		root: Defined<M>,
		found: (fn: Defined<M>) => boolean,
		crosses?: (fn: Defined<M>) => boolean
	): Array<Defined<M>> | null {
		return pathTo(root, {
			key: (fn) => `${fn.file}#${fn.name}`,
			next: (fn) => this.callees(fn),
			found,
			crosses
		});
	}
}
