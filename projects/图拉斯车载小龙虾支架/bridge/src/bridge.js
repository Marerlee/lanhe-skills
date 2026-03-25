/**
 * 桥接程序 - Session 复用版本
 * 
 * 功能：
 * 1. 自动生成 Ed25519 密钥对
 * 2. 自动注册设备到 paired.json
 * 3. 使用 v3 签名连接 Gateway
 * 4. 首次建立 session，后续复用，不重复创建
 * 
 * 使用方式：
 *   node bridge.js [消息内容]
 * 
 * Session 持久化：
 *   首次通信会创建 session 并保存到 bridge-session.json
 *   后续运行复用已保存的 session
 *   删除 bridge-session.json 可强制重建 session
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ========== 配置 ==========
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
const PAIRED_FILE = process.env.PAIRED_FILE || path.join(OPENCLAW_HOME, 'devices', 'paired.json');
const IDENTITY_DIR = process.env.IDENTITY_DIR || path.join(OPENCLAW_HOME, 'identity');
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'device.json');
const SESSION_FILE = path.join(__dirname, 'bridge-session.json');
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';

// ========== 工具函数 ==========
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
  const time = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${time}] ${msg}`);
}

// ========== Session 管理 ==========
function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    log(`📂 已加载保存的 Session: ${session.sessionKey}`);
    return session;
  }
  return null;
}

function saveSession(session) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
  log(`💾 Session 已保存: ${session.sessionKey}`);
}

// ========== 密钥和身份管理 ==========
function generateIdentity() {
  log('🔑 生成 Ed25519 密钥对...');
  
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const spkiDer = Buffer.from(
    publicKey.replace('-----BEGIN PUBLIC KEY-----', '')
             .replace('-----END PUBLIC KEY-----', '')
             .replace(/\s/g, ''),
    'base64'
  );
  const rawPublicKey = spkiDer.slice(12, 44);
  const deviceId = crypto.createHash('sha256').update(rawPublicKey).digest('hex');
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

  if (paired[identity.deviceId]) {
    log(`📋 设备已在 paired.json 中`);
    return true;
  }

  log(`📝 注册新设备到 paired.json...`);
  
  const now = Date.now();
  paired[identity.deviceId] = {
    deviceId: identity.deviceId,
    publicKey: identity.publicKeyBase64Url,
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
let authenticated = false;
let gotReply = false;
let pendingRequestId = null;
let currentSessionKey = null;
let subscribed = false;

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
      
      // 认证成功
      if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
        log('🎉 Gateway 认证成功！');
        authenticated = true;
        resolve();
        return;
      }

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
        return;
      }

      // chat 事件（AI 回复）
      if (msg.type === 'event' && msg.event === 'chat') {
        const content = msg.payload.message?.content;
        if (content) {
          const text = Array.isArray(content) ? content.map(c => c.text || '').join('') : content;
          if (text) {
            gotReply = true;
            log(`\n🤖 AI 回复:\n${text}\n`);
          }
        }
        return;
      }

      // run.finished 事件
      if (msg.type === 'event' && msg.event === 'run.finished') {
        log('📡 AI 处理完成');
        return;
      }

      // sessions.subscribe 响应
      if (msg.type === 'res' && msg.id === 'sub-1') {
        if (msg.ok && msg.payload?.subscribed) {
          subscribed = true;
          log('📡 Session 订阅成功');
        } else {
          log(`⚠️ Session 订阅失败或已存在: ${msg.error?.message || 'unknown'}`);
          subscribed = true; // 继续尝试发送
        }
        return;
      }

      // chat.send 响应
      if (msg.type === 'res' && msg.id === pendingRequestId) {
        if (msg.ok) {
          log('✅ 消息发送成功');
        } else {
          log(`❌ 发送失败: ${msg.error?.message}`);
          // 如果是 session 不存在，删除保存的 session 供下次重建
          if (msg.error?.message?.includes('not found') || msg.error?.message?.includes('session')) {
            log('⚠️ Session 已失效，删除保存的 session...');
            if (fs.existsSync(SESSION_FILE)) {
              fs.unlinkSync(SESSION_FILE);
            }
          }
        }
        pendingRequestId = null;
        return;
      }

      // 错误处理
      if (msg.type === 'res' && !msg.ok && msg.id === pendingRequestId) {
        log(`❌ 错误: ${msg.error?.message}`);
        pendingRequestId = null;
      }
    });

    ws.on('error', (e) => {
      log(`❌ WebSocket 错误: ${e.message}`);
      reject(e);
    });

    ws.on('close', () => {
      if (!authenticated) {
        log('🔌 连接关闭（未认证）');
      } else {
        log('🔌 连接关闭');
      }
    });

    // 15秒超时
    setTimeout(() => {
      if (!authenticated) {
        log('⏰ 连接超时');
        ws.close();
        reject(new Error('连接超时'));
      }
    }, 15000);
  });
}

// ========== 发送消息 ==========
function sendMessage(text) {
  return new Promise((resolve, reject) => {
    const id = 'chat-1';
    pendingRequestId = id;
    log(`📤 发送: "${text}"`);
    log(`📝 Session: ${currentSessionKey}`);

    // 超时处理
    const timeout = setTimeout(() => {
      if (pendingRequestId === id) {
        log('⏰ 消息发送超时');
        pendingRequestId = null;
        reject(new Error('发送超时'));
      }
    }, 15000);

    ws.send(JSON.stringify({
      type: 'req',
      id: id,
      method: 'chat.send',
      params: {
        sessionKey: currentSessionKey,
        message: text,
        idempotencyKey: 'bridge-' + Date.now()
      }
    }));
  });
}

// ========== 主流程 ==========
async function main() {
  const args = process.argv.slice(2);
  const message = args.join(' ') || '你好';

  try {
    log('========== 桥接程序启动 ==========');
    
    // 1. 加载或创建身份
    const identity = loadOrCreateIdentity();
    
    // 2. 自动配对
    autoPair(identity);
    
    // 3. 加载已保存的 session
    const savedSession = loadSession();
    
    // 4. 等待 Gateway 加载配对信息
    log('⏳ 等待 Gateway 加载配对信息 (2秒)...');
    await sleep(2000);
    
    // 5. 连接 Gateway
    await connectGateway(identity);
    
    // 6. 确定 session key
    if (savedSession) {
      // 复用已保存的 session
      currentSessionKey = savedSession.sessionKey;
      log(`♻️ 复用已存在的 Session: ${currentSessionKey}`);
    } else {
      // 创建新的 session
      currentSessionKey = `bridge:${identity.deviceId.substring(0, 8)}:${Date.now()}`;
      log(`🆕 创建新 Session: ${currentSessionKey}`);
      
      // 保存 session
      saveSession({
        sessionKey: currentSessionKey,
        deviceId: identity.deviceId,
        createdAt: Date.now()
      });
    }
    
    // 7. 订阅 session
    log('📡 订阅 Session...');
    ws.send(JSON.stringify({
      type: 'req',
      id: 'sub-1',
      method: 'sessions.subscribe',
      params: {
        key: currentSessionKey
      }
    }));
    
    // 等待订阅确认
    await sleep(500);
    
    // 8. 发送消息
    await sendMessage(message);
    
    // 9. 持续监听，直到收到 AI 回复
    log('📡 等待 AI 回复（持续监听模式，按 Ctrl+C 退出）...');
    
    while (!gotReply) {
      await sleep(1000);
    }
    
    log('========== 完成 ==========');
    process.exit(0);
    
  } catch (e) {
    log(`❌ 错误: ${e.message}`);
    process.exit(1);
  }
}

// 导出模块
module.exports = {
  loadOrCreateIdentity,
  autoPair,
  connectGateway,
  signV3
};

// 如果直接运行
if (require.main === module) {
  main();
}
