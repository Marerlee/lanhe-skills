/**
 * 中继服务器 (Relay Server)
 * 功能：ESP32模拟端 <-> 桥接程序模拟端 之间的消息转发
 */

const WebSocket = require('ws');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

// 存储连接的客户端
// tag: 'esp32' 或 'bridge'
const clients = {
  esp32: null,
  bridge: null
};

console.log(`🚀 中继服务器启动，监听端口 ${PORT}`);

wss.on('connection', (ws, req) => {
  const clientId = Math.random().toString(36).substring(7);
  let tag = null;

  // 等待客户端发送身份标识
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // 第一次连接时注册身份
      if (data.type === 'register') {
        if (data.tag === 'esp32' || data.tag === 'bridge') {
          tag = data.tag;
          clients[tag] = ws;
          console.log(`✅ 客户端注册: ${tag} (id: ${clientId})`);

          ws.send(JSON.stringify({
            type: 'registered',
            tag: tag
          }));
        }
        return;
      }

      // 常规消息转发
      if (data.type === 'message' && data.to && tag) {
        const target = clients[data.to];
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({
            type: 'message',
            from: tag,
            content: data.content,
            timestamp: Date.now()
          }));
          console.log(`📨 [${tag}] -> [${data.to}]: ${data.content.substring(0, 50)}...`);
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: `目标 ${data.to} 未连接`
          }));
        }
      }
    } catch (e) {
      // 可能是普通文本消息
      console.log(`📨 收到文本消息: ${message.toString().substring(0, 50)}`);
    }
  });

  ws.on('close', () => {
    if (tag) {
      clients[tag] = null;
      console.log(`❌ 客户端断开: ${tag}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`⚠️ WebSocket错误: ${err.message}`);
  });
});

console.log(`📡 等待客户端连接...`);
