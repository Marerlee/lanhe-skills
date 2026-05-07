/**
 * 分层日志系统
 * 支持多级别、多输出、敏感信息脱敏
 */

const levels = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

const SENSITIVE_KEYS = [
  'password', 'token', 'secret', 'apiKey', 'privateKey',
  'authorization', 'x-api-key', 'signature'
];

class Logger {
  constructor(module, config = {}) {
    this.module = module;
    this.level = levels[config.level?.toUpperCase()] ?? levels.INFO;
    this.format = config.format || 'text';
    this.maskSensitive = config.maskSensitive ?? true;
    this.includeTimestamp = config.includeTimestamp ?? true;
  }

  _mask(value) {
    if (typeof value !== 'string' || value.length < 8) return '***';
    return value.slice(0, 4) + '***' + value.slice(-4);
  }

  _sanitize(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) {
      return obj.map(item => this._sanitize(item));
    }
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = this.maskSensitive ? this._mask(String(value)) : value;
      } else if (typeof value === 'object') {
        sanitized[key] = this._sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  _format(level, message, meta = {}) {
    const timestamp = this.includeTimestamp ? new Date().toISOString() : '';
    const base = {
      timestamp,
      level,
      module: this.module,
      message,
      ...this._sanitize(meta)
    };
    return this.format === 'json' ? JSON.stringify(base) : `[${timestamp}] [${level}] [${this.module}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
  }

  error(message, meta = {}) {
    if (this.level >= levels.ERROR) {
      console.error(this._format('ERROR', message, meta));
    }
  }

  warn(message, meta = {}) {
    if (this.level >= levels.WARN) {
      console.warn(this._format('WARN', message, meta));
    }
  }

  info(message, meta = {}) {
    if (this.level >= levels.INFO) {
      console.log(this._format('INFO', message, meta));
    }
  }

  debug(message, meta = {}) {
    if (this.level >= levels.DEBUG) {
      console.log(this._format('DEBUG', message, meta));
    }
  }

  trace(message, meta = {}) {
    if (this.level >= levels.TRACE) {
      console.log(this._format('TRACE', message, meta));
    }
  }

  child(additionalFields) {
    const childLogger = new Logger(this.module, {
      level: Object.keys(levels).find(k => levels[k] === this.level)?.toLowerCase(),
      format: this.format,
      maskSensitive: this.maskSensitive,
      includeTimestamp: this.includeTimestamp
    });
    return {
      ...childLogger,
      _extra: { ...childLogger._sanitize(additionalFields) },
      _format: (level, message, meta = {}) => {
        return childLogger._format(level, message, { ...childLogger._extra, ...meta });
      }
    };
  }
}

/**
 * 创建模块logger
 * @param {string} module 模块名
 * @param {object} config 配置
 * @returns {Logger}
 */
function createLogger(module, config = {}) {
  return new Logger(module, config);
}

module.exports = { createLogger, Logger, levels };
