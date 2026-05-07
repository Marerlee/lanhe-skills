/**
 * Token 管理器
 *
 * P8设计要点：
 * 1. Token分层 - access token + refresh token
 * 2. Token带签名 - 防止篡改
 * 3. 主动刷新机制 - 接近过期时自动刷新
 * 4. Token撤销 - 支持单点撤销和批量撤销
 */

const crypto = require('crypto');
const { createLogger } = require('../utils/Logger');

const logger = createLogger('TokenManager');

/**
 * Token类型
 */
const TokenType = {
  ACCESS: 'access',
  REFRESH: 'refresh',
  DEVICE: 'device'
};

/**
 * Token声明
 * @typedef {Object} TokenPayload
 * @property {string} sub - subject (设备ID/用户ID)
 * @property {string} type - token类型
 * @property {string} role - 角色
 * @property {string[]} scopes - 权限范围
 * @property {number} iat - issued at
 * @property {number} exp - expiration
 * @property {string} jti - unique token id
 */

class TokenManager {
  /**
   * @param {Object} config
   * @param {string} config.secret - 签名密钥
   * @param {number} config.accessTokenMaxAge - Access Token有效期(ms)
   * @param {number} config.refreshTokenMaxAge - Refresh Token有效期(ms)
   * @param {number} config.refreshThreshold - 提前刷新阈值(ms)
   */
  constructor(config = {}) {
    this.secret = config.secret || crypto.randomBytes(32).toString('hex');
    this.accessTokenMaxAge = config.accessTokenMaxAge || 3600000; // 1小时
    this.refreshTokenMaxAge = config.refreshTokenMaxAge || 86400000 * 7; // 7天
    this.refreshThreshold = config.refreshThreshold || 300000; // 5分钟前刷新

    /** @type {Map<string, {payload: TokenPayload, revoked: boolean}>} */
    this.tokens = new Map();
    /** @type {Map<string, string[]>} - jti -> tokenIds */
    this.userTokens = new Map();
  }

  /**
   * 创建Token
   * @param {Object} payload
   * @param {string} payload.sub - subject
   * @param {string} payload.type - token类型
   * @param {string} payload.role - 角色
   * @param {string[]} payload.scopes - 权限
   * @returns {{accessToken: string, refreshToken: string, expiresIn: number}}
   */
  create(payload) {
    const now = Date.now();
    const accessJti = this._generateJti();
    const refreshJti = this._generateJti();

    const accessPayload = {
      sub: payload.sub,
      type: TokenType.ACCESS,
      role: payload.role,
      scopes: payload.scopes,
      iat: now,
      exp: now + this.accessTokenMaxAge,
      jti: accessJti
    };

    const refreshPayload = {
      sub: payload.sub,
      type: TokenType.REFRESH,
      role: payload.role,
      iat: now,
      exp: now + this.refreshTokenMaxAge,
      jti: refreshJti
    };

    // 存储token
    this.tokens.set(accessJti, { payload: accessPayload, revoked: false });
    this.tokens.set(refreshJti, { payload: refreshPayload, revoked: false });

    // 建立用户->token映射
    if (!this.userTokens.has(payload.sub)) {
      this.userTokens.set(payload.sub, []);
    }
    this.userTokens.get(payload.sub).push(accessJti, refreshJti);

    logger.info('Tokens created', { sub: payload.sub, type: payload.type });

    return {
      accessToken: this._sign(accessPayload),
      refreshToken: this._sign(refreshPayload),
      expiresIn: Math.floor(this.accessTokenMaxAge / 1000)
    };
  }

  /**
   * 验证Token
   * @param {string} token
   * @returns {{valid: boolean, payload?: TokenPayload, reason?: string}}
   */
  verify(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { valid: false, reason: 'INVALID_FORMAT' };
      }

      const [headerB64, payloadB64, sigB64] = parts;
      const expectedSig = this._computeSig(`${headerB64}.${payloadB64}`);

      if (sigB64 !== expectedSig) {
        logger.warn('Token signature mismatch');
        return { valid: false, reason: 'INVALID_SIGNATURE' };
      }

      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
      const now = Date.now();

      // 检查过期
      if (payload.exp < now) {
        return { valid: false, reason: 'TOKEN_EXPIRED' };
      }

      // 检查是否被撤销
      const stored = this.tokens.get(payload.jti);
      if (!stored || stored.revoked) {
        return { valid: false, reason: 'TOKEN_REVOKED' };
      }

      return { valid: true, payload };
    } catch (e) {
      logger.error('Token verification failed', { error: e.message });
      return { valid: false, reason: 'VERIFICATION_FAILED' };
    }
  }

  /**
   * 刷新Token
   * @param {string} refreshToken
   * @returns {{success: boolean, tokens?: Object, reason?: string}}
   */
  refresh(refreshToken) {
    const result = this.verify(refreshToken);
    if (!result.valid) {
      return { success: false, reason: result.reason };
    }

    if (result.payload.type !== TokenType.REFRESH) {
      return { success: false, reason: 'INVALID_TOKEN_TYPE' };
    }

    // 撤销旧refresh token（单次使用）
    const stored = this.tokens.get(result.payload.jti);
    if (stored) {
      stored.revoked = true;
    }

    // 生成新tokens
    return {
      success: true,
      tokens: this.create({
        sub: result.payload.sub,
        type: result.payload.type,
        role: result.payload.role,
        scopes: result.payload.scopes
      })
    };
  }

  /**
   * 撤销用户的所有的token
   * @param {string} sub
   */
  revokeAll(sub) {
    const tokenIds = this.userTokens.get(sub) || [];
    for (const jti of tokenIds) {
      const stored = this.tokens.get(jti);
      if (stored) {
        stored.revoked = true;
      }
    }
    this.userTokens.delete(sub);
    logger.info('All tokens revoked', { sub });
  }

  /**
   * 撤销单个token
   * @param {string} jti
   */
  revoke(jti) {
    const stored = this.tokens.get(jti);
    if (stored) {
      stored.revoked = true;
      logger.info('Token revoked', { jti });
    }
  }

  /**
   * 检查是否需要刷新
   * @param {string} token
   * @returns {boolean}
   */
  needsRefresh(token) {
    const result = this.verify(token);
    if (!result.valid) return false;
    const now = Date.now();
    return result.payload.exp - now < this.refreshThreshold;
  }

  /**
   * 生成唯一ID
   * @private
   */
  _generateJti() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 签名
   * @private
   */
  _sign(payload) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = this._computeSig(`${headerB64}.${payloadB64}`);
    return `${headerB64}.${payloadB64}.${sig}`;
  }

  /**
   * 计算签名
   * @private
   */
  _computeSig(data) {
    return crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      totalTokens: this.tokens.size,
      totalUsers: this.userTokens.size
    };
  }
}

module.exports = TokenManager;
module.exports.TokenType = TokenType;
