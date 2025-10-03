// WebSocket通信客户端模块
import { ConfigManager } from '../config/config.js';

class WebSocketClient {
    constructor(wsUrl, eventBus) {
        this.ws = null;
        this.wsUrl = wsUrl;
        this.eventBus = eventBus;
        this.reconnectDelay = 10000;
        this.reconnectTimer = null;
        this.heartbeatInterval = null;
        this.messageHandlers = new Map();
        this.connectionCallbacks = [];
        this.disconnectionCallbacks = [];
    }

    // 注册消息处理器
    on(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
    }

    // 注册连接回调
    onConnect(callback) {
        this.connectionCallbacks.push(callback);
    }

    // 注册断开连接回调
    onDisconnect(callback) {
        this.disconnectionCallbacks.push(callback);
    }

    // 初始化WebSocket连接
    connect() {
        if (this.ws) return;

        try {
            const wsUrl = this.wsUrl || 'ws://localhost:9000/socket.io';
            this.ws = new WebSocket(wsUrl);
            console.log(`[WebSocket] 尝试连接: ${wsUrl}`);

            this.ws.onopen = () => this.handleOpen();
            this.ws.onmessage = (event) => this.handleMessage(event);
            this.ws.onclose = () => this.handleClose();
            this.ws.onerror = (error) => this.handleError(error);

        } catch (error) {
            console.error('[WebSocket] 初始化失败', error);
            this.scheduleReconnect();
        }
    }

    // 处理连接打开
    handleOpen() {
        console.log('[WebSocket] 连接成功');
        this.clearReconnectTimer();
        
        // 触发连接事件
        if (this.eventBus) {
            this.eventBus.emit('websocketConnected');
        }
        
        // 执行连接回调
        this.connectionCallbacks.forEach(callback => callback());
        
        // 启动心跳检测
        this.startHeartbeat();
    }

    // 处理接收消息
    handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('[WebSocket] 收到消息:', message);
            
            // 触发消息接收事件
            if (this.eventBus) {
                this.eventBus.emit('websocketMessageReceived', message);
            }
            
            // 调用对应的消息处理器
            const handlers = this.messageHandlers.get(message.type) || [];
            handlers.forEach(handler => handler(message));
        } catch (error) {
            console.error('[WebSocket] 消息解析失败', error);
            
            // 触发消息解析错误事件
            if (this.eventBus) {
                this.eventBus.emit('websocketParseError', { error, rawData: event.data });
            }
        }
    }

    // 处理连接关闭
    handleClose() {
        console.log('[WebSocket] 连接关闭');
        this.ws = null;
        this.stopHeartbeat();
        
        // 触发断开连接事件
        if (this.eventBus) {
            this.eventBus.emit('websocketDisconnected');
        }
        
        // 执行断开连接回调
        this.disconnectionCallbacks.forEach(callback => callback());
        
        // 安排重连
        this.scheduleReconnect();
    }

    // 处理连接错误
    handleError(error) {
        console.error('[WebSocket] 连接错误', error);
        this.ws = null;
        
        // 触发错误事件
        if (this.eventBus) {
            this.eventBus.emit('websocketError', { error });
        }
        
        // 安排重连
        this.scheduleReconnect();
    }

    // 发送消息
    sendMessage(type, data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('[WebSocket] 连接未就绪，无法发送消息');
            
            // 触发发送失败事件
            if (this.eventBus) {
                this.eventBus.emit('websocketSendError', { type, data, error: '连接未就绪' });
            }
            return false;
        }
        
        const message = { type, data, timestamp: Date.now() };
        this.ws.send(JSON.stringify(message));
        
        // 触发发送成功事件
        if (this.eventBus) {
            this.eventBus.emit('websocketMessageSent', { type, data });
        }
        return true;
    }

    // 启动心跳检测
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.sendMessage('ping', { timestamp: Date.now() });
            }
        }, 30000);
    }

    // 停止心跳检测
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    // 安排重连
    scheduleReconnect() {
        this.clearReconnectTimer();
        console.log(`[WebSocket] ${this.reconnectDelay / 1000}秒后尝试重连...`);
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, this.reconnectDelay);
    }

    // 清除重连定时器
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    // 断开连接
    disconnect() {
        this.clearReconnectTimer();
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            
            // 触发断开连接事件
            if (this.eventBus) {
                this.eventBus.emit('websocketDisconnected');
            }
        }
    }

    // 获取连接状态
    getStatus() {
        if (!this.ws) return 'disconnected';
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'connecting';
            case WebSocket.OPEN: return 'connected';
            case WebSocket.CLOSING: return 'closing';
            case WebSocket.CLOSED: return 'disconnected';
            default: return 'unknown';
        }
    }
}

export { WebSocketClient };