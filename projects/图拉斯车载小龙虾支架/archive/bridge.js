/**
 * 桥接程序 - 完整版
 * 功能：
 * 1. 连接到 Gateway
 * 2. 通过中继服务器接收 ESP32 消息
 * 3. 将消息转发给 Gateway
 * 4. 将 Gateway 回复转发给 ESP32
 */

const WebSocket = require('ws');
const readline = require('readline');

// ============== 配置 ==============
const GATEWAY_URL = 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';
const RELAY_URL = 'ws://localhost:8080';  // 中继服务器地址

// ============== 状态 ==============
let gatewayWs = null;   // Gateway WebSocket 连接
let relayWs = null;     // 中继服务器连接
let requestId = 1;

// ============== 工具函数 ==============
function generateId() {
  return String(requestId++);
}

function log(type, msg) {
  const time = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${time}] [${type}] ${msg}`);
}

// ============== Gateway 连接 ==============
async function connectToGateway() {
  return new Promise((resolve, reject) => {
    log('GATEWAY', `连接到 ${GATEWAY_URL}...`);

    gatewayWs = new WebSocket(GATEWAY_URL);

    gatewayWs.on('open', () => {
      log('GATEWAY', 'WebSocket 连接成功');
    });

    gatewayWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      handleGatewayMessage(msg);
    });

    gatewayWs.on('error', (err) => {
      log('GATEWAY', `错误: ${err.message}`);
    });

    gatewayWs.on('close', () => {
      log('GATEWAY', '连接关闭');
    });

    // 处理 Gateway 消息
    function handleGatewayMessage(msg) {
      // connect.challenge
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        log('GATEWAY', '收到挑战，发送 connect 请求...');

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
              mode: 'cli'
            },
            role: 'operator',
            scopes: ['operator.read', 'operator.write'],
            auth: { token: GATEWAY_TOKEN }
          }
        }));
      }

      // connect 响应
      if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
        log('GATEWAY', '🎉 连接成功！Gateway 已接受');
        resolve();
      }

      // 错误响应
      if (msg.type === 'res' && !msg.ok) {
        log('GATEWAY', `❌ 错误: ${msg.error?.message}`);
        if (msg.error?.details?.code === 'DEVICE_IDENTITY_REQUIRED') {
          log('GATEWAY', '提示: 需要设备配对，请使用 node 角色或配置设备身份');
        }
      }

      // chat 事件（AI 回复）
      if (msg.type === 'event' && msg.event === 'chat') {
        log('GATEWAY', `收到 chat 事件: ${JSON.stringify(msg.payload).substring(0, 100)}`);
        handleChatEvent(msg.payload);
      }

      // res 响应（chat.send 等）
      if (msg.type === 'res' && msg.ok && msg.id) {
        log('GATEWAY', `收到响应 ID=${msg.id}: 成功`);
      }

      // tick 心跳
      if (msg.type === 'event' && msg.event === 'tick') {
        // 忽略心跳
      }
    }
  });
}

// ============== 发送消息到 Gateway ==============
function sendToGateway(text) {
  if (!gatewayWs || gatewayWs.readyState !== WebSocket.OPEN) {
    log('GATEWAY', '❌ Gateway 未连接');
    return;
  }

  const id = generateId();
  log('GATEWAY', `发送消息: "${text}"`);

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

  log('GATEWAY', `已发送请求 ID=${id}`);
}

// ============== 处理聊天事件 ==============
function handleChatEvent(payload) {
  log('GATEWAY', '收到聊天事件，准备转发到中继服务器...');

  // 提取回复内容
  let replyText = '';
  if (payload?.result?.content) {
    const content = payload.result.content;
    if (Array.isArray(content)) {
      replyText = content.map(c => c.text || '').join('');
    } else if (typeof content === 'string') {
      replyText = content;
    }
  }

  if (replyText) {
    log('GATEWAY', `AI 回复: "${replyText}"`);
    // 转发到中继服务器（如果连接）
    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(JSON.stringify({
        type: 'message',
        from: 'gateway',
        content: replyText
      }));
      log('RELAY', '已转发 AI 回复到中继服务器');
    }
  }
}

// ============== 中继服务器连接 ==============
async function connectToRelay() {
  return new Promise((resolve, reject) => {
    log('RELAY', `连接到 ${RELAY_URL}...`);

    relayWs = new WebSocket(RELAY_URL);

    relayWs.on('open', () => {
      log('RELAY', '中继服务器连接成功');

      // 注册为桥接程序
      relayWs.send(JSON.stringify({
        type: 'register',
        tag: 'bridge'
      }));
    });

    relayWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      handleRelayMessage(msg);
    });

    relayWs.on('error', (err) => {
      log('RELAY', `错误: ${err.message}`);
    });

    relayWs.on('close', () => {
      log('RELAY', '中继服务器连接关闭');
    });

    function handleRelayMessage(msg) {
      if (msg.type === 'registered') {
        log('RELAY', `✅ 注册成功: ${msg.tag}`);
        resolve();
      }

      if (msg.type === 'message' && msg.from === 'esp32') {
        log('RELAY', `收到 ESP32 消息: "${msg.content}"`);
        // 转发给 Gateway
        sendToGateway(msg.content);
      }
    }
  });
}

// ============== 交互式输入 ==============
function startInteractiveMode() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n========== 桥接程序已启动 ==========');
  console.log('命令:');
  console.log('  发送 <文本>  - 发送消息到 Gateway');
  console.log('  status       - 查看连接状态');
  console.log('  quit         - 退出\n');

  rl.on('line', (line) => {
    const cmd = line.trim();

    if (cmd === 'quit' || cmd === 'exit') {
      log('MAIN', '正在退出...');
      gatewayWs?.close();
      relayWs?.close();
      process.exit(0);
    }

    if (cmd === 'status') {
      console.log('\n--- 连接状态 ---');
      console.log(`Gateway: ${gatewayWs?.readyState === WebSocket.OPEN ? '✅ 已连接' : '❌ 未连接'}`);
      console.log(`中继服务器: ${relayWs?.readyState === WebSocket.OPEN ? '✅ 已连接' : '❌ 未连接'}`);
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

// ============== 主函数 ==============
async function main() {
  try {
    // 连接到 Gateway
    await connectToGateway();

    // 尝试连接到中继服务器（可选）
    try {
      await connectToRelay();
    } catch (e) {
      log('RELAY', `中继服务器连接失败（这是可选的）: ${e.message}`);
      console.log('\n提示: 中继服务器未连接，将只测试 Gateway 通讯\n');
    }

    // 开始交互模式
    startInteractiveMode();

  } catch (e) {
    log('MAIN', `启动失败: ${e.message}`);
    process.exit(1);
  }
}

main();
