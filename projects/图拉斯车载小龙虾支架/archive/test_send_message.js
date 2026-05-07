/**
 * 模拟发送"你好"到 Gateway
 */

const WebSocket = require('ws');

const GATEWAY_URL = 'ws://127.0.0.1:18789';
const AUTH_TOKEN = '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';

console.log('🔌 连接 Gateway...\n');

const ws = new WebSocket(GATEWAY_URL);
let requestId = 1;

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📥 收到:', JSON.stringify(message, null, 2), '\n');

  if (message.type === 'event' && message.event === 'connect.challenge') {
    console.log('✅ 收到挑战，发送 connect 请求...\n');

    ws.send(JSON.stringify({
      type: 'req',
      id: String(requestId++),
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'cli',
          version: '1.0.0',
          platform: 'test',
          mode: 'cli'
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        auth: { token: AUTH_TOKEN }
      }
    }));
  }

  // 连接成功后，发送 chat.send
  if (message.type === 'res' && message.ok && message.payload?.type === 'hello-ok') {
    console.log('🎉 连接成功！发送"你好"...\n');

    ws.send(JSON.stringify({
      type: 'req',
      id: String(requestId++),
      method: 'chat.send',
      params: {
        message: {
          role: 'user',
          content: [{
            type: 'text',
            text: '你好'
          }]
        }
      }
    }));
    console.log('📤 已发送 chat.send 请求\n');
  }

  // 收到 chat.send 的响应
  if (message.type === 'res' && message.method === 'chat.send') {
    console.log('📥 收到 AI 回复:', JSON.stringify(message.payload, null, 2), '\n');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('⏰ 超时');
  ws.close();
  process.exit(1);
}, 15000);
