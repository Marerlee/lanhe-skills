# 中继服务器

小龙虾车载支架的云端中继服务，负责设备认证和消息路由。

## 模块结构

```
src/
├── server.js              # WebSocket服务器主入口
├── auth/                  # 认证模块
│   ├── index.js          # 认证器主入口
│   ├── NonceManager.js   # Nonce防重放管理
│   ├── TokenManager.js   # Token生成与验证
│   ├── SignatureVerifier.js # Ed25519签名验证
│   └── RateLimiter.js    # 限流器
├── device/               # 设备管理
│   └── Manager.js        # 设备连接管理
├── session/              # 会话管理
│   └── Manager.js        # 消息队列与会话
├── router/               # 消息路由
│   └── MessageRouter.js  # 消息路由分发
├── middleware/           # 中间件
│   └── index.js          # 责任链中间件
└── utils/
    └── Logger.js         # 日志工具
```

## 认证流程

### 设备注册流程

```
1. 设备连接 WebSocket
2. 发送 { type: 'register', deviceId, type, metadata }
3. 服务器返回 { type: 'registered', deviceId }
```

### 设备认证流程

```
1. 设备发送 { type: 'auth', authType: 'device', deviceId, signature, timestamp, nonce }
2. 服务器验证签名
3. 服务器返回 { type: 'auth_ok', tokens: { accessToken, refreshToken } }
```

### 消息发送

```
1. 认证后的设备发送 { type: 'message', to, payload, idempotencyKey }
2. 服务器路由到目标
3. 服务器返回 { type: 'message_ack', messageId }
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/:path` | WebSocket | WebSocket连接（默认 `/relay`）|
| `/health` | GET | 健康检查 |
| `/metrics` | GET | 服务指标 |

## 配置

配置文件：`config/default.json`

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
    "path": "/relay"
  },
  "auth": {
    "nonceMaxAge": 300000,
    "tokenMaxAge": 86400000
  },
  "rateLimit": {
    "enabled": true,
    "windowMs": 60000,
    "maxRequests": 100
  }
}
```

## 运行

```bash
cd relay-server
npm install
npm start
```

## 待开发

- [ ] OpenClaw Gateway 对接
- [ ] STT/TTS 服务对接
- [ ] 设备固件 OTA 更新
- [ ] 监控告警系统
