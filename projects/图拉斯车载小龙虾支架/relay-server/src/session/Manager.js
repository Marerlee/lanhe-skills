/**
 * 会话管理器
 *
 * P8设计要点：
 * 1. 分层会话 - BridgeSession(桥接程序) / DeviceSession(设备)
 * 2. 消息队列 - 离线消息缓存，重连后投递
 * 3. 消息去重 - Idempotency key
 * 4. 消息排序 - Sequence number
 */

const crypto = require('crypto');
const { createLogger } = require('../utils/Logger');

const logger = createLogger('SessionManager');

/**
 * 消息类型
 */
const MessageType = {
  DEVICE_TO_BRIDGE: 'device_to_bridge',
  BRIDGE_TO_DEVICE: 'bridge_to_device',
  BRIDGE_TO_CLOUD: 'bridge_to_cloud',
  CLOUD_TO_BRIDGE: 'cloud_to_bridge',
  SYSTEM: 'system'
};

/**
 * 会话消息
 * @typedef {Object} SessionMessage
 * @property {string} id - 消息ID
 * @property {string} type - 消息类型
 * @property {string} from - 发送者ID
 * @property {string} to - 接收者ID
 * @property {object} payload - 消息内容
 * @property {number} timestamp - 时间戳
 * @property {string} [idempotencyKey] - 幂等键
 * @property {number} [sequence] - 序列号
 */

class SessionManager {
  /**
   * @param {Object} config
   * @param {number} config.messageRetention - 消息保留时间(ms)
   * @param {number} config.maxQueueSize - 最大队列长度
   */
  constructor(config = {}) {
    this.messageRetention = config.messageRetention || 86400000; // 24小时
    this.maxQueueSize = config.maxQueueSize || 100;

    /** @type {Map<string, BridgeSession>} - bridgeId -> BridgeSession */
    this.bridgeSessions = new Map();

    /** @type {Map<string, DeviceSession>} - deviceId -> DeviceSession */
    this.deviceSessions = new Map();

    /** @type {Set<string>} - 已处理的消息ID（去重） */
    this.processedMessages = new Set();

    /** 事件 */
    this.eventHandlers = new Map();

    // 定期清理过期消息
    this._cleanupTimer = setInterval(() => this._cleanup(), 60000);
    this._cleanupTimer.unref();
  }

  /**
   * 注册事件处理器
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
   * 创建或获取桥接程序会话
   * @param {string} bridgeId
   * @returns {BridgeSession}
   */
  getOrCreateBridgeSession(bridgeId) {
    if (!this.bridgeSessions.has(bridgeId)) {
      const session = new BridgeSession(bridgeId, this);
      this.bridgeSessions.set(bridgeId, session);
      logger.info('Bridge session created', { bridgeId });
    }
    return this.bridgeSessions.get(bridgeId);
  }

  /**
   * 创建或获取设备会话
   * @param {string} deviceId
   * @param {string} bridgeId
   * @returns {DeviceSession}
   */
  getOrCreateDeviceSession(deviceId, bridgeId) {
    if (!this.deviceSessions.has(deviceId)) {
      const bridgeSession = this.getOrCreateBridgeSession(bridgeId);
      const session = new DeviceSession(deviceId, bridgeSession, this);
      this.deviceSessions.set(deviceId, session);
      logger.info('Device session created', { deviceId, bridgeId });
    }
    return this.deviceSessions.get(deviceId);
  }

  /**
   * 路由消息
   * @param {SessionMessage} message
   * @returns {{delivered: boolean, reason?: string}}
   */
  routeMessage(message) {
    // 1. 幂等检查
    if (message.idempotencyKey) {
      if (this.processedMessages.has(message.idempotencyKey)) {
        logger.debug('Message already processed', {
          idempotencyKey: message.idempotencyKey
        });
        return { delivered: true, duplicate: true };
      }
      this.processedMessages.add(message.idempotencyKey);
    }

    // 2. 根据类型路由
    try {
      switch (message.type) {
        case MessageType.DEVICE_TO_BRIDGE: {
          const session = this.deviceSessions.get(message.from);
          if (session) {
            session.enqueue(message);
          }
          break;
        }
        case MessageType.BRIDGE_TO_DEVICE: {
          const session = this.deviceSessions.get(message.to);
          if (session) {
            session.enqueue(message);
          }
          break;
        }
        case MessageType.CLOUD_TO_BRIDGE: {
          const session = this.bridgeSessions.get(message.to);
          if (session) {
            session.enqueue(message);
          }
          break;
        }
        default:
          logger.warn('Unknown message type', { type: message.type });
      }

      this._emit('message.routed', message);
      return { delivered: true };
    } catch (e) {
      logger.error('Message routing failed', { error: e.message, messageId: message.id });
      return { delivered: false, reason: e.message };
    }
  }

  /**
   * 清理过期数据
   * @private
   */
  _cleanup() {
    const now = Date.now();
    let cleaned = 0;

    // 清理已处理消息
    if (this.processedMessages.size > 10000) {
      const toDelete = Array.from(this.processedMessages).slice(0, 5000);
      toDelete.forEach(k => this.processedMessages.delete(k));
      cleaned += toDelete.length;
    }

    // 清理设备会话
    for (const [deviceId, session] of this.deviceSessions.entries()) {
      session.cleanup(now);
      if (session.shouldRemove()) {
        this.deviceSessions.delete(deviceId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Session cleanup', { cleaned });
    }
  }

  /**
   * 获取会话统计
   * @returns {Object}
   */
  getStats() {
    let totalDeviceMessages = 0;
    let totalBridgeMessages = 0;

    for (const session of this.deviceSessions.values()) {
      totalDeviceMessages += session.queueSize();
    }
    for (const session of this.bridgeSessions.values()) {
      totalBridgeMessages += session.queueSize();
    }

    return {
      bridgeSessions: this.bridgeSessions.size,
      deviceSessions: this.deviceSessions.size,
      processedMessages: this.processedMessages.size,
      totalQueuedDeviceMessages: totalDeviceMessages,
      totalQueuedBridgeMessages: totalBridgeMessages
    };
  }

  /**
   * 关闭
   */
  shutdown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }
    this.bridgeSessions.clear();
    this.deviceSessions.clear();
    this.processedMessages.clear();
    logger.info('SessionManager shutdown');
  }
}

/**
 * 桥接程序会话
 */
class BridgeSession {
  /**
   * @param {string} bridgeId
   * @param {SessionManager} manager
   */
  constructor(bridgeId, manager) {
    this.bridgeId = bridgeId;
    this.manager = manager;
    this.sequence = 0;
    /** @type {SessionMessage[]} */
    this.messageQueue = [];
    this.lastActivity = Date.now();
  }

  /**
   * 入队消息
   * @param {SessionMessage} message
   */
  enqueue(message) {
    if (this.messageQueue.length >= 1000) {
      // 队列满，移除最老的
      this.messageQueue.shift();
    }
    message.sequence = ++this.sequence;
    this.messageQueue.push(message);
    this.lastActivity = Date.now();
  }

  /**
   * 获取待投递消息
   * @param {number} sinceSequence
   * @returns {SessionMessage[]}
   */
  getMessages(sinceSequence = 0) {
    const messages = this.messageQueue.filter(m => m.sequence > sinceSequence);
    // 清理已确认的消息
    if (messages.length > 0) {
      const minSeq = Math.min(...messages.map(m => m.sequence));
      const idx = this.messageQueue.findIndex(m => m.sequence === minSeq);
      if (idx > 0) {
        this.messageQueue = this.messageQueue.slice(idx);
      }
    }
    return messages;
  }

  queueSize() {
    return this.messageQueue.length;
  }

  cleanup(now) {
    // 清理超过保留期的消息
    const cutoff = now - this.manager.messageRetention;
    this.messageQueue = this.messageQueue.filter(m => m.timestamp > cutoff);
  }

  shouldRemove() {
    return this.messageQueue.length === 0 &&
      Date.now() - this.lastActivity > 3600000; // 1小时无活动
  }
}

/**
 * 设备会话
 */
class DeviceSession {
  /**
   * @param {string} deviceId
   * @param {BridgeSession} bridgeSession
   * @param {SessionManager} manager
   */
  constructor(deviceId, bridgeSession, manager) {
    this.deviceId = deviceId;
    this.bridgeSession = bridgeSession;
    this.manager = manager;
    this.sequence = 0;
    /** @type {SessionMessage[]} */
    this.messageQueue = [];
    this.lastActivity = Date.now();
  }

  /**
   * 入队消息
   * @param {SessionMessage} message
   */
  enqueue(message) {
    if (this.messageQueue.length >= this.manager.maxQueueSize) {
      this.messageQueue.shift();
    }
    message.sequence = ++this.sequence;
    this.messageQueue.push(message);
    this.lastActivity = Date.now();
  }

  /**
   * 获取并确认消息
   * @param {number} sinceSequence
   * @returns {SessionMessage[]}
   */
  getAndAck(sinceSequence = 0) {
    const messages = this.messageQueue.filter(m => m.sequence > sinceSequence);
    return messages;
  }

  queueSize() {
    return this.messageQueue.length;
  }

  cleanup(now) {
    const cutoff = now - this.manager.messageRetention;
    this.messageQueue = this.messageQueue.filter(m => m.timestamp > cutoff);
  }

  shouldRemove() {
    return this.messageQueue.length === 0 &&
      Date.now() - this.lastActivity > 3600000;
  }
}

module.exports = SessionManager;
module.exports.MessageType = MessageType;
