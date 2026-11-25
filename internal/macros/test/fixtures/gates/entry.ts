import { check_dev, check_rules, plain } from './checks.ts';

export function run(n: number): number {
	check_dev(n);
	if (n > 1) check_rules(n);
	return plain(n);
}
