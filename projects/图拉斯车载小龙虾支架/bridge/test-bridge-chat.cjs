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
  const sk = crypto.createPrivateKey({ key: identity.privateKeyPem, format: 'pem' });
  const sig = crypto.sign(null, Buffer.from(payload), sk);
  return {
    id: identity.deviceId,
    publicKey: identity.publicKeyBase64Url,
    signature: sig.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    signedAt: now,
    nonce
  };
}

const ws = new WebSocket(GATEWAY_URL);
let authed = false;
const bridgeSession = 'bridge:testbr:' + Date.now();

ws.on('open', () => console.log('[CONNECTED]'));

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'event' && msg.event === 'session.tool') return;
  
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    ws.send(JSON.stringify({
      type: 'req', id: 'a1', method: 'connect', params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'gateway-client', displayName: 'TestBridge', version: '1.0.0', platform: process.platform, mode: 'backend' },
        role: 'operator', scopes: ['operator.admin'],
        auth: { token: GATEWAY_TOKEN },
        device: signV3(msg.payload.nonce)
      }
    }));
    return;
  }
  
  if (msg.type === 'res' && msg.payload?.type === 'hello-ok' && !authed) {
    authed = true;
    console.log('[AUTH OK] Session:', bridgeSession);
    ws.send(JSON.stringify({ type: 'req', id: 's1', method: 'sessions.subscribe', params: { key: bridgeSession } }));
    setTimeout(() => {
      console.log('[SEND] Sending message...');
      ws.send(JSON.stringify({
        type: 'req', id: 'c1', method: 'chat.send',
        params: { sessionKey: bridgeSession, message: 'say hello in 3 words', idempotencyKey: 'x' + Date.now() }
      }));
    }, 800);
    return;
  }
  
  if (msg.type === 'res' && msg.id === 's1') {
    console.log('[SUB]', JSON.stringify(msg));
    return;
  }
  
  if (msg.type === 'res' && msg.id === 'c1') {
    console.log('[CHAT RES]', JSON.stringify(msg.payload));
    return;
  }
  
  if (msg.type === 'event' && msg.event === 'chat') {
    console.log('[CHAT]', JSON.stringify(msg.payload, null, 2));
    return;
  }
  
  if (msg.type === 'event') {
    console.log('[EVT]', msg.event, JSON.stringify(msg.payload).slice(0, 100));
  }
});

ws.on('error', (e) => console.log('[ERR]', e.message));
ws.on('close', () => { console.log('[CLOSE]'); process.exit(0); });
setTimeout(() => { console.log('[DONE]'); ws.close(); process.exit(0); }, 12000);
