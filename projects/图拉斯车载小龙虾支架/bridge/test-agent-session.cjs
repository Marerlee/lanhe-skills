const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATEWAY_URL = 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
const IDENTITY_FILE = process.env.IDENTITY_FILE || path.join(OPENCLAW_HOME, 'identity', 'device.json');
const identity = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));

function signV3(nonce) {
  const now = Date.now();
  const payload = ['v3', identity.deviceId, 'gateway-client', 'backend', 'operator', 'operator.admin',
    String(now), GATEWAY_TOKEN, nonce, process.platform, ''].join('|');
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

const ws = new WebSocket(GATEWAY_URL);

ws.on('open', () => console.log('[CONNECTED]'));
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  
  // Skip noisy session.tool events
  if (msg.type === 'event' && msg.event === 'session.tool') return;
  
  console.log(`[MSG] type=${msg.type} event=${msg.event || '-'} id=${msg.id || '-'} => ${JSON.stringify(msg).substring(0, 150)}`);
  
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    ws.send(JSON.stringify({ type: 'req', id: 'auth-1', method: 'connect', params: {
      minProtocol: 3, maxProtocol: 3,
      client: { id: 'gateway-client', displayName: 'TestRoute', version: '1.0.0', platform: process.platform, mode: 'backend' },
      role: 'operator', scopes: ['operator.admin'],
      auth: { token: GATEWAY_TOKEN },
      device: signV3(msg.payload.nonce)
    }}));
  }
  
  if (msg.type === 'res' && msg.payload?.type === 'hello-ok') {
    console.log('[AUTH OK] Subscribing to agent:main:main...');
    ws.send(JSON.stringify({ type: 'req', id: 'sub-1', method: 'sessions.subscribe', params: { key: 'agent:main:main' }}));
    setTimeout(() => {
      console.log('[SEND] Sending to agent:main:main...');
      ws.send(JSON.stringify({ type: 'req', id: 'chat-1', method: 'chat.send', params: {
        sessionKey: 'agent:main:main', message: 'hi',
        idempotencyKey: 'test-' + Date.now()
      }}));
    }, 1000);
  }
});
ws.on('error', (e) => console.log('[ERROR]', e.message));
ws.on('close', () => { console.log('[CLOSED]'); process.exit(0); });
setTimeout(() => { console.log('[TIMEOUT]'); ws.close(); process.exit(0); }, 20000);
