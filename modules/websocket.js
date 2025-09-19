import { deps } from "../core/deps.js";

// 模块私有变量
let ws = null;
let wsReconnectTimer = null;
const wsReconnectDelay = 10000; // 10秒重连
let heartbeatTimer = null; // 心跳定时器
let eventListeners = []; // 事件监听器集合

/**
 * 初始化WebSocket模块
 */
export const init = () => {
  try {
    const settings = deps.settings.getSettings();

    // 前置检查（禁用则不初始化）
    if (!settings.masterEnabled || !settings.enabled) {
      console.log(`[websocket] 扩展未启用，跳过初始化`);
      return;
    }

    // 注册扩展禁用事件监听
    const removeDisableListener = deps.EventBus.on(
      "extensionDisable",
      closeWebSocket
    );
    eventListeners.push(removeDisableListener);

    // 初始化连接
    initWebSocket();

    console.log(`[websocket] WebSocket模块初始化完成`);
  } catch (e) {
    deps.toastr.error(`[websocket] 初始化失败: ${e.message}`);
    console.error(`[websocket] 初始化错误:`, e);
  }
};

/**
 * 清理WebSocket模块
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

    // 取消所有事件监听
    eventListeners.forEach((removeListener) => removeListener());
    eventListeners = [];

    console.log(`[websocket] WebSocket模块已清理`);
  } catch (e) {
    deps.toastr.error(`[websocket] 清理失败: ${e.message}`);
    console.error(`[websocket] 清理错误:`, e);
  }
};

/**
 * 实际初始化WebSocket连接
 */
const initWebSocket = () => {
  const settings = deps.settings.getSettings();

  // 前置检查（禁用/已连接则跳过）
  if (!settings.enabled || ws) return;

  // 构建WS地址
  const wsUrl = settings.serviceUrl.replace("http://", "ws://") + "/socket.io";
  console.log(`[websocket] 尝试连接: ${wsUrl}`);

  try {
    ws = new WebSocket(wsUrl);

    // 连接成功
    ws.onopen = () => {
      console.log(`[websocket] 连接成功`);
      deps.toastr.success("WebSocket已连接，媒体库实时更新已启用");

      // 清除重连定时器
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);

      // 启动心跳检测（30秒一次）
      startHeartbeat();

      // 通知其他模块WebSocket就绪
      deps.EventBus.emit("websocketConnected");

      // 刷新媒体列表
      deps.EventBus.emit("requestRefreshMediaList");
    };

    // 接收消息
    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "media_updated":
            // 媒体库更新 → 通知刷新列表
            deps.EventBus.emit("requestRefreshMediaList");
            // 显示更新提示
            if (deps.settings.getSettings().showMediaUpdateToast) {
              deps.toastr.info(
                `媒体库更新: 总计${data.total_count}（图片${data.image_count} | 视频${data.video_count}）`
              );
            }
            // 通知UI更新状态
            deps.EventBus.emit("requestUpdateStatusDisplay");
            break;
          case "pong":
            // 心跳响应 → 无需处理
            break;
          default:
            console.log(`[websocket] 未知消息类型: ${data.type}`);
        }
      } catch (e) {
        console.error(`[websocket] 消息解析失败:`, e);
      }
    };

    // 连接关闭
    ws.onclose = (event) => {
      console.log(`[websocket] 连接关闭（代码: ${event.code}）`);
      ws = null;
      deps.toastr.warning("WebSocket连接已关闭，将自动重连");

      // 清除心跳定时器
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      // 仅在启用时重连
      if (deps.settings.getSettings().enabled) {
        wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
        console.log(`[websocket] ${wsReconnectDelay}ms后尝试重连`);
      }

      // 通知其他模块WebSocket断开
      deps.EventBus.emit("websocketDisconnected");
    };

    // 连接错误
    ws.onerror = (e) => {
      console.error(`[websocket] 连接错误:`, e);
      ws = null;
      deps.toastr.error("WebSocket连接错误");

      // 仅在启用时重连
      if (deps.settings.getSettings().enabled) {
        wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
      }
    };
  } catch (e) {
    console.error(`[websocket] 初始化失败:`, e);
    ws = null;
    deps.toastr.error(`WebSocket初始化失败: ${e.message}`);

    if (deps.settings.getSettings().enabled) {
      wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
    }
  }
};

/**
 * 关闭WebSocket连接
 */
const closeWebSocket = () => {
  if (ws) {
    ws.close(1000, "扩展禁用/关闭");
    ws = null;
  }

  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }

  console.log(`[websocket] 连接已关闭`);
};

/**
 * 启动心跳检测
 */
const startHeartbeat = () => {
  // 清除旧心跳定时器
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  // 30秒发送一次ping
  heartbeatTimer = setInterval(() => {
    const settings = deps.settings.getSettings();
    if (ws?.readyState === WebSocket.OPEN && settings.enabled) {
      ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
    }
  }, 30000);
};

/**
 * 手动发送WebSocket消息（供外部调用）
 */
export const sendWsMessage = (msg) => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    console.log(`[websocket] 发送消息:`, msg);
  } else {
    console.warn(`[websocket] 连接未就绪，无法发送消息`);
  }
};
