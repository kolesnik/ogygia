// The realm's restorer chunk lost (src/client.ts), and its wording chunk too: the page says what it
// can (the error itself), the wait for the restorer settles instead of holding every answer, and an
// answer goes in as it came.
import { expect, test, vi } from 'vitest';
import type { PageGlobals } from '@ogygia/core/plugin/client';
import client from '../../src/client.ts';

test('a restorer that does not load is said, and the answers waiting for it go on', async () => {
	const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
	const w = window as PageGlobals;
	client.boot!({ kitPage: false });
	const tpl = document.createElement('template');
	tpl.innerHTML = '<p>as it came</p>';
	const wait = client.hooks!.answerParsed!({ fragment: tpl.content });
	expect(wait).toBeInstanceOf(Promise);
	await wait;
	await w.__og_restore_ready;
	await vi.waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
	expect(String(printed.mock.calls[0][0])).toContain('restore.ts');
	expect(w.__og_restore).toBeUndefined();
	expect(tpl.content.firstElementChild!.outerHTML).toBe('<p>as it came</p>');
});
