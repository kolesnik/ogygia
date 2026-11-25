/** A shared server hook's name: one a plugin's server half implements and any plugin calls
 *  (`app.notify` / `app.ask`, core plugin/hooks.ts `ServerHooks`). */
export type ServerHookName =
	| 'invalidate'
	| 'invalidated'
	| 'lastBuild'
	| 'measures'
	| 'codeOrigins';

/** Every shared server hook. The compiler reads which ones each server half implements (the keys of
 *  its `defineServer({ … })`) into `ogygia:server/server-plugins`, so a hook no server half
 *  implements costs a request nothing. */
export const SERVER_HOOK_NAMES: readonly ServerHookName[] = [
	'invalidate',
	'invalidated',
	'lastBuild',
	'measures',
	'codeOrigins'
];
