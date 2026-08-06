export class ApiProviderUnavailableError extends Error {
  constructor() {
    super('Responses API is temporarily unavailable.');
    this.code = 'AI_PROVIDER_UNAVAILABLE';
  }
}

export async function askViaApi({ instructions, input }, config, safetyIdentifier, fetchImpl = fetch) {
  if (!config.apiKey) {
    throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=api.');
  }

  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.apiModel,
        instructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
        reasoning: { effort: config.apiReasoningEffort },
        text: { verbosity: 'low' },
        max_output_tokens: 500,
        safety_identifier: safetyIdentifier,
        store: false,
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new ApiProviderUnavailableError();
  }

  if (!response.ok) throw new ApiProviderUnavailableError();

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiProviderUnavailableError();
  }

  const answer = extractResponseText(payload);
  if (!answer) throw new ApiProviderUnavailableError();
  return answer;
}

export function extractResponseText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  return (payload?.output || [])
    .filter((item) => item?.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((part) => part?.type === 'output_text')
    .map((part) => part.text || '')
    .join('\n')
    .trim();
}
