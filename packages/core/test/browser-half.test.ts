// AN ISLAND ENTRY'S LOAD BY REALM (`#browser-half`): the browser's is the runtime's own; anywhere
// else (a server, plain Node: test/plain-node-imports.test.ts loads the snippet codec there) it
// refuses with a code and carries none of the runtime's entry-location code.
import { describe, expect, it } from 'vitest';
import * as browser from '../src/browser-half.browser.ts';
import * as server from '../src/browser-half.ts';
import { import_entry } from '../src/runtime/entry-locations.ts';

describe('#browser-half', () => {
	it("in the browser, loads with the runtime's own entry load", () => {
		expect(browser.import_entry).toBe(import_entry);
	});

	it('anywhere else, refuses with entry_load_server_only', async () => {
		await expect(server.import_entry('/x.js')).rejects.toThrow(/e\/entry_load_server_only/);
	});
});
