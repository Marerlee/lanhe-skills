/**
 * 桥接程序 - webchat 客户端测试
 */

const WebSocket = require('ws');

const GATEWAY_URL = 'ws://127.0.0.1:18789';

let ws = null;
let requestId = 1;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

async function main() {
  log('连接 Gateway (webchat 客户端模式)...');
  ws = new WebSocket(GATEWAY_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  log('✅ WebSocket 连接成功');

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    log(`收到: ${JSON.stringify(msg).substring(0, 150)}`);

    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      log('收到 challenge，尝试 webchat 客户端...');
      ws.send(JSON.stringify({
        type: 'req',
        id: String(requestId++),
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: 'webchat', version: '1.0.0', platform: 'web', mode: 'webchat' },
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          caps: [],
          commands: [],
          permissions: {}
        }
      }));
    }

    if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
      log('🎉 连接成功！');
      setTimeout(() => sendTestMessage(), 500);
    }

    if (msg.type === 'res' && !msg.ok) {
      log(`❌ 错误: ${msg.error?.message}`);
    }

    if (msg.type === 'res' && msg.id === 'chat-1') {
      log(`chat.send 响应: ok=${msg.ok}`);
      if (!msg.ok) log(`  错误: ${msg.error?.message}`);
      ws.close();
      process.exit(0);
    }
  });

  setTimeout(() => { log('超时'); ws.close(); process.exit(1); }, 15000);
}

function sendTestMessage() {
  log('发送: "你好"');
  ws.send(JSON.stringify({
    type: 'req',
    id: 'chat-1',
    method: 'chat.send',
    params: {
      message: { role: 'user', content: [{ type: 'text', text: '你好' }] }
    }
  }));
}

main().catch(e => { log(`❌ 错误: ${e.message}`); process.exit(1); });
