import { error } from '@sveltejs/kit';
import { cms_page } from '$lib/bench/cms';

export const load = ({ url, params }: { url: URL; params: { shape: string } }) => {
	if (params.shape !== 'hero' && params.shape !== 'text') error(404, 'no such shape');
	return { ...cms_page(url), shape: params.shape };
};
