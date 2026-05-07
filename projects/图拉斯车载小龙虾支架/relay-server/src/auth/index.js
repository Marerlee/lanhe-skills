/**
 * 认证模块主入口
 *
 * P8设计要点：
 * 1. 认证策略模式 - 支持设备认证、桥接认证、管理员认证
 * 2. 认证链 - 支持多因素、渐进式认证
 * 3. 认证事件发布 - 支持审计和监控
 * 4. 认证上下文 - 携带认证过程中的上下文数据
 */

const crypto = require('crypto');
const NonceManager = require('./NonceManager');
const TokenManager = require('./TokenManager');
const SignatureVerifier = require('./SignatureVerifier');
const RateLimiter = require('./RateLimiter');
const { createLogger } = require('../utils/Logger');

const logger = createLogger('Auth');

/**
 * 认证错误码
 */
const AuthError = {
  INVALID_REQUEST: { code: 'AUTH_INVALID_REQUEST', status: 400 },
  UNAUTHORIZED: { code: 'AUTH_UNAUTHORIZED', status: 401 },
  FORBIDDEN: { code: 'AUTH_FORBIDDEN', status: 403 },
  NOT_FOUND: { code: 'AUTH_NOT_FOUND', status: 404 },
  RATE_LIMITED: { code: 'AUTH_RATE_LIMITED', status: 429 },
  INTERNAL_ERROR: { code: 'AUTH_INTERNAL_ERROR', status: 500 },
  SERVICE_UNAVAILABLE: { code: 'AUTH_SERVICE_UNAVAILABLE', status: 503 }
};

/**
 * 认证类型
 */
const AuthType = {
  DEVICE: 'device',
  BRIDGE: 'bridge',
  ADMIN: 'admin'
};

/**
 * 认证结果
 */
class AuthResult {
  constructor(success, data = {}, error = null) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.timestamp = Date.now();
  }

  toJSON() {
    if (this.success) {
      return {
        success: true,
        data: this.data,
        timestamp: this.timestamp
      };
    }
    return {
      success: false,
      error: this.error,
      timestamp: this.timestamp
    };
  }
}

/**
 * 认证上下文
 */
class AuthContext {
  constructor(connectionId, remoteIp) {
    this.connectionId = connectionId;
    this.remoteIp = remoteIp;
    this.authType = null;
    this.deviceId = null;
    this.bridgeId = null;
    this.userId = null;
    this.scopes = [];
    this.metadata = {};
    this.startedAt = Date.now();
  }

  isDevice() { return this.authType === AuthType.DEVICE; }
  isBridge() { return this.authType === AuthType.BRIDGE; }
  isAdmin() { return this.authType === AuthType.ADMIN; }
  isAuthenticated() { return this.authType !== null; }

  hasScope(scope) { return this.scopes.includes(scope); }
  hasAnyScope(scopes) { return scopes.some(s => this.scopes.includes(s)); }

  get duration() { return Date.now() - this.startedAt; }
}

/**
 * 认证器主类
 */
class Authenticator {
  /**
   * @param {Object} config
   */
  constructor(config = {}) {
    this.nonceManager = new NonceManager(config.nonce || {});
    this.tokenManager = new TokenManager(config.token || {});
    this.signatureVerifier = new SignatureVerifier(config.signature || {});
    this.rateLimiter = new RateLimiter(config.rateLimit || {});

    // 事件处理
    /** @type {Map<string, Function[]>} */
    this.eventHandlers = new Map();

    // 配置
    this.config = {
      requireNonce: config.requireNonce ?? true,
      allowDeviceReconnect: config.allowDeviceReconnect ?? true,
      maxDevicesPerBridge: config.maxDevicesPerBridge ?? 10
    };

    logger.info('Authenticator initialized', { config: this.config });
  }

  /**
   * 注册事件处理器
   * @param {string} event - 事件名
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * 触发事件
   * @private
   */
  _emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (e) {
        logger.error('Event handler error', { event, error: e.message });
      }
    }
  }

  /**
   * 验证设备认证请求
   * @param {Object} params
   * @param {string} params.deviceId
   * @param {string} params.publicKey
   * @param {string} params.signature
   * @param {number} params.timestamp
   * @param {string} [params.nonce]
   * @param {string} [params.signatureFormat]
   * @param {AuthContext} [context]
   * @returns {AuthResult}
   */
  authenticateDevice({ deviceId, publicKey, signature, timestamp, nonce, signatureFormat }, context = null) {
    const remoteIp = context?.remoteIp || 'unknown';

    // 1. 限流检查
    const rateCheck = this.rateLimiter.check(deviceId, 'device');
    if (!rateCheck.allowed) {
      logger.warn('Device auth rate limited', { deviceId, reason: rateCheck.reason });
      return new AuthResult(false, null, { ...AuthError.RATE_LIMITED, detail: rateCheck.reason });
    }

    // 2. 注册公钥（如果是新设备）
    const existingKeys = this.signatureVerifier.getDeviceKeys(deviceId);
    if (existingKeys.length === 0 && publicKey) {
      this.signatureVerifier.registerPublicKey(deviceId, publicKey);
    }

    // 3. 验证签名
    const signatureResult = this.signatureVerifier.verify({
      deviceId,
      signature,
      message: deviceId,
      timestamp,
      nonce
    });

    if (!signatureResult.valid) {
      this.rateLimiter.recordAuthFailure(deviceId, 'device');
      logger.warn('Device signature verification failed', {
        deviceId,
        reason: signatureResult.reason
      });
      return new AuthResult(false, null, {
        ...AuthError.UNAUTHORIZED,
        detail: signatureResult.reason
      });
    }

    // 4. 生成Token
    const tokens = this.tokenManager.create({
      sub: deviceId,
      type: AuthType.DEVICE,
      role: 'device',
      scopes: ['device:read', 'device:write', 'device:audio']
    });

    // 5. 记录认证成功
    this._emit('device.authenticated', { deviceId, timestamp: Date.now() });

    logger.info('Device authenticated', { deviceId, duration: context?.duration });

    return new AuthResult(true, {
      deviceId,
      tokens,
      scopes: ['device:read', 'device:write', 'device:audio']
    });
  }

  /**
   * 验证桥接程序认证
   * @param {Object} params
   * @param {string} params.bridgeId
   * @param {string} params.signature
   * @param {number} params.timestamp
   * @param {string} [params.nonce]
   * @param {AuthContext} [context]
   * @returns {AuthResult}
   */
  authenticateBridge({ bridgeId, signature, timestamp, nonce }, context = null) {
    // 1. 限流检查
    const rateCheck = this.rateLimiter.check(bridgeId, 'bridge');
    if (!rateCheck.allowed) {
      return new AuthResult(false, null, { ...AuthError.RATE_LIMITED, detail: rateCheck.reason });
    }

    // 2. 验证签名
    const signatureResult = this.signatureVerifier.verify({
      deviceId: bridgeId,
      signature,
      message: bridgeId,
      timestamp,
      nonce
    });

    if (!signatureResult.valid) {
      this.rateLimiter.recordAuthFailure(bridgeId, 'bridge');
      return new AuthResult(false, null, { ...AuthError.UNAUTHORIZED, detail: signatureResult.reason });
    }

    // 3. 生成Token
    const tokens = this.tokenManager.create({
      sub: bridgeId,
      type: AuthType.BRIDGE,
      role: 'bridge',
      scopes: ['bridge:read', 'bridge:write', 'bridge:admin']
    });

    this._emit('bridge.authenticated', { bridgeId, timestamp: Date.now() });

    return new AuthResult(true, {
      bridgeId,
      tokens,
      scopes: ['bridge:read', 'bridge:write', 'bridge:admin']
    });
  }

  /**
   * Token认证（用于已连接后的每次请求）
   * @param {string} token
   * @param {string[]} [requiredScopes]
   * @returns {AuthResult}
   */
  verifyToken(token, requiredScopes = []) {
    const result = this.tokenManager.verify(token);

    if (!result.valid) {
      return new AuthResult(false, null, {
        ...AuthError.UNAUTHORIZED,
        detail: result.reason
      });
    }

    if (requiredScopes.length > 0) {
      const hasScope = requiredScopes.some(s => result.payload.scopes.includes(s));
      if (!hasScope) {
        return new AuthResult(false, null, {
          ...AuthError.FORBIDDEN,
          detail: 'INSUFFICIENT_SCOPES'
        });
      }
    }

    return new AuthResult(true, {
      sub: result.payload.sub,
      type: result.payload.type,
      role: result.payload.role,
      scopes: result.payload.scopes
    });
  }

  /**
   * 刷新Token
   * @param {string} refreshToken
   * @returns {AuthResult}
   */
  refreshToken(refreshToken) {
    const result = this.tokenManager.refresh(refreshToken);

    if (!result.success) {
      return new AuthResult(false, null, {
        ...AuthError.UNAUTHORIZED,
        detail: result.reason
      });
    }

    return new AuthResult(true, result.tokens);
  }

  /**
   * 撤销认证
   * @param {string} sub - subject (deviceId/bridgeId)
   */
  revokeAll(sub) {
    this.tokenManager.revokeAll(sub);
    this.signatureVerifier.revokeKey(sub);
    this._emit('auth.revoked', { sub, timestamp: Date.now() });
    logger.info('All auth revoked', { sub });
  }

  /**
   * 获取认证状态
   * @returns {Object}
   */
  getStatus() {
    return {
      nonce: this.nonceManager.getStatus(),
      token: this.tokenManager.getStatus(),
      rateLimit: this.rateLimiter.getStatus()
    };
  }

  /**
   * 关闭认证器
   */
  shutdown() {
    this.nonceManager.shutdown();
    this.rateLimiter.shutdown();
    logger.info('Authenticator shutdown');
  }
}

module.exports = {
  Authenticator,
  AuthResult,
  AuthContext,
  AuthError,
  AuthType,
  NonceManager,
  TokenManager,
  SignatureVerifier,
  RateLimiter
};
