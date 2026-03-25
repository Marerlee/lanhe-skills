/**
 * 桥接程序 - v2 payload 签名版
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');

const GATEWAY_URL = 'ws://127.0.0.1:18789';

// 从 paired.json 读取数据
const pairedData = JSON.parse(fs.readFileSync('C:/Users/doris/.openclaw/devices/paired.json', 'utf8'));
const deviceId = '71b1ba0cd90fba8932cdd32cfda293f997350a66780cc8b63c5f8f6543eb208b';
const deviceToken = pairedData[deviceId].tokens.operator.token;
const publicKeyRaw = pairedData[deviceId].publicKey;

// 从 identity/device.json 读取私钥
const deviceInfo = JSON.parse(fs.readFileSync('C:/Users/doris/.openclaw/identity/device.json', 'utf8'));
const privateKey = deviceInfo.privateKeyPem;

let ws = null;
let requestId = 1;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

// v2 payload 格式（没有 platform 和 deviceFamily）
function buildV2Payload(params) {
  const scopes = params.scopes.join(",");
  const token = params.token ?? "";
  return [
    "v2",                           // v2 版本
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce
  ].join("|");
}

// base64url 编码
function base64UrlEncode(buffer) {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function main() {
  log('连接 Gateway (v2 payload)...');
  ws = new WebSocket(GATEWAY_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  log('✅ WebSocket 连接成功');

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      const nonce = msg.payload.nonce;
      const timestamp = msg.payload.ts;

      log(`收到 challenge: nonce=${nonce}, ts=${timestamp}`);

      // 使用 v2 payload
      const payload = buildV2Payload({
        deviceId: deviceId,
        clientId: 'cli',
        clientMode: 'cli',
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        signedAtMs: timestamp,
        token: deviceToken,
        nonce: nonce
      });

      log(`v2 Payload: ${payload}`);

      // Ed25519 签名
      const privateKeyObj = crypto.createPrivateKey({ key: privateKey, format: 'pem', type: 'pkcs8' });
      const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKeyObj);
      const signatureB64 = base64UrlEncode(sig);

      log(`签名: ${signatureB64.substring(0, 30)}...`);

      ws.send(JSON.stringify({
        type: 'req',
        id: String(requestId++),
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: 'cli', version: '1.0.0', platform: process.platform, mode: 'cli' },
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          caps: [],
          commands: [],
          permissions: {},
          auth: { token: deviceToken },
          device: {
            id: deviceId,
            publicKey: publicKeyRaw,
            signature: signatureB64,
            signedAt: timestamp,
            nonce: nonce
          }
        }
      }));

      log('已发送 connect 请求 (v2 payload)...');
    }

    if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
      log('🎉🎉🎉 连接成功！发送测试消息...');
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'req',
          id: 'chat-1',
          method: 'chat.send',
          params: {
            message: '你好，v2 payload 测试成功！',
            sessionKey: 'main',
            idempotencyKey: 'test-1'
          }
        }));
      }, 500);
    }

    if (msg.type === 'res' && !msg.ok) {
      log(`❌ 错误: ${msg.error?.message}`);
      if (msg.error?.details) {
        log(`   详情: ${JSON.stringify(msg.error.details)}`);
        log(`   Code: ${msg.error.details.code}`);
        log(`   Reason: ${msg.error.details.reason}`);
      }
    }

    if (msg.type === 'res' && msg.id === 'chat-1') {
      if (msg.ok) {
        log('✅✅✅ 消息发送成功！');
        log(`   响应: ${JSON.stringify(msg.payload).substring(0, 200)}`);
      } else {
        log(`❌ 失败: ${msg.error?.message}`);
      }
      // 不立即关闭，等待 chat 事件
    }

    if (msg.type === 'event' && msg.event === 'chat') {
      log('收到 AI 回复:');
      log(`   ${JSON.stringify(msg.payload).substring(0, 500)}`);
    }
  });

  ws.on('close', () => log('连接关闭'));
  ws.on('error', (e) => log(`错误: ${e.message}`));

  setTimeout(() => { log('超时'); ws.close(); process.exit(1); }, 15000);
}

main().catch(e => { log(`失败: ${e.message}`); process.exit(1); });
