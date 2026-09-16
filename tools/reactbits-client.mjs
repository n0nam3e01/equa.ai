// Локальный MCP-клиент: использует установленный React Bits, не меняя конфиг Codex.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const client = new Client({name:'equa-component-reader',version:'1.0.0'});
const transport = new StdioClientTransport({
  command:process.execPath,
  args:[path.resolve('node_modules/reactbits-dev-mcp-server/dist/index.js')],
  // Не передаём серверу приватные токены из окружения разработчика.
  env:{PATH:process.env.PATH || '',SystemRoot:process.env.SystemRoot || ''},
});
try {
  await client.connect(transport);
  console.log('Tools:', (await client.listTools()).tools.map(tool=>tool.name).join(', '));
  const result = await client.callTool({name:'get_component', arguments:{name:'fade-content',style:'css'}});
  await mkdir('tools/vendor/reactbits-response',{recursive:true});
  await writeFile('tools/vendor/reactbits-response/fade-content.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result).slice(0,16000));
} finally {
  await client.close();
}
