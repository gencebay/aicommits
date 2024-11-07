import fs from 'fs/promises';
import path, { parse } from 'path';
import os from 'os';
import ini from 'ini';
import type { TiktokenModel } from '@dqbd/tiktoken';
import { fileExists } from './fs.js';
import { KnownError } from './error.js';

const commitTypes = ['', 'conventional'] as const;

export type CommitType = (typeof commitTypes)[number];

const { hasOwnProperty } = Object.prototype;
export const hasOwn = (object: unknown, key: PropertyKey) =>
	hasOwnProperty.call(object, key);

const parseAssert = (name: string, condition: any, message: string) => {
	if (!condition) {
		throw new KnownError(`Invalid config property ${name}: ${message}`);
	}
};

const configParsers = {
	OPENAI_KEY(key?: string) {
		if (!key) {
			// if USE_AZURE config is set to true, then we don't need to check for OPENAI_KEY
			return '';
		}
		parseAssert('OPENAI_KEY', key.startsWith('sk-'), 'Must start with "sk-"');
		// Key can range from 43~51 characters. There's no spec to assert this.

		return key;
	},
	locale(locale?: string) {
		if (!locale) {
			return 'en';
		}

		parseAssert('locale', locale, 'Cannot be empty');
		parseAssert(
			'locale',
			/^[a-z-]+$/i.test(locale),
			'Must be a valid locale (letters and dashes/underscores). You can consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes'
		);
		return locale;
	},
	generate(count?: string) {
		if (!count) {
			return 1;
		}

		parseAssert('generate', /^\d+$/.test(count), 'Must be an integer');

		const parsed = Number(count);
		parseAssert('generate', parsed > 0, 'Must be greater than 0');
		parseAssert('generate', parsed <= 5, 'Must be less or equal to 5');

		return parsed;
	},
	type(type?: string): CommitType {
		if (!type) {
			return '';
		}

		parseAssert(
			'type',
			commitTypes.includes(type as CommitType),
			'Invalid commit type'
		);

		return type as CommitType;
	},
	proxy(url?: string) {
		if (!url || url.length === 0) {
			return undefined;
		}

		parseAssert('proxy', /^https?:\/\//.test(url), 'Must be a valid URL');

		return url;
	},
	model(model?: string) {
		if (!model || model.length === 0) {
			return 'gpt-3.5-turbo';
		}

		return model as TiktokenModel;
	},
	timeout(timeout?: string) {
		if (!timeout) {
			return 10_000;
		}

		parseAssert('timeout', /^\d+$/.test(timeout), 'Must be an integer');

		const parsed = Number(timeout);
		parseAssert('timeout', parsed >= 500, 'Must be greater than 500ms');

		return parsed;
	},
	'max-length'(maxLength?: string) {
		if (!maxLength) {
			return 50;
		}

		parseAssert('max-length', /^\d+$/.test(maxLength), 'Must be an integer');

		const parsed = Number(maxLength);
		parseAssert(
			'max-length',
			parsed >= 20,
			'Must be greater than 20 characters'
		);

		return parsed;
	},
} as const;

const azureConfigParsers = {
	USE_AZURE(useAzure?: string) {
		if (useAzure === undefined) {
			return false;
		}
		const normalizedValue = String(useAzure).toLowerCase();
		parseAssert(
			'USE_AZURE',
			normalizedValue === 'true' || normalizedValue === 'false',
			'Must be true or false'
		);
		return normalizedValue === 'true';
	},
	AZURE_OPENAI_KEY(key?: string) {
		if (!key) {
			return '';
		}
		parseAssert('AZURE_OPENAI_KEY', key.length > 0, 'Cannot be empty');
		return key;
	},
	AZURE_OPENAI_ENDPOINT(endpoint?: string) {
		if (!endpoint) {
			return '';
		}
		parseAssert(
			'AZURE_OPENAI_ENDPOINT',
			/^https?:\/\//.test(endpoint),
			'Must be a valid URL'
		);
		return endpoint;
	},
} as const;

const combinedParsers = {
	...azureConfigParsers,
	...configParsers,
};

type ConfigKeys = keyof typeof combinedParsers;

type RawConfig = {
	[key in ConfigKeys]?: string;
};

export type ValidConfig = {
	[Key in ConfigKeys]: ReturnType<(typeof combinedParsers)[Key]>;
};

const configPath = path.join(os.homedir(), '.aicommits');

const readConfigFile = async (): Promise<RawConfig> => {
	const configExists = await fileExists(configPath);
	if (!configExists) {
		return Object.create(null);
	}

	const configString = await fs.readFile(configPath, 'utf8');
	return ini.parse(configString);
};

export const getConfig = async (
	cliConfig?: RawConfig,
	suppressErrors?: boolean
): Promise<ValidConfig> => {
	const config = await readConfigFile();
	const parsedConfig: Record<string, unknown> = {};

	for (const key of Object.keys(combinedParsers) as ConfigKeys[]) {
		const parser = combinedParsers[key];
		const value = cliConfig?.[key] ?? config[key];

		if (suppressErrors) {
			try {
				parsedConfig[key] = parser(value);
			} catch {}
		} else {
			parsedConfig[key] = parser(value);
		}
	}

	const openaiKey = parsedConfig['OPENAI_KEY'] as string;
	const useAzure = parsedConfig['USE_AZURE'] as boolean;
	if (openaiKey === '' && !useAzure) {
		if (!suppressErrors) {
			throw new KnownError(
				'Please set your OpenAI API key via `aicommits config set OPENAI_KEY=<your token>` or set your Azure OpenAI configurations.'
			);
		}
	}

	const azureOpenaiKey = parsedConfig['AZURE_OPENAI_KEY'] as string;
	const azureOpenaiEndpoint = parsedConfig['AZURE_OPENAI_ENDPOINT'] as string;
	if (useAzure) {
		if (!suppressErrors) {
			if (azureOpenaiKey === '') {
				throw new KnownError(
					`Please set your Azure OpenAI configurations via aicommits config set AZURE_OPENAI_KEY=<your token>`
				);
			}

			if (azureOpenaiEndpoint === '') {
				throw new KnownError(
					`Please set your Azure OpenAI configurations via aicommits config set AZURE_OPENAI_ENDPOINT='<your-deployment-full-url>'`
				);
			}
		}
	}

	return parsedConfig as ValidConfig;
};

export const setConfigs = async (keyValues: [key: string, value: string][]) => {
	const config = await readConfigFile();

	for (const [key, value] of keyValues) {
		if (!hasOwn(combinedParsers, key)) {
			throw new KnownError(`Invalid config property: ${key}`);
		}

		const parsed = combinedParsers[key as ConfigKeys](value);
		config[key as ConfigKeys] = parsed as any;
	}

	await fs.writeFile(configPath, ini.stringify(config), 'utf8');
};
