export function check_dev(n: number): void {
	$dev();
	console.log('dev-body', n);
}

export function check_rules(n: number): void {
	$rules();
	console.log('rules-body', n);
}

export function plain(n: number): number {
	return n + 1;
}
