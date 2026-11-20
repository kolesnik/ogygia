// A region needs a program of the region element's: a deferred region the hole program (its fetch),
// a live region the live program (its ticks). The build ships a program only when the app's marks
// select its feature (`HAS`, ogygia:boot), so a region the compiler missed is left as the server
// wrote it. `rule_region_program_shipped` says so in dev and at the end of every e2e test.
import { afterAll, expect, test } from 'vitest';
import { HAS, set_feature_word } from '../_stubs/boot.runtime-flags.ts';
import { F_FRAMES, F_LIVE } from '../../src/contract/features.ts';
import { install_rules, runtime_rules } from '../../src/runtime/rules.ts';

const ALL = HAS;
afterAll(() => set_feature_word(ALL));

install_rules(false);
const program_rule = () =>
	runtime_rules
		.broken()
		.filter((b) => b.code === 'rule_region_program_shipped')
		.map((b) => b.detail);

const DEFERRED = '<ogygia-region render="defer" entry="late"><p>fallback</p></ogygia-region>';
const LIVE = '<ogygia-region live entry="ticker"><p>first</p></ogygia-region>';
const LOAD = '<ogygia-region wake="load" entry="counter"><p>counter</p></ogygia-region>';

test('a build with every program breaks no rule, whatever regions the page holds', () => {
	set_feature_word(ALL);
	document.body.innerHTML = DEFERRED + LIVE + LOAD;
	expect(program_rule()).toEqual([]);
});

test('a build without frames breaks no rule on a page of islands alone', () => {
	set_feature_word(ALL & ~F_FRAMES & ~F_LIVE);
	document.body.innerHTML = LOAD;
	expect(program_rule()).toEqual([]);
});

test('a deferred region in a build without frames is a broken rule', () => {
	set_feature_word(ALL & ~F_FRAMES & ~F_LIVE);
	document.body.innerHTML = LOAD + DEFERRED;
	expect(program_rule()).toEqual(['late needs the hole program, which this build left out']);
});

test('a live region in a build without the live program is a broken rule', () => {
	set_feature_word(ALL & ~F_LIVE);
	document.body.innerHTML = DEFERRED + LIVE;
	expect(program_rule()).toEqual(['ticker needs the live program, which this build left out']);
});

test('a live region in a build without frames is a broken rule', () => {
	set_feature_word(ALL & ~F_FRAMES);
	document.body.innerHTML = LIVE;
	expect(program_rule()).toEqual(['ticker needs the live program, which this build left out']);
});
