// Sourcemap attribution for the size tools (bundle-size.ts, server-size.ts): which module wrote
// each byte of a built chunk.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The text of `code` each source of its map wrote, in the chunk's order, by the source as the
 *  map names it: each mapped segment runs to the next one on its line. Text no segment maps (a
 *  line's start before its first segment, a segment with no source) is no module's. */
export function mapped_text(
	code: string,
	map: { mappings: string; sources: ReadonlyArray<string | null> }
): Map<string, string> {
	const lines = code.split('\n');
	const parts = new Map<string, string[]>();
	let source = 0;
	map.mappings.split(';').forEach((line, at) => {
		const segments: Array<[column: number, source: number]> = [];
		let column = 0;
		for (const segment of line.split(',')) {
			if (!segment) continue;
			const fields = vlq(segment);
			column += fields[0];
			if (fields.length >= 4) source += fields[1];
			segments.push([column, fields.length >= 4 ? source : -1]);
		}
		const text = lines[at] ?? '';
		segments.forEach(([from, of], i) => {
			if (of === -1) return;
			const id = map.sources[of];
			if (id == null) return;
			const to = i + 1 < segments.length ? segments[i + 1][0] : text.length;
			let list = parts.get(id);
			if (list === undefined) parts.set(id, (list = []));
			list.push(text.slice(from, to));
		});
	});
	return new Map([...parts].map(([id, list]) => [id, list.join('')]));
}

/** One sourcemap segment's fields (base64 VLQ). */
function vlq(segment: string): number[] {
	const fields: number[] = [];
	let shift = 0;
	let value = 0;
	for (const ch of segment) {
		const digit = BASE64.indexOf(ch);
		value += (digit & 31) << shift;
		if (digit & 32) shift += 5;
		else {
			fields.push(value & 1 ? -(value >> 1) : value >> 1);
			value = 0;
			shift = 0;
		}
	}
	return fields;
}
