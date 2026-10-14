
//
// treb-llm-support: llm-support-core plus the TREB spreadsheet tools.
// apps with no spreadsheet should use llm-support-core directly.
//

export * from 'llm-support-core';
export * from './treb';

import { formatConfig } from 'llm-support-core';

// existing clients expect collapsible code blocks, which the core no 
// longer defaults to. apps can still set this after import.
formatConfig.collapsibleCodeBlocks = true;
