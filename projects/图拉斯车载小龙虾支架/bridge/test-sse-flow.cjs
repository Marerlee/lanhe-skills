// 完整测试：发送消息到 web-bridge，检查 SSE 是否收到 AI 回复
const http = require('http');

// 1. 先建立 SSE 连接
const sseReq = http.get('http://localhost:18790/events', (sseRes) => {
  console.log('[SSE] Status:', sseRes.statusCode);
  let sseData = '';
  sseRes.on('data', (chunk) => {
    sseData += chunk.toString();
    // Print each event
    const lines = sseData.split('\n');
    sseData = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        console.log('[SSE]', line.substring(6));
      }
    }
  });
  sseRes.on('end', () => console.log('[SSE] Ended'));
});

// 2. 等待 SSE 连接建立，然后发送消息
setTimeout(() => {
  console.log('[SEND] Posting message...');
  const postReq = http.request('http://localhost:18790/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, (postRes) => {
    let body = '';
    postRes.on('data', c => body += c);
    postRes.on('end', () => console.log('[SEND RES]', body));
  });
  postReq.on('error', (e) => console.log('[SEND ERR]', e.message));
  postReq.write(JSON.stringify({
    text: 'say hello in 2 words',
    sessionKey: 'bridge:65cacbfd:1774357712428'
  }));
  postReq.end();
}, 1000);

// 3. 等待足够长的时间看 AI 回复
setTimeout(() => {
  console.log('[DONE - waiting for any remaining SSE data]');
  setTimeout(() => process.exit(0), 3000);
}, 15000);
