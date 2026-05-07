/**
 * 签名验证器
 *
 * P8设计要点：
 * 1. 支持多种签名算法（Ed25519, RSA, ECDSA）
 * 2. 策略模式支持不同设备类型
 * 3. 签名时间窗口验证（防重放）
 * 4. 公钥缓存与轮换
 */

const crypto = require('crypto');
const { createLogger } = require('../utils/Logger');

const logger = createLogger('SignatureVerifier');

/**
 * 签名算法类型
 */
const Algorithm = {
  ED25519: 'ed25519',
  RSA: 'rsa',
  ECDSA: 'ecdsa'
};

/**
 * 签名格式
 */
const SignatureFormat = {
  RAW: 'raw',     // Raw 32/64 byte signature
  BASE64: 'base64',
  BASE64URL: 'base64url'
};

class SignatureVerifier {
  /**
   * @param {Object} config
   * @param {number} config.signatureWindow - 签名有效时间窗口(ms)
   * @param {boolean} config.allowRevokedKeys - 是否允许已撤销的公钥
   */
  constructor(config = {}) {
    this.signatureWindow = config.signatureWindow || 300000; // 5分钟
    /** @type {Map<string, {publicKey: string, algorithm: string, createdAt: number, revoked: boolean}>} */
    this.publicKeys = new Map();
    /** @type {Map<string, string>} - keyId -> deviceId */
    this.keyDeviceMap = new Map();
  }

  /**
   * 注册设备公钥
   * @param {string} deviceId
   * @param {string} publicKey - PEM格式或base64url格式
   * @param {string} algorithm - 算法类型
   * @param {string} [keyId] - 可选的keyId
   */
  registerPublicKey(deviceId, publicKey, algorithm = Algorithm.ED25519, keyId = null) {
    const id = keyId || this._deriveKeyId(publicKey, algorithm);
    this.publicKeys.set(id, {
      publicKey,
      algorithm,
      createdAt: Date.now(),
      revoked: false
    });
    this.keyDeviceMap.set(id, deviceId);
    logger.info('Public key registered', { deviceId, algorithm, keyId: id });
    return id;
  }

  /**
   * 撤销设备的公钥
   * @param {string} deviceId
   */
  revokeKey(deviceId) {
    let revoked = 0;
    for (const [keyId, mappedDeviceId] of this.keyDeviceMap.entries()) {
      if (mappedDeviceId === deviceId) {
        const key = this.publicKeys.get(keyId);
        if (key) {
          key.revoked = true;
          revoked++;
        }
      }
    }
    logger.info('Keys revoked', { deviceId, count: revoked });
    return revoked;
  }

  /**
   * 验证签名
   * @param {Object} params
   * @param {string} params.deviceId
   * @param {string} params.signature
   * @param {string} params.message - 原始消息
   * @param {number} params.timestamp - 时间戳
   * @param {string} [params.nonce] - 随机数
   * @param {string} [params.format] - 签名格式
   * @returns {{valid: boolean, reason?: string, keyId?: string}}
   */
  verify({ deviceId, signature, message, timestamp, nonce = null, format = SignatureFormat.BASE64URL }) {
    const now = Date.now();

    // 1. 时间窗口验证
    if (Math.abs(now - timestamp) > this.signatureWindow) {
      logger.warn('Signature timestamp out of window', {
        timestamp,
        now,
        drift: Math.abs(now - timestamp)
      });
      return { valid: false, reason: 'TIMESTAMP_EXPIRED' };
    }

    // 2. 查找公钥
    let keyEntry = null;
    let keyId = null;

    for (const [id, entry] of this.publicKeys.entries()) {
      if (this.keyDeviceMap.get(id) === deviceId && !entry.revoked) {
        keyEntry = entry;
        keyId = id;
        break;
      }
    }

    if (!keyEntry) {
      logger.warn('No valid key found for device', { deviceId });
      return { valid: false, reason: 'KEY_NOT_FOUND' };
    }

    if (keyEntry.revoked) {
      logger.warn('Attempt to use revoked key', { deviceId, keyId });
      return { valid: false, reason: 'KEY_REVOKED' };
    }

    // 3. 构建待签名数据
    const signedData = nonce ? `${message}|${nonce}` : message;

    // 4. 验证签名
    try {
      const isValid = this._verifySignature(
        signedData,
        signature,
        keyEntry.publicKey,
        keyEntry.algorithm,
        format
      );

      if (!isValid) {
        logger.warn('Signature verification failed', { deviceId, keyId });
        return { valid: false, reason: 'INVALID_SIGNATURE' };
      }

      logger.debug('Signature verified', { deviceId, keyId });
      return { valid: true, keyId };
    } catch (e) {
      logger.error('Signature verification error', { error: e.message, deviceId });
      return { valid: false, reason: 'VERIFICATION_ERROR' };
    }
  }

  /**
   * 批量验证（用于验证消息链）
   * @param {Array} signatures - [{deviceId, signature, message, timestamp, nonce}]
   * @returns {{valid: boolean, failed?: Object}}
   */
  verifyBatch(signatures) {
    const failed = [];
    for (const sig of signatures) {
      const result = this.verify(sig);
      if (!result.valid) {
        failed.push({ ...sig, reason: result.reason });
      }
    }
    return failed.length === 0
      ? { valid: true }
      : { valid: false, failed };
  }

  /**
   * 验证具体签名
   * @private
   */
  _verifySignature(data, signature, publicKey, algorithm, format) {
    const sigBuffer = this._decodeSignature(signature, format);
    const dataBuffer = Buffer.from(data);

    switch (algorithm) {
      case Algorithm.ED25519:
        return this._verifyEd25519(dataBuffer, sigBuffer, publicKey);
      case Algorithm.RSA:
        return this._verifyRSA(dataBuffer, sigBuffer, publicKey);
      case Algorithm.ECDSA:
        return this._verifyECDSA(dataBuffer, sigBuffer, publicKey);
      default:
        throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
  }

  /**
   * 验证Ed25519签名
   * @private
   */
  _verifyEd25519(data, signature, publicKey) {
    // publicKey可能是raw格式或PEM格式
    const key = this._importKey(publicKey, Algorithm.ED25519);
    return crypto.verify(null, data, key, signature);
  }

  /**
   * 验证RSA签名
   * @private
   */
  _verifyRSA(data, signature, publicKey) {
    const key = this._importKey(publicKey, Algorithm.RSA);
    return crypto.verify('SHA256', data, signature, key);
  }

  /**
   * 验证ECDSA签名
   * @private
   */
  _verifyECDSA(data, signature, publicKey) {
    const key = this._importKey(publicKey, Algorithm.ECDSA);
    return crypto.verify('SHA256', data, key, signature);
  }

  /**
   * 导入公钥
   * @private
   */
  _importKey(publicKey, algorithm) {
    if (algorithm === Algorithm.ED25519) {
      // Ed25519需要特定处理
      if (publicKey.startsWith('-----BEGIN')) {
        return crypto.createPublicKey(publicKey);
      }
      // Raw格式需要包装成SPKI
      const spkiHeader = Buffer.from([
        0x30, 0x42, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
        0x05, 0x21, 0x00, ...Buffer.from(publicKey, 'base64url')
      ]);
      return crypto.createPublicKey({ key: spkiHeader, format: 'der', type: 'spki' });
    }
    return crypto.createPublicKey(publicKey);
  }

  /**
   * 解码签名
   * @private
   */
  _decodeSignature(signature, format) {
    switch (format) {
      case SignatureFormat.BASE64URL:
        return Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      case SignatureFormat.BASE64:
        return Buffer.from(signature, 'base64');
      case SignatureFormat.RAW:
        return Buffer.from(signature);
      default:
        throw new Error(`Unknown signature format: ${format}`);
    }
  }

  /**
   * 推导keyId
   * @private
   */
  _deriveKeyId(publicKey, algorithm) {
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(publicKey));
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * 获取设备的所有有效公钥
   * @param {string} deviceId
   * @returns {string[]}
   */
  getDeviceKeys(deviceId) {
    const keys = [];
    for (const [keyId, mappedId] of this.keyDeviceMap.entries()) {
      if (mappedId === deviceId) {
        const entry = this.publicKeys.get(keyId);
        if (entry && !entry.revoked) {
          keys.push(keyId);
        }
      }
    }
    return keys;
  }
}

module.exports = SignatureVerifier;
module.exports.Algorithm = Algorithm;
module.exports.SignatureFormat = SignatureFormat;
