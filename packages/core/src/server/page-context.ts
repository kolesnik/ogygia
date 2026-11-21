/**
 * THE DROP-IN CONTEXT ROOT, the server half: what a csr=false page's drop-in `setContext` calls set
 * during the render, kept per request and written as one `<script data-ogygia-provide-page>` the
 * islands seed their `getContext` from (../context-registry.ts has the design). Only a build whose
 * word holds the `context` feature reaches this module (hooks.ts tests `HAS & F_CONTEXT` at each
 * use), so a server whose app provides no context carries none of it.
 */
import { slot as shared } from '@ogygia/machine';
import { live_event } from './live-event.ts';
import { mark_attr } from './response-mark.ts';
import { ogygia_script } from './document-assembly.ts';
import { serialize_provided_context } from '../context-bridge.ts';
import { set_ctx_recorder, set_ctx_script_reader } from '../context-registry.ts';
import { OGYGIA_PROVIDE_PAGE } from '../wire-markup.ts';

const request_ctx = /* @__PURE__ */ shared<WeakMap<Request, Map<string, unknown>>>({
	name: 'ogygia.request-context',
	version: 1,
	make: () => new WeakMap()
});

/** The server's recorder of the drop-in `setContext` (by the request the render belongs to), and the
 *  reader of the request's context root for a document written outside Kit's render. */
export function install_page_context(): void {
	set_ctx_recorder((key, value) => {
		const request = live_event()?.request;
		if (!request) return;
		let ctx = request_ctx.get(request);
		if (ctx === undefined) request_ctx.set(request, (ctx = new Map()));
		ctx.set(key, value);
	});
	set_ctx_script_reader(() => page_ctx_script(live_event()?.request));
}

/** The drop-in `setContext` page root (`<script data-ogygia-provide-page>`), or '' when the request
 *  set nothing an island can read. Drops any non-serializable value (function / store / class
 *  instance) instead of crashing. */
export function page_ctx_script(request: Request | undefined): string {
	const ctx = request && request_ctx.get(request);
	if (!request || !ctx?.size) return '';
	const payload = serialize_provided_context(ctx);
	return payload ? ogygia_script('ctx', payload, OGYGIA_PROVIDE_PAGE + mark_attr(request)) : '';
}
