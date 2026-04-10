import { tools } from './src/tool-schema';

const anthropicTools = tools.map(({ options, ...rest }) => rest);
const json = JSON.stringify(anthropicTools, null, 2);

console.log(json);
console.log('\n---');
console.log(`Characters: ${json.length}`);
console.log(`Compact:    ${JSON.stringify(anthropicTools).length}`);
