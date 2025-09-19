import { deps } from "../core/deps.js";

const { EventBus, toastr, settings: { get } } = deps;
let websocket = null;
let heartbeatTimer = null;
let reconnectTimeout = null;

/**
 * 初始化WebSocket连接
 */
export const init = () => {
  connectWebSocket();

  // 监听扩展禁用事件
  window.wsDisableListener = EventBus.on("extensionDisable", cleanup);
  console.log(`[websocket] 模块初始化完成`);
};

/**
 * 建立WebSocket连接
 */
const connectWebSocket = () => {
  const settings = get();
  if (!settings.masterEnabled) return;

  // 关闭现有连接
  closeWebSocket();

  try {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${new URL(settings.serviceUrl).host}/ws`;

    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log(`[websocket] 连接成功: ${wsUrl}`);
      toastr.success("媒体库实时同步已启用");
      startHeartbeat();
      clearTimeout(reconnectTimeout);
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "media_updated") {
        console.log(`[websocket] 媒体库更新，刷新列表`);
        EventBus.emit("requestRefreshMediaList");
      }
    };

    websocket.onclose = (event) => {
      console.log(`[websocket] 连接关闭 (code: ${event.code})，准备重连`);
      stopHeartbeat();
      scheduleReconnect();
    };

    websocket.onerror = (error) => {
      console.error(`[websocket] 错误:`, error);
      toastr.error("媒体库同步连接出错");
    };
  } catch (e) {
    console.error(`[websocket] 连接失败:`, e);
    scheduleReconnect();
  }
};

/**
 * 关闭WebSocket连接
 */
export const closeWebSocket = () => {
  if (websocket) {
    websocket.close(1000, "正常关闭");
    websocket = null;
  }
};

/**
 * 启动心跳检测
 */
const startHeartbeat = () => {
  // 每30秒发送一次心跳
  heartbeatTimer = setInterval(() => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: "heartbeat" }));
    }
  }, 30000);
};

/**
 * 停止心跳检测
 */
const stopHeartbeat = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

/**
 * 安排重连
 */
const scheduleReconnect = () => {
  const settings = get();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);

  reconnectTimeout = setTimeout(() => {
    if (get().masterEnabled) { // 再次检查是否启用
      console.log(`[websocket] 尝试重连...`);
      connectWebSocket();
    }
  }, settings.websocket_timeout || 10000);
};

/**
 * 清理WebSocket资源
 */
export const cleanup = () => {
  try {
    // 关闭WebSocket连接
    closeWebSocket();

    // 清除心跳定时器
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // 清除重连定时器
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    // 取消事件监听
    if (window.wsDisableListener) {
      window.wsDisableListener();
      window.wsDisableListener = null;
    }

    console.log(`[websocket] 资源清理完成`);
  } catch (e) {
    toastr.error(`[websocket] 清理失败: ${e.message}`);
    console.error(`[websocket] 清理错误:`, e);
  }
};