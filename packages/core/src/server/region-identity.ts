/**
 * A HELD REGION'S IDENTITY: the fingerprint a hole and a lake are known by on both legs. Only the
 * hole and lake renders import it, so a server without them holds none of it
 * (apps/palaestra/e2e/server-size.ts SERVER_PROGRAMS).
 */
import { REF_WIRE_KEY, with_local_names } from '../ref.ts';
import { fingerprint_of } from '../contract/hash.ts';
import { PropsWire, stringify_props } from './props-wire.ts';

/**
 * A hole's IDENTITY (`data-og-hole`): the fingerprint of its entry and canonical props. Region
 * computes it on both legs, so the browser leg finds the facts the server minted for the hole by it
 * (runtime/hole-facts.ts). `wire`: the props' plan, when the caller has one already.
 *
 * A stateful ref in the props has no name both legs share: the server names it by its request's
 * place, the browser by an id of its own. So props that hold one are written again with LOCAL names
 * (ref.ts `with_local_names`: places counted within these props alone), which either leg repeats
 * (#816). One instance held twice still differs from two equal instances. The endpoint decodes a
 * hole's props fresh, never by id, so a ref's local place is all of it the identity needs.
 */
export function hole_identity(
	entry: string,
	props: unknown,
	wire: PropsWire | null = null
): string {
	const canonical = (wire ?? new PropsWire(props || {}, entry)).canonical;
	const text = canonical.includes(REF_WIRE_KEY)
		? with_local_names(() => stringify_props(props || {}, entry))
		: canonical;
	return fingerprint_of(entry, '', text);
}

/**
 * A lake's IDENTITY (`data-og-lake`): a hole's identity over the lake's props, so two lakes of one
 * component with different props are two lakes. Its function props (children, snippets, callbacks)
 * stay out: they never cross, and each leg compiles its own. Props no wire can carry give no
 * identity (`''`): the lake is then known by its entry, and by its place among the lakes that share
 * it (runtime/lakes.ts).
 */
export function lake_identity(entry: string, props: Record<string, unknown> | undefined): string {
	if (!entry) return '';
	const rest: Record<string, unknown> = {};
	for (const key in props) if (typeof props[key] !== 'function') rest[key] = props[key];
	try {
		return hole_identity(entry, rest);
		// oxlint-disable-next-line ogygia/no-silent-failures -- a lake renders on the server alone, so any prop is allowed; one no wire carries leaves the lake known by its entry and place
	} catch {
		return '';
	}
}
