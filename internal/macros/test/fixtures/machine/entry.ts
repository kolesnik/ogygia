import { createRun } from '@ogygia/machine';

const steps = { off: ['on'], on: ['off'] } as const;

const toggle = $machine<{ off: {}; on: {} }>()({ name: 'fold-toggle', initial: 'off', steps });

const m = createRun(toggle);
m.go('on');
export const on: boolean = m.kind === 'on';
