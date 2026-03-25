/**
 * 桥接程序 - 自动配对版本
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const GATEWAY_URL = 'ws://127.0.0.1:18789';
const PAIRED_FILE = 'C:/Users/doris/.openclaw/devices/paired.json';
const IDENTITY_DIR = 'C:/Users/doris/.openclaw/identity';
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'device.json');
const GATEWAY_TOKEN = '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';

// ========== 工具函数 ==========
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

// ========== 密钥和身份管理 ==========
function generateIdentity() {
  log('🔑 生成 Ed25519 密钥对...');
  
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  // 从 SPKI PEM 提取 raw 32-byte 公钥
  const spkiDer = Buffer.from(
    publicKey.replace('-----BEGIN PUBLIC KEY-----', '')
             .replace('-----END PUBLIC KEY-----', '')
             .replace(/\s/g, ''),
    'base64'
  );
  const rawPublicKey = spkiDer.slice(12, 44);  // Ed25519 raw key 从 byte 12 开始

  // deviceId = SHA256(raw public key)
  const deviceId = crypto.createHash('sha256').update(rawPublicKey).digest('hex');

  // base64url encode (raw 格式)
  const publicKeyBase64Url = rawPublicKey
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const identity = {
    version: 1,
    deviceId: deviceId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    publicKeyBase64Url: publicKeyBase64Url
  };

  // 保存到文件
  fs.mkdirSync(path.dirname(IDENTITY_FILE), { recursive: true });
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2));
  
  log(`✅ 密钥对已生成`);
  log(`   Device ID: ${deviceId}`);
  
  return identity;
}

function loadOrCreateIdentity() {
  if (fs.existsSync(IDENTITY_FILE)) {
    const identity = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
    log(`📂 已加载身份: ${identity.deviceId.substring(0, 16)}...`);
    return identity;
  }
  return generateIdentity();
}

// ========== 自动配对 ==========
function autoPair(identity) {
  let paired = {};
  
  if (fs.existsSync(PAIRED_FILE)) {
    paired = JSON.parse(fs.readFileSync(PAIRED_FILE, 'utf8'));
  }

  // 检查是否已配对
  if (paired[identity.deviceId]) {
    log(`📋 设备已在 paired.json 中`);
    return true;
  }

  log(`📝 注册新设备到 paired.json...`);
  
  const now = Date.now();
  paired[identity.deviceId] = {
    deviceId: identity.deviceId,
    publicKey: identity.publicKeyBase64Url,  // raw 32-byte base64url
    platform: process.platform,
    clientId: 'gateway-client',
    clientMode: 'backend',
    role: 'operator',
    roles: ['operator'],
    scopes: ['operator.read', 'operator.admin', 'operator.write', 'operator.approvals', 'operator.pairing'],
    approvedScopes: ['operator.read', 'operator.admin', 'operator.write', 'operator.approvals', 'operator.pairing'],
    tokens: {
      operator: {
        token: 'bridge-token-' + crypto.randomBytes(16).toString('hex'),
        role: 'operator',
        scopes: ['operator.admin', 'operator.approvals', 'operator.pairing', 'operator.read', 'operator.write'],
        createdAtMs: now,
        rotatedAtMs: now
      }
    },
    createdAtMs: now,
    approvedAtMs: now
  };

  fs.writeFileSync(PAIRED_FILE, JSON.stringify(paired, null, 2));
  log(`✅ 设备已注册到 paired.json`);
  
  return true;
}

// ========== v3 签名 ==========
function signV3(identity, nonce) {
  const now = Date.now();
  
  const payload = [
    'v3',
    identity.deviceId,
    'gateway-client',
    'backend',
    'operator',
    'operator.admin',
    String(now),
    GATEWAY_TOKEN,
    nonce,
    process.platform,
    ''
  ].join('|');

  const privateKeyObj = crypto.createPrivateKey({
    key: identity.privateKeyPem,
    format: 'pem'
  });

  const signature = crypto.sign(null, Buffer.from(payload), privateKeyObj);
  const sigBase64 = signature
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return {
    id: identity.deviceId,
    publicKey: identity.publicKeyBase64Url,
    signature: sigBase64,
    signedAt: now,
    nonce: nonce
  };
}

// ========== Gateway 连接 ==========
let ws;
let requestId = 1;

function generateId() {
  return String(requestId++);
}

async function connectGateway(identity) {
  return new Promise((resolve, reject) => {
    log('🔌 连接 Gateway...');
    ws = new WebSocket(GATEWAY_URL);

    ws.on('open', () => log('✅ WebSocket 连接成功'));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      // 连接挑战
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        const nonce = msg.payload.nonce;
        log('🔐 收到连接挑战，发送认证...');
        
        const deviceInfo = signV3(identity, nonce);

        ws.send(JSON.stringify({
          type: 'req',
          id: generateId(),
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'gateway-client',
              displayName: 'Auto-Bridge',
              version: '1.0.0',
              platform: process.platform,
              mode: 'backend'
            },
            role: 'operator',
            scopes: ['operator.admin'],
            auth: {
              token: GATEWAY_TOKEN
            },
            device: deviceInfo
          }
        }));
      }

      // 认证成功
      if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
        log('🎉 Gateway 认证成功！');
        resolve();
      }

      // 错误处理
      if (msg.type === 'res' && !msg.ok && msg.error) {
        log(`❌ 响应错误: ${msg.error.message}`);
        ws.close();
        reject(new Error(msg.error.message));
      }
    });

    ws.on('error', (e) => {
      log(`❌ WebSocket 错误: ${e.message}`);
      reject(e);
    });

    ws.on('close', () => log('🔌 连接关闭'));

    // 15秒超时
    setTimeout(() => {
      log('⏰ 连接超时');
      ws.close();
      reject(new Error('连接超时'));
    }, 15000);
  });
}

// ========== 发送消息 ==========
function sendMessage(text) {
  return new Promise((resolve, reject) => {
    const id = 'chat-1';
    log(`📤 发送: "${text}"`);

    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      
      if (msg.type === 'res' && msg.id === id) {
        ws.off('message', handler);
        if (msg.ok) {
          log('✅ 消息发送成功');
          resolve(msg.payload);
        } else {
          log(`❌ 发送失败: ${msg.error?.message}`);
          reject(new Error(msg.error?.message));
        }
      }
    };

    ws.on('message', handler);

    ws.send(JSON.stringify({
      type: 'req',
      id: id,
      method: 'chat.send',
      params: {
        sessionKey: 'main',
        message: text,
        idempotencyKey: 'bridge-' + Date.now()
      }
    }));
  });
}

// ========== 监听回复 ==========
function listenForReplies() {
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'event' && msg.event === 'chat') {
      const content = msg.payload.message?.content;
      if (content) {
        const text = content[0]?.text || '';
        log(`\n🤖 AI 回复:\n${text}\n`);
      }
    }
  });
}

// ========== 主流程 ==========
async function main() {
  try {
    log('========== 桥接程序启动 ==========');
    
    // 1. 加载或创建身份
    const identity = loadOrCreateIdentity();
    
    // 2. 自动配对
    autoPair(identity);
    
    // 3. 等待 Gateway 加载配对信息（重要！）
    log('⏳ 等待 Gateway 加载配对信息 (2秒)...');
    await sleep(2000);
    
    // 4. 连接 Gateway
    await connectGateway(identity);
    
    // 5. 开始监听回复
    listenForReplies();
    
    // 6. 发送测试消息
    await sendMessage('你好，你叫什么名字？');
    
    // 7. 保持连接监听
    log('📡 监听消息中...');
    
  } catch (e) {
    log(`❌ 错误: ${e.message}`);
    process.exit(1);
  }
}

main();
