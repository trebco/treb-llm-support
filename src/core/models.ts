
import * as v from 'valibot';

export interface ModelFeatures {
  image_support_in_tools: boolean;
  tool_search: boolean;
}

export interface Provider {
  name: string;
  website: string;
  models?: string;
  default_features: Partial<ModelFeatures>;

  /** which API (and SDK) the provider speaks. the worker routes on this */
  api: 'anthropic'|'gemini'|'openai-responses'|'openai-chat-completion';

  /** 
   * endpoint, if not the SDK's default. this is what lets an app point a
   * provider at a compatible API (deepseek, a local server) without changes
   * here.
   */
  base_url?: string;

}

export const deepseek_provider: Provider = {
  name: 'Deepseek',
  website: 'https://platform.deepseek.com',
  models: 'https://api-docs.deepseek.com/quick_start/pricing',
  default_features: {

  },
  api: 'anthropic',
  base_url: 'https://api.deepseek.com/anthropic',
};

export const localhost_provider: Provider = {
  name: 'Localhost',
  website: 'https://localhost',
  default_features: {},
  api: 'anthropic',
  base_url: 'http://localhost:8080/',
};

export const togheterai_provider: Provider = {
  name: 'TogetherAI',
  website: 'https://api.together.ai',
  default_features: {},
  api: 'openai-chat-completion',
  base_url: 'https://api.together.xyz/v1',
};

export const openai_provider: Provider = {
  name: 'OpenAI',
  website: 'https://openai.com/api',
  models: 'https://developers.openai.com/api/docs/models',
  default_features: {
    image_support_in_tools: true,
    tool_search: true,
  },
  api: 'openai-responses',
};

export const anthropic_provider: Provider = {
  name: 'Anthropic',
  website: 'https://console.anthropic.com',
  default_features: {
    image_support_in_tools: true,
    tool_search: true,
  },
  api: 'anthropic',
};

export const gemini_provider: Provider = {
  name: 'Google',
  website: 'https://ai.google.dev/gemini-api',
  default_features: {
    image_support_in_tools: true,
    tool_search: true,
  },
  api: 'gemini',
};

export const openrouter_provider: Provider = {
  name: 'OpenRouter',
  website: 'https://openrouter.ai',
  default_features: {},
  api: 'openai-chat-completion',
  base_url: 'https://openrouter.ai/api/v1',
};

export const kimi_provider: Provider = {
  name: 'Kimi',
  website: 'https://platform.moonshot.ai',
  default_features: {},
  api: 'openai-chat-completion',
  base_url: 'https://api.moonshot.ai',
};

export interface Model<T = unknown> {

  /** display name */
  label: string;

  /** 
   * internal name, for the API 
   * FIXME: allow custom models, assuming we're connected to the service? (...)
   */
  name: string;

  /** model provider */
  provider: Provider;

  /** feature */
  thinking_budget?: boolean,

  /** 
   * these costs are a snapshot. they might change. also some 
   * services have discounts for cached tokens, we're not accounting
   * for that.
   */
  cost: {

    /** input cost for 1M tokens */
    input: number;

    /** output cost for 1M tokens */
    output: number;

    /** thinking tokens cost. only gemini atm */
    thoughts?: number;

  }

  /** 
   * opaque structure for additional patameters, using for some
   * openrouter-specific stuff
   */
  additional_parameters?: T;

  /** this only shows up in dev mode */
  dev?: boolean;

  /** overrides the provider default, if necessary */
  model_features?: Partial<ModelFeatures>;

}

// 
// we originally built in pricing to this structure but it's
// become impossible, now there are cache hit/cache miss prices
// and peak/off-peak prices, we'll just let someone else worry 
// about it
//

const default_models = [

  {
    label: 'Localhost',
    name: 'localhost',
    provider: localhost_provider,
    cost: {
      input: 0,
      output: 0,
    }
  },

  /*
  {
    label: 'DeepSeek-V3.2',
    name: 'deepseek-chat',
    provider: deepseek_provider,
    cost: {
      input: 0.28,
      output: 0.42,
    },
  },
  */
  {
    label: 'DeepSeek-V4.1-Flash',
    name: 'deepseek-flash',
    provider: deepseek_provider,
    cost: {
      input: 0.30,
      output: 1.20,
    },
  },
  {
    label: 'DeepSeek V4 Pro',
    name: 'deepseek-v4-pro',
    provider: deepseek_provider,
    cost: {
      input: 1.74,
      output: 3.48,
    },
  },

  // ----

  {
    label: 'Gemini 3.8 Flash',
    name: 'gemini-3.8-flash',
    provider: gemini_provider,
    cost: {
      input: 0.75,
      output: 1.50,
    },
  },  
  {
    label: 'Gemini 3.1 Pro',
    name: 'gemini-3.1-pro-preview',
    provider: gemini_provider,
    cost: {
      input: 2.00,
      output: 12.00,
    }
  },

  // ---

  {
    label: 'Claude Sonnet 5.5',
    name: 'claude-sonnet-5-5',
    provider: anthropic_provider,
    cost: {
      input: 2.00,
      output: 10.00,
    },
  },
  {
    label: 'Claude Opus 5.5',
    name: 'claude-opus-5-5',
    provider: anthropic_provider,
    cost: {
      input: 5.00,
      output: 25.00,
    },
  },

  /*
  {
    label: 'Claude Opus 4.8',
    name: 'claude-opus-4-8',
    provider: anthropic_provider,
    cost: {
      input: 5.00,
      output: 25.00,
    },
  },
  */

  {
    name: 'gpt-6.1-sol',
    label: 'GPT 6.1 Sol',
    provider: openai_provider,
    cost: {
      input: 2,
      output: 12,
    },
  },

  {
    name: 'gpt-6-luna',
    label: 'GPT 6 Luna',
    provider: openai_provider,
    cost: {
      input: 0.20,
      output: 1.20,
    },
  },

  /*
  {
    label: 'GPT-5.5',
    name: 'gpt-5.5',
    provider: openai_provider,
    cost: {
      input: 5.00,
      output: 30.00,
    },
  },
  {
    label: 'GPT-5.4',
    name: 'gpt-5.4',
    provider: openai_provider,
    cost: {
      input: 2.50,
      output: 15.00,
    },
  },
  {
    label: 'GPT-5.4 mini',
    name: 'gpt-5.4-mini',
    provider: openai_provider,
    cost: {
      input: 0.75,
      output: 4.50,
    },
  },
  */

] as const satisfies Model[];

/** the built-in providers, by name. see ResolveProvider */
const builtin_providers: Provider[] = [
  deepseek_provider, localhost_provider, togheterai_provider, openai_provider,
  anthropic_provider, gemini_provider, openrouter_provider, kimi_provider,
];

/**
 * fill in connection details for a provider that predates `base_url`.
 *
 * apps persist whole Model objects and send them to the worker as-is, so
 * the worker can see a provider saved before `base_url` existed. back then
 * the worker routed on the provider name; so if there's no `base_url` and
 * the name matches a built-in provider, take `api` and `base_url` from that.
 * anything else (including every provider with a `base_url`) is used as-is.
 */
export function ResolveProvider(provider: Provider): Provider {
  if (provider.base_url === undefined) {
    const builtin = builtin_providers.find(test => test.name === provider.name);
    if (builtin) {
      return { ...provider, api: builtin.api, base_url: builtin.base_url };
    }
  }
  return provider;
}

// --- registry ---

const FeaturesSchema = v.object({
  image_support_in_tools: v.optional(v.boolean()),
  tool_search: v.optional(v.boolean()),
});

/** validates a provider. unknown properties are kept */
export const ProviderSchema = v.looseObject({
  name: v.pipe(v.string(), v.nonEmpty()),
  website: v.string(),
  models: v.optional(v.string()),
  default_features: v.optional(FeaturesSchema, {}),
  api: v.picklist(['anthropic', 'gemini', 'openai-responses', 'openai-chat-completion']),
  base_url: v.optional(v.pipe(v.string(), v.url())),
});

/** validates a model. unknown properties are kept */
export const ModelSchema = v.looseObject({
  label: v.string(),
  name: v.pipe(v.string(), v.nonEmpty()),
  provider: ProviderSchema,
  thinking_budget: v.optional(v.boolean()),
  cost: v.object({
    input: v.number(),
    output: v.number(),
    thoughts: v.optional(v.number()),
  }),
  additional_parameters: v.optional(v.unknown()),
  dev: v.optional(v.boolean()),
  model_features: v.optional(FeaturesSchema),
});

/** 
 * what SetModels accepts: a Model, except `default_features` may be 
 * omitted. JSON fetched at runtime can be passed straight in.
 */
export type ModelInput = v.InferInput<typeof ModelSchema>;

/** 
 * model names used to be a union of the built-in names. models can now
 * be supplied at runtime, so this is just a string; kept for existing
 * imports.
 */
export type ModelName = string;

/** the built-in model list. SetModels(DefaultModels) restores it */
export const DefaultModels: readonly Model[] = default_models;

/**
 * the current model list. this is a live array: SetModels() replaces its
 * contents in place, so code that reads `Models` sees the new list. code
 * that copied from it (e.g. built a provider list) has to rebuild.
 */
export const Models: Model[] = [...default_models];

/**
 * replace the model list, e.g. with a list fetched at runtime. the input
 * is validated first; if it's invalid, or has duplicate names, this throws
 * and the current list is unchanged.
 *
 * returns the list as stored (with defaults filled in).
 */
export function SetModels(models: readonly ModelInput[]): Model[] {
  const parsed = v.parse(v.array(ModelSchema), models) as Model[];
  const seen = new Set<string>();
  for (const model of parsed) {
    if (seen.has(model.name)) {
      throw new Error('duplicate model name: ' + model.name);
    }
    seen.add(model.name);
  }
  Models.splice(0, Models.length, ...parsed);
  return Models;
}

export function FindModel(name: ModelName): Model|undefined {
  return Models.find(entry => entry.name === name);
}
