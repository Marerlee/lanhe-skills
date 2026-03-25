/**
 * 桥接程序 - 扫码配对版
 *
 * 步骤：
 * 1. 从 Gateway 获取配对信息（二维码/URL）
 * 2. 用配对信息完成设备身份认证
 * 3. 获得 token 后连接 Gateway
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 配置文件路径
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || require('os').homedir(), '.openclaw', 'bridge');
const DEVICE_KEYS_FILE = path.join(CONFIG_DIR, 'device-keys.json');
const DEVICE_TOKEN_FILE = path.join(CONFIG_DIR, 'device-token.json');

// 确保目录存在
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Gateway 配置
const GATEWAY_URL = 'http://127.0.0.1:18789';

// ============== 密钥管理 ==============

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
  console.log(`[保存] 密钥对已保存到: ${DEVICE_KEYS_FILE}`);
}

// 加载密钥对
function loadKeyPair() {
  if (fs.existsSync(DEVICE_KEYS_FILE)) {
    return JSON.parse(fs.readFileSync(DEVICE_KEYS_FILE, 'utf8'));
  }
  return null;
}

// 保存设备 token
function saveDeviceToken(tokenData) {
  fs.writeFileSync(DEVICE_TOKEN_FILE, JSON.stringify(tokenData, null, 2));
  console.log(`[保存] Token已保存到: ${DEVICE_TOKEN_FILE}`);
}

// 加载设备 token
function loadDeviceToken() {
  if (fs.existsSync(DEVICE_TOKEN_FILE)) {
    return JSON.parse(fs.readFileSync(DEVICE_TOKEN_FILE, 'utf8'));
  }
  return null;
}

// ============== HTTP 请求 ==============

// GET 请求
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.end();
  });
}

// POST 请求
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.write(data);
    req.end();
  });
}

// ============== 配对相关 ==============

// 从 Gateway 获取配对信息
async function fetchPairingInfo() {
  console.log('[配对] 从 Gateway 获取配对信息...');

  try {
    // 尝试获取配对码
    const response = await httpPost(`${GATEWAY_URL}/pairing/generate`, {
      type: 'device',
      clientId: 'openclaw-bridge',
      expiresIn: 300 // 5分钟
    });

    if (response.status === 200) {
      return response.data;
    } else {
      console.log(`[配对] 获取配对信息失败: ${response.status}`);
      return null;
    }
  } catch (e) {
    console.log(`[配对] 获取配对信息出错: ${e.message}`);
    return null;
  }
}

// ============== WebSocket ==============

let ws = null;
let requestId = 1;

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

function generateId() {
  return String(requestId++);
}

// base64url 编码
function base64UrlEncode(buffer) {
  return buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// 连接 Gateway 并完成配对
async function connectAndPair(pairingInfo) {
  return new Promise((resolve, reject) => {
    log('[连接] 连接到 Gateway...');
    ws = new WebSocket(GATEWAY_URL.replace('http', 'ws'));

    ws.on('open', () => {
      log('[连接] WebSocket 连接成功');
    });

    ws.on('error', (err) => {
      log(`[错误] WebSocket: ${err.message}`);
      reject(err);
    });

    ws.on('close', () => {
      log('[连接] 连接已关闭');
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      // Challenge
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        log('[认证] 收到 challenge');
        handleChallenge(msg.payload, pairingInfo, resolve, reject);
      }

      // 响应
      if (msg.type === 'res' && msg.id && msg.ok) {
        log(`[认证] ID=${msg.id} 响应成功`);

        if (msg.payload?.auth?.deviceToken) {
          log('[认证] 获得设备 token!');
          saveDeviceToken(msg.payload.auth);
          resolve(msg.payload.auth);
        }
      }

      if (msg.type === 'res' && !msg.ok) {
        log(`[错误] 认证失败: ${msg.error?.message}`);
        reject(new Error(msg.error?.message));
      }
    });
  });
}

// 处理 challenge
async function handleChallenge(challenge, pairingInfo, resolve, reject) {
  const deviceKeys = loadKeyPair();
  if (!deviceKeys) {
    reject(new Error('没有找到密钥对'));
    return;
  }

  const nonce = challenge.nonce;
  const timestamp = challenge.ts;

  // 构建 payload
  // 格式: v3|deviceId|clientId|clientMode|role|scopes|timestamp|token|nonce|platform|deviceFamily
  const payload = [
    'v3',
    pairingInfo?.deviceId || extractDeviceIdFromPublicKey(deviceKeys.publicKey),
    pairingInfo?.clientId || 'cli',
    pairingInfo?.clientMode || 'cli',
    'operator',
    'operator.read,operator.write',
    String(timestamp),
    pairingInfo?.token || '',
    nonce,
    process.platform,
    'node'
  ].join('|');

  log(`[认证] Payload: ${payload.substring(0, 50)}...`);

  // 签名
  const privateKeyDer = Buffer.from(deviceKeys.privateKey, 'base64');
  const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const signature = crypto.sign(null, Buffer.from(payload), privateKey);
  const signatureB64 = base64UrlEncode(signature);

  log(`[认证] 发送认证请求...`);

  ws.send(JSON.stringify({
    type: 'req',
    id: generateId(),
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: pairingInfo?.clientId || 'cli',
        version: '1.0.0',
        platform: process.platform,
        mode: pairingInfo?.clientMode || 'cli'
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      caps: [],
      commands: [],
      permissions: {},
      auth: pairingInfo?.token ? { token: pairingInfo.token } : {},
      device: {
        id: pairingInfo?.deviceId || extractDeviceIdFromPublicKey(deviceKeys.publicKey),
        publicKey: deviceKeys.publicKey,
        signature: signatureB64,
        signedAt: timestamp,
        nonce: nonce
      }
    }
  }));
}

// 从公钥提取设备ID
function extractDeviceIdFromPublicKey(publicKeyBase64) {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(publicKeyBase64, 'base64'));
  return hash.digest('hex').substring(0, 32);
}

// ============== 主流程 ==============

async function main() {
  console.log('========== 桥接程序 - 扫码配对版 ==========\n');

  // 1. 检查是否有已有密钥
  let deviceKeys = loadKeyPair();
  if (!deviceKeys) {
    log('[启动] 生成新的 Ed25519 密钥对...');
    deviceKeys = generateKeyPair();
    saveKeyPair(deviceKeys);
    log('[启动] 新密钥对已生成');
  } else {
    log('[启动] 使用已保存的密钥对');
  }

  // 2. 检查是否有已有 token
  const existingToken = loadDeviceToken();
  if (existingToken?.deviceToken) {
    log('[启动] 发现已保存的 token');
    log(`[启动] Token: ${existingToken.deviceToken.substring(0, 20)}...`);

    // 尝试用现有 token 连接
    try {
      const result = await connectAndPair({
        token: existingToken.deviceToken,
        deviceId: existingToken.deviceId
      });
      console.log('\n🎉 用现有 token 连接成功！');
      console.log(`设备ID: ${result.deviceId}`);
      return;
    } catch (e) {
      log(`[启动] 用现有 token 连接失败: ${e.message}`);
      log('[启动] 将尝试重新配对...');
    }
  }

  // 3. 获取配对信息
  log('[启动] 尝试获取配对信息...');

  // 尝试不同的 API 端点
  const pairingEndpoints = [
    `${GATEWAY_URL}/api/pairing/generate`,
    `${GATEWAY_URL}/api/device/pair`,
    `${GATEWAY_URL}/pairing`
  ];

  let pairingInfo = null;
  for (const endpoint of pairingEndpoints) {
    try {
      log(`[配对] 尝试: ${endpoint}`);
      const response = await httpPost(endpoint, {
        type: 'device',
        clientId: 'cli'
      });
      if (response.status === 200) {
        pairingInfo = response.data;
        log(`[配对] 成功获取配对信息`);
        break;
      }
    } catch (e) {
      log(`[配对] ${endpoint} 失败: ${e.message}`);
    }
  }

  if (!pairingInfo) {
    log('[配对] 无法获取配对信息');
    log('[提示] 请在 Gateway 控制面板生成配对码或二维码');
    log('[提示] 或者手动复制配对 URL']);

    // 作为后备，尝试直接连接（不保证成功）
    try {
      log('[后备] 尝试直接连接（无配对）...');
      await connectAndPair(null);
      console.log('\n🎉 连接成功！');
    } catch (e) {
      console.log(`\n❌ 连接失败: ${e.message}`);
      console.log('\n建议：');
      console.log('1. 在浏览器打开 Gateway 控制面板');
      console.log('2. 找到"添加设备"或"配对"选项');
      console.log('3. 获取配对码或二维码');
      console.log('4. 将配对信息填入本程序');
    }
    return;
  }

  console.log('\n配对信息:', JSON.stringify(pairingInfo, null, 2).substring(0, 200));

  // 4. 用配对信息连接并认证
  try {
    const result = await connectAndPair(pairingInfo);
    console.log('\n🎉🎉🎉 配对成功！');
    console.log(`设备Token: ${result.deviceToken?.substring(0, 20)}...`);
    console.log(`设备ID: ${result.deviceId}`);
    saveDeviceToken(result);
  } catch (e) {
    console.log(`\n❌ 配对失败: ${e.message}`);
    console.log('\n可能的原因：');
    console.log('1. 配对信息已过期');
    console.log('2. 配对信息已被使用');
    console.log('3. 需要在 Gateway 控制面板批准');
  }
}

main().catch(e => {
  console.error(`程序错误: ${e.message}`);
  process.exit(1);
});
