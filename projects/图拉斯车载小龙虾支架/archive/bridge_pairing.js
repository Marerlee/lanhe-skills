/**
 * 桥接程序 - 扫码配对版
 * 步骤：
 * 1. 生成 Ed25519 密钥对
 * 2. 请求 Gateway 配对码
 * 3. 用户批准后完成配对
 * 4. 用 token 连接 Gateway
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 配置文件路径
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || require('os').homedir(), '.openclaw', 'bridge');
const DEVICE_KEYS_FILE = path.join(CONFIG_DIR, 'device-keys.json');
const PAIRING_TOKEN_FILE = path.join(CONFIG_DIR, 'pairing-token.txt');

// 确保目录存在
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Gateway 地址
const GATEWAY_URL = 'ws://127.0.0.1:18789';

// 生成 Ed25519 密钥对
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const publicKeyRaw = publicKey.export({ type: 'spki', format: 'der' });
  const privateKeyRaw = privateKey.export({ type: 'pkcs8', format: 'der' });

  return {
    publicKey: Buffer.from(publicKeyRaw).toString('base64'),
    privateKey: Buffer.from(privateKeyRaw).toString('base64')
  };
}

// 保存密钥对
function saveKeyPair(keys) {
  fs.writeFileSync(DEVICE_KEYS_FILE, JSON.stringify(keys, null, 2));
  console.log(`密钥已保存到: ${DEVICE_KEYS_FILE}`);
}

// 加载密钥对
function loadKeyPair() {
  if (fs.existsSync(DEVICE_KEYS_FILE)) {
    return JSON.parse(fs.readFileSync(DEVICE_KEYS_FILE, 'utf8'));
  }
  return null;
}

// 生成随机 nonce
function generateNonce(length = 16) {
  return crypto.randomBytes(length).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// base64url 编码
function base64UrlEncode(buffer) {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

let ws = null;
let requestId = 1;
let deviceKeys = null;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

function generateId() {
  return String(requestId++);
}

async function connectToGateway() {
  return new Promise((resolve, reject) => {
    log(`连接到 Gateway: ${GATEWAY_URL}`);
    ws = new WebSocket(GATEWAY_URL);

    ws.on('open', () => {
      log('WebSocket 连接成功');
      resolve();
    });

    ws.on('error', (err) => {
      log(`WebSocket 错误: ${err.message}`);
      reject(err);
    });

    ws.on('close', () => {
      log('连接关闭');
    });
  });
}

async function waitForChallenge() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('等待 challenge 超时'));
    }, 10000);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        clearTimeout(timeout);
        resolve(msg.payload);
      }
    });

    ws.on('error', reject);
  });
}

async function sendConnectRequest(challenge) {
  const nonce = challenge.nonce;
  const timestamp = challenge.ts;

  // 构建 payload：v3|deviceId|clientId|clientMode|role|scopes|timestamp|token|nonce|platform|deviceFamily
  // 使用 Gateway 允许的 client id 和 mode
  const clientId = 'cli';
  const clientMode = 'cli';
  const deviceId = deviceKeys.publicKey.substring(0, 32).replace(/[^a-z0-9]/gi, ''); // 从公钥派生一个临时ID

  const payload = [
    'v3',
    deviceId,            // 临时 deviceId（从公钥派生）
    clientId,            // 客户端ID
    clientMode,          // 客户端模式
    'operator',          // 角色
    'operator.read,operator.write',  // 权限
    String(timestamp),   // 时间戳
    '',                  // token 为空
    nonce,               // 随机数
    process.platform,    // 平台
    'node'               // 设备类型
  ].join('|');

  log(`Payload: ${payload.substring(0, 50)}...`);

  // 用私钥签名
  // Ed25519 签名
  const privateKeyDer = Buffer.from(deviceKeys.privateKey, 'base64');
  const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });

  const signature = crypto.sign(null, Buffer.from(payload), privateKey);
  const signatureB64 = base64UrlEncode(signature);

  log(`公钥 (base64): ${deviceKeys.publicKey.substring(0, 20)}...`);
  log(`签名 (base64): ${signatureB64.substring(0, 20)}...`);

  // 发送配对请求
  const id = generateId();
  ws.send(JSON.stringify({
    type: 'req',
    id: id,
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'cli',
        version: '1.0.0',
        platform: process.platform,
        mode: 'cli'
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      caps: [],
      commands: [],
      permissions: {},
      device: {
        id: deviceId,
        publicKey: deviceKeys.publicKey,
        signature: signatureB64,
        signedAt: timestamp,
        nonce: nonce
      }
    }
  }));

  log('已发送配对请求，等待 Gateway 批准...');

  // 等待响应
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('等待配对响应超时'));
    }, 30000);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'res' && msg.id === id) {
        clearTimeout(timeout);
        if (msg.ok) {
          log('配对成功！');
          resolve(msg.payload);
        } else {
          log(`配对失败: ${msg.error?.message}`);
          reject(new Error(msg.error?.message));
        }
      }
    });
  });
}

async function main() {
  log('========== 桥接程序 - 扫码配对版 ==========\n');

  // 1. 检查是否有现有密钥
  deviceKeys = loadKeyPair();

  if (deviceKeys) {
    log('找到已保存的密钥对');
  } else {
    log('生成新的 Ed25519 密钥对...');
    deviceKeys = generateKeyPair();
    saveKeyPair(deviceKeys);
    log('新密钥对已生成并保存');
  }

  log(`公钥: ${deviceKeys.publicKey.substring(0, 30)}...`);
  log(`私钥: ${deviceKeys.privateKey.substring(0, 30)}...`);
  log('');

  // 2. 连接到 Gateway
  try {
    await connectToGateway();
  } catch (e) {
    log(`连接失败: ${e.message}`);
    log('');
    log('请确保 Gateway 正在运行');
    return;
  }

  // 3. 等待 challenge
  let challenge;
  try {
    challenge = await waitForChallenge();
    log(`收到 challenge: nonce=${challenge.nonce}, ts=${challenge.ts}`);
  } catch (e) {
    log(`获取 challenge 失败: ${e.message}`);
    return;
  }

  // 4. 发送配对请求
  try {
    const result = await sendConnectRequest(challenge);
    log(`配对响应: ${JSON.stringify(result).substring(0, 100)}...`);

    // 检查是否有 token
    if (result.auth?.deviceToken) {
      log(`\n🎉 配对成功！`);
      log(`设备 Token: ${result.auth.deviceToken.substring(0, 20)}...`);
      log(`设备 ID: ${result.auth.deviceId}`);

      // 保存 token
      fs.writeFileSync(PAIRING_TOKEN_FILE, result.auth.deviceToken);
      log(`Token 已保存到: ${PAIRING_TOKEN_FILE}`);
    } else {
      log(`\n⚠️ 配对似乎需要额外批准`);
      log(`请在 Gateway 控制面板批准配对请求`);
      log(`然后重新运行此程序`);
    }
  } catch (e) {
    log(`配对失败: ${e.message}`);
    log('');
    log('可能的原因：');
    log('1. 需要在 Gateway 控制面板批准配对请求');
    log('2. 或者 Gateway 不允许新设备配对');
  }

  ws.close();
}

main().catch(e => {
  log(`程序错误: ${e.message}`);
  process.exit(1);
});
