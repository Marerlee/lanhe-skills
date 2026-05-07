/**
 * 桥接程序 - 使用 agent 方法测试
 */

const WebSocket = require('ws');

const GATEWAY_URL = 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';

let gatewayWs = null;
let requestId = 1;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

function generateId() {
  return String(requestId++);
}

async function main() {
  log('连接 Gateway...');
  gatewayWs = new WebSocket(GATEWAY_URL);

  await new Promise((resolve, reject) => {
    gatewayWs.on('open', resolve);
    gatewayWs.on('error', reject);
  });

  log('✅ Gateway 连接成功');

  gatewayWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      log('收到挑战，发送 connect...');
      gatewayWs.send(JSON.stringify({
        type: 'req',
        id: generateId(),
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: 'cli', version: '1.0.0', platform: 'bridge', mode: 'cli' },
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          auth: { token: GATEWAY_TOKEN }
        }
      }));
    }

    if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
      log('🎉 Gateway 认证成功！发送测试消息...');
      sendTestMessage();
    }

    if (msg.type === 'res' && msg.id) {
      log(`收到响应 ID=${msg.id}: ok=${msg.ok}`);
      if (!msg.ok) {
        log(`   错误: ${msg.error?.message}`);
      }
      if (msg.ok && msg.id.startsWith('agent-')) {
        log(`   响应: ${JSON.stringify(msg.payload).substring(0, 300)}`);
        gatewayWs.close();
        process.exit(0);
      }
    }

    if (msg.type === 'event' && msg.event === 'agent') {
      log('收到 agent 事件');
      log(`   ${JSON.stringify(msg.payload).substring(0, 300)}`);
    }
  });

  setTimeout(() => {
    log('⏰ 超时，关闭连接');
    gatewayWs.close();
    process.exit(1);
  }, 15000);
}

function sendTestMessage() {
  const id = 'agent-1';
  log(`发送 agent 请求: "你好"`);

  gatewayWs.send(JSON.stringify({
    type: 'req',
    id: id,
    method: 'agent',
    params: {
      message: {
        role: 'user',
        content: '你好'
      }
    }
  }));
  log(`已发送请求 ID=${id}`);
}

main().catch(e => {
  log(`❌ 错误: ${e.message}`);
  process.exit(1);
});
