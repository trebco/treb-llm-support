
//
// treb-llm-support: the LLM chat core plus the TREB spreadsheet tools.
// apps with no spreadsheet should import from ./core instead.
//

export * from './core';
export * from './treb';

import { formatConfig } from './core/md';

// existing clients expect collapsible code blocks, which the core no 
// longer defaults to. apps can still set this after import.
formatConfig.collapsibleCodeBlocks = true;
