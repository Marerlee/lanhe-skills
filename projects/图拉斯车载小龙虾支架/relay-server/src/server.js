/**
 * 中继服务器主入口
 *
 * P8设计要点：
 * 1. 分层架构 - 网络层/协议层/业务层分离
 * 2. 配置中心 - 所有配置可外部化
 * 3. 可观测性 - 完整的日志、指标、健康检查
 * 4. 优雅关闭 - 处理中的请求完成后再退出
 */

const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

// 导入配置
const config = require('../config/default.json');

// 导入组件
const { createLogger } = require('./utils/Logger');
const { Authenticator, AuthContext } = require('./auth');
const DeviceManager = require('./device/Manager');
const SessionManager = require('./session/Manager');
const MessageRouter = require('./router/MessageRouter');
const {
  compose,
  createContext,
  requestLogger,
  errorHandler,
  heartbeat,
  messageSizeLimit
} = require('./middleware');

// 创建主logger
const logger = createLogger('RelayServer', config.logging);

/**
 * 中继服务器
 */
class RelayServer {
  constructor(cfg = {}) {
    this.config = { ...config, ...cfg };

    // 初始化组件
    this.authenticator = new Authenticator(this.config.auth);
    this.deviceManager = new DeviceManager(this.config.device);
    this.sessionManager = new SessionManager(this.config.session);
    this.messageRouter = new MessageRouter({
      sessionManager: this.sessionManager,
      deviceManager: this.deviceManager,
      authenticator: this.authenticator
    });

    // HTTP服务器（用于健康检查和指标）
    this.httpServer = null;
    this.wss = null;

    // 状态
    this.isRunning = false;
    this.isShuttingDown = false;
    this.connections = new Map();

    // 统计
    this.startTime = Date.now();
  }

  /**
   * 启动服务器
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Server already running');
      return;
    }

    const { host, port, path: wsPath, maxConnections, pingInterval, pingTimeout } = this.config.server;

    // 创建HTTP服务器（健康检查 + 指标）
    this.httpServer = http.createServer(this._handleHttpRequest.bind(this));
    this.httpServer.listen(port, host, () => {
      logger.info('HTTP server started', { host, port });
    });

    // 创建WebSocket服务器
    this.wss = new WebSocket.Server({
      server: this.httpServer,
      path: wsPath,
      maxPayload: this.config.server.maxPayload || 1024 * 1024
    });

    // WebSocket事件处理
    this.wss.on('connection', this._handleConnection.bind(this));
    this.wss.on('error', this._handleWsError.bind(this));

    // 开始心跳
    this._startHeartbeat(pingInterval, pingTimeout);

    // 注册设备管理事件
    this._setupEventHandlers();

    this.isRunning = true;
    logger.info('Relay server started', {
      host,
      port,
      wsPath,
      maxConnections
    });
  }

  /**
   * 停止服务器
   */
  async stop() {
    if (!this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('Shutting down...');

    // 停止接受新连接
    if (this.wss) {
      this.wss.close();
    }

    // 关闭现有连接
    for (const [connectionId, ctx] of this.connections) {
      try {
        ctx.ws.close(1001, 'Server shutting down');
      } catch (e) {
        logger.warn('Error closing connection', { connectionId, error: e.message });
      }
    }

    // 等待一段时间让连接关闭
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 关闭HTTP服务器
    if (this.httpServer) {
      await new Promise(resolve => {
        this.httpServer.close(resolve);
      });
    }

    // 关闭组件
    this.authenticator.shutdown();
    this.deviceManager.shutdown();
    this.sessionManager.shutdown();

    this.isRunning = false;
    this.isShuttingDown = false;
    logger.info('Server stopped');
  }

  /**
   * HTTP请求处理（健康检查、指标）
   * @private
   */
  _handleHttpRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // 健康检查
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        uptime: Date.now() - this.startTime,
        connections: this.connections.size
      }));
      return;
    }

    // 指标
    if (url.pathname === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        server: {
          uptime: Date.now() - this.startTime,
          connections: this.connections.size,
          isShuttingDown: this.isShuttingDown
        },
        auth: this.authenticator.getStatus(),
        device: this.deviceManager.getStats(),
        session: this.sessionManager.getStats(),
        router: this.messageRouter.getStats()
      }));
      return;
    }

    // 根路径
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('小龙虾车载支架中继服务器\n\nEndpoints:\n- GET /health - Health check\n- GET /metrics - Metrics');
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * WebSocket连接处理
   * @private
   */
  _handleConnection(ws, req) {
    const connectionId = this._generateConnectionId();
    const remoteIp = this._getClientIp(req);
    const url = new URL(req.url, `http://${req.headers.host}`);

    logger.info('New connection', { connectionId, remoteIp, path: url.pathname });

    // 创建上下文
    const ctx = createContext(ws, {
      connectionId,
      remoteIp,
      connectedAt: Date.now()
    });

    // 存储连接
    this.connections.set(connectionId, ctx);

    // 添加待认证连接
    this.deviceManager.addPendingConnection(connectionId, ws, remoteIp);

    // 消息处理链
    const handleMessage = compose(
      requestLogger(),
      errorHandler(),
      messageSizeLimit(1024 * 1024),
      heartbeat(this.config.server.pingInterval, this.config.server.pingTimeout),
      (c, next) => this._processMessage(c, next)
    );

    // WebSocket事件
    ws.on('message', (data) => {
      ctx.data.raw = data;
      handleMessage(ctx).catch((e) => {
        logger.error('Message handling failed', { error: e.message, connectionId });
      });
    });

    ws.on('close', (code, reason) => {
      logger.info('Connection closed', {
        connectionId,
        code,
        reason: reason.toString()
      });
      this._cleanupConnection(connectionId);
    });

    ws.on('error', (e) => {
      logger.error('WebSocket error', { connectionId, error: e.message });
      this._cleanupConnection(connectionId);
    });

    // 发送连接成功消息
    ws.send(JSON.stringify({
      type: 'connected',
      connectionId,
      serverTime: Date.now()
    }));
  }

  /**
   * 处理消息
   * @private
   */
  async _processMessage(ctx, next) {
    const { ws, data: { raw }, connectionId } = ctx;

    // 解析消息
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (e) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_JSON',
        message: 'Failed to parse JSON'
      }));
      return;
    }

    // 更新心跳
    this.deviceManager.updateHeartbeat(connectionId);

    // 处理不同类型的消息
    switch (message.type) {
      case 'register':
        await this._handleRegister(ctx, message);
        break;

      case 'auth':
        await this._handleAuth(ctx, message);
        break;

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;

      case 'message':
        await this._handleAppMessage(ctx, message);
        break;

      case 'subscribe':
        await this._handleSubscribe(ctx, message);
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unknown message type: ${message.type}`
        }));
    }
  }

  /**
   * 处理注册消息
   * @private
   */
  async _handleRegister(ctx, message) {
    const { ws, connectionId, remoteIp } = ctx;
    const { deviceId, type, metadata } = message;

    // 注册设备
    const result = this.deviceManager.registerDevice(connectionId, {
      deviceId,
      type,
      bridgeId: metadata?.bridgeId,
      metadata
    });

    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'register_error',
        code: result.reason,
        message: result.detail
      }));
      return;
    }

    // 创建会话
    if (type === 'device') {
      this.sessionManager.getOrCreateDeviceSession(deviceId, metadata?.bridgeId);
    } else if (type === 'bridge') {
      this.sessionManager.getOrCreateBridgeSession(deviceId);
    }

    ws.send(JSON.stringify({
      type: 'registered',
      deviceId,
      connectionId,
      serverTime: Date.now()
    }));

    logger.info('Device registered', { deviceId, type, connectionId });
  }

  /**
   * 处理认证消息
   * @private
   */
  async _handleAuth(ctx, message) {
    const { ws, connectionId } = ctx;
    const { authType, ...authParams } = message;

    let result;
    const authCtx = new AuthContext(connectionId, ctx.remoteIp);

    switch (authType) {
      case 'device':
        result = this.authenticator.authenticateDevice(authParams, authCtx);
        break;
      case 'bridge':
        result = this.authenticator.authenticateBridge(authParams, authCtx);
        break;
      default:
        ws.send(JSON.stringify({
          type: 'auth_error',
          code: 'INVALID_AUTH_TYPE'
        }));
        return;
    }

    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'auth_error',
        code: result.error?.code,
        message: result.error?.detail
      }));
      return;
    }

    // 完成认证
    this.deviceManager.completeAuth(connectionId, result.data);
    ctx.auth = result.data;

    ws.send(JSON.stringify({
      type: 'auth_ok',
      ...result.data
    }));

    logger.info('Authentication successful', { connectionId, authType });
  }

  /**
   * 处理应用消息
   * @private
   */
  async _handleAppMessage(ctx, message) {
    const { ws, connectionId, auth } = ctx;

    if (!auth) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'NOT_AUTHENTICATED'
      }));
      return;
    }

    // 路由消息
    const result = await this.messageRouter.route(
      {
        ...message,
        from: auth.sub || auth.deviceId || auth.bridgeId
      },
      ctx
    );

    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'message_error',
        code: result.error?.code,
        messageId: result.messageId
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'message_ack',
        messageId: result.messageId
      }));
    }
  }

  /**
   * 处理订阅消息
   * @private
   */
  async _handleSubscribe(ctx, message) {
    const { ws, connectionId, auth } = ctx;
    const { topics } = message;

    // 订阅逻辑（简化版）
    ws.send(JSON.stringify({
      type: 'subscribed',
      topics
    }));
  }

  /**
   * WebSocket错误处理
   * @private
   */
  _handleWsError(e) {
    logger.error('WebSocket server error', { error: e.message });
  }

  /**
   * 清理连接
   * @private
   */
  _cleanupConnection(connectionId) {
    const ctx = this.connections.get(connectionId);
    if (ctx?.auth) {
      this.sessionManager.deviceSessions.delete(ctx.auth.deviceId);
      this.sessionManager.bridgeSessions.delete(ctx.auth.bridgeId);
    }
    this.deviceManager.removeConnection(connectionId, 'cleanup');
    this.connections.delete(connectionId);
  }

  /**
   * 设置事件处理
   * @private
   */
  _setupEventHandlers() {
    // 设备断开时清理会话
    this.deviceManager.on('device.disconnected', ({ deviceId }) => {
      logger.info('Device session cleaned up', { deviceId });
    });

    // 消息路由事件
    this.messageRouter.on('cloud.message', ({ from, message }) => {
      // 转发到OpenClaw Gateway
      logger.debug('Cloud message received', { from, messageId: message.id });
    });
  }

  /**
   * 启动心跳
   * @private
   */
  _startHeartbeat(interval, timeout) {
    setInterval(() => {
      if (this.isShuttingDown) return;

      for (const [connectionId, ctx] of this.connections) {
        if (ctx.ws.readyState === WebSocket.OPEN) {
          try {
            ctx.ws.ping();
          } catch (e) {
            logger.warn('Ping failed', { connectionId });
          }
        }
      }
    }, interval);
  }

  /**
   * 生成连接ID
   * @private
   */
  _generateConnectionId() {
    return `conn_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * 获取客户端IP
   * @private
   */
  _getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * 获取服务器状态
   */
  getStatus() {
    return {
      running: this.isRunning,
      shuttingDown: this.isShuttingDown,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      connections: this.connections.size,
      config: {
        host: this.config.server.host,
        port: this.config.server.port,
        wsPath: this.config.server.path
      }
    };
  }
}

// ========== 启动服务器 ==========

// 创建并启动服务器
const server = new RelayServer();

process.on('SIGINT', async () => {
  logger.info('Received SIGINT');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM');
  await server.stop();
  process.exit(0);
});

// 捕获未处理错误
process.on('uncaughtException', (e) => {
  logger.error('Uncaught exception', { error: e.message, stack: e.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

// 启动
server.start().catch((e) => {
  logger.error('Failed to start server', { error: e.message });
  process.exit(1);
});

module.exports = RelayServer;
