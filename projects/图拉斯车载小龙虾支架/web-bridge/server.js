/**
 * Web Bridge 界面服务
 * 提供 HTTP 界面，与 Gateway WebSocket 桥接
 * 
 * 运行: node server.js
 * 然后浏览器打开 http://localhost:18790
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ========== 配置 ==========
const GATEWAY_URL = process.env.GATEWAY_URL || 'ws://127.0.0.1:18789';
const HTTP_PORT = 18790;
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
const PAIRED_FILE = process.env.PAIRED_FILE || path.join(OPENCLAW_HOME, 'devices', 'paired.json');
const IDENTITY_DIR = process.env.IDENTITY_DIR || path.join(OPENCLAW_HOME, 'identity');
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'device.json');
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';
const SESSION_FILE = path.join(__dirname, 'web-bridge-session.json');

// ========== 工具函数 ==========
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg) {
  const time = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`[${time}] ${msg}`);
}

// ========== 密钥和身份管理 ==========
function loadOrCreateIdentity() {
  if (fs.existsSync(IDENTITY_FILE)) {
    const identity = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
    log(`📂 已加载身份: ${identity.deviceId.substring(0, 16)}...`);
    return identity;
  }
  
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
  log(`✅ 密钥对已生成，Device ID: ${deviceId}`);
  return identity;
}

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

function signV3(identity, nonce) {
  const now = Date.now();
  const payload = [
    'v3', identity.deviceId, 'gateway-client', 'backend', 'operator', 'operator.admin',
    String(now), GATEWAY_TOKEN, nonce, process.platform, ''
  ].join('|');
  const privateKeyObj = crypto.createPrivateKey({ key: identity.privateKeyPem, format: 'pem' });
  const signature = crypto.sign(null, Buffer.from(payload), privateKeyObj);
  return {
    id: identity.deviceId,
    publicKey: identity.publicKeyBase64Url,
    signature: signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    signedAt: now,
    nonce: nonce
  };
}

// ========== Gateway 连接 ==========
let ws = null;
let requestId = 1;
let authenticated = false;
let pendingCallbacks = {};

function generateId() {
  return String(requestId++);
}

function sendRaw(data) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('未连接'));
      return;
    }
    const id = data.id || generateId();
    data.id = id;
    
    pendingCallbacks[id] = { resolve, reject, timeout: setTimeout(() => {
      delete pendingCallbacks[id];
      reject(new Error('请求超时'));
    }, 15000) };

    ws.send(JSON.stringify(data));

    if (data.type === 'req' && !data.id.startsWith('sub-')) {
      // 等待响应
    } else {
      resolve();
    }
  });
}

async function connectGateway(identity) {
  return new Promise((resolve, reject) => {
    log('🔌 连接 Gateway...');
    ws = new WebSocket(GATEWAY_URL);

    ws.on('open', () => log('✅ WebSocket 连接成功'));

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      // 处理连接挑战
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        const nonce = msg.payload.nonce;
        log('🔐 收到连接挑战，发送认证...');
        const deviceInfo = signV3(identity, nonce);
        ws.send(JSON.stringify({
          type: 'req', id: 'auth-1', method: 'connect',
          params: {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'gateway-client', displayName: 'Web-Bridge', version: '1.0.0', platform: process.platform, mode: 'backend' },
            role: 'operator', scopes: ['operator.admin'],
            auth: { token: GATEWAY_TOKEN },
            device: deviceInfo
          }
        }));
      }

      // 认证成功
      if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
        log('🎉 Gateway 认证成功！');
        authenticated = true;
        resolve();
      }

      // 订阅响应
      if (msg.type === 'res' && msg.id && pendingCallbacks[msg.id]) {
        clearTimeout(pendingCallbacks[msg.id].timeout);
        pendingCallbacks[msg.id].resolve(msg);
        delete pendingCallbacks[msg.id];
      }

      // chat 事件（AI 回复）- 只在 final 状态广播，避免 delta + final 重复
      if (msg.type === 'event' && msg.event === 'chat') {
        if (msg.payload.state !== 'final') return;
        const content = msg.payload.message?.content;
        if (content) {
          const text = Array.isArray(content) ? content.map(c => c.text || '').join('') : content;
          if (text) {
            log(`📨 AI 回复: ${text}`);
            broadcast({ type: 'reply', text });
          }
        }
      }
    });

    ws.on('error', (e) => {
      log(`❌ WebSocket 错误: ${e.message}`);
      reject(e);
    });

    ws.on('close', () => {
      log('🔌 连接关闭');
      authenticated = false;
    });

    setTimeout(() => {
      if (!authenticated) {
        log('⏰ 连接超时');
        ws.close();
        reject(new Error('连接超时'));
      }
    }, 15000);
  });
}

// ========== HTTP 服务器 ==========
let clients = [];

function broadcast(data) {
  const json = JSON.stringify(data);
  clients.forEach(client => {
    try { client.write(`data: ${json}\n\n`); } catch (e) {}
  });
}

async function sendMessage(text, sessionKey) {
  const id = generateId();
  return new Promise((resolve, reject) => {
    pendingCallbacks[id] = { resolve, reject, timeout: setTimeout(() => {
      delete pendingCallbacks[id];
      reject(new Error('发送超时'));
    }, 15000) };

    ws.send(JSON.stringify({
      type: 'req', id,
      method: 'chat.send',
      params: {
        sessionKey,
        message: text,
        idempotencyKey: 'webbridge-' + Date.now()
      }
    }));
  });
}

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>小龙虾桥接 - 测试界面</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; padding: 20px; }
.container { max-width: 800px; margin: 0 auto; }
h1 { text-align: center; margin-bottom: 20px; color: #e94560; }
.status { text-align: center; margin-bottom: 15px; font-size: 14px; }
.status span { padding: 4px 12px; border-radius: 12px; }
.status .connected { background: #0f9b0f; }
.status .disconnected { background: #e94560; }
.chat-box { background: #16213e; border-radius: 12px; height: 400px; overflow-y: auto; padding: 20px; margin-bottom: 15px; }
.msg { margin-bottom: 12px; padding: 10px 14px; border-radius: 10px; max-width: 80%; }
.msg.user { background: #e94560; color: #fff; margin-left: auto; }
.msg.ai { background: #0f3460; }
.msg.system { background: #333; font-size: 12px; color: #aaa; text-align: center; }
.input-area { display: flex; gap: 10px; }
input { flex: 1; padding: 12px 16px; border: none; border-radius: 8px; background: #16213e; color: #fff; font-size: 16px; }
input:focus { outline: 2px solid #e94560; }
button { padding: 12px 24px; border: none; border-radius: 8px; background: #e94560; color: #fff; font-size: 16px; cursor: pointer; }
button:hover { background: #d63850; }
button:disabled { background: #666; cursor: not-allowed; }
</style>
</head>
<body>
<div class="container">
  <h1>🦞 小龙虾桥接测试</h1>
  <div class="status">状态: <span id="status" class="disconnected">连接中...</span></div>
  <div class="chat-box" id="chatBox"></div>
  <div class="input-area">
    <input type="text" id="input" placeholder="输入消息..." onkeypress="if(event.key==='Enter')send()">
    <button id="sendBtn" onclick="send()">发送</button>
  </div>
</div>
<script>
let sessionKey = '';
function addMsg(text, type) {
  const box = document.getElementById('chatBox');
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
async function send() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg(text, 'user');
  try {
    const res = await fetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sessionKey })
    });
    const data = await res.json();
    if (data.sessionKey) sessionKey = data.sessionKey;
  } catch (e) { addMsg('发送失败: ' + e.message, 'system'); }
}
const evtSource = new EventSource('/events');
evtSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'connected') {
    document.getElementById('status').textContent = '已连接';
    document.getElementById('status').className = 'connected';
    addMsg('系统已连接，可以开始聊天了~', 'system');
  }
  if (data.type === 'reply') {
    addMsg(data.text, 'ai');
  }
};
evtSource.onerror = () => {
  document.getElementById('status').textContent = '断开连接';
  document.getElementById('status').className = 'disconnected';
};
</script>
</body>
</html>`;

// ========== Session 持久化 ==========
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

async function main() {
  // 1. 加载身份并配对
  const identity = loadOrCreateIdentity();
  autoPair(identity);

  // 2. 连接 Gateway
  await connectGateway(identity);

  // 3. 加载或创建 Session
  const savedSession = loadSession();
  let bridgeSessionKey;
  if (savedSession) {
    bridgeSessionKey = savedSession.sessionKey;
    log(`♻️ 复用已存在的 Session: ${bridgeSessionKey}`);
  } else {
    bridgeSessionKey = `bridge:${identity.deviceId.substring(0, 8)}:${Date.now()}`;
    saveSession({ sessionKey: bridgeSessionKey, deviceId: identity.deviceId, createdAt: Date.now() });
    log(`🆕 创建新 Session: ${bridgeSessionKey}`);
  }

  // 4. 订阅 session
  await sendRaw({
    type: 'req', id: 'sub-1', method: 'sessions.subscribe',
    params: { key: bridgeSessionKey }
  });
  log(`📡 Session: ${bridgeSessionKey}`);

  // 5. HTTP 服务器
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
    } else if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      clients.push(res);
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      req.on('close', () => {
        clients = clients.filter(c => c !== res);
      });
    } else if (req.url === '/send' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { text } = JSON.parse(body);
          broadcast({ type: 'system', text: `发送: ${text}` });
          await sendMessage(text, bridgeSessionKey);
          res.end(JSON.stringify({ ok: true, sessionKey: bridgeSessionKey }));
        } catch (e) {
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(HTTP_PORT, '0.0.0.0', () => {
    log(`🌐 界面已启动: http://localhost:${HTTP_PORT}`);
    log(`📝 Session Key: ${bridgeSessionKey}`);
  });
}

main().catch(e => {
  log(`❌ 错误: ${e.message}`);
  process.exit(1);
});
