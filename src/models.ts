
export interface Provider {
  name: string;
  website: string;
}

export const deepseek_provider: Provider = {
  name: 'Deepseek',
  website: 'https://platform.deepseek.com',
};

export const togheterai_provider: Provider = {
  name: 'TogetherAI',
  website: 'https://api.together.ai',
};

export const openai_provider: Provider = {
  name: 'OpenAI',
  website: 'https://openai.com/api',
};

export const anthropic_provider: Provider = {
  name: 'Anthropic',
  website: 'https://console.anthropic.com',
};

export const gemini_provider: Provider = {
  name: 'Google',
  website: 'https://ai.google.dev/gemini-api',
};

export const openrouter_provider: Provider = {
  name: 'OpenRouter',
  website: 'https://openrouter.ai',
};

export const kimi_provider: Provider = {
  name: 'Kimi',
  website: 'https://platform.moonshot.ai',
};

export const default_provider: Provider = {
  name: 'Default',
  website: 'https://treb.app',
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

}

const list: Model[] = [

  {
    label: 'DeepSeek-V3.2',
    name: 'deepseek-chat',
    provider: deepseek_provider,
    cost: {
      input: 0.28,
      output: 0.42,
    },
  },

  {
    label: 'Gemini 3 Flash (preview)',
    name: 'gemini-3-flash-preview',
    provider: gemini_provider,
    cost: {
      input: 0.50,
      output: 3.00,
    }
  },  
  {
    label: 'Gemini 3.1 Flash-Lite (preview)',
    name: 'gemini-3.1-flash-lite-preview',
    provider: gemini_provider,
    cost: {
      input: 0.25,
      output: 1.50,
    }
  },

  {
    label: 'Claude Haiku 4.5',
    name: 'claude-haiku-4-5',
    provider: anthropic_provider,
    cost: {
      input: 1.00,
      output: 5.00,
    },
  },
  {
    label: 'Claude Sonnet 4.6',
    name: 'claude-sonnet-4-6',
    provider: anthropic_provider,
    cost: {
      input: 3.00,
      output: 15.00,
    },
  },
  {
    label: 'Placeholder Model',
    name: 'placeholder',
    provider: openai_provider,
    cost: {
      input: 100.00,
      output: 100.00,
    },
  },

];

export const Models = list;
