/**
 * 桥接程序 - Node 配对版本
 *
 * 这个版本使用 Node 配对流程来获取 Gateway 的访问权限
 *
 * 配对流程：
 * 1. 连接 Gateway 并请求配对
 * 2. Gateway 发出配对请求事件
 * 3. 用户在 Gateway 批准配对请求
 * 4. 桥接程序获得 token，开始正常工作
 */

const WebSocket = require('ws');
const readline = require('readline');

const GATEWAY_URL = 'ws://127.0.0.1:18789';

let gatewayWs = null;
let requestId = 1;
let nodeToken = null;
let pendingRequestId = null;

function log(type, msg) {
  const time = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${time}] [${type}] ${msg}`);
}

function generateId() {
  return String(requestId++);
}

async function connectAndPair() {
  return new Promise((resolve, reject) => {
    log('BRIDGE', `连接到 Gateway...`);
    gatewayWs = new WebSocket(GATEWAY_URL);

    gatewayWs.on('open', () => {
      log('BRIDGE', 'WebSocket 连接成功');
    });

    gatewayWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    });

    gatewayWs.on('error', (err) => {
      log('BRIDGE', `错误: ${err.message}`);
    });

    gatewayWs.on('close', () => {
      log('BRIDGE', '连接关闭');
    });

    function handleMessage(msg) {
      // connect.challenge - 需要先配对
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        log('BRIDGE', '收到挑战，尝试以 node 角色连接（将触发配对请求）...');

        gatewayWs.send(JSON.stringify({
          type: 'req',
          id: generateId(),
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'cli',
              version: '1.0.0',
              platform: 'bridge',
              mode: 'node'
            },
            role: 'node',
            scopes: ['node.message'],
            caps: ['audio', 'voice'],
            commands: ['audio.play', 'voice.record'],
            permissions: {},
            auth: { token: '' }  // node 角色暂不需要 token
          }
        }));
      }

      // 配对请求被拒绝
      if (msg.type === 'res' && msg.id && !msg.ok && msg.error?.code === 'NOT_PAIRED') {
        log('BRIDGE', '需要设备配对，准备请求配对...');
        requestPairing();
      }

      // 配对请求已发送
      if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
        log('BRIDGE', '✅ 连接成功！');
        if (msg.payload.auth?.deviceToken) {
          nodeToken = msg.payload.auth.deviceToken;
          log('BRIDGE', `🎉 已获得设备 token: ${nodeToken.substring(0, 20)}...`);
        }
        resolve();
      }

      // 配对请求的响应
      if (msg.type === 'res' && pendingRequestId && msg.id === pendingRequestId) {
        if (msg.ok) {
          log('BRIDGE', '✅ 配对请求已提交，等待 Gateway 管理员批准...');
        } else {
          log('BRIDGE', `❌ 配对请求失败: ${msg.error?.message}`);
        }
        pendingRequestId = null;
      }

      // node.pair.requested 事件 - 表示配对请求正在等待批准
      if (msg.type === 'event' && msg.event === 'node.pair.requested') {
        log('BRIDGE', '📋 配对请求已发出，等待批准中...');
        log('BRIDGE', `   请在 Gateway 控制面板批准配对请求`);
      }

      // node.pair.resolved 事件 - 配对已批准
      if (msg.type === 'event' && msg.event === 'node.pair.resolved') {
        if (msg.payload?.approved) {
          log('BRIDGE', '🎉 配对已批准！');
          // 重新连接以获取 token
          reconnectWithPairing();
        } else {
          log('BRIDGE', '❌ 配对被拒绝');
          process.exit(1);
        }
      }
    }
  });
}

function requestPairing() {
  pendingRequestId = generateId();
  log('BRIDGE', '发送配对请求...');

  gatewayWs.send(JSON.stringify({
    type: 'req',
    id: pendingRequestId,
    method: 'node.pair.request',
    params: {
      silent: false,
      deviceName: 'ESP32-Bridge',
      capabilities: ['audio', 'voice']
    }
  }));
}

async function reconnectWithPairing() {
  log('BRIDGE', '关闭当前连接，重新连接...');
  gatewayWs.close();

  await new Promise(r => setTimeout(r, 1000));

  return new Promise((resolve, reject) => {
    gatewayWs = new WebSocket(GATEWAY_URL);

    gatewayWs.on('open', () => {
      log('BRIDGE', '重新连接中...');
    });

    gatewayWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        gatewayWs.send(JSON.stringify({
          type: 'req',
          id: generateId(),
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'cli',
              version: '1.0.0',
              platform: 'bridge',
              mode: 'node'
            },
            role: 'node',
            scopes: [],
            caps: ['audio', 'voice'],
            commands: ['audio.play', 'voice.record'],
            permissions: {}
          }
        }));
      }

      if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
        log('BRIDGE', '✅ 重新连接成功！');
        if (msg.payload.auth?.deviceToken) {
          nodeToken = msg.payload.auth.deviceToken;
          log('BRIDGE', `🎉 获得设备 token`);
        }
        resolve();
      }
    });

    gatewayWs.on('error', reject);
  });
}

function sendToGateway(text) {
  if (!gatewayWs || gatewayWs.readyState !== WebSocket.OPEN) {
    log('BRIDGE', '❌ Gateway 未连接');
    return;
  }

  const id = generateId();
  log('BRIDGE', `发送: "${text}"`);

  gatewayWs.send(JSON.stringify({
    type: 'req',
    id: id,
    method: 'chat.send',
    params: {
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: text
        }]
      }
    }
  }));
}

function startInteractiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n========== 桥接程序 (Node 配对版) ==========');
  console.log('注意: 需要先在 Gateway 批准配对请求');
  console.log('命令:');
  console.log('  发送 <文本>  - 发送消息到 Gateway');
  console.log('  status       - 查看连接状态');
  console.log('  quit         - 退出\n');

  rl.on('line', (line) => {
    const cmd = line.trim();

    if (cmd === 'quit' || cmd === 'exit') {
      log('MAIN', '正在退出...');
      gatewayWs?.close();
      process.exit(0);
    }

    if (cmd === 'status') {
      console.log('\n--- 连接状态 ---');
      console.log(`Gateway: ${gatewayWs?.readyState === WebSocket.OPEN ? '✅ 已连接' : '❌ 未连接'}`);
      console.log(`Token: ${nodeToken ? '✅ 已获得' : '❌ 未获得'}`);
      console.log('');
    }

    if (cmd.startsWith('发送 ')) {
      const text = cmd.substring(3);
      sendToGateway(text);
    }

    if (!cmd.startsWith('发送 ') && cmd !== 'status' && cmd !== 'quit' && cmd !== '') {
      console.log('未知命令');
    }
  });
}

async function main() {
  try {
    await connectAndPair();
    startInteractiveMode();
  } catch (e) {
    log('MAIN', `启动失败: ${e.message}`);
    process.exit(1);
  }
}

main();
