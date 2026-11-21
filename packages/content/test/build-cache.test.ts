import { readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { expect, test } from 'vitest';
import { BuildCache } from '@ogygia/compiler';

test("a test file's build cache is its own and starts empty: never what an earlier run left in node_modules", () => {
	const dir = new BuildCache('probe').dir();
	expect(dir).not.toBeNull();
	expect(dir).not.toContain(`${sep}node_modules${sep}`);
	expect(readdirSync(dir!)).toEqual([]);
});
