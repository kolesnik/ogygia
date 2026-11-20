/**
 * Each boot helper's place in the boot link (./slots.ts `BootLink`, filled by ./boot-link.ts): the
 * lazy chunks read the link by number, so no helper's name ships in the boot or in a lazy chunk.
 * Constants alone, each under 1000: the boot and its lazy chunks both import this module, and the
 * bundler inlines a shared number into each chunk only while it prints in three characters or
 * fewer (packages/compiler/test/runtime-boot-svelte-free.test.ts), so this module never becomes a
 * file of its own. test/browser/boot-link-index.test.ts checks each place holds its helper.
 *
 * @internal
 */
export const L_KIT_HYDRATES_PAGE = 0;
export const L_KIT_BOOT = 1;
export const L_ABSOLUTE_URL_SCHEME = 2;
export const L_REGISTER_ISLAND_GRAPH = 3;
export const L_IS_WARMED_MODULE = 4;
export const L_WARM_ISLAND_MODULE = 5;
export const L_RUNS_ENTRY = 6;
export const L_NOTE_ENTRY_LOCATION = 7;
export const L_PROPS_SIDECAR_OF = 8;
export const L_PARSE_REGION_HTML = 9;
export const L_PARSE_PAGE_DOCUMENT = 10;
export const L_INIT_SHADOW_REGISTRIES = 11;
export const L_SET_INNER_HTML = 12;
export const L_VOUCH_PAGE_ANSWER = 13;
export const L_VOUCH_PAGE_HTML = 14;
export const L_RUNTIME_SESSION = 15;
export const L_REGIONS_IN_SHADOW = 16;
export const L_RELEASE_HEAD_NODES = 17;
export const L_HEAD_OWNERS = 18;
export const L_ADD_HEAD_OWNERS = 19;
export const L_ADOPT_OWNER_RECORD = 20;
export const L_YIELD_TASK = 21;
export const L_REGION_HYDRATE = 22;
export const L_WALK_ENTERS = 23;
export const L_IS_SELF_OWNED = 24;
export const L_RECORD_SERVER_BODY = 25;
export const L_SERVER_BODY_ATTRIBUTES = 26;
export const L_SERVER_BODY_CHILD = 27;
export const L_SERVER_CHANNEL = 28;
export const L_ADOPT_RESPONSE = 29;
export const L_LOAD_SLOT = 30;
export const L_PRIORITY = 31;
export const L_FETCH_PRIORITY_OF = 32;
export const L_LOAD_DEVALUE = 33;
export const L_DEVALUE = 34;
export const L_WITH_DEVALUE = 35;
export const L_NEEDS_DEVALUE = 36;
export const L_OGYGIA_ERROR = 37;
export const L_WARN = 38;
export const L_STALE = 39;
export const L_FLIGHTS = 40;
export const L_CACHE = 41;
export const L_SOFT = 42;
export const L_IS_DEFERRED = 43;
export const L_OURS_ON_KIT_DOCUMENT = 44;
export const L_REGION_SSR_TRUNCATED = 45;
