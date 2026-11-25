import { library } from '@ogygia/config/tsdown';
import { package_macros } from 'ogygia-internal-macros/plugin';

export default library({ plugins: [package_macros(new URL('.', import.meta.url))] });
