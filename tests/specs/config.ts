import fs from 'fs/promises';
import path from 'path';
import { testSuite, expect } from 'manten';
import { createFixture } from '../utils.js';

export default testSuite(({ describe }) => {
	describe('config', async ({ test, describe }) => {
		const { fixture, aicommits } = await createFixture();
		const configPath = path.join(fixture.path, '.aicommits');
		const openAiToken = 'OPENAI_KEY=sk-abc';

		test('set unknown config file', async () => {
			const { stderr } = await aicommits(['config', 'set', 'UNKNOWN=1'], {
				reject: false,
			});

			expect(stderr).toMatch('Invalid config property: UNKNOWN');
		});

		test('set invalid OPENAI_KEY', async () => {
			const { stderr } = await aicommits(['config', 'set', 'OPENAI_KEY=abc'], {
				reject: false,
			});

			expect(stderr).toMatch(
				'Invalid config property OPENAI_KEY: Must start with "sk-"'
			);
		});

		await test('set config file', async () => {
			await aicommits(['config', 'set', openAiToken]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(openAiToken);
		});

		await test('get config file', async () => {
			const { stdout } = await aicommits(['config', 'get', 'OPENAI_KEY']);
			expect(stdout).toBe(openAiToken);
		});

		await test('reading unknown config', async () => {
			await fs.appendFile(configPath, 'UNKNOWN=1');

			const { stdout, stderr } = await aicommits(['config', 'get', 'UNKNOWN'], {
				reject: false,
			});

			expect(stdout).toBe('');
			expect(stderr).toBe('');
		});

		await describe('timeout', ({ test }) => {
			test('setting invalid timeout config', async () => {
				const { stderr } = await aicommits(['config', 'set', 'timeout=abc'], {
					reject: false,
				});

				expect(stderr).toMatch('Must be an integer');
			});

			test('setting valid timeout config', async () => {
				const timeout = 'timeout=20000';
				await aicommits(['config', 'set', timeout]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(timeout);

				const get = await aicommits(['config', 'get', 'timeout']);
				expect(get.stdout).toBe(timeout);
			});
		});

		await describe('max-length', ({ test }) => {
			test('must be an integer', async () => {
				const { stderr } = await aicommits(
					['config', 'set', 'max-length=abc'],
					{
						reject: false,
					}
				);

				expect(stderr).toMatch('Must be an integer');
			});

			test('must be at least 20 characters', async () => {
				const { stderr } = await aicommits(['config', 'set', 'max-length=10'], {
					reject: false,
				});

				expect(stderr).toMatch(/must be greater than 20 characters/i);
			});

			test('updates config', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'max-length']);
				expect(defaultConfig.stdout).toBe('max-length=50');

				const maxLength = 'max-length=60';
				await aicommits(['config', 'set', maxLength]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(maxLength);

				const get = await aicommits(['config', 'get', 'max-length']);
				expect(get.stdout).toBe(maxLength);
			});
		});

		await test('set config file', async () => {
			await aicommits(['config', 'set', openAiToken]);

			const configFile = await fs.readFile(configPath, 'utf8');
			expect(configFile).toMatch(openAiToken);
		});

		await test('get config file', async () => {
			const { stdout } = await aicommits(['config', 'get', 'OPENAI_KEY']);
			expect(stdout).toBe(openAiToken);
		});

		await describe('USE_AZURE', ({ test }) => {
			test('setting invalid USE_AZURE', async () => {
				const { stderr } = await aicommits(['config', 'set', 'USE_AZURE=1'], {
					reject: false,
				});
				expect(stderr).toMatch(/Must be true or false/i);
			});

			test('updates config', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'USE_AZURE']);
				expect(defaultConfig.stdout).toBe('USE_AZURE=false');

				const useAzure = 'USE_AZURE=true';
				await aicommits(['config', 'set', useAzure]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(useAzure);

				const get = await aicommits(['config', 'get', 'USE_AZURE']);
				expect(get.stdout).toBe(useAzure);
			});
		});

		await describe('AZURE_OPENAI_KEY', ({ test }) => {
			test('updates config', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'AZURE_OPENAI_KEY']);
				expect(defaultConfig.stdout).toBe('AZURE_OPENAI_KEY=');

				const azureOpenAIKey = 'AZURE_OPENAI_KEY=azure-key';
				await aicommits(['config', 'set', azureOpenAIKey]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(azureOpenAIKey);

				const get = await aicommits(['config', 'get', 'AZURE_OPENAI_KEY']);
				expect(get.stdout).toBe(azureOpenAIKey);
			});
		});

		await describe('AZURE_OPENAI_ENDPOINT', ({ test }) => {
			test('setting invalid AZURE_OPENAI_ENDPOINT', async () => {
				const { stderr } = await aicommits(
					['config', 'set', 'AZURE_OPENAI_ENDPOINT=foo://bar'],
					{ reject: false }
				);
				expect(stderr).toMatch(/Must be a valid URL/i);
			});

			test('updates config', async () => {
				const defaultConfig = await aicommits(['config', 'get', 'AZURE_OPENAI_ENDPOINT']);
				expect(defaultConfig.stdout).toBe('AZURE_OPENAI_ENDPOINT=');

				const endpoint = 'https://demo.openai.azure.com/openai/deployments/my-latest-deployment/chat/completions?api-version=2024-08-01-preview';
				const azureEndpoint = `AZURE_OPENAI_ENDPOINT='${endpoint}'`;
				await aicommits(['config', 'set', azureEndpoint]);

				const configFile = await fs.readFile(configPath, 'utf8');
				expect(configFile).toMatch(`AZURE_OPENAI_ENDPOINT="${endpoint}"`);

				const get = await aicommits(['config', 'get', 'AZURE_OPENAI_ENDPOINT']);
				expect(get.stdout).toBe(`AZURE_OPENAI_ENDPOINT=${endpoint}`);
			});
		});

		await fixture.rm();
	});
});
