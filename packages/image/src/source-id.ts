/**
 * A source's id: a hash of its bytes, which names every file made from it. Whoever makes a file (the
 * endpoint's reader, the build's writer) checks the original it read against it.
 *
 * @packageDocumentation
 */
import crypto from 'node:crypto';

/** Bump when the encoder's output changes for the same input: every cached file is made again, and
 *  every source gets a new id, so every file a new name. */
export const ENCODER_VERSION = 4;

/** A source's id: its bytes (and the encoder's version), so every file made from it names its
 *  content. Whoever makes a file checks the original it read against the id it is named by. */
export function source_id(bytes: Uint8Array): string {
	return crypto
		.createHash('sha256')
		.update(bytes)
		.update(`\0encoder ${ENCODER_VERSION}`)
		.digest('base64url')
		.slice(0, 16);
}
