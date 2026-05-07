/**
 * 中间件层
 *
 * P8设计要点：
 * 1. 责任链模式 - 请求经过多个中间件处理
 * 2. 组合模式 - 方便地组合多个中间件
 * 3. 错误传播 - 中间件中的错误正确传播
 */

const { createLogger } = require('../utils/Logger');

const logger = createLogger('Middleware');

/**
 * 包装中间件为责任链
 * @param  {...Function} middlewares
 * @returns {Function}
 */
function compose(...middlewares) {
  return (ctx, next) => {
    let index = -1;

    const dispatch = (i) => {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;

      if (i === middlewares.length) {
        return next ? next(ctx) : Promise.resolve();
      }

      const handler = middlewares[i];
      try {
        const result = handler(ctx, () => dispatch(i + 1));
        return result;
      } catch (e) {
        return Promise.reject(e);
      }
    };

    return dispatch(0);
  };
}

/**
 * 创建上下文对象
 * @param {WebSocket} ws
 * @param {Object} initialData
 * @returns {Object}
 */
function createContext(ws, initialData = {}) {
  return {
    ws,
    connectionId: initialData.connectionId,
    remoteIp: initialData.remoteIp,
    state: {},
    auth: null,
    data: initialData
  };
}

/**
 * IP白名单中间件
 * @param {string[]} allowedIps
 */
function ipWhitelist(allowedIps) {
  return async (ctx, next) => {
    if (allowedIps.length > 0 && !allowedIps.includes(ctx.remoteIp)) {
      logger.warn('IP not in whitelist', { ip: ctx.remoteIp });
      ctx.ws.close(4001, 'IP not allowed');
      return;
    }
    await next();
  };
}

/**
 * 认证中间件
 * @param {import('../auth').Authenticator} authenticator
 */
function authenticate(authenticator) {
  return async (ctx, next) => {
    // 从header或query获取token
    const token = ctx.data.token || ctx.data.authorization?.replace('Bearer ', '');

    if (!token) {
      ctx.ws.close(4002, 'Authentication required');
      return;
    }

    const result = authenticator.verifyToken(token);

    if (!result.success) {
      logger.warn('Authentication failed', { reason: result.error?.detail });
      ctx.ws.close(4003, 'Invalid token');
      return;
    }

    ctx.auth = result.data;
    await next();
  };
}

/**
 * 消息解析中间件
 */
function parseMessage() {
  return async (ctx, next) => {
    ctx.parseMessage = (rawData) => {
      try {
        return { success: true, data: JSON.parse(rawData) };
      } catch (e) {
        logger.warn('Message parse failed', { error: e.message });
        return { success: false, error: e.message };
      }
    };
    await next();
  };
}

/**
 * 消息验证中间件
 * @param {Object} schema - JSON Schema
 */
function validateMessage(schema) {
  return async (ctx, next) => {
    ctx.validateMessage = (message) => {
      // 简单的schema验证
      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in message)) {
            return { valid: false, error: `Missing required field: ${field}` };
          }
        }
      }
      return { valid: true };
    };
    await next();
  };
}

/**
 * 限流中间件
 * @param {import('../auth/RateLimiter').RateLimiter} rateLimiter
 * @param {string} keyExtractor - 从ctx提取限流key的函数
 */
function rateLimit(rateLimiter, keyExtractor = (ctx) => ctx.remoteIp) {
  return async (ctx, next) => {
    const key = keyExtractor(ctx);
    const check = rateLimiter.check(key);

    if (!check.allowed) {
      logger.warn('Rate limit exceeded', { key, reason: check.reason });
      ctx.ws.send(JSON.stringify({
        type: 'error',
        code: 'RATE_LIMITED',
        retryAfter: check.retryAfter
      }));
      return;
    }

    rateLimiter.recordRequest(key);
    await next();
  };
}

/**
 * 日志中间件
 */
function requestLogger() {
  return async (ctx, next) => {
    const start = Date.now();
    const { connectionId, remoteIp } = ctx;

    logger.debug('Connection started', { connectionId, remoteIp });

    try {
      await next();
    } finally {
      const duration = Date.now() - start;
      logger.debug('Connection ended', {
        connectionId,
        remoteIp,
        duration
      });
    }
  };
}

/**
 * 错误处理中间件
 */
function errorHandler() {
  return async (ctx, next) => {
    try {
      await next();
    } catch (e) {
      logger.error('Unhandled error', {
        error: e.message,
        stack: e.stack,
        connectionId: ctx.connectionId
      });

      ctx.ws.send(JSON.stringify({
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }));
    }
  };
}

/**
 * 心跳中间件
 * @param {number} interval - ping间隔(ms)
 * @param {number} timeout - pong超时(ms)
 */
function heartbeat(interval = 30000, timeout = 10000) {
  return async (ctx, next) => {
    let pingTimer = null;
    let pongTimer = null;

    const startPing = () => {
      pingTimer = setInterval(() => {
        if (ctx.ws.readyState === 1) { // OPEN
          ctx.ws.ping();

          // 设置pong超时
          pongTimer = setTimeout(() => {
            logger.warn('Pong timeout', { connectionId: ctx.connectionId });
            ctx.ws.close();
          }, timeout);
        }
      }, interval);
    };

    const stopPing = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (pongTimer) clearTimeout(pongTimer);
    };

    ctx.ws.on('pong', () => {
      if (pongTimer) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    });

    ctx.ws.on('close', stopPing);

    startPing();
    await next();
    stopPing();
  };
}

/**
 * 消息大小限制中间件
 * @param {number} maxSize - 最大字节数
 */
function messageSizeLimit(maxSize = 1024 * 1024) { // 1MB
  return async (ctx, next) => {
    ctx.checkMessageSize = (data) => {
      const size = Buffer.byteLength(data, 'utf8');
      if (size > maxSize) {
        return {
          valid: false,
          error: `Message size ${size} exceeds limit ${maxSize}`
        };
      }
      return { valid: true, size };
    };
    await next();
  };
}

module.exports = {
  compose,
  createContext,
  ipWhitelist,
  authenticate,
  parseMessage,
  validateMessage,
  rateLimit,
  requestLogger,
  errorHandler,
  heartbeat,
  messageSizeLimit
};
