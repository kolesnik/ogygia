/**
 * `import.meta.og.image(src, options?)` and `import.meta.og.image.glob(pattern, options?)`.
 *
 *   const hero = import.meta.og.image('./hero.jpg', { quality: 70 });
 *   // → import __og_image_0 from './hero.jpg?og-image=<options>';  const hero = __og_image_0;
 *
 * The call becomes an import of the file under the plugin's query; the plugin's `load` turns that into
 * the descriptor (./plugin.ts). Arguments are literals, read from the AST before any code runs, so an
 * option is real JS (numbers, arrays, `16 / 9`) instead of a string inside an import attribute.
 */
import fs from 'node:fs';
import path from 'node:path';
import { og_js_regions, og_member, parse_module, type AstNode } from '@ogygia/compiler';
import { OgygiaError } from '../messages.ts';
import { check_image_options, type ImageOptions } from './options.ts';

type Node = AstNode;

export const QUERY = 'og-image';
const REMOTE_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const MARKER = 'import.meta.og.image';

/** The import specifier that loads `src` as a descriptor with `options`. */
export function image_specifier(src: string, options: ImageOptions = {}): string {
	const keys = Object.keys(options);
	if (!keys.length) return `${src}?${QUERY}`;
	return `${src}?${QUERY}=${Buffer.from(JSON.stringify(options)).toString('base64url')}`;
}

/** The options an `og-image` query carries. */
export function options_of_query(query: string): ImageOptions {
	const value = new URLSearchParams(query).get(QUERY);
	if (!value) return {};
	return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ImageOptions;
}

function walk(node: Node, visit: (n: Node) => void): void {
	visit(node);
	for (const key in node) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		const child = node[key];
		if (Array.isArray(child)) {
			for (const c of child)
				if (c && typeof c === 'object' && typeof c.type === 'string') walk(c, visit);
		} else if (child && typeof child === 'object' && typeof child.type === 'string') {
			walk(child, visit);
		}
	}
}

function line_of(src: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line++;
	return line;
}

const NOT_LITERAL: unique symbol = Symbol('not literal');

/** The value a literal expression writes, or NOT_LITERAL. */
function literal(n: Node): unknown {
	switch (n.type) {
		case 'Literal':
			return n.regex ? NOT_LITERAL : n.value;
		case 'TemplateLiteral':
			return (n.expressions as Node[]).length === 0
				? (n.quasis as Node[]).map((q) => q.value.cooked).join('')
				: NOT_LITERAL;
		case 'UnaryExpression': {
			if (n.operator !== '-' && n.operator !== '+') return NOT_LITERAL;
			const v = literal(n.argument as Node);
			return typeof v === 'number' ? (n.operator === '-' ? -v : v) : NOT_LITERAL;
		}
		case 'BinaryExpression': {
			const l = literal(n.left as Node);
			const r = literal(n.right as Node);
			if (typeof l !== 'number' || typeof r !== 'number') return NOT_LITERAL;
			if (n.operator === '/') return l / r;
			if (n.operator === '*') return l * r;
			return NOT_LITERAL;
		}
		case 'ArrayExpression': {
			const out: unknown[] = [];
			for (const e of n.elements as (Node | null)[]) {
				if (!e || e.type === 'SpreadElement') return NOT_LITERAL;
				const v = literal(e);
				if (v === NOT_LITERAL) return NOT_LITERAL;
				out.push(v);
			}
			return out;
		}
		case 'ObjectExpression': {
			const out: Record<string, unknown> = {};
			for (const p of n.properties as Node[]) {
				if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method)
					return NOT_LITERAL;
				const key =
					p.key.type === 'Identifier'
						? (p.key.name as string)
						: typeof p.key.value === 'string'
							? (p.key.value as string)
							: null;
				if (key === null) return NOT_LITERAL;
				const v = literal(p.value as Node);
				if (v === NOT_LITERAL) return NOT_LITERAL;
				out[key] = v;
			}
			return out;
		}
		case 'TSAsExpression':
		case 'TSSatisfiesExpression':
		case 'ParenthesizedExpression':
			return literal(n.expression as Node);
		default:
			return NOT_LITERAL;
	}
}

type Call = {
	start: number;
	end: number;
	/** where the import goes: the start of the JS region holding the call */
	region: number;
	glob: boolean;
	src: string;
	options: ImageOptions;
	line: number;
};

/** Find every call, its literal arguments read and checked. */
function find_calls(src: string, id: string, markup_exts: readonly string[]): Call[] {
	const regions = og_js_regions(src, id, markup_exts);
	if (!regions) return [];
	const calls: Call[] = [];
	const rel = path.basename(id);
	for (const region of regions) {
		if (!region.code.includes(MARKER)) continue;
		// a component's script is parsed as TypeScript: `lang="ts"` or not, TS is a superset here
		const as = markup_exts.some((x) => id.endsWith(x)) ? `${id}.ts` : id;
		const { program, ok } = parse_module(region.code, as);
		if (!ok || !program) continue;
		walk(program, (n) => {
			if (n.type !== 'CallExpression') return;
			const callee = n.callee as Node;
			let glob = false;
			if (og_member(callee) !== 'image') {
				if (
					callee.type !== 'MemberExpression' ||
					callee.computed ||
					callee.property?.name !== 'glob' ||
					og_member(callee.object as Node) !== 'image'
				)
					return;
				glob = true;
			}
			const abs = region.offset + (n.start as number);
			const line = line_of(src, abs);
			const args = (n.arguments as Node[] | undefined) ?? [];
			if (args.length < 1 || args.length > 2)
				throw new OgygiaError('image_macro_arity', { file: rel, line });
			const path_value = literal(args[0]!);
			if (typeof path_value !== 'string')
				throw new OgygiaError('image_macro_not_literal', {
					file: rel,
					line,
					what: glob ? 'the pattern' : 'the path'
				});
			let options: unknown = undefined;
			if (args[1]) {
				options = literal(args[1]);
				if (options === NOT_LITERAL)
					throw new OgygiaError('image_macro_not_literal', {
						file: rel,
						line,
						what: 'the options'
					});
			}
			calls.push({
				start: abs,
				end: region.offset + (n.end as number),
				region: region.offset,
				glob,
				src: path_value,
				options: check_image_options(`${rel}:${line}`, options),
				line
			});
		});
	}
	return calls;
}

/** Rewrite every image call in `src` (module `id`). Returns `src` itself when there is none. */
export function rewrite_image_calls(
	src: string,
	id: string,
	markup_exts: readonly string[] = ['.svelte']
): string {
	if (!src.includes(MARKER)) return src;
	const calls = find_calls(src, id, markup_exts);
	if (!calls.length) return src;
	const dir = path.dirname(id);
	const rel = path.basename(id);

	const edits: { start: number; end: number; text: string }[] = [];
	const heads = new Map<number, string[]>();
	calls.forEach((c, i) => {
		if (REMOTE_RE.test(c.src) || c.src.startsWith('data:'))
			throw new OgygiaError('image_remote_unsupported', { file: rel, src: c.src });
		if (c.glob) {
			const matches = fs.globSync(c.src, { cwd: dir });
			if (!matches.length)
				throw new OgygiaError('image_glob_empty', { file: `${rel}:${c.line}`, pattern: c.src });
			const query = image_specifier('', c.options).slice(1);
			edits.push({
				start: c.start,
				end: c.end,
				text: `import.meta.glob(${JSON.stringify(c.src)}, { eager: true, import: 'default', query: ${JSON.stringify(`?${query}`)} })`
			});
			return;
		}
		if (!fs.existsSync(path.resolve(dir, c.src)))
			throw new OgygiaError('image_not_found', { file: `${rel}:${c.line}`, src: c.src });
		const name = `__og_image_${i}`;
		let list = heads.get(c.region);
		if (!list) heads.set(c.region, (list = []));
		list.push(`import ${name} from ${JSON.stringify(image_specifier(c.src, c.options))};`);
		edits.push({ start: c.start, end: c.end, text: name });
	});
	for (const [at, lines] of heads)
		edits.push({ start: at, end: at, text: `\n${lines.join('\n')}\n` });
	edits.sort((a, b) => a.start - b.start || (a.end === a.start ? -1 : 1));

	let out = '';
	let last = 0;
	for (const e of edits) {
		out += src.slice(last, e.start) + e.text;
		last = e.end;
	}
	return out + src.slice(last);
}
