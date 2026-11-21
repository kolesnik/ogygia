// devalue_text (server/devalue-text.ts) writes devalue's own text: for any value and reducers that
// claim objects, functions and primitives (an app's transport may claim a string), its text is
// `stringify(value, reducers)`'s byte for byte, a value devalue refuses is refused with devalue's
// message, and each reducer is asked about a value once, whichever writes it.
import { describe, expect, it } from 'vitest';
import { stringify } from 'devalue';
import { fc, fuzz } from '@ogygia/config/html-fuzz';
import { devalue_text } from '../src/server/devalue-text.ts';

class Wired {
	readonly n: number;
	constructor(n: number) {
		this.n = n;
	}
}
class Unknown {
	readonly x = 1;
}
const branded = Object.assign(() => 0, { brand: 'fn' });

/** Three reducers: the prop families' two (an object or function they know), and an app's that
 *  claims a string. */
function reducers(asked: Map<string, Map<unknown, number>> | null = null) {
	const count = (key: string, v: unknown) => {
		if (asked === null) return;
		const by = asked.get(key) ?? asked.set(key, new Map()).get(key)!;
		by.set(v, (by.get(v) ?? 0) + 1);
	};
	return {
		Seed: (v: unknown) => {
			count('Seed', v);
			return v !== null && typeof v === 'object' && 'seed' in v ? ['data', 'k'] : undefined;
		},
		Ref: (v: unknown) => {
			count('Ref', v);
			if (v instanceof Wired) return { k: 'wire', i: `w${v.n}`, d: { n: v.n } };
			if (typeof v === 'function' && 'brand' in v) return { k: 'fn', i: 'f', d: '' };
			return undefined;
		},
		Tagged: (v: unknown) => {
			count('Tagged', v);
			return typeof v === 'string' && v.startsWith('$') ? [v.slice(1)] : undefined;
		}
	};
}

/** devalue's answer: its text, or the message it refuses with. */
const answer = (f: () => string): string => {
	try {
		return `text ${f()}`;
	} catch (e) {
		return `refused ${(e as Error).message}`;
	}
};

const text_arb = fc.oneof(
	fc.string({ unit: 'binary' }),
	fc.string({ unit: 'grapheme' }),
	fc.constantFrom(
		'<',
		'</script>',
		'\u2028',
		'\u2029',
		'\ud800',
		'a\udc00b',
		'"\\',
		'\b\f\n\r\t\v\0\x1f\x7f',
		'',
		'$tag',
		'$<'
	)
);

const value_arb = fc.letrec((tie) => ({
	leaf: fc.oneof(
		text_arb,
		fc.double(),
		fc.integer(),
		fc.constantFrom(0, -0, NaN, Infinity, -Infinity, true, false, null, undefined),
		fc.bigInt(),
		fc.date({ noInvalidDate: false }),
		fc.integer({ min: 0, max: 9 }).map((n) => new Wired(n)),
		fc.constantFrom(
			branded,
			new Unknown(),
			/re/g,
			new URL('https://example.com/a?b'),
			Symbol('s'),
			() => 1,
			Object(1),
			{ seed: 1 },
			{ then: () => 1 },
			JSON.parse('{"__proto__":1,"a":2}') as object
		)
	),
	node: fc.oneof(
		{ depthSize: 'small' },
		tie('leaf'),
		fc.array(tie('node'), { maxLength: 4 }),
		fc.dictionary(text_arb, tie('node'), { maxKeys: 4 }),
		fc.array(fc.tuple(tie('node'), tie('node')), { maxLength: 3 }).map((e) => new Map(e)),
		fc.array(tie('node'), { maxLength: 3 }).map((e) => new Set(e)),
		fc.array(tie('node'), { maxLength: 3 }).map((a) => {
			const sparse = [...a];
			sparse.length += 2;
			return sparse;
		}),
		fc
			.dictionary(text_arb, tie('node'), { maxKeys: 2 })
			.map((d) => Object.assign(Object.create(null), d)),
		tie('node').map((v) => ({ shared: v, again: v })),
		fc.constant(null).map(() => {
			const cycle: Record<string, unknown> = { name: 'loop' };
			cycle.self = cycle;
			return cycle;
		})
	)
})).node;

describe('devalue_text writes devalue’s text', () => {
	it('any value, with reducers that claim objects, functions and strings: the same text, or the same refusal', () => {
		fuzz(
			value_arb,
			(value) => {
				expect(answer(() => devalue_text(value, reducers()))).toBe(
					answer(() => stringify(value, reducers()))
				);
			},
			{ runs: 3000 }
		);
	});

	it('each reducer is asked about a value once, whichever writes it', () => {
		fuzz(
			value_arb,
			(value) => {
				const ours = new Map<string, Map<unknown, number>>();
				answer(() => devalue_text(value, reducers(ours)));
				for (const by of ours.values()) for (const n of by.values()) expect(n).toBe(1);
			},
			{ runs: 1000 }
		);
	});

	it('a reducer’s own error passes through, and the reducer is asked once', () => {
		const broken = { broken: true };
		let asked = 0;
		const failing = {
			Ref: (v: unknown) => {
				if (v !== broken) return undefined;
				asked++;
				throw new TypeError('the reducer broke');
			}
		};
		expect(() => devalue_text({ a: 'x', b: [broken] }, failing)).toThrow('the reducer broke');
		expect(asked).toBe(1);
	});

	it('the strings devalue spells apart from JSON: `<`, the line and paragraph separators, a lone surrogate', () => {
		for (const s of ['a<b', '\u2028\u2029', '\ud800', 'x\udfffy', '<😀<', '\u0001\u001f'])
			expect(devalue_text({ s }, {})).toBe(stringify({ s }));
	});

	it('a root devalue writes as a constant: undefined, NaN, the infinities, -0', () => {
		for (const v of [undefined, NaN, Infinity, -Infinity, -0])
			expect(devalue_text(v, {})).toBe(stringify(v));
	});
});
