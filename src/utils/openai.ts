import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type {
	CreateChatCompletionRequest,
	CreateChatCompletionResponse,
} from 'openai';
import createHttpsProxyAgent from 'https-proxy-agent';
import { KnownError } from './error.js';
import type { ValidConfig } from './config.js';
import { generatePrompt } from './prompt.js';

const httpsPost = async (
	url: string,
	headers: Record<string, string>,
	json: unknown,
	timeout: number,
	proxy?: string
) =>
	new Promise<{
		request: ClientRequest;
		response: IncomingMessage;
		data: string;
	}>((resolve, reject) => {
		const postContent = JSON.stringify(json);
		const request = https.request(
			url,
			{
				port: 443,
				method: 'POST',
				headers: {
					...headers,
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postContent),
				},
				timeout,
				agent: proxy ? createHttpsProxyAgent(proxy) : undefined,
			},
			(response) => {
				const body: Buffer[] = [];
				response.on('data', (chunk) => body.push(chunk));
				response.on('end', () => {
					resolve({
						request,
						response,
						data: Buffer.concat(body).toString(),
					});
				});
			}
		);
		request.on('error', reject);
		request.on('timeout', () => {
			request.destroy();
			reject(
				new KnownError(
					`Time out error: request took over ${timeout}ms. Try increasing the \`timeout\` config, or checking the OpenAI API status https://status.openai.com`
				)
			);
		});

		request.write(postContent);
		request.end();
	});

const createChatCompletion = async (
	useAzure: boolean,
	url: string,
	apiKey: string,
	json: CreateChatCompletionRequest,
	timeout: number,
	proxy?: string
) => {
	const headers: Record<string, string> = useAzure
		? { 'api-key': apiKey }
		: { Authorization: `Bearer ${apiKey}` };

	const { response, data } = await httpsPost(
		url,
		headers,
		json,
		timeout,
		proxy
	);

	if (
		!response.statusCode ||
		response.statusCode < 200 ||
		response.statusCode > 299
	) {
		let errorMessage = `API Error: ${response.statusCode} - ${response.statusMessage}`;

		if (data) {
			errorMessage += `\n\n${data}`;
		}

		if (response.statusCode === 500) {
			errorMessage += '\n\nCheck the API status: https://status.openai.com';
		}

		throw new KnownError(errorMessage);
	}

	return JSON.parse(data) as CreateChatCompletionResponse;
};

const sanitizeMessage = (message: string) =>
	message
		.trim()
		.replace(/[\n\r]/g, '')
		.replace(/(\w)\.$/, '$1');

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

export const generateCommitMessage = async (
	config: ValidConfig,
	diff: string
) => {
	const {
		OPENAI_KEY: apiKey,
		USE_AZURE: useAzure,
		AZURE_OPENAI_KEY: azureKey,
		proxy,
		generate: completions,
		timeout,
		locale,
		'max-length': maxLength,
		model,
		type,
	} = config;

	try {
		const url = useAzure
			? config.AZURE_OPENAI_ENDPOINT
			: 'https://api.openai.com/v1/chat/completions';

		const completion = await createChatCompletion(
			useAzure,
			url,
			useAzure ? azureKey! : apiKey!,
			{
				model,
				messages: [
					{
						role: 'system',
						content: generatePrompt(locale, maxLength, type),
					},
					{
						role: 'user',
						content: diff,
					},
				],
				temperature: 0.7,
				top_p: 1,
				frequency_penalty: 0,
				presence_penalty: 0,
				max_tokens: 200,
				stream: false,
				n: completions,
			},
			timeout,
			proxy
		);

		return deduplicateMessages(
			completion.choices
				.filter((choice) => choice.message?.content)
				.map((choice) => sanitizeMessage(choice.message!.content as string))
		);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`
			);
		}

		throw errorAsAny;
	}
};
