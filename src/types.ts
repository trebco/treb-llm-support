import type { ChatMessage } from './chat-message';

export type SegmentOpts = {
  json: string[];
  response_message?: ChatMessage;
  reasoning_state?: boolean;
  index: number;
  cache: string[];
  default_model_name?: string;
  model_name?: string;
};

export type SegmentMetadata = {
  tokens: {
    prompt: number;
    completion: number;
    thoughts: number;

    // google also separates out tool use and cached tokens?
    // cached might be useful if it has different pricing (TODO)

  }
};

export type SegmentParser = (opts: SegmentOpts) => SegmentMetadata|void;
