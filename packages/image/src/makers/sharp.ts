/**
 * The sharp maker (Node): encodes with sharp, and keeps its files on disk: in the build cache's
 * folder in the build and the dev server, in a folder under the system's temporary folder on a live
 * server (../store.ts). Loaded on the first image request only: a server that never serves one never
 * loads sharp.
 *
 * @packageDocumentation
 */
import os from 'node:os';
import { build_handoff } from '../handoff.ts';
import type { MadeStore, Maker } from '../maker.ts';
import { encode_recipe, VIPS_VERSION } from '../pixels.ts';
import { FileStore, runtime_store } from '../store.ts';

/** How many files it makes at once: half the machine's cores, from one to four. */
export const parallel: number = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));

/** One recipe's file from its original's bytes. */
export const make: Maker['make'] = encode_recipe;

const handoff = build_handoff();

/** sharp runs in the build. */
export const in_build: Maker['in_build'] = true;

/** The build cache's store in the build and the dev server, else the live server's. */
export const store: MadeStore | null = handoff
	? FileStore.shared(handoff.store)
	: runtime_store(VIPS_VERSION);
