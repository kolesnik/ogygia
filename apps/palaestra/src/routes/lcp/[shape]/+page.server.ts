// THE LCP PAGES (the early code start's measurement): the /bench-cms page shape with a
// real largest contentful paint at the top, `hero` (a ~260 KB image, fetchpriority="high") or `text`
// (a large lead paragraph). csr=false; /lcp-kit/[shape] is the same page as Kit hydrates it.
import { error } from '@sveltejs/kit';
import { page_tree } from '$lib/bench/data';

export const prerender = false;
export const load = ({ params }: { params: { shape: string } }) => {
	if (params.shape !== 'hero' && params.shape !== 'text') error(404, 'no such shape');
	return { ...page_tree(), shape: params.shape };
};
