// THE REALM'S RESTORER (src/client.ts): a document a rewrite restored something in carries the
// restorer inline; a page whose document carried none loads the realm's copy at boot, a chunk of its
// own, so no boot carries it. An answer parsed before the copy is in waits for it (core's
// region_fragment holds the answer until the hook's promise settles), and comes out restored.
import { afterEach, expect, test } from 'vitest';
import type { PageGlobals } from '@ogygia/core/plugin/client';
import client from '../../src/client.ts';
import { restore } from '../../src/restore.ts';
import { transformMarkup } from '../../src/reversible.ts';
import { fake_scoped } from '../fixtures/fake-scoped-render.ts';

const w = window as PageGlobals;

afterEach(() => {
	delete w.__og_restore;
	delete w.__og_restore_adopt;
	delete w.__og_restore_ready;
});

/** An answer a scoped render reshaped, parsed inert as the runtime parses one. */
async function answer(): Promise<DocumentFragment> {
	const s = await transformMarkup('<demo-card class="x"> hi </demo-card>', fake_scoped, {
		kind: 'region'
	});
	const tpl = document.createElement('template');
	tpl.innerHTML = s.html;
	return tpl.content;
}

test('a page with no restorer of its own loads the realm’s after the boot, and an answer parsed first waits for it', async () => {
	delete w.__og_restore;
	client.boot!({ kitPage: false });
	// (a chunk of its own: the boot itself carries none)
	expect(w.__og_restore).toBeUndefined();
	const frag = await answer();
	const wait = client.hooks!.answerParsed!({ fragment: frag });
	expect(wait).toBeInstanceOf(Promise);
	expect(frag.querySelector('demo-card')!.shadowRoot).toBeNull();
	await wait;
	expect(frag.querySelector('demo-card')!.shadowRoot).not.toBeNull();
	expect(frag.querySelector('demo-card')!.innerHTML).toBe(' hi ');
	// once in, every later answer restores at once
	const next = await answer();
	expect(client.hooks!.answerParsed!({ fragment: next })).toBeUndefined();
	expect(next.querySelector('demo-card')!.shadowRoot).not.toBeNull();
});

test('a page whose document carried the restorer uses that one and loads none', async () => {
	let runs = 0;
	w.__og_restore = (root, lite) => (runs++, restore(root as Element, lite));
	client.boot!({ kitPage: false });
	expect(w.__og_restore_ready).toBeUndefined();
	const frag = await answer();
	expect(client.hooks!.answerParsed!({ fragment: frag })).toBeUndefined();
	expect(runs).toBe(1);
	expect(frag.querySelector('demo-card')!.shadowRoot).not.toBeNull();
});
