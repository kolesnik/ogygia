/**
 * Error codes: a message table (`export const MESSAGES = { code: { id, text, fix, safe } }`) gives
 * each code a fixed id. Output carries the id; the words are written only behind a development
 * check, so production ships no message text, only the arguments a message calls safe.
 *
 * @packageDocumentation
 */
import { readFileSync } from 'node:fs';
import { parseSync } from 'oxc-parser';
import { keyName, type N } from './ast.ts';
import { DEV_CHECK } from './gate.ts';

/** A message as its table holds it: its code, its fixed id, its words and what to do, and the
 *  arguments production may print. */
export interface Message {
	readonly code: string;
	readonly id: number;
	readonly text: string;
	readonly fix: string;
	readonly safe: ReadonlyArray<string>;
}

/** A message table, in the order it is written. */
export type Messages = ReadonlyArray<Message>;

/** A hole in a message's text: `{name}`. */
export const HOLE = /\{(\w+)\}/g;

function stringOf(file: string, where: string, v: N): string {
	if (v?.type !== 'Literal' || typeof v.value !== 'string')
		throw new Error(`${file}: ${where} must be a string.`);
	return v.value;
}

/**
 * Reads `export const <name> = { code: { id, text, fix, safe }, … }` from `file`, in order. An id
 * that is not a whole number or is given twice, a value that is not a literal, a hole named twice,
 * a hole in `fix`, or a safe argument that is not a hole of `text` is an error.
 */
export function readMessages(file: string, name = 'MESSAGES'): Messages {
	const code = readFileSync(file, 'utf8');
	const { program } = parseSync(file, code, {
		lang: 'ts',
		sourceType: 'module'
	});
	for (const node of program.body as Array<N>) {
		const d = node.declaration?.declarations?.[0];
		if (node.type !== 'ExportNamedDeclaration' || d?.id?.name !== name) continue;
		let table = d.init;
		if (table?.type === 'TSAsExpression') table = table.expression;
		if (table?.type !== 'ObjectExpression')
			throw new Error(`${file}: ${name} must be an object literal.`);
		const ids = new Set<number>();
		return table.properties.map((p: N): Message => {
			const at = `${name}.${keyName(p)}`;
			if (p.value?.type !== 'ObjectExpression')
				throw new Error(`${file}: ${at} must be { id, text, fix, safe }.`);
			const fields = new Map<string, N>();
			for (const f of p.value.properties) fields.set(keyName(f), f.value);
			const id = fields.get('id');
			if (
				id?.type !== 'Literal' ||
				typeof id.value !== 'number' ||
				!Number.isInteger(id.value) ||
				id.value < 0
			)
				throw new Error(`${file}: ${at}.id must be a whole number.`);
			if (ids.has(id.value)) throw new Error(`${file}: ${at}.id ${id.value} is given twice.`);
			ids.add(id.value);
			const text = stringOf(file, `${at}.text`, fields.get('text'));
			const fix = stringOf(file, `${at}.fix`, fields.get('fix'));
			const holes = holesOf(text);
			if (new Set(holes).size !== holes.length)
				throw new Error(`${file}: ${at} names a hole twice.`);
			if (holesOf(fix).length !== 0)
				throw new Error(`${file}: ${at}.fix has a hole: its words are fixed.`);
			let safe = fields.get('safe');
			if (safe?.type === 'TSAsExpression') safe = safe.expression;
			if (safe?.type !== 'ArrayExpression')
				throw new Error(`${file}: ${at}.safe must be a list of its holes.`);
			const names = safe.elements.map((e: N) => stringOf(file, `${at}.safe`, e));
			for (const n of names)
				if (!holes.includes(n))
					throw new Error(`${file}: ${at}.safe names "${n}", not a hole of its text.`);
			return { code: keyName(p), id: id.value, text, fix, safe: names };
		});
	}
	throw new Error(`${file}: no exported ${name} table.`);
}

/** The holes a message's text names, in order. */
export function holesOf(text: string): Array<string> {
	return [...text.matchAll(HOLE)].map((m) => m[1]!);
}

/** What is wrong with the arguments a message is given, by name: the first hole none fills, else
 *  the first name no hole has; null when they match. */
export function argumentProblem(
	message: Message,
	given: ReadonlyArray<string>
): { readonly missing: string } | { readonly extra: string } | null {
	const holes = holesOf(message.text);
	for (const hole of holes) if (!given.includes(hole)) return { missing: hole };
	for (const name of given) if (!holes.includes(name)) return { extra: name };
	return null;
}

/**
 * A message's arguments as output passes them: an object literal of every hole (`source` gives
 * each one's code), behind the development check (`check`, default `DEV_CHECK`) when some are not safe, so production builds
 * only the safe ones and never evaluates the rest.
 */
export function argumentsOf(
	message: Message,
	source: (hole: string) => string,
	check: string = DEV_CHECK
): string {
	const holes = holesOf(message.text);
	const record = (names: ReadonlyArray<string>) =>
		names.length === 0
			? '{}'
			: `{ ${names.map((k) => `${JSON.stringify(k)}: ${source(k)}`).join(', ')} }`;
	const all = record(holes);
	return message.safe.length === holes.length
		? all
		: `${check} ? ${all} : ${record(holes.filter((h) => message.safe.includes(h)))}`;
}

/** A message's words as output passes them: `[code, text, fix]` in development, null in
 *  production. */
export function wordsOf(message: Message, check: string = DEV_CHECK): string {
	return `${check} ? ${JSON.stringify([message.code, message.text, message.fix])} : null`;
}

/**
 * What breaks a table's promise against its committed baseline (code → id): a code the baseline
 * lacks, a code whose id moved, and an id the baseline gives twice. A removed code stays in the
 * baseline, so its id is never given again. Empty when the promise holds.
 */
export function idProblems(
	table: ReadonlyArray<{ readonly code: string; readonly id: number }>,
	baseline: Readonly<Record<string, number>>
): Array<string> {
	const out: Array<string> = [];
	const next = Math.max(-1, ...Object.values(baseline)) + 1;
	for (const { code, id } of table) {
		const was = Object.hasOwn(baseline, code) ? baseline[code] : undefined;
		if (was === undefined) out.push(`${code}: not in the baseline; add it with id ${next}.`);
		else if (was !== id) out.push(`${code}: id ${id}, but the baseline gave it ${was}.`);
	}
	const codes = new Map<number, string>();
	for (const [code, id] of Object.entries(baseline)) {
		const other = codes.get(id);
		if (other !== undefined)
			out.push(`id ${id} is given twice in the baseline: ${other}, ${code}.`);
		codes.set(id, code);
	}
	return out;
}
