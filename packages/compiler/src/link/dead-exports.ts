/**
 * THE SERVER'S DEAD EXPORTS: a pass over a finished server bundle that drops what a shared chunk
 * exports and no chunk imports, and the code only those exports reached.
 *
 * The bundler fixes a shared chunk's export list before the build's feature word folds its tests
 * (`HAS & F_x`, the word a const of a virtual module, inlined late). An importer whose call folds
 * away stops importing, but the chunk still exports the helper, so the helper and everything only it
 * reaches stays. This pass reads the finished chunks as they are written: what each one imports,
 * statically or by a literal `import()`, is the whole demand on a chunk that is no entry. Exports
 * outside that demand go, the bundler itself re-shakes the chunk to say which top-level declarations
 * nothing reaches any more, and those are cut from the chunk's text; every other byte stays as
 * written. A chunk shrinks, its imports shrink, so the pass runs again until nothing changes.
 *
 * It only removes what it proves dead. An entry, a chunk loaded by `import()`, one imported whole
 * (`import *`, `export *`), one named as text elsewhere in the bundle, or one whose exports are not one
 * plain list keeps every export. A declaration is cut only when the re-shake dropped it and no kept
 * code names it.
 *
 * @packageDocumentation
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import MagicString from 'magic-string';
import remapping, { type SourceMapInput } from '@jridgewell/remapping';
import { walk } from 'estree-walker';
import { parse_module, type AstNode } from '../parse/oxc.ts';
import { free_references } from '../free-vars.ts';
import { warn } from '../messages.ts';

/** A chunk of a finished server bundle: the fields of the bundler's output chunk this pass reads and
 *  writes. */
export interface ShakeChunk {
	readonly fileName: string;
	code: string;
	map: SourceMapInput | null;
	exports: string[];
	readonly isEntry: boolean;
	readonly isDynamicEntry: boolean;
}

/** Re-bundle one module (every import external) and give its output map's `mappings`, or null
 *  when the bundler wrote no map. */
export type Reshake = (code: string) => Promise<string | null>;

/** What the pass did. */
export interface ShakeReport {
	/** Each changed chunk's dropped exports (their exported names). */
	readonly dropped: Map<string, string[]>;
	/** Chunks with dead exports the pass kept, and why: by a rule, or because a step failed
	 *  (`failed`, which the build says). */
	readonly kept: Kept[];
	/** Bytes the pass took out of the bundle's code. */
	bytes: number;
}

/** A chunk that keeps its dead exports. */
export interface Kept {
	readonly file: string;
	readonly reason: string;
	readonly failed: boolean;
}

type Demand = Set<string> | 'all';

interface ChunkFacts {
	readonly code: string;
	readonly body: AstNode[];
	readonly comments: { type: string; start: number; end: number }[];
	readonly specifier_spans: [number, number][];
	readonly demands: { target: string; names: Demand }[];
	readonly plain_export_list: AstNode | null;
}

const QUOTES: ReadonlySet<string> = new Set(['"', "'", '`']);
const DECLARATIONS: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'ClassDeclaration',
	'VariableDeclaration'
]);
const KEYED: ReadonlySet<string> = new Set([
	'Property',
	'MethodDefinition',
	'PropertyDefinition',
	'AccessorProperty'
]);
const FUNCTIONS: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression'
]);
const B64: ReadonlyMap<string, number> = new Map(
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').map((c, i) => [c, i])
);

function target_of(from: string, spec: string): string | null {
	if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
	return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
}

function name_of(node: AstNode): string {
	return node.type === 'Identifier' ? node.name : String(node.value);
}

function read_chunk(chunk: ShakeChunk): ChunkFacts | null {
	const parsed = parse_module(chunk.code, chunk.fileName);
	if (!parsed.ok) return null;
	const body = parsed.program.body as AstNode[];
	const specifiers: [number, number][] = [];
	const demands: { target: string; names: Demand }[] = [];
	const demand = (source: AstNode, names: Demand) => {
		specifiers.push([source.start, source.end]);
		const target = target_of(chunk.fileName, String(source.value));
		if (target !== null) demands.push({ target, names });
	};
	let list: AstNode | null = null;
	let plain = true;
	for (const node of body) {
		if (node.type === 'ImportDeclaration') {
			const names = new Set<string>();
			let whole = false;
			for (const s of node.specifiers as AstNode[]) {
				if (s.type === 'ImportNamespaceSpecifier') whole = true;
				else if (s.type === 'ImportDefaultSpecifier') names.add('default');
				else names.add(name_of(s.imported));
			}
			demand(node.source, whole ? 'all' : names);
		} else if (node.type === 'ExportAllDeclaration') {
			plain = false;
			demand(node.source, 'all');
		} else if (node.type === 'ExportNamedDeclaration' && node.source) {
			plain = false;
			demand(node.source, new Set((node.specifiers as AstNode[]).map((s) => name_of(s.local))));
		} else if (node.type === 'ExportNamedDeclaration' && !node.declaration && list === null) {
			list = node;
		} else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
			plain = false;
		}
	}
	walk(parsed.program as never, {
		enter(node) {
			const n = node as AstNode;
			if (n.type === 'ImportExpression' && n.source.type === 'Literal') demand(n.source, 'all');
		}
	});
	return {
		code: chunk.code,
		body,
		comments: parsed.comments as ChunkFacts['comments'],
		specifier_spans: specifiers,
		demands,
		plain_export_list: plain ? list : null
	};
}

function file_name_in_text(file: string, facts: ReadonlyMap<string, ChunkFacts>): boolean {
	const base = path.posix.basename(file);
	for (const { code, specifier_spans } of facts.values())
		for (let at = code.indexOf(base); at !== -1; at = code.indexOf(base, at + 1)) {
			if (!QUOTES.has(code[at + base.length] ?? '')) continue;
			if (!specifier_spans.some(([s, e]) => at >= s && at < e)) return true;
		}
	return false;
}

function mapped_source_offsets(mappings: string, starts: readonly number[]): number[] {
	const out: number[] = [];
	const field = [0, 0, 0, 0, 0];
	let line = 0;
	let col = 0;
	let n = 0;
	let value = 0;
	let shift = 0;
	const flush = () => {
		if (n >= 4) {
			line += field[2]!;
			col += field[3]!;
			out.push((starts[line] ?? Infinity) + col);
		}
		n = 0;
	};
	for (const c of mappings) {
		if (c === ',' || c === ';') {
			flush();
			continue;
		}
		const digit = B64.get(c) ?? 0;
		value += (digit & 31) << shift;
		shift += 5;
		if (digit & 32) continue;
		field[n++] = value & 1 ? -(value >>> 1) : value >>> 1;
		value = 0;
		shift = 0;
	}
	flush();
	return out.sort((a, b) => a - b);
}

function line_starts(text: string): number[] {
	const out = [0];
	for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) out.push(i + 1);
	return out;
}

function any_in_span(sorted: readonly number[], start: number, end: number): boolean {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (sorted[mid]! < start) lo = mid + 1;
		else hi = mid;
	}
	return lo < sorted.length && sorted[lo]! < end;
}

function bindings(node: AstNode | null, out: string[]): string[] {
	if (node === null) return out;
	if (node.type === 'Identifier') out.push(node.name);
	else if (node.type === 'ObjectPattern')
		for (const p of node.properties as AstNode[])
			bindings(p.type === 'RestElement' ? p.argument : p.value, out);
	else if (node.type === 'ArrayPattern')
		for (const e of node.elements as AstNode[]) bindings(e, out);
	else if (node.type === 'RestElement') bindings(node.argument, out);
	else if (node.type === 'AssignmentPattern') bindings(node.left, out);
	return out;
}

function declared(node: AstNode): string[] {
	if (node.type === 'VariableDeclaration')
		return (node.declarations as AstNode[]).flatMap((d) => bindings(d.id, []));
	return node.id ? [node.id.name as string] : [];
}

function outside_names(node: AstNode): Set<string> {
	const out = new Set(free_references(node as never));
	walk(node as never, {
		enter(child) {
			const n = child as AstNode;
			if (FUNCTIONS.has(n.type)) for (const p of n.params as AstNode[]) param_reads(p, out);
		}
	});
	return out;
}

function param_reads(node: AstNode | null, out: Set<string>): void {
	if (node === null) return;
	if (node.type === 'AssignmentPattern') {
		names_in(node.right, out);
		param_reads(node.left, out);
	} else if (node.type === 'ObjectPattern')
		for (const p of node.properties as AstNode[]) {
			if (p.type === 'RestElement') param_reads(p.argument, out);
			else {
				if (p.computed) names_in(p.key, out);
				param_reads(p.value, out);
			}
		}
	else if (node.type === 'ArrayPattern')
		for (const e of node.elements as AstNode[]) param_reads(e, out);
	else if (node.type === 'RestElement') param_reads(node.argument, out);
}

function names_in(node: AstNode, out: Set<string>): void {
	walk(node as never, {
		enter(child, parent, key) {
			const n = child as AstNode;
			if (n.type !== 'Identifier') return;
			const p = parent as AstNode | null;
			if (p?.type === 'MemberExpression' && key === 'property' && !p.computed) return;
			if (p && KEYED.has(p.type) && key === 'key' && !p.computed) return;
			out.add(n.name);
		}
	});
}

function cut_span(code: string, facts: ChunkFacts, at: number): [number, number] {
	const node = facts.body[at]!;
	const floor = at === 0 ? 0 : facts.body[at - 1]!.end;
	let start = node.start as number;
	for (let i = facts.comments.length - 1; i >= 0; i--) {
		const c = facts.comments[i]!;
		if (c.end > start || c.start < floor) continue;
		if (c.type !== 'Block' || code.slice(c.end, start).trim() !== '') break;
		start = c.start;
	}
	return whole_lines(code, start, node.end);
}

function whole_lines(code: string, start: number, end: number): [number, number] {
	const from = code.lastIndexOf('\n', start - 1) + 1;
	if (code.slice(from, start).trim() !== '') return [start, end];
	const eol = code.indexOf('\n', end);
	const to = eol === -1 ? code.length : eol + 1;
	return code.slice(end, to).trim() === '' ? [from, to] : [start, end];
}

function import_text(code: string, node: AstNode, live: ReadonlySet<string>): string | null {
	const specs = node.specifiers as AstNode[];
	const kept = specs.filter((s) => live.has(s.local.name));
	if (kept.length === specs.length || (node.attributes?.length ?? 0) > 0) return null;
	const source = code.slice(node.source.start, node.source.end);
	if (kept.length === 0) return `import ${source};`;
	const slice = (s: AstNode) => code.slice(s.start, s.end);
	const head = kept.filter((s) => s.type !== 'ImportSpecifier').map(slice);
	const named = kept.filter((s) => s.type === 'ImportSpecifier').map(slice);
	if (named.length) head.push(`{ ${named.join(', ')} }`);
	return `import ${head.join(', ')} from ${source};`;
}

type Shaken =
	| {
			ok: true;
			code: string;
			map: SourceMapInput | null;
			exports: string[];
			dropped: string[];
	  }
	| { ok: false; reason: string; failed: boolean };

async function shake_chunk(
	chunk: ShakeChunk,
	facts: ChunkFacts,
	demand: ReadonlySet<string>,
	reshake: Reshake
): Promise<Shaken> {
	const { code, body } = facts;
	const list = facts.plain_export_list!;
	const specs = list.specifiers as AstNode[];
	const kept_specs = specs.filter((s) => demand.has(name_of(s.exported)));
	const dropped = specs
		.filter((s) => !demand.has(name_of(s.exported)))
		.map((s) => name_of(s.exported));
	const list_text = kept_specs.length
		? `export { ${kept_specs.map((s) => code.slice(s.start, s.end)).join(', ')} };`
		: '';
	const probe = `${code.slice(0, list.start)}${list_text.padEnd(list.end - list.start)}${code.slice(list.end)}`;
	let mappings: string | null;
	try {
		mappings = await reshake(probe);
		// oxlint-disable-next-line ogygia/no-silent-failures -- not silent: the chunk keeps every export and the caller says server_exports_kept with this reason
	} catch (e) {
		return {
			ok: false,
			reason: `the re-shake failed (${(e as Error).message})`,
			failed: true
		};
	}
	if (mappings === null) return { ok: false, reason: 'the re-shake wrote no map', failed: true };
	const offsets = mapped_source_offsets(mappings, line_starts(probe));
	const cut = new Set<number>();
	const owners = new Map<string, number[]>();
	body.forEach((node, i) => {
		if (!DECLARATIONS.has(node.type)) return;
		for (const name of declared(node)) owners.set(name, [...(owners.get(name) ?? []), i]);
		if (!any_in_span(offsets, node.start, node.end)) cut.add(i);
	});
	const live = new Set<string>();
	for (const s of kept_specs) {
		const name = s.local.name as string;
		live.add(name);
		if (owners.get(name)?.some((i) => cut.has(i)))
			return {
				ok: false,
				reason: `the re-shake dropped ${name}, which the chunk still exports`,
				failed: true
			};
	}
	const queue = [...body.keys()].filter(
		(i) => body[i] !== list && body[i]!.type !== 'ImportDeclaration' && !cut.has(i)
	);
	for (let i = queue.pop(); i !== undefined; i = queue.pop())
		for (const name of outside_names(body[i]!)) {
			live.add(name);
			for (const o of owners.get(name) ?? []) if (cut.delete(o)) queue.push(o);
		}
	if (live.has('eval'))
		return {
			ok: false,
			reason: 'it calls eval, which may read any name',
			failed: false
		};
	const s = new MagicString(code);
	const statements: string[] = [];
	body.forEach((node, i) => {
		if (cut.has(i)) {
			const [from, to] = cut_span(code, facts, i);
			s.remove(from, to);
			return;
		}
		let text: string | null = null;
		if (node === list) text = list_text;
		else if (node.type === 'ImportDeclaration') text = import_text(code, node, live);
		if (text === null) statements.push(code.slice(node.start, node.end));
		else if (text !== '') {
			s.overwrite(node.start, node.end, text);
			statements.push(text);
		} else {
			const [from, to] = whole_lines(code, node.start, node.end);
			s.remove(from, to);
		}
	});
	drop_emptied_module_headers(code, facts, cut, s);
	const next = s.toString();
	const reread = parse_module(next, chunk.fileName);
	const read_as = reread.ok
		? (reread.program.body as AstNode[]).map((n) => next.slice(n.start, n.end))
		: [];
	if (read_as.length !== statements.length || read_as.some((t, i) => t !== statements[i]))
		return {
			ok: false,
			reason: 'the chunk reads differently once cut',
			failed: true
		};
	const map = chunk.map
		? (remapping(
				[
					s.generateMap({
						hires: true,
						source: chunk.fileName,
						file: chunk.fileName
					}) as SourceMapInput,
					chunk.map
				],
				() => null
			) as unknown as SourceMapInput)
		: null;
	return {
		ok: true,
		code: next,
		map,
		exports: kept_specs.map((x) => name_of(x.exported)),
		dropped
	};
}

function drop_emptied_module_headers(
	code: string,
	facts: ChunkFacts,
	cut: ReadonlySet<number>,
	s: MagicString
) {
	const { body, comments } = facts;
	const heads: { at: number; c: { start: number; end: number } }[] = [];
	let i = 0;
	for (const c of comments) {
		if (c.type !== 'Line') continue;
		while (i < body.length && body[i]!.end <= c.start) i++;
		if (i < body.length && body[i]!.start < c.end) continue;
		heads.push({ at: i, c });
	}
	heads.forEach(({ at, c }, k) => {
		const until = heads[k + 1]?.at ?? body.length;
		let any = false;
		for (let j = at; j < until; j++) {
			const node = body[j]!;
			if (node === facts.plain_export_list || node.type === 'ImportDeclaration') continue;
			if (!cut.has(j)) return;
			any = true;
		}
		if (!any) return;
		const [from, to] = whole_lines(code, c.start, c.end);
		if (from === c.start && to === c.end) return;
		s.remove(from, to);
	});
}

/**
 * Drop each non-entry chunk's exports that no chunk imports, and the code only they reached, until
 * nothing changes. Chunks are edited in place (code, map, exports).
 */
export async function drop_dead_exports(
	chunks: readonly ShakeChunk[],
	reshake: Reshake
): Promise<ShakeReport> {
	const report: ShakeReport = { dropped: new Map(), kept: [], bytes: 0 };
	const settled = new Set<string>();
	const by_file = new Map(chunks.map((c) => [c.fileName, c]));
	for (;;) {
		const facts = new Map<string, ChunkFacts>();
		for (const c of chunks) {
			const f = read_chunk(c);
			if (f === null) {
				report.kept.push({
					file: c.fileName,
					reason: 'it does not parse, so what it imports is unknown',
					failed: true
				});
				return report;
			}
			facts.set(c.fileName, f);
		}
		const demand = new Map<string, Demand>();
		for (const f of facts.values())
			for (const d of f.demands) {
				if (!by_file.has(d.target)) continue;
				const had = demand.get(d.target) ?? new Set<string>();
				if (had === 'all' || d.names === 'all') demand.set(d.target, 'all');
				else demand.set(d.target, new Set([...had, ...d.names]));
			}
		let changed = false;
		for (const c of chunks) {
			if (c.isEntry || c.isDynamicEntry || settled.has(c.fileName)) continue;
			const asked = demand.get(c.fileName) ?? new Set<string>();
			if (asked === 'all') continue;
			const f = facts.get(c.fileName)!;
			if (f.plain_export_list === null) {
				if (c.exports.some((e) => !asked.has(e)))
					report.kept.push({
						file: c.fileName,
						reason: 'its exports are not one plain list',
						failed: false
					});
				settled.add(c.fileName);
				continue;
			}
			const specs = f.plain_export_list.specifiers as AstNode[];
			if (specs.every((s) => asked.has(name_of(s.exported)))) continue;
			if (file_name_in_text(c.fileName, facts)) {
				report.kept.push({
					file: c.fileName,
					reason: 'its file name is written in the bundle as text',
					failed: false
				});
				settled.add(c.fileName);
				continue;
			}
			const out = await shake_chunk(c, f, asked, reshake);
			if (!out.ok) {
				report.kept.push({
					file: c.fileName,
					reason: out.reason,
					failed: out.failed
				});
				settled.add(c.fileName);
				continue;
			}
			report.bytes += Buffer.byteLength(c.code) - Buffer.byteLength(out.code);
			report.dropped.set(c.fileName, [...(report.dropped.get(c.fileName) ?? []), ...out.dropped]);
			c.code = out.code;
			if (out.map) c.map = out.map;
			c.exports = out.exports;
			changed = true;
		}
		if (!changed) return report;
	}
}

function vite_own_rolldown(): string {
	return createRequire(createRequire(import.meta.url).resolve('vite')).resolve('rolldown');
}

/** The bundler at `locate()`, as a {@link Reshake}; null when it cannot be loaded. */
export async function bundler_reshake(
	locate: () => string = vite_own_rolldown
): Promise<Reshake | null> {
	let rolldown: (options: object) => Promise<{
		generate(o: object): Promise<{
			output: [{ code: string; map: { mappings: string } | null }];
		}>;
		close(): Promise<void>;
	}>;
	try {
		({ rolldown } = await import(pathToFileURL(locate()).href));
		// oxlint-disable-next-line ogygia/no-silent-failures -- not silent: a null reshake makes the caller say server_exports_kept
	} catch {
		return null;
	}
	// @why rolldown writes no mappings for a module whose id starts with \0 (test: test/dead-exports.test.ts › the bundler's re-shake gives a map)
	const ID = 'ogygia-chunk.js';
	return async (code) => {
		const bundle = await rolldown({
			input: ID,
			external: (id: string) => id !== ID,
			logLevel: 'silent',
			treeshake: { moduleSideEffects: true },
			plugins: [
				{
					name: 'ogygia:chunk',
					resolveId: (id: string) => (id === ID ? id : null),
					load: (id: string) => (id === ID ? code : null)
				}
			]
		});
		try {
			const [out] = (await bundle.generate({ format: 'esm', sourcemap: true })).output;
			if (out.map) return out.map.mappings;
			const parsed = parse_module(out.code, ID);
			const bare =
				parsed.ok &&
				(parsed.program.body as AstNode[]).every((n) => n.type === 'ImportDeclaration');
			return bare ? '' : null;
		} finally {
			await bundle.close();
		}
	};
}

/** A finished bundle as `generateBundle` holds it: chunks, and assets (a chunk's map among them). */
export type ShakeBundle = Record<
	string,
	| ({ type: 'chunk' } & ShakeChunk)
	| { type: 'asset'; fileName: string; source: string | Uint8Array }
>;

/** The server leg's pass: {@link drop_dead_exports} with the bundler Vite builds with, over a
 *  finished bundle (a changed chunk's map file written again). A chunk a step failed on stays as
 *  written, and the build says `server_exports_kept`. */
export async function shake_server_bundle(
	bundle: ShakeBundle,
	reshake: Reshake | null
): Promise<ShakeReport | null> {
	if (reshake === null) {
		warn('server_exports_kept', {
			file: 'every chunk',
			reason: 'the bundler Vite builds with could not be loaded'
		});
		return null;
	}
	const chunks: ShakeChunk[] = [];
	for (const item of Object.values(bundle)) if (item.type === 'chunk') chunks.push(item);
	const report = await drop_dead_exports(chunks, reshake);
	for (const k of report.kept)
		if (k.failed) warn('server_exports_kept', { file: k.file, reason: k.reason });
	for (const file of report.dropped.keys()) {
		const chunk = bundle[file];
		const asset = bundle[`${file}.map`];
		if (chunk?.type === 'chunk' && chunk.map && asset?.type === 'asset')
			asset.source = JSON.stringify(chunk.map);
	}
	return report;
}
