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
import {
	find_og_calls,
	line_of,
	literal_of,
	NOT_LITERAL,
	og_js_regions,
	og_member,
	parse_module,
	walk_ast,
	type AstNode,
	type Edit
} from '@ogygia/compiler';
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
	try {
		return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ImageOptions;
	} catch {
		throw new OgygiaError('image_query_invalid', { query });
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
		walk_ast(program, (n) => {
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
			const path_value = literal_of(args[0]!);
			if (typeof path_value !== 'string')
				throw new OgygiaError('image_macro_not_literal', {
					file: rel,
					line,
					what: glob ? 'the pattern' : 'the path'
				});
			let options: unknown = undefined;
			if (args[1]) {
				options = literal_of(args[1]);
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

/** Fail on an image call in a component's markup: only its scripts are read, so `calls` (found there)
 *  must hold every call the source makes. */
function refuse_markup_calls(src: string, id: string, calls: readonly Call[]): void {
	const found = [
		...find_og_calls(src, 'import.meta.og.').filter((c) => c.method === 'image'),
		...find_og_calls(src, `${MARKER}.`).filter((c) => c.method === 'glob')
	];
	for (const c of found)
		if (!calls.some((k) => k.start === c.start))
			throw new OgygiaError('image_macro_in_markup', {
				file: `${path.basename(id)}:${line_of(src, c.start)}`
			});
}

/** The edits that rewrite every image call in `src` (module `id`): none when there is no call. */
export function image_call_edits(
	src: string,
	id: string,
	markup_exts: readonly string[] = ['.svelte'],
	watch: (file: string) => void = () => {}
): Edit[] {
	if (!src.includes(MARKER)) return [];
	const calls = find_calls(src, id, markup_exts);
	if (markup_exts.some((x) => id.endsWith(x))) refuse_markup_calls(src, id, calls);
	if (!calls.length) return [];
	const dir = path.dirname(id);
	const rel = path.basename(id);

	const edits: Edit[] = [];
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
		const file = path.resolve(dir, c.src);
		watch(file);
		if (!fs.existsSync(file))
			throw new OgygiaError('image_not_found', { file: `${rel}:${c.line}`, src: c.src });
		const name = `__og_image_${i}`;
		let list = heads.get(c.region);
		if (!list) heads.set(c.region, (list = []));
		list.push(`import ${name} from ${JSON.stringify(image_specifier(c.src, c.options))};`);
		edits.push({ start: c.start, end: c.end, text: name });
	});
	for (const [at, lines] of heads)
		edits.push({ start: at, end: at, text: `\n${lines.join('\n')}\n` });
	return edits.sort((a, b) => a.start - b.start || (a.end === a.start ? -1 : 1));
}
