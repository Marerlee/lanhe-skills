const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const GATEWAY_URL = 'ws://127.0.0.1:18789';
const GATEWAY_TOKEN = '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5';
const identity = JSON.parse(fs.readFileSync('C:/Users/doris/.openclaw/identity/device.json', 'utf8'));

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
const SESSION = `bridge:test2:${Date.now()}`;

ws.on('open', () => console.log('[CONNECTED]'));

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'event' && msg.event === 'session.tool') return;
  
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    ws.send(JSON.stringify({
      type: 'req', id: 'a1', method: 'connect', params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'gateway-client', displayName: 'FreshTest', version: '1.0.0', platform: process.platform, mode: 'backend' },
        role: 'operator', scopes: ['operator.admin'],
        auth: { token: GATEWAY_TOKEN },
        device: signV3(msg.payload.nonce)
      }
    }));
    return;
  }
  
  if (msg.type === 'res' && msg.payload?.type === 'hello-ok' && !authed) {
    authed = true;
    console.log('[AUTH OK] Creating session:', SESSION);
    ws.send(JSON.stringify({ type: 'req', id: 's1', method: 'sessions.create', params: {
      key: SESSION,
      options: { chatType: 'direct', displayName: 'FreshTest' }
    }}));
    return;
  }
  
  if (msg.type === 'res' && msg.id === 's1') {
    console.log('[SESSION CREATED]', JSON.stringify(msg.payload));
    setTimeout(() => {
      console.log('[SENDING] Message to', SESSION);
      ws.send(JSON.stringify({
        type: 'req', id: 'c1', method: 'chat.send',
        params: { sessionKey: SESSION, message: 'reply with just "ok"', idempotencyKey: 'x' + Date.now() }
      }));
    }, 500);
    return;
  }
  
  if (msg.type === 'res' && msg.id === 'c1') {
    console.log('[CHAT RES]', JSON.stringify(msg.payload).slice(0, 100));
    return;
  }
  
  if (msg.type === 'event' && msg.event === 'chat') {
    const content = msg.payload.message?.content;
    const text = Array.isArray(content) ? content.map(c => c.text || '').join('') : content;
    console.log('[CHAT] state=' + msg.payload.state + ' text=' + text);
    return;
  }
  
  if (msg.type === 'event') {
    console.log('[EVT]', msg.event);
  }
});

ws.on('error', (e) => console.log('[ERR]', e.message));
ws.on('close', () => { console.log('[CLOSE]'); process.exit(0); });
setTimeout(() => { console.log('[DONE]'); ws.close(); process.exit(0); }, 12000);
