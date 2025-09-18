import { getSettings, saveSafeSettings } from "./settings.js";
import { refreshMediaList } from "./api.js";
import { getSafeToastr } from "./utils.js";

let ws = null;
let wsReconnectTimer = null;
const wsReconnectDelay = 10000; // 10秒重连
const toastr = getSafeToastr();

/**
 * 初始化WebSocket连接
 */
export const initWebSocket = () => {
  const settings = getSettings();

  // 1. 前置检查（禁用/已连接则跳过）
  if (!settings.enabled || ws) return;

  // 2. 构建WS地址
  const wsUrl = settings.serviceUrl.replace("http://", "ws://") + "/socket.io";
  console.log(`[WebSocket] 尝试连接: ${wsUrl}`);

  // 3. 创建WS实例
  try {
    ws = new WebSocket(wsUrl);

    // 4. 连接成功
    ws.onopen = () => {
      console.log(`[WebSocket] 连接成功`);
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      refreshMediaList(); // 连接成功后刷新媒体列表
    };

    // 5. 接收消息
    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "media_updated":
            // 媒体库更新 → 刷新列表
            await refreshMediaList();
            if (settings.showMediaUpdateToast) {
              toastr.info(
                `媒体库更新: 总计${data.total_count}（图片${data.image_count} | 视频${data.video_count}）`
              );
            }
            // 同步状态显示（需引入UI模块，避免循环依赖）
            await import("./ui.js").then(({ updateStatusDisplay }) =>
              updateStatusDisplay()
            );
            break;
          case "pong":
            // 心跳响应 → 无需处理
            break;
          default:
            console.log(`[WebSocket] 未知消息类型: ${data.type}`);
        }
      } catch (e) {
        console.error(`[WebSocket] 消息解析失败:`, e);
      }
    };

    // 6. 连接关闭
    ws.onclose = (event) => {
      console.log(`[WebSocket] 连接关闭（代码: ${event.code}）`);
      ws = null;
      // 仅在启用时重连
      if (getSettings().enabled) {
        wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
        console.log(`[WebSocket] ${wsReconnectDelay}ms后尝试重连`);
      }
    };

    // 7. 连接错误
    ws.onerror = (e) => {
      console.error(`[WebSocket] 连接错误:`, e);
      ws = null;
      // 仅在启用时重连
      if (getSettings().enabled) {
        wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
      }
    };

    // 8. 心跳检测（30秒一次）
    setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && getSettings().enabled) {
        ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, 30000);
  } catch (e) {
    console.error(`[WebSocket] 初始化失败:`, e);
    ws = null;
    if (getSettings().enabled) {
      wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
    }
  }
};

/**
 * 关闭WebSocket连接
 */
export const closeWebSocket = () => {
  if (ws) {
    ws.close(1000, "扩展禁用/关闭");
    ws = null;
  }
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  console.log(`[WebSocket] 连接已关闭`);
};

/**
 * 手动发送WebSocket消息
 * @param {object} msg - 消息对象
 */
export const sendWsMessage = (msg) => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
};
