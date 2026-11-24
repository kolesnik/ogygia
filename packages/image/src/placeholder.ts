/**
 * A placeholder token → the CSS that paints it. Runs in SSR, pure and synchronous: the blur is in the
 * HTML before any pixel arrives, with no client script.
 */
import { thumbHashToDataURL } from 'thumbhash';

const PREFIX = 'thumbhash:';

/** The data URL a token paints, or null for a token this version does not read. */
export function placeholder_url(token: string): string | null {
	if (!token.startsWith(PREFIX)) return null;
	const bin = atob(token.slice(PREFIX.length));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return thumbHashToDataURL(bytes);
}

/** The inline style that paints `token` behind the image, or '' for none. */
export function placeholder_style(token: string | undefined): string {
	if (!token) return '';
	const url = placeholder_url(token);
	return url
		? `background-image:url(${url});background-size:cover;background-repeat:no-repeat`
		: '';
}
