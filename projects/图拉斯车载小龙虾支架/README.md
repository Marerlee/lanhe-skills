# 图拉斯车载小龙虾支架

车载4G语音助手，让AI助手触手可及。

## 项目结构

```
├── docs/              # 产品方案、成本核算等文档
├── bridge/            # 桥接程序（运行在用户手机/电脑上）
├── relay-server/      # 中继服务器（部署在云端）
├── firmware/          # 设备端固件
│   └── simulator/     # 模拟器（开发调试用）
└── archive/           # 归档（历史版本、废弃代码）
```

## 模块说明

| 模块 | 说明 | 状态 |
|------|------|------|
| docs/ | 产品方案文档 | ✅ 完成 |
| bridge/ | 桥接程序，连接设备与OpenClaw Gateway | 🔨 开发中 |
| relay-server/ | 中继服务器，处理设备认证和消息路由 | 🔨 开发中 |
| firmware/ | ESP32设备端固件 | 📋 规划中 |

## 开发

```bash
# 启动桥接程序
cd bridge && npm install && npm start

# 启动中继服务器
cd relay-server && npm install && npm start
```
