// websocket.js 修复版本
import { deps } from '../core/deps.js';

let websocket = null;
let reconnectTimer = null;
let heartbeatInterval = null;
let isManualClose = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * 初始化WebSocket连接
 */
export const init = () => {
  const settings = deps.settings.get();
  if (!settings.serviceUrl) {
    console.warn(`[websocket] 未配置服务地址，无法初始化WebSocket`);
    return;
  }

  // 清除旧的重连定时器
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // 转换HTTP地址为WebSocket地址
  const wsUrl = settings.serviceUrl.replace(/^http/, 'ws') + '/ws';

  console.log(`[websocket] 尝试连接: ${wsUrl}`);

  try {
    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log(`[websocket] 连接成功: ${wsUrl}`);
      deps.toastr.success("媒体实时同步已启用");
      reconnectAttempts = 0; // 重置重连计数

      // 启动心跳机制
      startHeartbeat();

      deps.EventBus.emit("websocketConnected");
      isManualClose = false;
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[websocket] 收到消息:`, data);

        // 处理心跳响应
        if (data.type === "pong") {
          console.log(`[websocket] 收到心跳响应`);
          return;
        }

        deps.EventBus.emit("websocketMessage", data);

        if (data.type === "media_updated") {
          deps.EventBus.emit("mediaListUpdated", data);
          // 刷新媒体列表
          deps.EventBus.emit("requestRefreshMediaList");
        }
      } catch (e) {
        console.error(`[websocket] 消息解析失败:`, e);
      }
    };

    websocket.onerror = (error) => {
      console.error(`[websocket] 连接错误:`, error);
      deps.toastr.error("媒体同步连接出错");
      
      // 添加具体的错误提示
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(3000, 1000 * (reconnectAttempts + 1));
        console.log(`[websocket] ${delay}ms后重试连接 (尝试 ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
      } else {
        deps.toastr.warning('媒体服务连接失败，请确保已启动后端服务', '连接问题');
      }
    };

    websocket.onclose = (event) => {
      console.log(`[websocket] 连接关闭`, event.code, event.reason);

      // 停止心跳
      stopHeartbeat();

      // 如果不是手动关闭，则尝试重连
      if (!isManualClose && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        // 指数退避算法
        const delay = 2000 * Math.pow(1.5, reconnectAttempts);
        console.log(`[websocket] 将在${delay / 1000}秒后重试 (尝试 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        deps.toastr.info(`媒体同步已断开，${delay / 1000}秒后重连...`);

        reconnectTimer = setTimeout(() => {
          init();
        }, delay);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log(`[websocket] 达到最大重连次数，停止重连`);
        deps.toastr.error("媒体同步连接失败，请检查服务状态");
        // 添加具体的用户提示
        deps.toastr.warning('媒体服务连接失败，请确保已启动后端服务', '连接问题');
      }

      deps.EventBus.emit("websocketDisconnected");
    };
  } catch (e) {
    console.error(`[websocket] 初始化错误:`, e);
    // 10秒后重试
    reconnectTimer = setTimeout(() => {
      init();
    }, 10000);
  }
};

/**
 * 启动心跳机制
 */
const startHeartbeat = () => {
  stopHeartbeat(); // 先停止旧的心跳

  heartbeatInterval = setInterval(() => {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      try {
        websocket.send(JSON.stringify({
          type: "ping",
          timestamp: Date.now()
        }));
        console.log(`[websocket] 发送心跳`);
      } catch (e) {
        console.error(`[websocket] 发送心跳失败:`, e);
      }
    }
  }, 25000); // 25秒发送一次心跳
};

/**
 * 停止心跳机制
 */
const stopHeartbeat = () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
};

/**
 * 关闭WebSocket连接
 */
export const closeWebSocket = () => {
  isManualClose = true;
  stopHeartbeat();

  if (websocket) {
    websocket.close();
    websocket = null;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  reconnectAttempts = 0;
};

/**
 * 清理WebSocket资源
 */
export const cleanup = () => {
  closeWebSocket();
  console.log(`[websocket] 资源清理完成`);
};

/**
 * 获取WebSocket状态
 */
export const getStatus = () => {
  return {
    connected: websocket && websocket.readyState === WebSocket.OPEN,
    readyState: websocket ? websocket.readyState : WebSocket.CLOSED,
    reconnectAttempts: reconnectAttempts
  };
};
