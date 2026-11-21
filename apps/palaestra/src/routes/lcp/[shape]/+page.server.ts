// THE LCP PAGES (the early code start's measurement): the /bench-cms page shape with a
// real largest contentful paint at the top, `hero` (a ~260 KB image, fetchpriority="high") or `text`
// (a large lead paragraph). csr=false; /lcp-kit/[shape] is the same page as Kit hydrates it.
// `?csp=1`: an enforced policy that allows no inline script but by hash (e2e/early-code.spec.ts).
import { error } from '@sveltejs/kit';
import { page_tree } from '$lib/bench/data';

export const prerender = false;
export const load = ({
	params,
	url,
	setHeaders
}: {
	params: { shape: string };
	url: URL;
	setHeaders: (h: Record<string, string>) => void;
}) => {
	if (params.shape !== 'hero' && params.shape !== 'text') error(404, 'no such shape');
	if (url.searchParams.get('csp') === '1')
		setHeaders({ 'content-security-policy': "script-src 'self' 'report-sample'" });
	return { ...page_tree(), shape: params.shape };
};
