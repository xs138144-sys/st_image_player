import { deps } from "../core/deps.js";

const { EventBus, toastr, settings: { get, save } } = deps;
let websocket = null;
let heartbeatTimer = null;
let reconnectTimeout = null;
let ws = null; // WebSocket实例
const DEFAULT_RECONNECT_DELAY = 10000; // 默认10秒重连

/**
 * 初始化WebSocket连接
 */
export const init = () => {
  const settings = get();
  // 前置检查（禁用则不初始化）
  if (!settings.masterEnabled || !settings.enabled) {
    console.log(`[websocket] 扩展未启用，跳过初始化`);
    return;
  }

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
  if (!settings.masterEnabled || !settings.enabled) return;

  // 关闭现有连接
  closeWebSocket();

  try {
    // 构建WS地址（兼容旧版逻辑，优先使用设置中的地址转换）
    const wsUrl = settings.serviceUrl
      ? settings.serviceUrl.replace("http://", "ws://").replace("https://", "wss://") + "/socket.io"
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

    websocket = new WebSocket(wsUrl);
    console.log(`[websocket] 尝试连接: ${wsUrl}`);

    websocket.onopen = () => {
      console.log(`[websocket] 连接成功`);
      toastr.success("WebSocket已连接，媒体库实时更新已启用");
      startHeartbeat();
      clearTimeout(reconnectTimeout);

      // 通知其他模块并刷新媒体列表
      EventBus.emit("websocketConnected");
      EventBus.emit("requestRefreshMediaList");
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "media_updated":
            // 媒体库更新 → 通知刷新列表
            EventBus.emit("requestRefreshMediaList");
            // 显示详细更新提示（保留旧版优点）
            if (get().showMediaUpdateToast) {
              toastr.info(
                `媒体库更新: 总计${data.total_count}（图片${data.image_count} | 视频${data.video_count}）`
              );
            }
            // 通知UI更新状态
            EventBus.emit("requestUpdateStatusDisplay");
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

    websocket.onclose = (event) => {
      console.log(`[websocket] 连接关闭（代码: ${event.code}）`);
      websocket = null;
      toastr.warning("WebSocket连接已关闭，将自动重连");

      stopHeartbeat();
      scheduleReconnect();

      // 通知其他模块连接断开
      EventBus.emit("websocketDisconnected");
    };

    websocket.onerror = (error) => {
      console.error(`[websocket] 连接错误:`, error);
      toastr.error("WebSocket连接错误");
      websocket = null;
      scheduleReconnect();
    };
  } catch (e) {
    console.error(`[websocket] 连接失败:`, e);
    toastr.error(`WebSocket初始化失败: ${e.message}`);
    scheduleReconnect();
  }
};

// 实现关闭连接函数
const closeWebSocket = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "扩展清理");
    console.log(`[websocket] 连接已关闭`);
  }
  ws = null;
};
/**
 * 启动心跳检测（保留旧版30秒间隔，发送ping类型）
 */
const startHeartbeat = () => {
  // 清除旧心跳定时器
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  // 30秒发送一次ping
  heartbeatTimer = setInterval(() => {
    const settings = get();
    if (websocket?.readyState === WebSocket.OPEN && settings.enabled) {
      websocket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
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
 * 安排重连（使用设置中的超时时间或默认值）
 */
const scheduleReconnect = () => {
  const settings = get();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);

  const reconnectDelay = settings.websocket_timeout || DEFAULT_RECONNECT_DELAY;
  reconnectTimeout = setTimeout(() => {
    const currentSettings = get();
    if (currentSettings.masterEnabled && currentSettings.enabled) {
      console.log(`[websocket] ${reconnectDelay}ms后尝试重连...`);
      connectWebSocket();
    }
  }, reconnectDelay);
};

/**
 * 手动发送WebSocket消息（保留旧版外部调用功能）
 */
export const sendWsMessage = (msg) => {
  if (websocket?.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify(msg));
    console.log(`[websocket] 发送消息:`, msg);
  } else {
    console.warn(`[websocket] 连接未就绪，无法发送消息`);
  }
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