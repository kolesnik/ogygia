export const check_dev: (n: number) => void = $dev(function check_dev(n: number): void {
	console.log('dev-body', n);
});

export const check_rules: (n: number) => void = $rules(function check_rules(n: number): void {
	console.log('rules-body', n);
});

export function plain(n: number): number {
	return n + 1;
}
