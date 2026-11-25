/**
 * Decision tables and message tables: a choice decided for every row with its checks, and error
 * codes numbered by place with their words for development only.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decideAll, inputAt, tableProblem } from '../src/decisions.ts';
import {
	argumentProblem,
	argumentsOf,
	holesOf,
	idProblems,
	readMessages,
	wordsOf,
	type Message
} from '../src/messages.ts';

const axes = [
	['kind', ['mouse', 'key']],
	['moved', [false, true]]
] as const;

describe('decision tables', () => {
	test('every row in index order, the last input fastest', () => {
		const plans = decideAll(axes, (i) => {
			const { kind, moved } = i as { kind: string; moved: boolean };
			return kind === 'key' ? 'start' : moved ? 'start' : 'wait';
		});
		expect(plans).toEqual(['wait', 'start', 'start', 'start']);
		expect(inputAt(axes, 2)).toEqual({ kind: 'key', moved: false });
		expect(tableProblem('t', axes, plans, {})).toBeNull();
	});

	test('a rule that fails, and an input that never changes the plan', () => {
		expect(
			tableProblem('t', axes, ['wait', 'start', 'start', 'start'], {
				'a key starts': (row) =>
					(row.input as { kind: string }).kind !== 'key' || row.plan === 'wait'
			})
		).toBe(
			't: the rule "a key starts" does not hold for {"kind":"key","moved":false} (plan "start").'
		);
		expect(tableProblem('t', axes, ['a', 'b', 'a', 'b'], {})).toBe(
			't: the input "kind" never changes the plan: delete it.'
		);
	});
});

describe('message tables', () => {
	test('codes in order with their ids; holes', () => {
		const file = join(mkdtempSync(join(tmpdir(), 'kit-')), 'messages.ts');
		writeFileSync(
			file,
			"export const MESSAGES = { gone: { id: 3, text: 'no {name} in `{where}`', fix: 'add it', safe: ['where'] }, ok: { id: 0, text: 'fine', fix: 'none', safe: [] } } as const\n"
		);
		expect(readMessages(file)).toEqual([
			{
				code: 'gone',
				id: 3,
				text: 'no {name} in `{where}`',
				fix: 'add it',
				safe: ['where']
			},
			{ code: 'ok', id: 0, text: 'fine', fix: 'none', safe: [] }
		]);
		expect(holesOf('no {name} in `{where}`')).toEqual(['name', 'where']);
	});

	test('a bad id, a value that is not a string, a hole twice, a hole in fix, or an unsafe safe is refused', () => {
		const dir = mkdtempSync(join(tmpdir(), 'kit-'));
		const table = (name: string, body: string) => {
			writeFileSync(join(dir, `${name}.ts`), `export const MESSAGES = { ${body} }\n`);
			return () => readMessages(join(dir, `${name}.ts`));
		};
		const entry = (fields: string) => `m: { id: 0, text: 'a {x}', fix: 'f', safe: [], ${fields} }`;
		expect(table('a', entry('text: 1'))).toThrow('MESSAGES.m.text must be a string.');
		expect(table('b', entry("text: '{x}{x}'"))).toThrow('MESSAGES.m names a hole twice.');
		expect(table('c', entry('id: 1.5'))).toThrow('MESSAGES.m.id must be a whole number.');
		expect(
			table(
				'd',
				"a: { id: 1, text: 't', fix: 'f', safe: [] }, b: { id: 1, text: 't', fix: 'f', safe: [] }"
			)
		).toThrow('MESSAGES.b.id 1 is given twice.');
		expect(table('e', entry("fix: 'use {x}'"))).toThrow('MESSAGES.m.fix has a hole');
		expect(table('f', entry("safe: ['y']"))).toThrow('MESSAGES.m.safe names "y"');
	});
});

describe('a message at its use', () => {
	const late: Message = {
		code: 'late',
		id: 3,
		text: '{who} was {ms} late.',
		fix: 'Be on time.',
		safe: ['ms']
	};
	const bare: Message = {
		code: 'bare',
		id: 4,
		text: 'none.',
		fix: 'no.',
		safe: []
	};

	test('the arguments match the holes, both ways', () => {
		expect(argumentProblem(late, ['who', 'ms'])).toBeNull();
		expect(argumentProblem(late, ['ms'])).toEqual({ missing: 'who' });
		expect(argumentProblem(late, ['who', 'ms', 'why'])).toEqual({
			extra: 'why'
		});
		expect(argumentProblem(bare, [])).toBeNull();
	});

	test('production builds only the safe arguments; development all, and the words', () => {
		const dev = "process.env.NODE_ENV !== 'production'";
		expect(argumentsOf(late, (h) => `a.${h}`)).toBe(
			`${dev} ? { "who": a.who, "ms": a.ms } : { "ms": a.ms }`
		);
		expect(argumentsOf({ ...late, safe: ['who', 'ms'] }, (h) => h)).toBe(
			'{ "who": who, "ms": ms }'
		);
		expect(argumentsOf(bare, (h) => h)).toBe('{}');
		expect(wordsOf(late)).toBe(`${dev} ? ["late","{who} was {ms} late.","Be on time."] : null`);
	});
});

describe('idProblems', () => {
	test('a new code, a moved id, an id given twice', () => {
		expect(idProblems([{ code: 'a', id: 0 }], { a: 0, gone: 1 })).toEqual([]);
		expect(
			idProblems(
				[
					{ code: 'a', id: 1 },
					{ code: 'b', id: 2 }
				],
				{ a: 0, gone: 1, again: 1 }
			)
		).toEqual([
			'a: id 1, but the baseline gave it 0.',
			'b: not in the baseline; add it with id 2.',
			'id 1 is given twice in the baseline: gone, again.'
		]);
	});
});
