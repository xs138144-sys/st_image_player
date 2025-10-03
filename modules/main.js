// 主入口模块 - 整合所有模块功能
import { ConfigManager } from '../config/config.js';
import { APIClient } from '../api/apiClient.js';
import { WebSocketClient } from '../api/websocketClient.js';
import { MediaPlayer } from '../modules/mediaPlayer.js';
import { PlayerWindow } from '../ui/playerWindow.js';
import { EventBus, ErrorHandler, PerformanceMonitor } from '../utils/helpers.js';

class ImagePlayerExtension {
    constructor() {
        this.eventBus = new EventBus();
        this.configManager = new ConfigManager(this.eventBus);
        this.apiClient = new APIClient();
        this.wsClient = null;
        this.mediaPlayer = null;
        this.playerWindow = null;
        
        this.isInitialized = false;
        this.mediaList = [];
        this.currentMedia = null;
    }

    // 初始化扩展
    async initialize() {
        PerformanceMonitor.startMark('extension-initialize');
        
        try {
            console.log('[ImagePlayerExtension] 开始初始化扩展...');
            
            // 1. 加载配置
            await this.configManager.loadConfig();
            console.log('[ImagePlayerExtension] 配置加载完成');
            
            // 2. 检查后端服务状态
            const isServiceAvailable = await this.apiClient.checkServiceStatus();
            if (!isServiceAvailable) {
                console.warn('[ImagePlayerExtension] 后端服务不可用');
                this.showServiceError();
                return false;
            }
            console.log('[ImagePlayerExtension] 后端服务连接正常');
            
            // 3. 初始化WebSocket连接
            const settings = await this.configManager.getConfig();
            const wsUrl = settings.serviceUrl.replace('http://', 'ws://') + '/socket.io';
            this.wsClient = new WebSocketClient(wsUrl, this.eventBus);
            await this.wsClient.connect();
            console.log('[ImagePlayerExtension] WebSocket连接已建立');
            
            // 绑定事件（在WebSocket连接建立后）
            this.bindEvents();
            
            // 4. 加载媒体列表
            await this.loadMediaList();
            console.log(`[ImagePlayerExtension] 媒体列表加载完成，共 ${this.mediaList.length} 个文件`);
            
            // 5. 创建播放器窗口
            this.playerWindow = new PlayerWindow();
            this.playerWindow.create();
            console.log('[ImagePlayerExtension] 播放器窗口已创建');
            
            // 6. 创建媒体播放器
            const config = await this.configManager.getConfig();
            this.mediaPlayer = new MediaPlayer(this.mediaList, this.configManager, this.eventBus);
            await this.mediaPlayer.initialize();
            console.log('[ImagePlayerExtension] 媒体播放器已初始化');
            
            // 7. 绑定播放器事件
            this.bindPlayerEvents();
            
            this.isInitialized = true;
            
            PerformanceMonitor.endMark('extension-initialize');
            console.log('[ImagePlayerExtension] 扩展初始化完成');
            
            this.eventBus.emit('extensionReady');
            return true;
            
        } catch (error) {
            const errorInfo = ErrorHandler.handle(error, 'extension-initialize');
            console.error('[ImagePlayerExtension] 初始化失败:', errorInfo);
            this.showInitializationError(errorInfo);
            return false;
        }
    }

    // 绑定事件
    bindEvents() {
        // 配置变化事件
        this.eventBus.on('configChanged', (newConfig) => {
            this.handleConfigChange(newConfig);
        });
        
        // WebSocket消息事件（仅在WebSocket客户端可用时绑定）
        if (this.wsClient) {
            this.wsClient.on('mediaUpdate', (data) => {
                this.handleMediaUpdate(data);
            });
            
            this.wsClient.on('directoryUpdate', (data) => {
                this.handleDirectoryUpdate(data);
            });
            
            this.wsClient.on('serviceStatus', (data) => {
                this.handleServiceStatus(data);
            });
        } else {
            console.warn('[ImagePlayerExtension] WebSocket客户端不可用，跳过事件绑定');
        }
        
        // 窗口事件
        this.eventBus.on('windowClosed', () => {
            this.handleWindowClose();
        });
        
        this.eventBus.on('windowMinimized', () => {
            this.handleWindowMinimize();
        });
    }

    // 绑定播放器事件
    bindPlayerEvents() {
        if (!this.playerWindow || !this.mediaPlayer) return;
        
        // 播放器控制事件
        this.playerWindow.on('previous', () => {
            this.mediaPlayer.previous();
        });
        
        this.playerWindow.on('next', () => {
            this.mediaPlayer.next();
        });
        
        this.playerWindow.on('togglePlay', () => {
            this.mediaPlayer.togglePlay();
        });
        
        this.playerWindow.on('toggleMode', () => {
            this.mediaPlayer.toggleMode();
        });
        
        this.playerWindow.on('filterChange', (filter) => {
            this.mediaPlayer.setFilter(filter);
        });
        
        // 媒体播放器事件
        this.mediaPlayer.on('mediaChanged', (media) => {
            this.playerWindow.displayMedia(media);
        });
        
        this.mediaPlayer.on('playStateChanged', (isPlaying) => {
            this.playerWindow.updatePlayState(isPlaying);
        });
        
        this.mediaPlayer.on('modeChanged', (mode) => {
            this.playerWindow.updateMode(mode);
        });
    }

    // 加载媒体列表
    async loadMediaList() {
        try {
            PerformanceMonitor.startMark('load-media-list');
            
            const config = await this.configManager.getConfig();
            const mediaList = await this.apiClient.getMediaList(config.mediaDirectories);
            
            if (mediaList && Array.isArray(mediaList)) {
                this.mediaList = mediaList;
                this.eventBus.emit('mediaListLoaded', this.mediaList);
            } else {
                console.warn('[ImagePlayerExtension] 媒体列表为空或格式错误');
                this.mediaList = [];
            }
            
            PerformanceMonitor.endMark('load-media-list');
            
        } catch (error) {
            ErrorHandler.handle(error, 'load-media-list');
            this.mediaList = [];
        }
    }

    // 处理媒体变化
    handleMediaChange(media) {
        this.currentMedia = media;
        this.eventBus.emit('mediaChanged', media);
    }

    // 处理播放状态变化
    handlePlayStateChange(isPlaying) {
        this.eventBus.emit('playStateChanged', isPlaying);
    }

    // 处理播放模式变化
    async handleModeChange(mode) {
        await this.configManager.updateConfig({ playMode: mode });
        this.eventBus.emit('modeChanged', mode);
    }

    // 处理配置变化
    handleConfigChange(newConfig) {
        console.log('[ImagePlayerExtension] 配置已更新:', newConfig);
        
        // 更新相关组件
        if (this.mediaPlayer) {
            this.mediaPlayer.updateSettings(newConfig);
        }
        
        if (this.playerWindow) {
            this.playerWindow.updateSettings(newConfig);
        }
        
        // 处理特定配置变化
        if (newConfig.mediaDirectories) {
            this.loadMediaList();
        }
    }

    // 处理媒体更新
    handleMediaUpdate(data) {
        console.log('[ImagePlayerExtension] 收到媒体更新:', data);
        
        if (data.action === 'add') {
            this.mediaList.push(data.media);
        } else if (data.action === 'remove') {
            this.mediaList = this.mediaList.filter(m => m.rel_path !== data.media.rel_path);
        } else if (data.action === 'update') {
            const index = this.mediaList.findIndex(m => m.rel_path === data.media.rel_path);
            if (index !== -1) {
                this.mediaList[index] = data.media;
            }
        }
        
        if (this.mediaPlayer) {
            this.mediaPlayer.updateMediaList(this.mediaList);
        }
        
        this.eventBus.emit('mediaListUpdated', this.mediaList);
    }

    // 处理目录更新
    handleDirectoryUpdate(data) {
        console.log('[ImagePlayerExtension] 收到目录更新:', data);
        
        // 重新加载媒体列表
        this.loadMediaList();
    }

    // 处理服务状态
    handleServiceStatus(data) {
        console.log('[ImagePlayerExtension] 服务状态:', data);
        
        if (data.status === 'offline') {
            this.showServiceError();
        } else if (data.status === 'online') {
            this.hideServiceError();
            this.loadMediaList();
        }
    }

    // 处理窗口关闭
    handleWindowClose() {
        console.log('[ImagePlayerExtension] 播放器窗口已关闭');
        
        if (this.mediaPlayer) {
            this.mediaPlayer.stop();
        }
        
        this.eventBus.emit('extensionStopped');
    }

    // 处理窗口最小化
    handleWindowMinimize() {
        console.log('[ImagePlayerExtension] 播放器窗口已最小化');
        
        if (this.mediaPlayer) {
            this.mediaPlayer.pause();
        }
    }

    // 显示服务错误
    showServiceError() {
        // 在实际实现中，这里应该显示错误提示
        console.error('[ImagePlayerExtension] 后端服务不可用');
        this.eventBus.emit('serviceError');
    }

    // 隐藏服务错误
    hideServiceError() {
        this.eventBus.emit('serviceRecovered');
    }

    // 显示初始化错误
    showInitializationError(errorInfo) {
        // 在实际实现中，这里应该显示错误提示
        console.error('[ImagePlayerExtension] 初始化失败:', errorInfo);
        this.eventBus.emit('initializationError', errorInfo);
    }

    // 获取扩展状态
    async getStatus() {
        const config = await this.configManager.getConfig();
        return {
            initialized: this.isInitialized,
            serviceConnected: this.apiClient.isConnected,
            websocketConnected: this.wsClient ? this.wsClient.isConnected : false,
            mediaCount: this.mediaList.length,
            currentMedia: this.currentMedia,
            settings: config
        };
    }

    // 销毁扩展
    destroy() {
        console.log('[ImagePlayerExtension] 开始销毁扩展...');
        
        if (this.mediaPlayer) {
            this.mediaPlayer.destroy();
            this.mediaPlayer = null;
        }
        
        if (this.playerWindow) {
            this.playerWindow.destroy();
            this.playerWindow = null;
        }
        
        if (this.wsClient) {
            this.wsClient.disconnect();
        }
        
        this.eventBus.emit('extensionDestroyed');
        this.eventBus = null;
        
        this.isInitialized = false;
        console.log('[ImagePlayerExtension] 扩展已销毁');
    }

    // 重新加载扩展
    async reload() {
        console.log('[ImagePlayerExtension] 重新加载扩展...');
        
        this.destroy();
        
        // 等待一小段时间让资源释放
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return await this.initialize();
    }
}

// 创建全局实例
let extensionInstance = null;

// 初始化函数
export async function initializeExtension() {
    if (!extensionInstance) {
        extensionInstance = new ImagePlayerExtension();
    }
    
    return await extensionInstance.initialize();
}

// 获取实例
export function getExtensionInstance() {
    return extensionInstance;
}

// 销毁函数
export function destroyExtension() {
    if (extensionInstance) {
        extensionInstance.destroy();
        extensionInstance = null;
    }
}

// 重新加载函数
export async function reloadExtension() {
    if (extensionInstance) {
        return await extensionInstance.reload();
    }
    return await initializeExtension();
}

// 获取状态
export async function getExtensionStatus() {
    return extensionInstance ? await extensionInstance.getStatus() : null;
}

export default ImagePlayerExtension;