// The benches' `ogygia:server/region-endpoint` (internal/heisenbench/src/preload.ts reads a stub's
// `.native` twin first): the test stub, with production's island fingerprint (server/fingerprint.ts,
// Node's native SHA-1). The tests keep the universal lane hash, because a browser test shares the stub.
export * from './server.region-endpoint.ts';
export { region_fingerprint } from '../../src/server/fingerprint.ts';
