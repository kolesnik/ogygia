import { vi } from 'vitest';

/** The ogygia errors logged (`console.error`) while `run` runs, as `code message`. */
export async function errors_during(run: () => Promise<void>): Promise<string[]> {
	const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
	try {
		await run();
		return spy.mock.calls.flatMap((args) =>
			args.flatMap((a) =>
				a instanceof Error && 'code' in a ? [`${String(a.code)} ${a.message}`] : []
			)
		);
	} finally {
		spy.mockRestore();
	}
}

/** The codes of the ogygia errors logged while `run` runs. */
export async function codes_during(run: () => Promise<void>): Promise<string[]> {
	return (await errors_during(run)).map((line) => line.split(' ')[0]);
}
