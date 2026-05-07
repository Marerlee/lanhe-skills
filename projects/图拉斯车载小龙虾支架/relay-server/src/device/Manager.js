/**
 * 设备连接管理器
 *
 * P8设计要点：
 * 1. 连接元数据管理 - 追踪连接状态、最后活跃时间
 * 2. 分层索引 - 快速查找设备、连接、订阅关系
 * 3. 心跳检测 - 自动断开无响应的连接
 * 4. 连接事件发布 - 支持监控和审计
 */

const { createLogger } = require('../utils/Logger');

const logger = createLogger('DeviceManager');

/**
 * 设备连接状态
 */
const ConnectionState = {
  CONNECTING: 'connecting',
  AUTHENTICATED: 'authenticated',
  REGISTERED: 'registered',
  READY: 'ready',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

/**
 * 设备信息
 * @typedef {Object} DeviceInfo
 * @property {string} deviceId
 * @property {string} bridgeId - 所属桥接程序ID
 * @property {string} type - 设备类型
 * @property {object} metadata - 设备元数据
 */

/**
 * 连接信息
 * @typedef {Object} ConnectionInfo
 * @property {WebSocket} ws - WebSocket连接
 * @property {string} connectionId
 * @property {string} remoteIp
 * @property {ConnectionState} state
 * @property {number} connectedAt
 * @property {number} lastHeartbeat
 * @property {object} authInfo - 认证信息
 */

class DeviceManager {
  /**
   * @param {Object} config
   * @param {number} config.heartbeatInterval - 心跳间隔(ms)
   * @param {number} config.heartbeatTimeout - 心跳超时(ms)
   * @param {number} config.maxDevicesPerBridge - 每个桥接程序最大设备数
   */
  constructor(config = {}) {
    this.heartbeatInterval = config.heartbeatInterval || 30000;
    this.heartbeatTimeout = config.heartbeatTimeout || 10000;
    this.maxDevicesPerBridge = config.maxDevicesPerBridge || 10;

    /** @type {Map<string, ConnectionInfo>} - connectionId -> ConnectionInfo */
    this.connections = new Map();

    /** @type {Map<string, string>} - deviceId -> connectionId */
    this.deviceToConnection = new Map();

    /** @type {Map<string, string>} - bridgeId -> Set<deviceId> */
    this.bridgeDevices = new Map();

    /** @type {Map<string, DeviceInfo>} - deviceId -> DeviceInfo */
    this.devices = new Map();

    /** @type {Set<string>} - 等待注册的connectionId */
    this.pendingConnections = new Set();

    // 事件处理
    /** @type {Map<string, Function[]>} */
    this.eventHandlers = new Map();

    // 心跳检测定时器
    this._heartbeatTimer = null;
    this._startHeartbeat();
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
   * 添加待认证连接
   * @param {string} connectionId
   * @param {WebSocket} ws
   * @param {string} remoteIp
   */
  addPendingConnection(connectionId, ws, remoteIp) {
    this.connections.set(connectionId, {
      ws,
      connectionId,
      remoteIp,
      state: ConnectionState.CONNECTING,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
      authInfo: null
    });
    this.pendingConnections.add(connectionId);
    logger.debug('Pending connection added', { connectionId, remoteIp });
  }

  /**
   * 完成连接认证
   * @param {string} connectionId
   * @param {Object} authInfo
   */
  completeAuth(connectionId, authInfo) {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      logger.warn('Connection not found for auth completion', { connectionId });
      return false;
    }

    conn.authInfo = authInfo;
    conn.state = ConnectionState.AUTHENTICATED;
    this.pendingConnections.delete(connectionId);

    logger.info('Connection authenticated', {
      connectionId,
      type: authInfo.type,
      sub: authInfo.sub
    });

    this._emit('connection.authenticated', {
      connectionId,
      ...authInfo
    });

    return true;
  }

  /**
   * 注册设备
   * @param {string} connectionId
   * @param {Object} deviceInfo
   * @returns {{success: boolean, reason?: string}}
   */
  registerDevice(connectionId, deviceInfo) {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return { success: false, reason: 'CONNECTION_NOT_FOUND' };
    }

    // 如果是桥接程序设备，不计入限制
    if (deviceInfo.type === 'bridge') {
      conn.state = ConnectionState.REGISTERED;
      conn.deviceId = deviceInfo.bridgeId;
      return { success: true };
    }

    // 检查每个桥接程序的设备数限制
    const bridgeId = deviceInfo.bridgeId;
    if (bridgeId) {
      const existingDevices = this.bridgeDevices.get(bridgeId) || new Set();
      if (existingDevices.size >= this.maxDevicesPerBridge) {
        logger.warn('Bridge device limit exceeded', {
          bridgeId,
          count: existingDevices.size
        });
        return {
          success: false,
          reason: 'DEVICE_LIMIT_EXCEEDED',
          detail: `Max ${this.maxDevicesPerBridge} devices per bridge`
        };
      }
    }

    // 注册设备
    this.devices.set(deviceInfo.deviceId, {
      ...deviceInfo,
      connectionId,
      registeredAt: Date.now()
    });

    this.deviceToConnection.set(deviceInfo.deviceId, connectionId);

    if (bridgeId) {
      if (!this.bridgeDevices.has(bridgeId)) {
        this.bridgeDevices.set(bridgeId, new Set());
      }
      this.bridgeDevices.get(bridgeId).add(deviceInfo.deviceId);
    }

    conn.state = ConnectionState.READY;
    conn.deviceId = deviceInfo.deviceId;

    logger.info('Device registered', {
      deviceId: deviceInfo.deviceId,
      bridgeId,
      type: deviceInfo.type
    });

    this._emit('device.registered', {
      deviceId: deviceInfo.deviceId,
      connectionId,
      bridgeId
    });

    return { success: true };
  }

  /**
   * 获取设备的连接
   * @param {string} deviceId
   * @returns {ConnectionInfo|null}
   */
  getDeviceConnection(deviceId) {
    const connectionId = this.deviceToConnection.get(deviceId);
    if (!connectionId) return null;
    return this.connections.get(connectionId);
  }

  /**
   * 获取桥接程序的所有设备
   * @param {string} bridgeId
   * @returns {DeviceInfo[]}
   */
  getBridgeDevices(bridgeId) {
    const deviceIds = this.bridgeDevices.get(bridgeId) || new Set();
    return Array.from(deviceIds)
      .map(id => this.devices.get(id))
      .filter(Boolean);
  }

  /**
   * 更新心跳
   * @param {string} connectionId
   */
  updateHeartbeat(connectionId) {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.lastHeartbeat = Date.now();
    }
  }

  /**
   * 移除连接
   * @param {string} connectionId
   * @param {string} [reason]
   */
  removeConnection(connectionId, reason = 'unknown') {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    const { deviceId, ws, state } = conn;

    // 从各索引中移除
    if (deviceId) {
      this.deviceToConnection.delete(deviceId);
      const deviceInfo = this.devices.get(deviceId);
      if (deviceInfo?.bridgeId) {
        const bridgeDevices = this.bridgeDevices.get(deviceInfo.bridgeId);
        if (bridgeDevices) {
          bridgeDevices.delete(deviceId);
          if (bridgeDevices.size === 0) {
            this.bridgeDevices.delete(deviceInfo.bridgeId);
          }
        }
      }
      this.devices.delete(deviceId);

      this._emit('device.disconnected', {
        deviceId,
        connectionId,
        reason
      });
    }

    this.pendingConnections.delete(connectionId);
    this.connections.delete(connectionId);

    logger.info('Connection removed', {
      connectionId,
      deviceId,
      state,
      reason
    });
  }

  /**
   * 启动心跳检测
   * @private
   */
  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      this._checkHeartbeats();
    }, this.heartbeatInterval);
    this._heartbeatTimer.unref();
  }

  /**
   * 检测心跳超时
   * @private
   */
  _checkHeartbeats() {
    const now = Date.now();
    const timeout = this.heartbeatTimeout;

    for (const [connectionId, conn] of this.connections.entries()) {
      if (conn.state === ConnectionState.DISCONNECTED) continue;

      if (now - conn.lastHeartbeat > timeout) {
        logger.warn('Connection heartbeat timeout', {
          connectionId,
          deviceId: conn.deviceId,
          lastHeartbeat: conn.lastHeartbeat,
          now
        });
        conn.ws?.close();
        this.removeConnection(connectionId, 'heartbeat_timeout');
      }
    }
  }

  /**
   * 广播消息到设备的所有者（桥接程序）
   * @param {string} deviceId
   * @param {Object} message
   */
  broadcastToOwner(deviceId, message) {
    const device = this.devices.get(deviceId);
    if (!device || !device.bridgeId) return false;

    const bridgeConn = this.getDeviceConnection(device.bridgeId);
    if (bridgeConn?.ws?.readyState === 1) { // OPEN
      bridgeConn.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const stateCount = {};
    for (const conn of this.connections.values()) {
      stateCount[conn.state] = (stateCount[conn.state] || 0) + 1;
    }

    return {
      totalConnections: this.connections.size,
      totalDevices: this.devices.size,
      pendingConnections: this.pendingConnections.size,
      bridges: this.bridgeDevices.size,
      stateDistribution: stateCount
    };
  }

  /**
   * 关闭
   */
  shutdown() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
    }
    for (const conn of this.connections.values()) {
      conn.ws?.close();
    }
    this.connections.clear();
    this.devices.clear();
    logger.info('DeviceManager shutdown');
  }
}

module.exports = DeviceManager;
module.exports.ConnectionState = ConnectionState;
