// A production build folds the telling of machine moves out: observe() hears nothing there, and
// says so once with its code (a watch that silently heard nothing would be a silent failure).
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	vi.resetModules();
});

it('in a production build observe() hears no move, and says machine_observe_off once', async () => {
	vi.stubEnv('DEV', false);
	vi.resetModules();
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const { flights, machine, observe } = await import('../src/index.ts');
	const heard: string[] = [];
	const off = observe((name) => heard.push(name));
	const again = observe((name) => heard.push(name));
	const light = machine<{ red: {}; green: {} }>()({
		name: 'light',
		initial: 'red',
		steps: { red: ['green'], green: ['red'] }
	}).create();
	light.go('green');
	await flights({ name: 'pages', run: async () => 1 }).get();
	off();
	again();
	expect(heard).toEqual([]);
	expect(warn).toHaveBeenCalledOnce();
	expect(String(warn.mock.calls[0]![0])).toContain('machine_observe_off');
});
