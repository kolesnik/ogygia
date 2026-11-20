/**
 * THE SOFT REFRESH (`invalidate` / `invalidateAll`), one machine per page: re-reads the page's seeds
 * in place, with or without the router. Refreshing never cancels a real click navigation, but a real
 * navigation ends it (its answer belongs to the page being left, #202), and a newer refresh
 * supersedes it. Each refresh is a visit: its fetch is a task of it, and each step after an await
 * checks it is still `mine`.
 *
 *   idle ─ refreshing ─ idle      (refreshing → refreshing: a newer refresh takes over)
 *
 * The boot holds it (./boot-link.ts) and the navigation chunk (./router-nav.ts) reaches it through
 * `boot_link()`, as a `router: false` page refreshes too and never loads the router.
 */
import type { Run } from '@ogygia/machine/internal';
import * as fsm from '@ogygia/machine/internal';

type States = { idle: {}; refreshing: { href: string } };
const steps = { idle: ['refreshing'], refreshing: ['refreshing', 'idle'] } as const;

const definition = fsm.definition<States>()({ name: 'soft refresh', initial: 'idle', steps });

/** The page's soft refresh machine. */
export type SoftRefresh = Run<States, typeof steps>;

/** A soft refresh machine, idle. */
export function create_soft_refresh(): SoftRefresh {
	return fsm.create(definition);
}
