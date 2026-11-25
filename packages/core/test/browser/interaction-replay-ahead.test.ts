import { expect, test } from 'vitest';
import { Downloads } from '@ogygia/tooling/vitest/downloads';
import { lifeOf } from '@ogygia/machine';
import { scope } from '@ogygia/machine';
import { arm_interaction } from '../../src/runtime/interaction.ts';
import { critical_settled } from '../../src/runtime/load-scheduler.ts';

const downloads = new Downloads();
const replay_requests = () => downloads.named('/src/runtime/interaction-replay.ts');

const arm = (id: string) => {
	document.body.innerHTML = `<ogygia-region id="${id}" wake="interaction" entry="/x.js"><button>go</button></ogygia-region>`;
	return arm_interaction(
		document.getElementById(id)!,
		() => {},
		() => new Promise<void>(() => {}),
		lifeOf(scope())
	);
};

test('the replay half asked for ahead is not fetched when no island is still armed at its turn (#451)', async () => {
	arm('woke-alone')();
	await critical_settled();
	await new Promise((r) => setTimeout(r, 200));
	expect(replay_requests()).toHaveLength(0);
});

test('the replay half is fetched ahead, before any press, while an island is armed', async () => {
	const disarm = arm('still-armed');
	await critical_settled();
	await expect.poll(() => replay_requests().length, { timeout: 5000 }).toBeGreaterThan(0);
	disarm();
});
