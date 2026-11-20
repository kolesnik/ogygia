// THE BROWSER'S HALF BY REALM (`#browser-half`): the work a module both realms import does in the
// browser alone (an island entry's load, the `{@html}` range marks taken out before a hydrate) is the
// runtime's own there; anywhere else (a server, plain Node: test/plain-node-imports.test.ts loads the
// snippet codec there) each refuses with a code and carries none of the runtime's code.
import { describe, expect, it } from 'vitest';
import * as browser from '../src/browser-half.browser.ts';
import * as server from '../src/browser-half.ts';
import { import_entry } from '../src/runtime/entry-locations.ts';
import { unmark_html_ranges } from '../src/runtime/html-ranges.ts';

describe('#browser-half', () => {
	it("in the browser, loads with the runtime's own entry load", () => {
		expect(browser.import_entry).toBe(import_entry);
	});

	it("in the browser, takes the range marks out with the runtime's own", () => {
		expect(browser.unmark_html_ranges).toBe(unmark_html_ranges);
	});

	it('anywhere else, an entry load refuses with browser_only_on_server', async () => {
		await expect(server.import_entry('/x.js')).rejects.toThrow(/e\/browser_only_on_server/);
	});

	it('anywhere else, taking the range marks out refuses with browser_only_on_server', () => {
		expect(() => server.unmark_html_ranges({} as Element)).toThrow(/e\/browser_only_on_server/);
	});
});
