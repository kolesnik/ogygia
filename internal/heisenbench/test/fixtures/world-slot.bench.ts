// A bench file that joins a process slot as it loads, as a plugin's server half joins core's
// shared hooks (federation's owners.bench.ts `startPlugin`) (test: preload.test.ts).
import { bench } from '@bench/heisenbench/bench';
import { join_slot, read_slot } from './world-slot-read.ts';

join_slot();

bench('a slot joined at load holds this copy alone', () => read_slot());
