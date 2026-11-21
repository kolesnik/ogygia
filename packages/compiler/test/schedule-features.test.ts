// THE SCHEDULE FEATURES (link/runtime-entry.ts `idle`, `visible`, `media`): each arm of the region
// element's trigger interpreter ships only when some region of the app is scheduled on it, a wake,
// a hole's fetch or prefetch, or a lake's revalidation. A schedule the marks cannot see (a held
// region's runtime options, a peer's regions) keeps every arm. A region that asks
// for an arm its build left out runs on load and says so (core test/browser/schedules-missing.test.ts).
import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../src/index.ts';
import {
	generateRuntimeFlagsSource,
	resolveFeatures,
	type RuntimeMarks
} from '../src/link/runtime-entry.ts';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent, F_IDLE, F_MEDIA, F_VISIBLE } from '@ogygia/core/contract';

const ARMS = ['idle', 'visible', 'media'] as const;
const marks = (m: Partial<RuntimeMarks>): RuntimeMarks => ({ complete: true, ...m });
const arms_of = (m: Partial<RuntimeMarks>): string[] =>
	resolveFeatures(marks(m)).filter((f) => (ARMS as readonly string[]).includes(f));

describe('each arm ships with a region scheduled on it', () => {
	test('a page of load islands ships no arm', () => {
		expect(arms_of({ hydrate: ['load'] })).toEqual([]);
		expect(arms_of({ hydrate: ['load', 'interaction'], defer: ['load'] })).toEqual([]);
	});

	test.each<[string, Partial<RuntimeMarks>, string[]]>([
		['an idle wake', { hydrate: ['idle'] }, ['idle']],
		['a visible wake', { hydrate: ['visible'] }, ['visible']],
		['a media query wake', { hydrate: ['(min-width: 600px)'] }, ['media']],
		['an idle hole fetch', { defer: ['idle'] }, ['idle']],
		[
			'a hole prefetched on visible',
			{ defer: ['interaction'], prefetch: ['visible'] },
			['visible']
		],
		[
			'a lake revalidated on a media query',
			{ revalidate: ['screen and (min-width: 1px)'] },
			['media']
		],
		[
			'an idle wake and a visible prefetch',
			{ hydrate: ['idle'], prefetch: ['visible'] },
			['idle', 'visible']
		]
	])('%s', (_, m, arms) => {
		expect(arms_of(m)).toEqual(arms);
	});

	test('a value no trigger parses as is no media query', () => {
		expect(arms_of({ hydrate: ['visible(200px)'] })).toEqual([]);
	});
});

describe('a schedule the marks cannot see keeps every arm', () => {
	test.each<[string, Partial<RuntimeMarks>]>([
		["a held region (region()'s options are runtime values)", { hydrate: ['load'], live: true }],
		["a peer's regions (federation)", { hydrate: ['load'], foreign: true }]
	])('%s', (_, m) => {
		expect(arms_of(m)).toEqual([...ARMS]);
	});

	test('a build with no marks (dev) has every arm, and so does its word', () => {
		expect(resolveFeatures({ complete: false })).toEqual(expect.arrayContaining([...ARMS]));
		const has = Number(/HAS = (\d+);/.exec(generateRuntimeFlagsSource({}, '/rt', true))![1]);
		expect(has & (F_IDLE | F_VISIBLE | F_MEDIA)).toBe(F_IDLE | F_VISIBLE | F_MEDIA);
	});

	test("the word holds an arm's bit exactly when the arm ships", () => {
		const word = (m: Partial<RuntimeMarks>) =>
			Number(/HAS = (\d+);/.exec(generateRuntimeFlagsSource(marks(m), '/rt'))![1]);
		expect(word({ hydrate: ['load'] }) & (F_IDLE | F_VISIBLE | F_MEDIA)).toBe(0);
		expect(word({ hydrate: ['idle'] }) & (F_IDLE | F_VISIBLE | F_MEDIA)).toBe(F_IDLE);
	});
});

const roots: string[] = [];
afterEach(() => {
	for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

/** The marks a prescan of `page` (a csr=false route) records. */
function marks_for(
	page: string,
	extra: Record<string, string> = {},
	init: object = {}
): RuntimeMarks {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-schedule-'));
	roots.push(root);
	const files: Record<string, string> = {
		'src/routes/+layout.ts': 'export const csr = false;\n',
		'src/routes/+page.svelte': page,
		'src/lib/Part.svelte': '<p>part</p>\n',
		...extra
	};
	for (const [rel, src] of Object.entries(files)) {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, src);
	}
	const program = new Program({ forms: false, router: false });
	const profiler = {
		prof: {
			transformMs: 0,
			transformN: 0,
			transformHit: 0,
			prescanMs: 0,
			macroMs: 0,
			macroN: 0,
			resolveMs: 0,
			loadMs: 0
		},
		P: false,
		outHash: new Map<string, number>()
	};
	const compiler = new Compiler(
		program,
		profiler,
		new CompileCtx(
			partial_ctx_init({
				root,
				base: '/',
				libDir: path.join(root, 'src/lib'),
				is_dev: false,
				id_salt: '',
				visibleMargin: '0px',
				presets: {},
				import_keys: normalize_import_keys(undefined),
				resolve_alias: [],
				pkg_root: '/nowhere/ogygia',
				...init
			})
		)
	);
	compiler.prescan();
	return { ...program.runtime_marks, complete: true };
}

const page = (imports: string, body: string) =>
	`${dedent`
	<script>
	${imports}
	</script>
	${body}
`}\n`;

describe('the prescan records every schedule a region is on', () => {
	test("a hole's prefetch is a schedule: its arm ships, and the fetch's", () => {
		const m = marks_for(
			page(
				"\timport Part from '$lib/Part.svelte' with { render: 'deferred', fetch: 'visible', prefetch: 'idle' };",
				'<Part />'
			)
		);
		expect(m.defer).toEqual(['visible']);
		expect(m.prefetch).toEqual(['idle']);
		expect(arms_of(m)).toEqual(['idle', 'visible']);
	});

	test("a live lake's revalidation is a schedule: a media query ships the media arm", () => {
		const m = marks_for(
			page(
				"\timport Part from '$lib/Part.svelte' with { render: 'live', wake: '(min-width: 600px)' };",
				'<Part />'
			)
		);
		expect(m.revalidate).toEqual(['(min-width: 600px)']);
		expect(arms_of(m)).toEqual(['media']);
	});

	test('load islands alone record no schedule that ships an arm', () => {
		const m = marks_for(
			page("\timport Part from '$lib/Part.svelte' with { wake: 'load' };", '<Part />')
		);
		expect(m.prefetch).toEqual([]);
		expect(m.revalidate).toEqual([]);
		expect(arms_of(m)).toEqual([]);
	});

	test("a held region's wake is the app's to pick at run time: every arm ships", () => {
		const m = marks_for(
			page(
				`${dedent`
					import Part from '$lib/Part.svelte' with { region: 'raw' };
					import { region } from 'ogygia';
					let { data } = $props();
					const r = region(Part, {}, { wake: data.when });
				`}`,
				'{r}'
			)
		);
		expect(m.live).toBe(true);
		expect(arms_of(m)).toEqual([...ARMS]);
	});
});

// A PLUGIN puts regions this build never compiled into a page only by saying so
// (`b.foreignHydrate()`, the `foreign` mark). Its browser half alone cannot: it boots and is told
// the runtime's moments (core plugin/client.ts), so it hides no schedule and wakes no island.
describe("a plugin's browser half hides no schedule", () => {
	const client = { client_plugins: [{ name: '@x/plugin', module: '/x/plugin/client.js' }] };
	const on = (wake: string) =>
		page(`\timport Part from '$lib/Part.svelte' with { wake: '${wake}' };`, '<Part />');

	test('load islands with a client plugin ship no arm', () => {
		expect(arms_of(marks_for(on('load'), {}, client))).toEqual([]);
	});

	test("a client plugin keeps the arms of the app's own schedules", () => {
		expect(arms_of(marks_for(on('idle'), {}, client))).toEqual(['idle']);
		expect(arms_of(marks_for(on('(min-width: 600px)'), {}, client))).toEqual(['media']);
	});

	test('lakes with a client plugin read no island graph', () => {
		const m = marks_for(on('none'), {}, client);
		expect(m.lakes).toBe(true);
		expect(resolveFeatures(m)).not.toContain('graph');
	});

	test('a plugin that places regions (b.foreignHydrate) keeps every arm and the graph', () => {
		const m = marks_for(on('none'), {}, { ...client, foreign_hydrate: true });
		expect(arms_of(m)).toEqual([...ARMS]);
		expect(resolveFeatures(m)).toContain('graph');
	});
});
