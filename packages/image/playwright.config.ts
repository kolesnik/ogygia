// @ogygia/image's e2e suite against its fixture app (e2e/app), built and served.
// `pnpm --filter @ogygia/image e2e`.
import { suite } from '@ogygia/tooling/e2e/config.ts';
import { fileURLToPath } from 'node:url';

export default suite({
	port: 3062,
	serve: fileURLToPath(new URL('./e2e/app', import.meta.url))
});
