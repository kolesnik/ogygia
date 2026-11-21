import { describe, it, expect, vi } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import MagicString from 'magic-string';
import { dedent } from '@ogygia/core/contract';
import {
	bundler_reshake,
	drop_dead_exports,
	shake_server_bundle,
	type Reshake,
	type ShakeBundle,
	type ShakeChunk
} from '../src/link/dead-exports.ts';

// THE SERVER'S DEAD EXPORTS (link/dead-exports.ts): a shared chunk's exports no chunk imports go, with
// the code only they reached; everything it cannot prove dead stays, byte for byte.

const reshake = (await bundler_reshake())!;

const chunk = (fileName: string, code: string, over: Partial<ShakeChunk> = {}): ShakeChunk => ({
	fileName,
	code,
	map: null,
	exports: [...code.matchAll(/(?:\bas |[{,] )(\w+)(?= [,}])/g)].map((m) => m[1]!),
	isEntry: false,
	isDynamicEntry: false,
	...over
});
const entry = (fileName: string, code: string) => chunk(fileName, code, { isEntry: true });

const SHARED = `${dedent`
	import { t as base } from "./base.js";
	// ../../packages/core/dist/used.js
	/** What the entry calls. */
	function used() {
		return base();
	}
	// ../../packages/core/dist/dead.js
	/**
	* Only the dead export reaches this.
	*/
	function helper() {
		return 2;
	}
	function dead() {
		return helper();
	}
	export { used as n, dead as t };
`}\n`;
const SHARED_LIVE = `${dedent`
	import { t as base } from "./base.js";
	// ../../packages/core/dist/used.js
	/** What the entry calls. */
	function used() {
		return base();
	}
	export { used as n };
`}\n`;
const USER = `${dedent`
	import { n as used } from "./chunks/shared.js";
	used();
`}\n`;
const user = () => entry('index.js', USER);

describe('what goes', () => {
	it('an export no chunk imports goes, with the code only it reached, its comments and its module header', async () => {
		const shared = chunk('chunks/shared.js', SHARED);
		const report = await drop_dead_exports([user(), shared], reshake);
		expect(shared.code).toBe(SHARED_LIVE);
		expect(shared.exports).toEqual(['n']);
		expect(report.dropped).toEqual(new Map([['chunks/shared.js', ['t']]]));
		expect(report.bytes).toBe(SHARED.length - SHARED_LIVE.length);
		expect(report.kept).toEqual([]);
	});

	it("a chunk's dropped code was the only importer of another chunk's export: that one goes on the next pass", async () => {
		const mid = chunk(
			'chunks/mid.js',
			`${dedent`
				import { t as base } from "./base.js";
				function mid() {
					return base();
				}
				export { mid as t };
			`}\n`
		);
		const base = chunk(
			'chunks/base.js',
			`${dedent`
				function base() {
					return 1;
				}
				function other() {
					return 3;
				}
				export { other as n, base as t };
			`}\n`
		);
		const index = entry(
			'index.js',
			`${dedent`
				import { n as other } from "./chunks/base.js";
				other();
			`}\n`
		);
		const report = await drop_dead_exports([index, mid, base], reshake);
		expect(report.kept).toEqual([]);
		expect(mid.code).toBe('import "./base.js";\n');
		expect(base.code).toBe(
			`${dedent`
				function other() {
					return 3;
				}
				export { other as n };
			`}\n`
		);
		expect(report.dropped.get('chunks/base.js')).toEqual(['t']);
	});

	it('the map still sends each kept byte to the module that wrote it', async () => {
		const map = new MagicString(SHARED).generateMap({
			hires: true,
			source: 'src/original.js'
		});
		const shared = chunk('chunks/shared.js', SHARED, { map: map as never });
		await drop_dead_exports([user(), shared], reshake);
		const trace = new TraceMap(shared.map as never);
		const line = shared.code.split('\n').indexOf('\treturn base();');
		expect(originalPositionFor(trace, { line: line + 1, column: 1 })).toMatchObject({
			source: 'src/original.js',
			line: SHARED.split('\n').indexOf('\treturn base();') + 1,
			column: 1
		});
	});

	it("over a bundle, a changed chunk's map file is written again", async () => {
		const map = JSON.parse(
			new MagicString(SHARED).generateMap({ hires: true, source: 'src/original.js' }).toString()
		);
		const bundle: ShakeBundle = {
			'index.js': { type: 'chunk', ...user() },
			'chunks/shared.js': {
				type: 'chunk',
				...chunk('chunks/shared.js', SHARED, { map })
			},
			'chunks/shared.js.map': {
				type: 'asset',
				fileName: 'chunks/shared.js.map',
				source: '{}'
			}
		};
		await shake_server_bundle(bundle, reshake);
		const written = JSON.parse((bundle['chunks/shared.js.map'] as { source: string }).source);
		const shared = bundle['chunks/shared.js'] as ShakeChunk;
		expect(written.mappings).toBe((shared.map as { mappings: string }).mappings);
		expect(written.mappings).not.toBe(map.mappings);
	});
});

describe('what stays', () => {
	const shared_after = async (others: ShakeChunk[], over: Partial<ShakeChunk> = {}) => {
		const shared = chunk('chunks/shared.js', SHARED, over);
		const report = await drop_dead_exports([...others, shared], reshake);
		return { code: shared.code, report };
	};

	it('an entry or a chunk loaded by import() keeps every export', async () => {
		expect((await shared_after([user()], { isEntry: true })).code).toBe(SHARED);
		expect((await shared_after([user()], { isDynamicEntry: true })).code).toBe(SHARED);
	});

	it('a chunk some code imports with a literal import(), whole or by namespace, keeps every export', async () => {
		for (const code of [
			'const m = import("./chunks/shared.js");\n',
			'import * as all from "./chunks/shared.js";\n',
			'export * from "./chunks/shared.js";\n'
		])
			expect((await shared_after([entry('index.js', code)])).code).toBe(SHARED);
	});

	it('a chunk whose file name is written as text elsewhere keeps every export (a variable import() may be handed it)', async () => {
		const loader = entry(
			'index.js',
			`${dedent`
				import { n as used } from "./chunks/shared.js";
				const at = "./chunks/shared.js";
				import(at);
			`}\n`
		);
		const { code, report } = await shared_after([loader]);
		expect(code).toBe(SHARED);
		expect(report.kept).toEqual([
			{
				file: 'chunks/shared.js',
				reason: 'its file name is written in the bundle as text',
				failed: false
			}
		]);
	});

	it('a chunk whose exports are not one plain list keeps every export', async () => {
		const code = `${dedent`
			function used() {}
			export function dead() {}
			export { used as n };
		`}\n`;
		const odd = chunk('chunks/odd.js', code, { exports: ['dead', 'n'] });
		const report = await drop_dead_exports(
			[entry('index.js', 'import { n } from "./chunks/odd.js";\n'), odd],
			reshake
		);
		expect(odd.code).toBe(code);
		expect(report.kept).toEqual([
			{
				file: 'chunks/odd.js',
				reason: 'its exports are not one plain list',
				failed: false
			}
		]);
	});

	it('a declaration with a side effect stays though nothing names it', async () => {
		const effect = chunk(
			'chunks/effect.js',
			`${dedent`
				function used() {}
				var seen = globalThis.register(1);
				function dead() {
					return seen;
				}
				export { used as n, dead as t };
			`}\n`
		);
		await drop_dead_exports(
			[entry('index.js', 'import { n } from "./chunks/effect.js";\n'), effect],
			reshake
		);
		expect(effect.code).toBe(
			`${dedent`
				function used() {}
				var seen = globalThis.register(1);
				export { used as n };
			`}\n`
		);
	});

	it('a declaration the re-shake dropped stays while kept code names it (a parameter default included)', async () => {
		const only_first: Reshake = async () => 'AAAA';
		const live = dedent`
			function used(a = helper) {
				var helper = 0;
				return a + helper + other();
			}
			function helper() {}
			function other() {
				return deep;
			}
			var deep = 1;
		`;
		const dead = dedent`
			function dead() {}
			export { used as n, dead as t };
		`;
		const shared = chunk('chunks/shared.js', `${live}\n${dead}\n`);
		await drop_dead_exports(
			[entry('index.js', 'import { n } from "./chunks/shared.js";\n'), shared],
			only_first
		);
		const kept_list = 'export { used as n };';
		expect(shared.code).toBe(`${live}\n${kept_list}\n`);
	});

	it('a chunk that calls eval keeps every export', async () => {
		const code = `${dedent`
			function used(s) {
				return eval(s);
			}
			function dead() {}
			export { used as n, dead as t };
		`}\n`;
		const shared = chunk('chunks/shared.js', code);
		const report = await drop_dead_exports(
			[entry('index.js', 'import { n } from "./chunks/shared.js";\n'), shared],
			reshake
		);
		expect(shared.code).toBe(code);
		expect(report.kept[0]).toMatchObject({
			reason: 'it calls eval, which may read any name',
			failed: false
		});
	});
});

describe('when a step fails, the chunk stays as written and the build says so', () => {
	it('the re-shake throws, or writes no map, or drops what the chunk still exports', async () => {
		const cases: [Reshake, string][] = [
			[
				async () => {
					throw new Error('no');
				},
				'the re-shake failed (no)'
			],
			[async () => null, 'the re-shake wrote no map'],
			[async () => '', 'the re-shake dropped used, which the chunk still exports']
		];
		for (const [bad, reason] of cases) {
			const shared = chunk('chunks/shared.js', SHARED);
			const report = await drop_dead_exports([user(), shared], bad);
			expect(shared.code).toBe(SHARED);
			expect(report.kept).toEqual([{ file: 'chunks/shared.js', reason, failed: true }]);
		}
	});

	it('a cut that would join the lines around it into one statement (no semicolons) leaves the chunk as written', async () => {
		const code = `${dedent`
			function used() {}
			var a = used
			function dead() {}
			(used)(a)
			export { used as n, dead as t };
		`}\n`;
		const shared = chunk('chunks/shared.js', code);
		const report = await drop_dead_exports(
			[entry('index.js', 'import { n } from "./chunks/shared.js";\n'), shared],
			reshake
		);
		expect(shared.code).toBe(code);
		expect(report.kept).toEqual([
			{ file: 'chunks/shared.js', reason: 'the chunk reads differently once cut', failed: true }
		]);
	});

	it('a chunk that does not parse: nothing changes anywhere', async () => {
		const shared = chunk('chunks/shared.js', SHARED);
		const report = await drop_dead_exports(
			[user(), shared, chunk('chunks/bad.js', 'function (')],
			reshake
		);
		expect(shared.code).toBe(SHARED);
		expect(report.kept).toEqual([
			{
				file: 'chunks/bad.js',
				reason: 'it does not parse, so what it imports is unknown',
				failed: true
			}
		]);
	});

	it('server_exports_kept names the chunk and the reason; a chunk kept by a rule says nothing', async () => {
		const said: string[] = [];
		const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
			said.push(a.map(String).join(' '));
		});
		const bundle: ShakeBundle = {
			'index.js': { type: 'chunk', ...user() },
			'chunks/shared.js': {
				type: 'chunk',
				...chunk('chunks/shared.js', SHARED)
			},
			'chunks/plain.js': {
				type: 'chunk',
				...chunk('chunks/plain.js', 'export function dead() {}\n', {
					exports: ['dead']
				})
			}
		};
		await shake_server_bundle(bundle, async () => null);
		await shake_server_bundle(bundle, null);
		spy.mockRestore();
		expect(said).toHaveLength(2);
		expect(said[0]).toContain('server_exports_kept');
		expect(said[0]).toContain('chunks/shared.js');
		expect(said[0]).toContain('the re-shake wrote no map');
		expect(said[1]).toContain('every chunk');
		expect(said[1]).toContain('the bundler Vite builds with could not be loaded');
	});
});

it("the bundler's re-shake gives a map", async () => {
	expect(await reshake('function f() {}; export { f };')).toMatch(/^[A-Za-z0-9+/,;]+$/);
	expect(await reshake('import "./x.js"; function f() {}')).toBe('');
});

it('a bundler that cannot be found or loaded gives no re-shake', async () => {
	const missing = () => {
		throw new Error('Cannot find module rolldown');
	};
	expect(await bundler_reshake(missing)).toBeNull();
	expect(await bundler_reshake(() => '/nowhere/rolldown.mjs')).toBeNull();
});
