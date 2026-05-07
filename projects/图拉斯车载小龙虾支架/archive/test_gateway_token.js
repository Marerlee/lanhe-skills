/**
 * 桥接程序 - 使用 gateway.auth.token
 */

const WebSocket = require('ws');

const GATEWAY_URL = 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';

let ws = null;
let requestId = 1;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

async function main() {
  log('连接 Gateway...');
  ws = new WebSocket(GATEWAY_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  log('✅ WebSocket 连接成功');

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      log('收到 challenge，发送 connect...');
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
          auth: { token: GATEWAY_TOKEN }
        }
      }));
    }

    if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
      log('🎉 连接成功！发送测试消息...');
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'req',
          id: 'chat-1',
          method: 'chat.send',
          params: {
            message: {
              role: 'user',
              content: [{ type: 'text', text: '你好，这是桥接程序测试' }]
            }
          }
        }));
      }, 500);
    }

    if (msg.type === 'res' && !msg.ok) {
      log(`❌ 错误: ${msg.error?.message}`);
      if (msg.error?.details) log(`   详情: ${JSON.stringify(msg.error.details)}`);
    }

    if (msg.type === 'res' && msg.id === 'chat-1') {
      log(`chat.send: ok=${msg.ok}`);
      if (msg.ok) {
        log('✅ 消息发送成功！');
      } else {
        log(`❌ 失败: ${msg.error?.message}`);
      }
      ws.close();
      process.exit(0);
    }

    if (msg.type === 'event' && msg.event === 'chat') {
      log('收到 AI 回复:');
      log(`   ${JSON.stringify(msg.payload).substring(0, 300)}`);
    }
  });

  ws.on('close', () => log('连接关闭'));
  ws.on('error', (e) => log(`错误: ${e.message}`));

  setTimeout(() => { log('超时'); ws.close(); process.exit(1); }, 15000);
}

main().catch(e => { log(`失败: ${e.message}`); process.exit(1); });
