import { deps } from '../core/deps.js';
import { get } from './settings.js';

let websocket = null;
let reconnectTimer = null;

/**
 * 初始化WebSocket连接
 */
export const init = () => {
  const settings = get();
  if (!settings.serviceUrl) {
    deps.toastr.warning("未配置服务地址，无法初始化WebSocket");
    return;
  }

  // 转换HTTP地址为WebSocket地址
  const wsUrl = settings.serviceUrl.replace(/^http/, 'ws') + '/ws';

  const connect = () => {
    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log(`[websocket] 连接成功: ${wsUrl}`);
      deps.toastr.success("媒体实时同步已启用");
      clearTimeout(reconnectTimer);
      deps.EventBus.emit("websocketConnected");
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      deps.EventBus.emit("websocketMessage", data);
      if (data.type === "media_updated") {
        deps.EventBus.emit("mediaListUpdated", data.payload);
      }
    };

    websocket.onerror = (error) => {
      console.error(`[websocket] 错误:`, error);
      deps.toastr.error("媒体同步连接出错");
    };

    websocket.onclose = () => {
      console.log(`[websocket] 连接关闭，将在10秒后重试`);
      deps.toastr.info("媒体同步已断开，正在重连...");

      // 10秒后自动重连
      reconnectTimer = setTimeout(connect, 10000);
      deps.EventBus.emit("websocketDisconnected");
    };
  };

  connect();
};

/**
 * 关闭WebSocket连接
 */
export const closeWebSocket = () => {
  if (websocket) {
    websocket.close();
    websocket = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
};

/**
 * 清理WebSocket资源
 */
export const cleanup = () => {
  closeWebSocket();
  console.log(`[websocket] 资源清理完成`);
};