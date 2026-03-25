/**
 * 桥接程序 - 完整签名版
 * 使用已有的设备密钥对进行签名认证
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');

const GATEWAY_URL = 'ws://127.0.0.1:18789';

// 读取设备密钥
const deviceInfo = JSON.parse(fs.readFileSync('C:/Users/doris/.openclaw/identity/device.json', 'utf8'));
const deviceId = deviceInfo.deviceId;
const publicKey = deviceInfo.publicKeyPem;
const privateKey = deviceInfo.privateKeyPem;

let ws = null;
let requestId = 1;
let nonce = null;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

function sign(nonce, timestamp) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(nonce + timestamp);
  return sign.sign(privateKey, 'base64');
}

async function main() {
  log('连接 Gateway (完整签名版)...');
  ws = new WebSocket(GATEWAY_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  log('✅ WebSocket 连接成功');

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    // 收到 challenge
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      nonce = msg.payload.nonce;
      const timestamp = msg.payload.ts;
      const signature = sign(nonce, timestamp);

      log('收到 challenge，进行签名认证...');

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
          device: {
            id: deviceId,
            publicKey: publicKey,
            signature: signature,
            signedAt: timestamp,
            nonce: nonce
          }
        }
      }));
    }

    // 连接成功
    if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
      log('🎉🎉🎉 连接成功！认证通过！');
      log('桥接程序已完成 Gateway 认证！');
      log('');
      log('下一步：');
      log('1. 如果需要发送消息，可以在这里继续');
      log('2. 或者按 Ctrl+C 退出');

      // 测试发送消息
      setTimeout(() => {
        log('发送测试消息: "你好"');
        ws.send(JSON.stringify({
          type: 'req',
          id: String(requestId++),
          method: 'chat.send',
          params: {
            message: {
              role: 'user',
              content: [{ type: 'text', text: '你好' }]
            }
          }
        }));
      }, 1000);
    }

    // 错误处理
    if (msg.type === 'res' && !msg.ok) {
      log(`❌ 错误: ${msg.error?.message}`);
      if (msg.error?.details) {
        log(`   详情: ${JSON.stringify(msg.error.details)}`);
      }
    }

    // chat.send 响应
    if (msg.type === 'res' && msg.id && msg.ok === false && msg.id !== '1') {
      log(`chat.send 响应: ok=false`);
      log(`   错误: ${msg.error?.message}`);
      ws.close();
      process.exit(1);
    }

    if (msg.type === 'res' && msg.id && msg.ok === true && msg.id !== '1') {
      log(`chat.send 响应: ✅ 成功！`);
      ws.close();
      process.exit(0);
    }

    // chat 事件
    if (msg.type === 'event' && msg.event === 'chat') {
      log('收到 AI 回复:');
      log(`   ${JSON.stringify(msg.payload).substring(0, 200)}`);
    }
  });

  ws.on('close', () => log('连接关闭'));
  ws.on('error', (e) => log(`错误: ${e.message}`));

  setTimeout(() => {
    log('超时，退出');
    ws.close();
    process.exit(1);
  }, 15000);
}

main().catch(e => { log(`失败: ${e.message}`); process.exit(1); });
