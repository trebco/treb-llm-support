
/** what a tool handler returns; formatted per-provider as a tool result in stream.ts */

export type ToolHandlerImageResponseType = {
  type: 'image',
  image_uri: string;
  content?: unknown;
};

export type ToolHandlerGenericResposneType = {
  type: 'object',
  content: unknown,
};

export type ToolHandlerErrorType = {
  type: 'error',
  content: unknown,
};

export type ToolHandlerResponseType = 
  ToolHandlerGenericResposneType | 
  ToolHandlerImageResponseType |
  ToolHandlerErrorType ;

