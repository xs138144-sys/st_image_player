// 媒体播放器核心模块
import { ConfigManager } from '../config/config.js';
import { APIClient } from '../api/apiClient.js';

class MediaPlayer {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.configManager = new ConfigManager();
        this.settings = this.configManager.getConfig();
        this.apiClient = new APIClient(this.settings.serviceUrl);
        
        this.mediaList = [];
        this.currentIndex = 0;
        this.switchTimer = null;
        this.preloadedMedia = null;
        this.currentMediaType = 'image';
    }

    // 初始化播放器
    async initialize() {
        try {
            await this.refreshMediaList();
            this.eventBus.emit('mediaPlayerReady', { mediaCount: this.mediaList.length });
        } catch (error) {
            console.error('[MediaPlayer] 初始化失败', error);
            this.eventBus.emit('mediaPlayerError', { type: 'init', error });
        }
    }

    // 刷新媒体列表
    async refreshMediaList() {
        const oldListLength = this.mediaList.length;
        
        try {
            this.mediaList = await this.apiClient.fetchMediaList(this.settings.mediaFilter);
            this.settings.randomMediaList = [...this.mediaList];
            
            if (this.mediaList.length === 0) {
                this.currentIndex = 0;
                this.settings.randomPlayedIndices = [];
                this.settings.currentRandomIndex = -1;
                this.eventBus.emit('mediaEmpty', { filter: this.settings.mediaFilter });
            } else if (this.mediaList.length !== oldListLength) {
                this.currentIndex = 0;
                this.settings.randomPlayedIndices = [];
                this.settings.currentRandomIndex = -1;
            }
            
            this.eventBus.emit('mediaListUpdated', { 
                mediaList: this.mediaList, 
                totalCount: this.mediaList.length 
            });
            
            return this.mediaList;
        } catch (error) {
            console.error('[MediaPlayer] 刷新媒体列表失败', error);
            this.eventBus.emit('mediaPlayerError', { type: 'refreshMedia', error });
            throw error;
        }
    }

    // 获取当前媒体
    getCurrentMedia() {
        if (this.mediaList.length === 0) return null;
        return this.mediaList[this.currentIndex];
    }

    // 获取下一个媒体索引
    getNextIndex() {
        if (this.mediaList.length === 0) return -1;
        
        if (this.settings.playMode === 'random') {
            return this.getRandomIndex();
        } else {
            return (this.currentIndex + 1) % this.mediaList.length;
        }
    }

    // 获取随机索引
    getRandomIndex() {
        if (this.mediaList.length === 0) return -1;
        
        // 如果所有媒体都已播放过，重置播放记录
        if (this.settings.randomPlayedIndices.length >= this.mediaList.length) {
            this.settings.randomPlayedIndices = [];
            this.eventBus.emit('playlistReset', { total: this.mediaList.length });
        }
        
        // 获取未播放的媒体索引
        const availableIndices = Array.from({ length: this.mediaList.length }, (_, i) => i)
            .filter(i => !this.settings.randomPlayedIndices.includes(i));
        
        if (availableIndices.length === 0) return -1;
        
        const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
        this.settings.randomPlayedIndices.push(randomIndex);
        this.settings.currentRandomIndex = randomIndex;
        
        return randomIndex;
    }

    // 切换到下一个媒体
    next() {
        const nextIndex = this.getNextIndex();
        if (nextIndex === -1) return null;
        
        this.currentIndex = nextIndex;
        const media = this.getCurrentMedia();
        
        this.eventBus.emit('mediaChanged', { 
            media, 
            index: this.currentIndex, 
            total: this.mediaList.length 
        });
        
        return media;
    }

    // 切换到上一个媒体
    previous() {
        if (this.mediaList.length === 0) return null;
        
        if (this.settings.playMode === 'random') {
            // 随机模式下，上一个为播放记录中的前一个
            if (this.settings.randomPlayedIndices.length > 1) {
                this.settings.randomPlayedIndices.pop(); // 移除当前
                this.currentIndex = this.settings.randomPlayedIndices[this.settings.randomPlayedIndices.length - 1] || 0;
            } else {
                this.currentIndex = 0;
            }
        } else {
            // 顺序模式下，上一个为索引减一
            this.currentIndex = (this.currentIndex - 1 + this.mediaList.length) % this.mediaList.length;
        }
        
        const media = this.getCurrentMedia();
        this.eventBus.emit('mediaChanged', { media, index: this.currentIndex, total: this.mediaList.length });
        
        return media;
    }

    // 开始播放
    startPlayback() {
        if (this.switchTimer) {
            clearTimeout(this.switchTimer);
        }
        
        if (this.mediaList.length === 0) {
            this.eventBus.emit('playbackStopped', { reason: 'noMedia' });
            return;
        }
        
        this.settings.isPlaying = true;
        this.scheduleNextSwitch();
        this.eventBus.emit('playbackStarted', { mode: this.settings.autoSwitchMode });
    }

    // 停止播放
    stopPlayback() {
        if (this.switchTimer) {
            clearTimeout(this.switchTimer);
            this.switchTimer = null;
        }
        
        this.settings.isPlaying = false;
        this.eventBus.emit('playbackStopped', { reason: 'manual' });
    }

    // 安排下一次切换
    scheduleNextSwitch() {
        if (!this.settings.isPlaying) return;
        
        if (this.settings.autoSwitchMode === 'timer') {
            this.switchTimer = setTimeout(() => {
                this.next();
                this.scheduleNextSwitch();
            }, this.settings.switchInterval);
        }
    }

    // 切换播放模式
    async togglePlayMode() {
        this.settings.playMode = this.settings.playMode === 'random' ? 'sequential' : 'random';
        this.settings.randomPlayedIndices = [];
        this.settings.currentRandomIndex = -1;
        
        this.eventBus.emit('playModeChanged', { mode: this.settings.playMode });
        await this.configManager.updateConfig({ playMode: this.settings.playMode });
    }

    // 切换媒体筛选
    async setMediaFilter(filter) {
        this.settings.mediaFilter = filter;
        await this.refreshMediaList();
        
        this.eventBus.emit('mediaFilterChanged', { filter });
        await this.configManager.updateConfig({ mediaFilter: filter });
    }

    // 预加载媒体
    preloadMedia(index) {
        if (index < 0 || index >= this.mediaList.length) return;
        
        const media = this.mediaList[index];
        if (!media) return;
        
        if (this.settings.preloadImages && media.media_type === 'image') {
            this.preloadImage(media);
        } else if (this.settings.preloadVideos && media.media_type === 'video') {
            this.preloadVideo(media);
        }
    }

    // 预加载图片
    preloadImage(media) {
        const img = new Image();
        img.src = `${this.settings.serviceUrl}/file/${encodeURIComponent(media.rel_path)}`;
        this.preloadedMedia = img;
    }

    // 预加载视频
    preloadVideo(media) {
        const video = document.createElement('video');
        video.src = `${this.settings.serviceUrl}/file/${encodeURIComponent(media.rel_path)}`;
        video.preload = 'metadata';
        this.preloadedMedia = video;
    }

    // 清理播放器状态
    cleanup() {
        this.stopPlayback();
        this.mediaList = [];
        this.currentIndex = 0;
        this.preloadedMedia = null;
        this.settings.randomPlayedIndices = [];
        this.settings.currentRandomIndex = -1;
        
        this.eventBus.emit('cleanup', {});
    }

    // 销毁播放器
    destroy() {
        console.log('[MediaPlayer] 销毁媒体播放器...');
        
        this.cleanup();
        
        if (this.configManager) {
            this.configManager = null;
        }
        
        if (this.apiClient) {
            this.apiClient = null;
        }
        
        console.log('[MediaPlayer] 媒体播放器销毁完成');
    }

    // 获取播放器状态
    getStatus() {
        return {
            isPlaying: this.settings.isPlaying || false,
            playMode: this.settings.playMode || 'random',
            mediaFilter: this.settings.mediaFilter || 'all',
            currentMedia: this.getCurrentMedia(),
            mediaCount: this.mediaList.length,
            currentIndex: this.currentIndex
        };
    }
}

export { MediaPlayer };