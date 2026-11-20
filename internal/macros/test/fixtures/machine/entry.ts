import { create, go, kind } from '@ogygia/machine/internal';

const steps = { off: ['on'], on: ['off'] } as const;

const toggle = $machine<{ off: {}; on: {} }>()({ name: 'fold-toggle', initial: 'off', steps });

const m = create(toggle);
go(m, 'on');
export const now: string = kind(m);
