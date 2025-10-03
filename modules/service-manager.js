// 服务管理器模块 - 负责后端服务连接和状态管理
import { APIClient } from '../api/apiClient.js';
import { WebSocketClient } from '../api/websocketClient.js';
import { ConfigManager } from '../config/config.js';

class ServiceManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.apiClient = null;
    this.wsClient = null;
    this.configManager = null;
    this.isConnected = false;
    this.mediaList = [];
    this.directories = [];
    this.retryCount = 0;
    this.maxRetries = 3;
    this.retryInterval = 5000; // 5秒重试间隔
    this.retryTimer = null;
  }

  async initialize() {
    try {
      console.log('[ServiceManager] 初始化服务管理器...');
      
      // 初始化配置管理器
      this.configManager = new ConfigManager();
      await this.configManager.load();
      
      // 初始化API客户端
      this.apiClient = new APIClient(this.configManager.getConfig().serviceUrl);
      
      // 初始化WebSocket客户端
      this.wsClient = new WebSocketClient(this.configManager.getConfig().wsUrl, this.eventBus);
      
      // 绑定事件监听器
      this.bindEventListeners();
      
      // 连接服务
      await this.connectToService();
      
      console.log('[ServiceManager] 服务管理器初始化完成');
      return true;
      
    } catch (error) {
      console.error('[ServiceManager] 初始化失败:', error);
      this.eventBus.emit('serviceError', { error: error.message });
      return false;
    }
  }

  bindEventListeners() {
    // WebSocket连接状态变化
    this.wsClient.on('connected', () => {
      console.log('[ServiceManager] WebSocket连接成功');
      this.isConnected = true;
      this.retryCount = 0;
      this.eventBus.emit('serviceConnected');
    });

    this.wsClient.on('disconnected', () => {
      console.log('[ServiceManager] WebSocket连接断开');
      this.isConnected = false;
      this.eventBus.emit('serviceDisconnected');
      this.scheduleReconnect();
    });

    this.wsClient.on('error', (error) => {
      console.error('[ServiceManager] WebSocket错误:', error);
      this.eventBus.emit('serviceError', { error: error.message });
    });

    // 媒体列表更新
    this.wsClient.on('mediaListUpdated', (data) => {
      this.mediaList = data.mediaList || [];
      this.eventBus.emit('mediaListUpdated', { mediaList: this.mediaList });
    });

    // 目录列表更新
    this.wsClient.on('directoriesUpdated', (data) => {
      this.directories = data.directories || [];
      this.eventBus.emit('directoriesUpdated', { directories: this.directories });
    });
  }

  async connectToService() {
    try {
      console.log('[ServiceManager] 连接后端服务...');
      
      // 检查服务状态
      const status = await this.apiClient.checkServiceStatus();
      if (!status.connected) {
        throw new Error('后端服务未启动');
      }
      
      // 连接WebSocket
      await this.wsClient.connect();
      
      // 获取初始媒体列表
      await this.refreshMediaList();
      
      console.log('[ServiceManager] 后端服务连接成功');
      return true;
      
    } catch (error) {
      console.error('[ServiceManager] 连接后端服务失败:', error);
      this.eventBus.emit('serviceError', { error: error.message });
      this.scheduleReconnect();
      return false;
    }
  }

  scheduleReconnect() {
    if (this.retryCount >= this.maxRetries) {
      console.error('[ServiceManager] 达到最大重试次数，停止重连');
      this.eventBus.emit('serviceConnectionFailed');
      return;
    }

    this.retryCount++;
    const delay = this.retryInterval * this.retryCount;
    
    console.log(`[ServiceManager] ${delay/1000}秒后尝试第${this.retryCount}次重连`);
    
    this.retryTimer = setTimeout(() => {
      this.connectToService();
    }, delay);
  }

  async refreshMediaList() {
    try {
      const mediaList = await this.apiClient.getMediaList();
      this.mediaList = mediaList;
      this.eventBus.emit('mediaListUpdated', { mediaList: this.mediaList });
      return mediaList;
    } catch (error) {
      console.error('[ServiceManager] 刷新媒体列表失败:', error);
      throw error;
    }
  }

  async updateDirectories() {
    try {
      const directories = await this.apiClient.updateDirectories();
      this.directories = directories;
      this.eventBus.emit('directoriesUpdated', { directories: this.directories });
      return directories;
    } catch (error) {
      console.error('[ServiceManager] 更新目录列表失败:', error);
      throw error;
    }
  }

  getStatus() {
    return {
      connected: this.isConnected,
      mediaCount: this.mediaList.length,
      directoryCount: this.directories.length,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries
    };
  }

  destroy() {
    console.log('[ServiceManager] 销毁服务管理器...');
    
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.wsClient = null;
    }
    
    if (this.apiClient) {
      this.apiClient = null;
    }
    
    if (this.configManager) {
      this.configManager = null;
    }
    
    this.isConnected = false;
    this.mediaList = [];
    this.directories = [];
    this.retryCount = 0;
    
    console.log('[ServiceManager] 服务管理器销毁完成');
  }
}

export { ServiceManager };