/**
 * 桥接程序 连接 Gateway WebSocket 测试
 * 使用 operator 角色，简化连接流程
 */

const WebSocket = require('ws');

const GATEWAY_URL = 'ws://127.0.0.1:18789';

console.log('🔌 测试连接到 Gateway (operator模式)...\n');
console.log(`目标地址: ${GATEWAY_URL}\n`);

const ws = new WebSocket(GATEWAY_URL);

ws.on('open', () => {
  console.log('✅ WebSocket 连接成功！\n');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📥 收到消息:', JSON.stringify(message, null, 2), '\n');

  // 如果是 connect.challenge，发送 connect 请求
  if (message.type === 'event' && message.event === 'connect.challenge') {
    console.log('✅ 收到 Gateway 挑战，准备发送 connect 请求...\n');

    const connectRequest = {
      type: 'req',
      id: 'test-001',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'cli',
          version: '1.0.0',
          platform: 'test',
          mode: 'cli'
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [],
        commands: [],
        permissions: {},
        auth: { token: '97bca68133308f5af435838828dd2a4aeb33c586dd23fce5' },
        locale: 'zh-CN',
        userAgent: 'bridge-tester/1.0.0'
      }
    };

    ws.send(JSON.stringify(connectRequest));
    console.log('📤 已发送 connect 请求\n');
  }

  // 如果是响应
  if (message.type === 'res' && message.id === 'test-001') {
    console.log('📥 收到响应:', JSON.stringify(message, null, 2), '\n');

    if (message.ok) {
      console.log('🎉🎉🎉 **连接成功！** Gateway 接受了桥接程序的连接！');
      console.log('   payload:', JSON.stringify(message.payload, null, 2));
    } else {
      console.log('❌ 连接被拒绝:', message.error);
    }

    // 关闭连接
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket 错误:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n🔌 连接已关闭');
});

// 超时处理
setTimeout(() => {
  console.log('\n⏰ 测试超时');
  ws.close();
  process.exit(1);
}, 10000);
