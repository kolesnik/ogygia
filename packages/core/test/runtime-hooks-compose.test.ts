import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { boot_client_plugins, type ClientRealm } from '../src/runtime/client-plugins.ts';
import { told } from '../src/runtime/hook-told.ts';
import type { NavigatedEvent } from '../src/contract/runtime-hooks.ts';

const nav: NavigatedEvent = {
	from: '/',
	to: '/next',
	type: 'link',
	t: 1,
	fetched: 2,
	styled: 3,
	swapped: 4,
	reconciled: true
};
let errors: unknown[][];
beforeEach(() => {
	errors = [];
	vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a));
});
afterEach(() => {
	vi.restoreAllMocks();
	boot_client_plugins([], false);
});
const navigated = told('navigated');
const region_hydrate = told('regionHydrate');
const codes = () => errors.map((a) => String(a[0]));

test('three plugins on one hook run in plugin order', () => {
	const order: string[] = [];
	const realms: ClientRealm[] = ['a', 'b', 'c'].map((name) => ({
		name,
		client: { hooks: { navigated: () => void order.push(name) } }
	}));
	boot_client_plugins(realms, false);
	navigated({ ...nav });
	expect(order).toEqual(['a', 'b', 'c']);
});

test('a throwing subscriber is reported once and never stops the ones after it', () => {
	const order: string[] = [];
	boot_client_plugins(
		[
			{ name: 'a', client: { hooks: { navigated: () => void order.push('a') } } },
			{
				name: 'b',
				client: {
					hooks: {
						navigated: () => {
							throw new Error('boom');
						}
					}
				}
			},
			{ name: 'c', client: { hooks: { navigated: () => void order.push('c') } } }
		],
		false
	);
	navigated({ ...nav });
	navigated({ ...nav });
	expect(order).toEqual(['a', 'c', 'a', 'c']);
	expect(codes()).toHaveLength(1);
	expect(codes()[0]).toContain('client_hook_failed');
	expect(codes()[0]).toContain('`b`');
	expect(codes()[0]).toContain('navigated');
});

test("a subscriber's rejected promise is reported, and the call's wait settles past it", async () => {
	const lone: ClientRealm = {
		name: 'lone',
		client: { hooks: { navigated: (async () => Promise.reject(new Error('later'))) as () => void } }
	};
	boot_client_plugins([lone], false);
	await expect(navigated({ ...nav })).resolves.toBeUndefined();
	await vi.waitFor(() => expect(codes()).toHaveLength(1));
	expect(codes()[0]).toContain('client_hook_failed');
	expect(codes()[0]).toContain('`lone`');
});

test('in dev, a subscriber that writes to the payload fails, and the next one sees it untouched', () => {
	let seen = '';
	boot_client_plugins(
		[
			{
				name: 'writer',
				client: {
					hooks: {
						navigated: (e) => {
							(e as { to: string }).to = '/elsewhere';
						}
					}
				}
			},
			{ name: 'reader', client: { hooks: { navigated: (e) => void (seen = e.to) } } }
		],
		false
	);
	navigated({ ...nav });
	expect(seen).toBe('/next');
	expect(codes()[0]).toContain('`writer`');
});

test('a plugin whose boot throws is reported, and the boot and the plugins after it carry on', () => {
	const booted: string[] = [];
	expect(() =>
		boot_client_plugins(
			[
				{ name: 'a', client: { boot: () => void booted.push('a') } },
				{
					name: 'bad',
					client: {
						boot() {
							throw new Error('boom');
						}
					}
				},
				{ name: 'c', client: { boot: () => void booted.push('c') } }
			],
			false
		)
	).not.toThrow();
	expect(booted).toEqual(['a', 'c']);
	expect(codes()).toHaveLength(1);
	expect(codes()[0]).toContain('client_hook_failed');
	expect(codes()[0]).toContain('`bad`');
	expect(codes()[0]).toContain('`boot`');
});

test('the functions subscribers return come back as one, run in plugin order, a throw in one reported and the rest run', () => {
	const order: string[] = [];
	const realms: ClientRealm[] = [
		{ name: 'a', client: { hooks: { regionHydrate: () => () => void order.push('a') } } },
		{ name: 'none', client: { hooks: { regionHydrate: () => undefined } } },
		{
			name: 'bad',
			client: {
				hooks: {
					regionHydrate: () => () => {
						throw new Error('after failed');
					}
				}
			}
		},
		{ name: 'c', client: { hooks: { regionHydrate: () => () => void order.push('c') } } }
	];
	boot_client_plugins(realms, false);
	const hook = region_hydrate as (e: unknown) => (() => void) | undefined;
	const after = hook({});
	expect(order).toEqual([]);
	expect(typeof after).toBe('function');
	after!();
	expect(order).toEqual(['a', 'c']);
	expect(codes()).toHaveLength(1);
	expect(codes()[0]).toContain('client_hook_failed');
});

test('a hook whose subscribers return nothing gives back nothing to run after', () => {
	boot_client_plugins(
		[{ name: 'a', client: { hooks: { regionHydrate: () => undefined } } }],
		false
	);
	const hook = region_hydrate as (e: unknown) => unknown;
	expect(hook({})).toBeUndefined();
});

test('a hook no realm subscribes to tells nobody and gives back nothing', () => {
	let booted = 0;
	boot_client_plugins([{ name: 'a', client: { boot: () => void booted++ } }], false);
	expect(booted).toBe(1);
	expect(navigated({ ...nav })).toBeUndefined();
	expect(codes()).toEqual([]);
});

test('subscribers that answer with a promise: the call waits for every one, a rejection reported and waited past', async () => {
	const order: string[] = [];
	let release!: () => void;
	boot_client_plugins(
		[
			{
				name: 'slow',
				client: {
					hooks: {
						answerParsed: () =>
							new Promise<void>((r) => (release = r)).then(() => void order.push('slow'))
					}
				}
			},
			{
				name: 'broken',
				client: { hooks: { answerParsed: () => Promise.reject(new Error('no')) } }
			},
			{ name: 'sync', client: { hooks: { answerParsed: () => void order.push('sync') } } }
		],
		false
	);
	const answer_parsed = told('answerParsed');
	const wait = answer_parsed({ fragment: {} as DocumentFragment });
	expect(wait).toBeInstanceOf(Promise);
	expect(order).toEqual(['sync']);
	let settled = false;
	void wait!.then(() => (settled = true));
	await Promise.resolve();
	expect(settled).toBe(false);
	release();
	await wait;
	expect(order).toEqual(['sync', 'slow']);
	expect(codes()).toEqual([expect.stringContaining('client_hook_failed')]);
});
