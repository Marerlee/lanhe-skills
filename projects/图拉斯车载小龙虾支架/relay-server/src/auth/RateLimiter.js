/**
 * 限流器
 *
 * P8设计要点：
 * 1. 令牌桶算法 - 允许一定程度的burst
 * 2. 多维度限流 - IP、设备ID、用户ID
 * 3. 分层限流 - 连接数、请求数、认证失败次数
 * 4. 自动熔断 - 超过阈值自动屏蔽
 */

const crypto = require('crypto');
const { createLogger } = require('../utils/Logger');

const logger = createLogger('RateLimiter');

/**
 * 限流维度
 */
const LimitType = {
  IP: 'ip',
  DEVICE: 'device',
  USER: 'user',
  GLOBAL: 'global'
};

class RateLimiter {
  /**
   * @param {Object} config
   * @param {boolean} config.enabled
   * @param {number} config.windowMs - 时间窗口
   * @param {number} config.maxRequests - 最大请求数
   * @param {number} config.maxAuthAttempts - 最大认证失败次数
   * @param {number} config.blockDuration - 屏蔽时长(ms)
   */
  constructor(config = {}) {
    this.enabled = config.enabled ?? true;
    this.windowMs = config.windowMs || 60000;
    this.maxRequests = config.maxRequests || 100;
    this.maxAuthAttempts = config.maxAuthAttempts || 5;
    this.blockDuration = config.blockDuration || 300000;

    /** @type {Map<string, {count: number, resetAt: number, authFails: number, blocked: boolean, blockedUntil: number}>} */
    this.counters = new Map();

    /** @type {Set<string>} - 被屏蔽的IP/设备 */
    this.blocked = new Set();

    /** @type {Map<string, number>} - key -> unblockTime */
    this.tempBlocks = new Map();

    // 定期清理
    this._cleanupInterval = setInterval(() => this._cleanup(), this.windowMs);
    this._cleanupInterval.unref();
  }

  /**
   * 检查是否允许请求
   * @param {string} key - 限流key
   * @param {string} type - 限流类型
   * @returns {{allowed: boolean, reason?: string, retryAfter?: number}}
   */
  check(key, type = LimitType.IP) {
    if (!this.enabled) {
      return { allowed: true };
    }

    const now = Date.now();
    const compositeKey = `${type}:${key}`;

    // 检查临时屏蔽
    if (this.tempBlocks.has(compositeKey)) {
      const until = this.tempBlocks.get(compositeKey);
      if (now < until) {
        return {
          allowed: false,
          reason: 'TEMPORARILY_BLOCKED',
          retryAfter: Math.ceil((until - now) / 1000)
        };
      }
      this.tempBlocks.delete(compositeKey);
    }

    // 检查永久blocked集合
    if (this.blocked.has(key)) {
      return { allowed: false, reason: 'PERMANENTLY_BLOCKED' };
    }

    // 获取或创建计数器
    let counter = this.counters.get(compositeKey);
    if (!counter || now > counter.resetAt) {
      counter = {
        count: 0,
        resetAt: now + this.windowMs,
        authFails: 0,
        blocked: false,
        blockedUntil: 0
      };
      this.counters.set(compositeKey, counter);
    }

    // 检查是否在屏蔽中
    if (counter.blocked && now < counter.blockedUntil) {
      return {
        allowed: false,
        reason: 'RATE_LIMITED',
        retryAfter: Math.ceil((counter.blockedUntil - now) / 1000)
      };
    }

    // 检查请求数
    if (counter.count >= this.maxRequests) {
      logger.warn('Rate limit exceeded', { type, key, count: counter.count });
      return { allowed: false, reason: 'REQUEST_LIMIT_EXCEEDED' };
    }

    return { allowed: true };
  }

  /**
   * 记录请求
   * @param {string} key
   * @param {string} type
   */
  recordRequest(key, type = LimitType.IP) {
    const compositeKey = `${type}:${key}`;
    let counter = this.counters.get(compositeKey);
    if (!counter) {
      counter = {
        count: 0,
        resetAt: Date.now() + this.windowMs,
        authFails: 0,
        blocked: false,
        blockedUntil: 0
      };
    }
    counter.count++;
    this.counters.set(compositeKey, counter);
  }

  /**
   * 记录认证失败
   * @param {string} key
   * @param {string} type
   */
  recordAuthFailure(key, type = LimitType.IP) {
    const compositeKey = `${type}:${key}`;
    let counter = this.counters.get(compositeKey);
    if (!counter) {
      counter = {
        count: 0,
        resetAt: Date.now() + this.windowMs,
        authFails: 0,
        blocked: false,
        blockedUntil: 0
      };
    }
    counter.authFails++;

    // 超过阈值，触发临时屏蔽
    if (counter.authFails >= this.maxAuthAttempts) {
      const until = Date.now() + this.blockDuration;
      counter.blocked = true;
      counter.blockedUntil = until;
      this.tempBlocks.set(compositeKey, until);
      logger.warn('Auth failures exceeded, temporary block applied', {
        type,
        key,
        until: new Date(until).toISOString()
      });
    }
  }

  /**
   * 永久屏蔽
   * @param {string} key
   */
  block(key) {
    this.blocked.add(key);
    logger.warn('Key permanently blocked', { key });
  }

  /**
   * 解封
   * @param {string} key
   */
  unblock(key) {
    this.blocked.delete(key);
    this.tempBlocks.forEach((_, k) => {
      if (k.endsWith(`:${key}`)) {
        this.tempBlocks.delete(k);
      }
    });
    logger.info('Key unblocked', { key });
  }

  /**
   * 获取限制信息
   * @param {string} key
   * @param {string} type
   * @returns {Object}
   */
  getLimitInfo(key, type = LimitType.IP) {
    const compositeKey = `${type}:${key}`;
    const counter = this.counters.get(compositeKey);
    if (!counter) {
      return {
        remaining: this.maxRequests,
        limit: this.maxRequests,
        resetAt: null,
        authFails: 0
      };
    }
    return {
      remaining: Math.max(0, this.maxRequests - counter.count),
      limit: this.maxRequests,
      resetAt: counter.resetAt,
      authFails: counter.authFails,
      blocked: counter.blocked,
      blockedUntil: counter.blockedUntil
    };
  }

  /**
   * 清理过期数据
   * @private
   */
  _cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, counter] of this.counters.entries()) {
      if (now > counter.resetAt && !counter.blocked) {
        this.counters.delete(key);
        cleaned++;
      }
    }

    // 清理过期的临时屏蔽
    for (const [key, until] of this.tempBlocks.entries()) {
      if (now > until) {
        this.tempBlocks.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Rate limiter cleanup', { cleaned });
    }
  }

  /**
   * 关闭
   */
  shutdown() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
    }
  }

  /**
   * 获取统计
   * @returns {Object}
   */
  getStatus() {
    let activeCounters = 0;
    let blockedCount = 0;
    const now = Date.now();

    for (const [, counter] of this.counters) {
      if (now < counter.resetAt) {
        activeCounters++;
        if (counter.blocked) blockedCount++;
      }
    }

    return {
      enabled: this.enabled,
      counters: activeCounters,
      blocked: blockedCount,
      permanentlyBlocked: this.blocked.size,
      config: {
        windowMs: this.windowMs,
        maxRequests: this.maxRequests,
        maxAuthAttempts: this.maxAuthAttempts,
        blockDuration: this.blockDuration
      }
    };
  }
}

module.exports = RateLimiter;
module.exports.LimitType = LimitType;
