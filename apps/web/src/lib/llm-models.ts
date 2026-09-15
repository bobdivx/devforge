/** Helpers LLM repris de l’ancien frontend DevForge (`frontend/src/lib/llm-models.ts`). */

export const AUTO_MODEL_VALUE = 'auto';

export const MIN_AGENT_TOOL_PARAMS_B = 7;

export const SMALL_MODEL_TOOLS_WARNING =
  'Ce modèle est trop petit pour les agents avec outils. Attendez-vous à des réponses vides ou absurdes ; utilisez au moins un modèle ~7B (ex. qwen2.5-coder:7b).';

export type ProviderDefaults = {
  needsKey: boolean;
  needsUrl: boolean;
  defaultUrl: string;
  placeholderUrl: string;
};

export const PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
  openai: {
    needsKey: true,
    needsUrl: false,
    defaultUrl: 'https://api.openai.com/v1',
    placeholderUrl: 'https://api.openai.com/v1',
  },
  openrouter: {
    needsKey: true,
    needsUrl: false,
    defaultUrl: 'https://openrouter.ai/api/v1',
    placeholderUrl: 'https://openrouter.ai/api/v1',
  },
  gemini: {
    needsKey: true,
    needsUrl: false,
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    placeholderUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  ollama: {
    needsKey: false,
    needsUrl: true,
    defaultUrl: 'http://127.0.0.1:11434',
    placeholderUrl: 'http://127.0.0.1:11434',
  },
  auto: {
    needsKey: true,
    needsUrl: false,
    defaultUrl: 'https://api.openai.com/v1',
    placeholderUrl: 'https://api.openai.com/v1 (ou endpoint compatible)',
  },
  stub: {
    needsKey: false,
    needsUrl: false,
    defaultUrl: '',
    placeholderUrl: '',
  },
};

export function isAutoModel(model: string | null | undefined): boolean {
  const normalized = (model ?? '').trim().toLowerCase();
  return normalized === '' || normalized === AUTO_MODEL_VALUE;
}

/** Peut-on appeler discover models ? (logique ancienne AiProvidersSettings). */
export function isCustomEndpoint(baseUrl: string, provider: string): boolean {
  const url = baseUrl.trim();
  if (!url) return false;
  if (provider === 'openrouter') {
    return !url.includes('openrouter.ai');
  }
  if (provider === 'gemini') {
    return !url.includes('generativelanguage.googleapis.com');
  }
  if (provider === 'openai' || provider === 'auto') {
    return !url.includes('api.openai.com');
  }
  return true;
}

export function canDiscoverModels(opts: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  hasStoredKey?: boolean;
}): boolean {
  const info = PROVIDER_DEFAULTS[opts.provider] ?? PROVIDER_DEFAULTS.openai;
  if (opts.provider === 'stub') return false;

  // Endpoint custom (proxy / LiteLLM / Ollama distant) : URL suffit.
  if (
    (opts.provider === 'openai' || opts.provider === 'auto' || opts.provider === 'ollama') &&
    isCustomEndpoint(opts.baseUrl, opts.provider)
  ) {
    return opts.baseUrl.trim().length > 0;
  }

  if (opts.provider === 'ollama') {
    return opts.baseUrl.trim().length > 0;
  }

  if (info.needsKey) {
    if (opts.apiKey.trim().length >= 8) return true;
    return opts.hasStoredKey === true;
  }

  if (info.needsUrl) {
    return opts.baseUrl.trim().length > 0;
  }

  return true;
}

export function parseModelParamBillions(model: string | null | undefined): number | null {
  const id = (model ?? '').trim().toLowerCase();
  if (id === '') return null;
  const matches = [...id.matchAll(/(\d+(?:\.\d+)?)b\b/gi)];
  const values: number[] = [];
  for (const match of matches) {
    const offset = match.index ?? 0;
    if (offset > 0 && id[offset - 1] === 'x') continue;
    values.push(Number.parseFloat(match[1] ?? ''));
  }
  if (values.length === 0) return null;
  return Math.max(...values);
}

export function isModelTooSmallForTools(model: string | null | undefined): boolean {
  const id = (model ?? '').trim().toLowerCase();
  if (id === '' || id === AUTO_MODEL_VALUE) return false;
  // Cloud « mini » (gpt-4o-mini, etc.) ≠ modèle local trop petit.
  if (/^(gpt-|o[0-9]|claude-|gemini-|openai\/|anthropic\/|google\/)/.test(id)) {
    return false;
  }
  if (id.includes('tinyllama')) return true;
  // Tags locaux type `:mini`, `/tiny` — pas le suffixe `-mini` d’OpenAI.
  if (/(?:^|[:/_])(tiny|mini)(?:[:/_]|$)/i.test(id)) return true;
  const billions = parseModelParamBillions(id);
  if (billions === null) return false;
  return billions < MIN_AGENT_TOOL_PARAMS_B;
}

/** Pour le chat Ollama on stocke souvent …/v1 ; pour l’UX listing on montre le root. */
export function displayBaseUrl(provider: string, stored: string): string {
  if (provider !== 'ollama') return stored;
  const clean = stored.trim().replace(/\/+$/, '');
  if (clean.endsWith('/v1')) return clean.slice(0, -3);
  return stored;
}

/** Normalise l’URL avant save : Ollama chat attend /v1. */
export function persistBaseUrl(provider: string, url: string): string {
  const clean = url.trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (provider === 'ollama' && !clean.endsWith('/v1')) {
    return `${clean}/v1`;
  }
  return clean;
}
