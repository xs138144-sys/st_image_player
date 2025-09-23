// websocket.js 修复版本 - 适配Flask-SocketIO
import { deps } from '../core/deps.js';

let socket = null;
let reconnectTimer = null;
let heartbeatInterval = null;
let isManualClose = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * 动态加载SocketIO客户端库
 */
const loadSocketIOLibrary = () => {
  return new Promise((resolve, reject) => {
    // 检查是否已经加载
    if (typeof io !== 'undefined') {
      console.log(`[websocket] SocketIO库已加载`);
      resolve();
      return;
    }

    // 创建script标签加载SocketIO
    const script = document.createElement('script');
    script.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
    
    script.onload = () => {
      console.log(`[websocket] SocketIO客户端库加载成功`);
      resolve();
    };
    
    script.onerror = (error) => {
      console.error(`[websocket] SocketIO客户端库加载失败:`, error);
      deps.toastr.error("SocketIO库加载失败，请检查网络");
      reject(error);
    };
    
    document.head.appendChild(script);
  });
};

/**
 * 初始化SocketIO连接
 */
export const init = async () => {
  const settings = deps.settings.get();
  if (!settings.serviceUrl) {
    console.warn(`[websocket] 未配置服务地址，无法初始化SocketIO`);
    return;
  }

  // 清除旧的重连定时器
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // 确保使用正确的SocketIO路径
  const serviceUrl = settings.serviceUrl.replace(/\/$/, ''); // 移除末尾斜杠
  console.log(`[websocket] 尝试连接SocketIO: ${serviceUrl}`);

  try {
    // 动态加载SocketIO客户端库
    if (typeof io === 'undefined') {
      console.log(`[websocket] 动态加载SocketIO客户端库`);
      await loadSocketIOLibrary();
    }

    // 创建SocketIO连接
    socket = io(serviceUrl, {
      transports: ['websocket', 'polling'],
      reconnection: false // 手动处理重连
    });

    socket.on('connect', () => {
      console.log(`[websocket] SocketIO连接成功: ${serviceUrl}`);
      deps.toastr.success("媒体实时同步已启用");
      reconnectAttempts = 0; // 重置重连计数

      // 启动心跳机制
      startHeartbeat();

      deps.EventBus.emit("websocketConnected");
      isManualClose = false;
    });

    socket.on('init', (data) => {
      console.log(`[websocket] 收到初始化消息，媒体总数: ${data.total_count}`);
      deps.EventBus.emit("websocketInitialized", data);
    });

    socket.on('media_updated', (data) => {
      console.log(`[websocket] 收到媒体更新消息:`, data);
      deps.EventBus.emit("websocketMessage", data);
      deps.EventBus.emit("mediaListUpdated", data);
      deps.EventBus.emit("requestRefreshMediaList");
    });

    socket.on('pong', (data) => {
      console.log(`[websocket] 收到心跳响应`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[websocket] SocketIO连接断开:`, reason);

      // 停止心跳
      stopHeartbeat();

      // 如果不是手动关闭，则尝试重连
      if (!isManualClose && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(30000, Math.pow(2, reconnectAttempts) * 1000); // 指数退避
        console.log(`[websocket] 将在${delay / 1000}秒后重试 (尝试 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        deps.toastr.info(`媒体同步已断开，${delay / 1000}秒后重连...`);

        reconnectTimer = setTimeout(() => {
          init();
        }, delay);
      } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log(`[websocket] 达到最大重连次数，停止重连`);
        deps.toastr.error("媒体同步连接失败，请检查服务状态");
      }

      deps.EventBus.emit("websocketDisconnected");
    });

    socket.on('connect_error', (error) => {
      console.error(`[websocket] SocketIO连接错误:`, error);
      deps.toastr.error("媒体同步连接出错");
    });

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
    if (socket && socket.connected) {
      try {
        socket.emit('ping', {
          type: "ping",
          timestamp: Date.now()
        });
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
 * 关闭SocketIO连接
 */
export const closeWebSocket = () => {
  isManualClose = true;
  stopHeartbeat();

  if (socket) {
    socket.disconnect();
    socket = null;
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
 * 获取SocketIO状态
 */
export const getStatus = () => {
  return {
    connected: socket ? socket.connected : false,
    readyState: socket ? (socket.connected ? 1 : 0) : 0, // 1=OPEN, 0=CLOSED
    reconnectAttempts: reconnectAttempts
  };
};

/**
 * 重新连接SocketIO（外部调用）
 */
export const reconnect = () => {
  console.log(`[websocket] 手动触发重连`);
  isManualClose = false;
  reconnectAttempts = 0;
  
  // 先关闭现有连接
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  // 停止心跳和重连定时器
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  // 立即重新连接
  init();
};

/**
 * 检查并修复SocketIO连接状态
 */
export const checkAndFixConnection = () => {
  const status = getStatus();
  
  if (!status.connected && !isManualClose) {
    console.log(`[websocket] 检测到异常关闭，尝试重新连接`);
    reconnect();
    return true;
  }
  
  return false;
};

// 添加定时检查连接状态
setInterval(() => {
  checkAndFixConnection();
}, 30000); // 每30秒检查一次连接状态