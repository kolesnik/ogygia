// Test stub for Kit's `$app/paths` — Kit 2's (the repo's own Kit), with `paths.relative` off and no
// base: an asset path or a pathname takes its leading slash, one without is refused, and a path is
// resolved as a route the way Kit 2's `resolve` does it (utils/routing.js `resolve_route`: a
// `(group)` segment and empty segments dropped), so a bench counts what each `asset()` call costs.
const BASIC_PARAM = /\[(\[)?(\.\.\.)?(\w+?)(?:=(\w+))?\]\]?/g;
const affects_path = (segment: string) => segment !== '' && !/^\([^)]+\)$/.test(segment);
function resolve_route(id: string): string {
	const segments = id.slice(1).split('/').filter(affects_path);
	const trailing = id != '/' && id.endsWith('/');
	const path = segments
		.map((segment) =>
			segment.replace(BASIC_PARAM, (_, optional, _rest, name) => {
				if (optional) return '';
				throw new Error(`Missing parameter '${name}' in route ${id}`);
			})
		)
		.filter(Boolean)
		.join('/');
	return `/${path}${trailing ? '/' : ''}`;
}
const refuse_relative = (p: string) => {
	if (!p.startsWith('/'))
		throw new Error(
			`Cannot use \`resolve(...)\` with a non-absolute pathname or route ID (got "${p}").`
		);
	return resolve_route(p);
};
export const asset = refuse_relative;
export const base = '';
export const assets = '';
export const resolve = refuse_relative;
