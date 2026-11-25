/**
 * The tracker: what each name refers to, where. A name is tracked by its declaration: the macros
 * that care (a machine, a scope) each give a classifier, and a declaration's type annotation or
 * initializer decides its binding once. A read of the name anywhere in its scope resolves to that
 * binding; a class field read through `this` does too.
 *
 * The tracker also hands out the names a file already takes (every global and declaration), so
 * the emitter never writes a name that collides.
 *
 * @packageDocumentation
 */
import { analyze, type Scope } from 'periscopic';
import { walk } from 'zimmerframe';
import { keyName, typeName, type N } from './ast.ts';
import type { Report } from './report.ts';

/** What a tracked name is. A classifier's own kinds carry what they need. */
export interface Binding {
	readonly kind: string;
}

/** Where a typed name is declared. */
export type Where = 'declaration' | 'param' | 'field';

/** What one macro family tracks: how its bindings are decided. Each hook is optional. */
export interface Classifier<B extends Binding> {
	/** Before the walk: a whole-program scan (a type alias of a tracked type). */
	prepare?(program: N, tracker: Tracker<B>): void;
	/** A declarator is reached, before its initializer is walked. */
	declared?(node: N): void;
	/** A name annotated `type`: its binding, or null. */
	typed?(type: string, at: N, scope: Scope, where: Where, tracker: Tracker<B>): B | null;
	/** A declaration's initializer: its binding, or null. */
	init?(init: N, scope: Scope, tracker: Tracker<B>): B | null;
	/** A member read that is itself a binding (`m.scope` of a tracked `m`). */
	member?(node: N, scope: Scope, tracker: Tracker<B>): B | undefined;
	/** A function is reached: its parameters may be bound by where it is (a callback's). */
	fn?(node: N, own: Scope, tracker: Tracker<B>): void;
	/** Kinds a plain alias carries over: `const n = m` is what `m` is. */
	readonly aliases?: ReadonlyArray<string>;
	/** Kinds that must stay tracked when passed to a local function: the type to annotate. */
	readonly tracked?: Readonly<Record<string, string>>;
	/** Whether a parameter typed `type` keeps a value of `kind` tracked. */
	keeps?(kind: string, type: string, tracker: Tracker<B>): boolean;
}

/** Tracking by declaration: which names are which macros' values, decided where declared. */
export class Tracker<B extends Binding> {
	readonly program: N;
	readonly scopes: WeakMap<N, Scope>;
	readonly root: Scope;
	readonly taken: Set<string>;
	readonly bindings = new Map<string, B>();
	/** Local functions by key: what a tracked argument is checked against. */
	readonly functions = new Map<string, N>();
	/** Each `this.x` read, to the class body it is in. */
	readonly classOf = new Map<N, number>();
	readonly report: Report;
	readonly classifiers: ReadonlyArray<Classifier<B>>;

	constructor(program: N, report: Report, classifiers: ReadonlyArray<Classifier<B>>) {
		this.program = program;
		this.report = report;
		this.classifiers = classifiers;
		// @why periscopic opens a scope for `export { x } from '…'` and never leaves it, so every later declaration lands in it (test: test/tracker.test.ts › a re-export before a declaration leaves it tracked)
		const { map, scope, globals } = analyze({
			...program,
			body: program.body.filter((n: N) => n.type !== 'ExportNamedDeclaration' || n.source === null)
		});
		this.scopes = map;
		this.root = scope;
		this.taken = new Set([...globals.keys(), ...scope.declarations.keys()]);
	}

	/** Walks the program once and decides every binding. */
	collect(): void {
		for (const c of this.classifiers) c.prepare?.(this.program, this);
		walk(this.program, this.root, {
			_: (node: N, c) => this.enter(node, c),
			VariableDeclarator: (node: N, c) => this.declarator(node, c),
			FunctionDeclaration: (node: N, c) => this.fn(node, c),
			ArrowFunctionExpression: (node: N, c) => this.fn(node, c),
			FunctionExpression: (node: N, c) => this.fn(node, c),
			ClassBody: (node: N, c) => this.classBody(node, c)
		});
	}

	/** The walk state is the innermost periscopic scope. */
	scopeAt(node: N, state: Scope): Scope {
		return this.scopes.get(node) ?? state;
	}

	/** A declared name's key: where it is declared, and its name; null for a global. */
	keyOf(scope: Scope, name: string): string | null {
		const owner = scope.find_owner(name);
		if (owner === null) return null;
		return `${(owner.declarations.get(name) as N).start}:${name}`;
	}

	/** The scope at the end of `path` (a walk's ancestors, outermost first). */
	scopeAlong(path: ReadonlyArray<N>): Scope {
		let scope: Scope = this.root;
		for (const n of path) scope = this.scopeAt(n, scope);
		return scope;
	}

	/** The identifier that declares `name` with a type annotation, where `path` ends, or null. */
	annotated(name: string, path: ReadonlyArray<N>): N {
		const node: N = this.scopeAlong(path).find_owner(name)?.declarations.get(name);
		if (node === undefined) return null;
		let found: N = null;
		walk(node, null, {
			Identifier(id: N, { next }) {
				if (found === null && id.name === name && id.typeAnnotation) found = id;
				next();
			}
		});
		return found;
	}

	/**
	 * Whether `node` holds one value from where it is bound on: a literal, or an untracked name
	 * bound once and never written after (a const, an import, a function declaration, a function
	 * expression's own name inside it, or a parameter its function never writes).
	 */
	fixed(node: N, scope: Scope): boolean {
		if (node.type === 'Literal') return true;
		if (node.type !== 'Identifier') return false;
		if (this.resolve(scope, node) != null) return false;
		const owner = scope.find_owner(node.name);
		const decl: N = owner?.declarations.get(node.name);
		if (decl === undefined) return false;
		if (decl.type === 'VariableDeclaration') return decl.kind === 'const';
		if (
			decl.type === 'ImportSpecifier' ||
			decl.type === 'ImportDefaultSpecifier' ||
			decl.type === 'ImportNamespaceSpecifier'
		)
			return true;
		if (
			decl.type !== 'FunctionDeclaration' &&
			decl.type !== 'FunctionExpression' &&
			decl.type !== 'ArrowFunctionExpression'
		)
			return false;
		if (decl.id?.name === node.name) return decl.type !== 'ArrowFunctionExpression';
		if (!decl.params.some((p: N) => p.type === 'Identifier' && p.name === node.name)) return false;
		const written: Array<N> = [];
		walk(decl.body, null, {
			AssignmentExpression(n: N, { next }) {
				if (n.left.type === 'Identifier' && n.left.name === node.name) written.push(n);
				next();
			},
			UpdateExpression(n: N, { next }) {
				if (n.argument.type === 'Identifier' && n.argument.name === node.name) written.push(n);
				next();
			}
		});
		return written.length === 0;
	}

	/**
	 * The first argument of a call of a local function that is tracked but lands in a parameter
	 * that does not keep it tracked, with its place and the type to annotate; null when none does
	 * (or the callee is no local function).
	 */
	untracked(call: N, scope: Scope): { arg: N; index: number; want: string } | null {
		if (call.callee.type !== 'Identifier') return null;
		const key = this.keyOf(scope, call.callee.name);
		const fn = key === null ? undefined : this.functions.get(key);
		if (fn === undefined) return null;
		for (let index = 0; index < call.arguments.length; index++) {
			const arg = call.arguments[index];
			const b = this.resolve(scope, arg);
			const want = b === undefined ? undefined : this.trackedType(b.kind);
			if (b === undefined || want === undefined) continue;
			if (!this.keeps(b.kind, typeName(fn.params[index]) ?? '')) return { arg, index, want };
		}
		return null;
	}

	/** Binds the name at `key`. */
	bind(key: string, binding: B): void {
		this.bindings.set(key, binding);
	}

	/** What `node` (a name, `this.x`, or a classifier's member) refers to, or undefined. */
	resolve(scope: Scope, node: N): B | undefined {
		if (node?.type === 'Identifier') {
			const key = this.keyOf(scope, node.name);
			return key === null ? undefined : this.bindings.get(key);
		}
		if (
			node?.type === 'MemberExpression' &&
			node.object.type === 'ThisExpression' &&
			!node.computed &&
			(node.property.type === 'PrivateIdentifier' || node.property.type === 'Identifier')
		)
			return this.bindings.get(
				`${node.property.type === 'PrivateIdentifier' ? '#' : '.'}${node.property.name}@${this.classOf.get(node)}`
			);
		if (node?.type === 'MemberExpression')
			for (const c of this.classifiers) {
				const b = c.member?.(node, scope, this);
				if (b !== undefined) return b;
			}
		return undefined;
	}

	/** The type a tracked `kind` is annotated with, or undefined for a kind that may go untracked. */
	trackedType(kind: string): string | undefined {
		for (const c of this.classifiers) if (c.tracked?.[kind] !== undefined) return c.tracked[kind];
		return undefined;
	}

	/** Whether a parameter typed `type` keeps a `kind` value tracked. */
	keeps(kind: string, type: string): boolean {
		return this.classifiers.some((c) => c.keeps?.(kind, type, this) === true);
	}

	private enter(node: N, { state, next }: { state: Scope; next: (s: Scope) => void }) {
		const own = this.scopes.get(node);
		if (own) for (const name of own.declarations.keys()) this.taken.add(name);
		next(own ?? state);
	}

	private typed(type: string | null, at: N, scope: Scope, where: Where): B | null {
		if (type === null) return null;
		for (const c of this.classifiers) {
			const b = c.typed?.(type, at, scope, where, this);
			if (b) return b;
		}
		return null;
	}

	/** What an initializer makes: a classifier's binding, or what the name it aliases is. */
	bindingOf(init: N, scope: Scope): B | null {
		for (const c of this.classifiers) {
			const b = c.init?.(init, scope, this);
			if (b) return b;
		}
		const same = this.resolve(scope, init);
		if (same !== undefined && this.classifiers.some((c) => c.aliases?.includes(same.kind) === true))
			return same;
		return null;
	}

	private declarator(node: N, { state, next }: { state: Scope; next: () => void }) {
		for (const c of this.classifiers) c.declared?.(node);
		next();
		if (node.id.type !== 'Identifier' || !node.init) return;
		const key = this.keyOf(state, node.id.name)!;
		const b =
			this.typed(typeName(node.id), node.id, state, 'declaration') ??
			this.bindingOf(node.init, state);
		if (b) this.bindings.set(key, b);
		else if (
			node.init.type === 'ArrowFunctionExpression' ||
			node.init.type === 'FunctionExpression'
		)
			this.functions.set(key, node.init);
	}

	private fn(node: N, { state, next }: { state: Scope; next: (s: Scope) => void }) {
		if (node.type === 'FunctionDeclaration' && node.id)
			this.functions.set(this.keyOf(state, node.id.name)!, node);
		const own = this.scopes.get(node) ?? state;
		for (const p of node.params) this.param(p, own);
		for (const c of this.classifiers) c.fn?.(node, own, this);
		next(own);
	}

	private param(given: N, scope: Scope) {
		const p = given.type === 'AssignmentPattern' ? given.left : given;
		if (p.type !== 'Identifier') return;
		const key = this.keyOf(scope, p.name);
		if (key === null) return;
		const b = this.typed(typeName(p), p, scope, 'param');
		if (b) this.bindings.set(key, b);
	}

	private classBody(node: N, { state, next }: { state: Scope; next: () => void }) {
		const at = node.start as number;
		for (const el of node.body) {
			if (
				el.type !== 'PropertyDefinition' ||
				el.computed ||
				(el.key.type !== 'PrivateIdentifier' && el.key.type !== 'Identifier')
			)
				continue;
			const b =
				this.typed(typeName(el), el, state, 'field') ??
				(el.value ? this.bindingOf(el.value, state) : null);
			const mark = el.key.type === 'PrivateIdentifier' ? '#' : '.';
			if (b) this.bindings.set(`${mark}${keyName(el)}@${at}`, b);
		}
		walk(node, null, {
			MemberExpression: (m: N, { next: inner }) => {
				if (m.object.type === 'ThisExpression' && !m.computed) this.classOf.set(m, at);
				inner();
			}
		});
		next();
	}
}
