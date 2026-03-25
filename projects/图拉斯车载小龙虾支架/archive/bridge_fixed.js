/**
 * 桥接程序 - 修复版
 * 修复了配对流程中的连接管理问题
 */

const WebSocket = require('ws');

const GATEWAY_URL = 'ws://127.0.0.1:18789';

let ws = null;
let requestId = 1;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

function send(obj) {
  const id = String(requestId++);
  obj.id = id;
  ws.send(JSON.stringify(obj));
  return id;
}

async function connect() {
  return new Promise((resolve, reject) => {
    log('连接 Gateway...');
    ws = new WebSocket(GATEWAY_URL);

    ws.on('open', () => log('WebSocket 已连接'));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    });

    ws.on('error', (e) => log(`错误: ${e.message}`));
    ws.on('close', () => log('连接关闭'));

    let stage = 'connect';

    function handleMessage(msg) {
      // Stage 1: 收到 challenge
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        log('收到 challenge，发送 connect (node role)...');

        // 以 node 角色连接，会被拒绝并触发配对
        send({
          type: 'req',
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: 'cli', version: '1.0.0', platform: 'bridge', mode: 'node' },
            role: 'node',
            scopes: [],
            caps: ['audio', 'voice'],
            commands: ['audio.play'],
            permissions: {}
          }
        });
      }

      // Stage 2: connect 被拒绝 (NOT_PAIRED)
      if (msg.type === 'res' && !msg.ok && msg.error?.code === 'NOT_PAIRED') {
        log('需要配对，发送 node.pair.request...');
        send({
          type: 'req',
          method: 'node.pair.request',
          params: {
            silent: false,
            deviceName: 'ESP32-Bridge-Device'
          }
        });
        stage = 'pairing';
      }

      // Stage 3: 配对请求已提交
      if (msg.type === 'res' && msg.ok && stage === 'pairing') {
        log('✅ 配对请求已提交！');
        log('请在新终端运行: openclaw nodes pending  # 查看请求');
        log('然后运行: openclaw nodes approve <requestId>  # 批准请求');
        log('');
        log('批准后，按回车键继续...');
        stage = 'waiting_approval';
      }

      // 收到任何响应
      if (msg.type === 'res' && msg.id) {
        if (msg.ok) {
          log(`响应 ID=${msg.id}: ok`);
        } else {
          log(`响应 ID=${msg.id}: error - ${msg.error?.message}`);
        }
      }
    }

    // 等待 30 秒让用户操作
    setTimeout(() => {
      if (stage === 'waiting_approval') {
        log('重新尝试连接...');
        // 重新连接
        ws.close();
        setTimeout(() => connectWithToken(), 1000);
      }
    }, 30000);
  });
}

async function connectWithToken() {
  // 读取配对后的 token
  const fs = require('fs');
  const pairedPath = 'C:/Users/doris/.openclaw/nodes/paired.json';

  if (!fs.existsSync(pairedPath)) {
    log('❌ 未找到配对信息，请先完成配对');
    process.exit(1);
  }

  const paired = JSON.parse(fs.readFileSync(pairedPath, 'utf8'));
  const devices = Object.values(paired.devices || {});
  const device = devices[devices.length - 1];

  if (!device?.token) {
    log('❌ 配对信息中没有 token');
    process.exit(1);
  }

  log(`找到配对设备，使用 token: ${device.token.substring(0, 20)}...`);

  return new Promise((resolve, reject) => {
    ws = new WebSocket(GATEWAY_URL);

    ws.on('open', () => log('使用配对 token 重新连接...'));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    });

    ws.on('error', (e) => log(`错误: ${e.message}`));
    ws.on('close', () => log('连接关闭'));

    function handleMessage(msg) {
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        ws.send(JSON.stringify({
          type: 'req',
          id: String(requestId++),
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: 'cli', version: '1.0.0', platform: 'bridge', mode: 'node' },
            role: 'node',
            scopes: [],
            caps: ['audio', 'voice'],
            commands: ['audio.play'],
            permissions: {},
            auth: { token: device.token }
          }
        }));
      }

      if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
        log('🎉🎉🎉 连接成功！桥接程序已完成设置！');
        log('现在可以发送消息了...');
        resolve();
      }
    }
  });
}

// 简单交互模式
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
  rl.question('\n桥接程序> ', (cmd) => {
    if (cmd.trim()) {
      console.log(`发送消息: ${cmd}`);
    }
    prompt();
  });
}

async function main() {
  try {
    await connect();
    prompt();
  } catch (e) {
    log(`失败: ${e.message}`);
    process.exit(1);
  }
}

main();
