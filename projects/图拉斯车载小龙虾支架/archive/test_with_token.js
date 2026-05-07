/**
 * 桥接程序 - 使用真实设备 token
 */

const WebSocket = require('ws');

const GATEWAY_URL = 'ws://127.0.0.1:18789';
const DEVICE_TOKEN = 'd8nWB6TPwoUoXm89-jew0jRzgAY-_o3FKUZuxQzBuiA';
const DEVICE_ID = '71b1ba0cd90fba8932cdd32cfda293f997350a66780cc8b63c5f8f6543eb208b';

let ws = null;
let requestId = 1;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

async function main() {
  log('连接 Gateway (使用设备 token)...');
  ws = new WebSocket(GATEWAY_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  log('✅ WebSocket 连接成功');

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      log('收到 challenge，发送 connect (带设备 token)...');
      ws.send(JSON.stringify({
        type: 'req',
        id: String(requestId++),
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: 'cli', version: '1.0.0', platform: 'bridge', mode: 'cli' },
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          caps: [],
          commands: [],
          permissions: {},
          auth: { token: DEVICE_TOKEN },
          device: { id: DEVICE_ID }
        }
      }));
    }

    if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
      log('🎉 连接成功！发送测试消息...');
      setTimeout(() => sendMessage('你好，这是桥接程序的测试消息'), 500);
    }

    if (msg.type === 'res' && !msg.ok) {
      log(`❌ connect 错误: ${msg.error?.message}`);
    }

    if (msg.type === 'res' && msg.id === 'chat-1') {
      log(`chat.send 响应: ok=${msg.ok}`);
      if (msg.ok) {
        log(`✅ 消息发送成功！`);
      } else {
        log(`❌ 发送失败: ${msg.error?.message}`);
      }
      ws.close();
      process.exit(0);
    }

    if (msg.type === 'event' && msg.event === 'chat') {
      log('收到 chat 事件 (AI回复):');
      log(`   ${JSON.stringify(msg.payload).substring(0, 200)}`);
    }
  });

  setTimeout(() => { log('超时'); ws.close(); process.exit(1); }, 15000);
}

function sendMessage(text) {
  log(`发送: "${text}"`);
  ws.send(JSON.stringify({
    type: 'req',
    id: 'chat-1',
    method: 'chat.send',
    params: {
      message: { role: 'user', content: [{ type: 'text', text: text }] }
    }
  }));
}

main().catch(e => { log(`❌ 错误: ${e.message}`); process.exit(1); });
