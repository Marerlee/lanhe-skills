/**
 * Nonce 管理器
 * 用于防止重放攻击（Replay Attack）
 *
 * P8设计要点：
 * 1. 时间窗口限制 - 防止旧请求重放
 * 2. 内存优化 - 定期清理过期nonce
 * 3. 分布式友好 - 可扩展为Redis存储
 */

const { createLogger } = require('../utils/Logger');

const logger = createLogger('NonceManager');

/**
 * Nonce 数据结构
 * @typedef {Object} NonceEntry
 * @property {number} timestamp - 创建时间戳
 * @property {string} signature - 签名摘要（用于快速查找）
 */

class NonceManager {
  /**
   * @param {Object} config
   * @param {number} config.maxAge - Nonce最大有效期(ms)
   * @param {number} config.cleanupInterval - 清理间隔(ms)
   */
  constructor(config = {}) {
    this.maxAge = config.maxAge || 300000; // 5分钟
    this.cleanupInterval = config.cleanupInterval || 60000; // 1分钟
    /** @type {Map<string, NonceEntry>} */
    this.nonces = new Map();
    this._cleanupTimer = null;
    this._startCleanup();
  }

  /**
   * 启动定期清理
   * @private
   */
  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      this._cleanup();
    }, this.cleanupInterval);
    this._cleanupTimer.unref();
  }

  /**
   * 清理过期nonce
   * @private
   */
  _cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [nonce, entry] of this.nonces.entries()) {
      if (now - entry.timestamp > this.maxAge) {
        this.nonces.delete(nonce);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug(`Cleaned ${cleaned} expired nonces`, { remaining: this.nonces.size });
    }
  }

  /**
   * 生成随机nonce
   * @param {number} length
   * @returns {string}
   */
  generate(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    const randomBytes = require('crypto').randomBytes(length);
    for (let i = 0; i < length; i++) {
      nonce += chars[randomBytes[i] % chars.length];
    }
    return nonce;
  }

  /**
   * 验证nonce是否有效
   * @param {string} nonce
   * @param {string} signature - 签名摘要
   * @param {number} timestamp - 时间戳
   * @returns {{valid: boolean, reason?: string}}
   */
  validate(nonce, signature, timestamp) {
    const now = Date.now();

    // 1. 检查时间戳是否在有效窗口内
    if (Math.abs(now - timestamp) > this.maxAge) {
      logger.warn('Nonce timestamp out of range', {
        nonce,
        timestamp,
        now,
        drift: Math.abs(now - timestamp)
      });
      return { valid: false, reason: 'TIMESTAMP_EXPIRED' };
    }

    // 2. 检查nonce是否已被使用（组合key: nonce+signature防止同一nonce不同签名）
    const key = `${nonce}:${signature}`;
    if (this.nonces.has(key)) {
      logger.warn('Nonce already used', { nonce, signature: signature.substring(0, 8) });
      return { valid: false, reason: 'NONCE_REUSED' };
    }

    // 3. 存储nonce
    this.nonces.set(key, {
      timestamp,
      signature
    });

    // 4. 内存保护 - 如果过大，清理最老的
    if (this.nonces.size > 100000) {
      logger.warn('Nonce cache too large, emergency cleanup');
      const entries = Array.from(this.nonces.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, entries.length - 50000);
      toDelete.forEach(([key]) => this.nonces.delete(key));
    }

    return { valid: true };
  }

  /**
   * 关闭清理定时器
   */
  shutdown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /**
   * 获取当前状态（用于监控）
   * @returns {Object}
   */
  getStatus() {
    return {
      nonceCount: this.nonces.size,
      maxAge: this.maxAge,
      cleanupInterval: this.cleanupInterval
    };
  }
}

module.exports = NonceManager;
