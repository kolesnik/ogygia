import { resolve } from '$app/paths';
import { layOut } from '@ogygia/image';
import { blog } from '$lib/blog.ts';

declare const __IMAGE_E2E_STATIC__: boolean;

export const prerender = __IMAGE_E2E_STATIC__;

const URL_ATTR_RE = /\b(src|srcset)="([^"]*)"/g;

function absolute(value: string, at: URL): string {
	return value
		.split(', ')
		.map((candidate) => {
			const [url = '', ...rest] = candidate.split(' ');
			return [new URL(url.replaceAll('&amp;', '&'), at).href, ...rest].join(' ');
		})
		.join(', ');
}

function escape(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
}

export async function GET({ url }) {
	const items: string[] = [];
	for (const ref of await blog.refs()) {
		const post = (await blog.get(ref.id))!;
		const body = await post.body;
		const html = (body.kind === 'inline' ? (body.html ?? '') : '').replace(
			URL_ATTR_RE,
			(_, attr: string, value: string) => `${attr}="${absolute(value, url)}"`
		);
		const cover = new URL(layOut(post.data.cover, { width: 600 }).src, url).href;
		const link = new URL(resolve('/blog/[slug]', { slug: ref.id }), url).href;
		const title = `<title>${escape(post.data.title)}</title>`;
		const enclosure = `<enclosure url="${cover}" type="image/webp" length="0"/>`;
		items.push(
			`<item>${title}<link>${link}</link>${enclosure}<description>${escape(html)}</description></item>`
		);
	}
	const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>A blog</title>${items.join('')}</channel></rss>`;
	return new Response(xml, { headers: { 'content-type': 'application/xml' } });
}
