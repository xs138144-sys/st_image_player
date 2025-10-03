// 播放器窗口UI组件模块
import { PLAYER_WINDOW_ID } from '../config/config.js';

class PlayerWindow {
    constructor(eventBus, configManager) {
        this.eventBus = eventBus;
        this.configManager = configManager;
        this.windowId = PLAYER_WINDOW_ID;
        this.settings = null;
        this.dragData = null;
        this.resizeData = null;
        this.isDragging = false;
        this.isResizing = false;
    }

    // 初始化播放器窗口
    async init() {
        await this.loadSettings();
        this.createWindow();
        this.bindEvents();
        this.updateWindow();
    }

    // 创建播放器窗口
    createWindow() {
        if ($(`#${this.windowId}`).length) return;

        const html = this.generateWindowHTML();
        $('body').append(html);
        
        console.log('[PlayerWindow] 播放器窗口已创建');
    }

    // 生成窗口HTML
    generateWindowHTML() {
        const videoControlsHtml = this.settings.showVideoControls ? this.generateVideoControlsHTML() : '';
        
        return `
            <div id="${this.windowId}" class="image-player-window ${this.settings.hideBorder ? 'no-border' : ''}">
                <div class="image-player-header">
                    <div class="title"><i class="fa-solid fa-film"></i> 媒体播放器</div>
                    <div class="window-controls">
                        <button class="lock"><i class="fa-solid ${this.settings.isLocked ? 'fa-lock' : 'fa-lock-open'}"></i></button>
                        <button class="toggle-info ${this.settings.showInfo ? 'active' : ''}"><i class="fa-solid fa-circle-info"></i></button>
                        <button class="toggle-video-controls ${this.settings.showVideoControls ? 'active' : ''}" title="视频控制"><i class="fa-solid fa-sliders"></i></button>
                        <button class="minimize"><i class="fa-solid fa-window-minimize"></i></button>
                        <button class="close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                
                <div class="image-player-content">
                    <div class="media-container">
                        <img class="image-player-image" style="display: none;" />
                        <video class="image-player-video" style="display: none;" ${this.settings.videoLoop ? 'loop' : ''}></video>
                    </div>
                    
                    ${videoControlsHtml}
                    
                    <div class="media-info ${this.settings.showInfo ? '' : 'hidden'}">
                        <div class="media-name"></div>
                        <div class="media-type"></div>
                        <div class="media-size"></div>
                    </div>
                </div>
                
                <div class="image-player-controls">
                    <button class="control-btn prev-btn" title="上一个"><i class="fa-solid fa-backward-step"></i></button>
                    <button class="control-btn play-pause-btn" title="播放/暂停">
                        <i class="fa-solid ${this.settings.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
                    </button>
                    <button class="control-btn next-btn" title="下一个"><i class="fa-solid fa-forward-step"></i></button>
                    <button class="control-btn mode-btn" title="切换播放模式">
                        <i class="fa-solid ${this.settings.playMode === 'random' ? 'fa-shuffle' : 'fa-repeat'}"></i>
                    </button>
                    <div class="filter-controls">
                        <button class="filter-btn ${this.settings.mediaFilter === 'all' ? 'active' : ''}" data-filter="all" title="所有媒体"><i class="fa-solid fa-film"></i></button>
                        <button class="filter-btn ${this.settings.mediaFilter === 'image' ? 'active' : ''}" data-filter="image" title="仅图片"><i class="fa-solid fa-image"></i></button>
                        <button class="filter-btn ${this.settings.mediaFilter === 'video' ? 'active' : ''}" data-filter="video" title="仅视频"><i class="fa-solid fa-video"></i></button>
                    </div>
                </div>
                
                <div class="resize-handle"></div>
            </div>
        `;
    }

    // 生成视频控制HTML
    generateVideoControlsHTML() {
        return `
            <div class="video-controls">
                ${this.settings.customVideoControls.showProgress ? `
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-loaded"></div>
                            <div class="progress-played"></div>
                            <div class="progress-handle"></div>
                        </div>
                    </div>
                ` : ''}
                <div class="video-control-group">
                    ${this.settings.customVideoControls.showVolume ? `
                        <button class="video-control-btn volume-btn">
                            <i class="fa-solid ${this.settings.videoVolume > 0 ? 'fa-volume-high' : 'fa-volume-mute'}"></i>
                        </button>
                        <div class="volume-slider-container">
                            <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="${this.settings.videoVolume}" />
                        </div>
                    ` : ''}
                    ${this.settings.customVideoControls.showLoop ? `
                        <button class="video-control-btn loop-btn ${this.settings.videoLoop ? 'active' : ''}">
                            <i class="fa-solid fa-repeat"></i>
                        </button>
                    ` : ''}
                    ${this.settings.customVideoControls.showTime ? `
                        <div class="time-display">
                            <span class="current-time">00:00</span> / <span class="total-time">00:00</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // 绑定事件
    bindEvents() {
        this.bindWindowEvents();
        this.bindControlEvents();
        this.bindVideoEvents();
    }

    // 绑定窗口事件
    bindWindowEvents() {
        const window = $(`#${this.windowId}`);
        
        // 窗口拖动
        window.find('.image-player-header').on('mousedown', (e) => {
            if (this.settings.isLocked) return;
            this.startDrag(e);
        });

        // 窗口缩放
        window.find('.resize-handle').on('mousedown', (e) => {
            if (this.settings.isLocked) return;
            this.startResize(e);
        });

        // 窗口控制按钮
        window.find('.lock').on('click', () => this.toggleLock());
        window.find('.toggle-info').on('click', () => this.toggleInfo());
        window.find('.toggle-video-controls').on('click', () => this.toggleVideoControls());
        window.find('.minimize').on('click', () => this.minimize());
        window.find('.close').on('click', () => this.close());

        // 全局鼠标事件
        $(document)
            .on('mousemove', (e) => {
                if (this.isDragging) this.handleDrag(e);
                if (this.isResizing) this.handleResize(e);
            })
            .on('mouseup', () => {
                this.stopDrag();
                this.stopResize();
            });
    }

    // 绑定控制事件
    bindControlEvents() {
        const window = $(`#${this.windowId}`);
        
        window.find('.prev-btn').on('click', () => this.emit('previous'));
        window.find('.next-btn').on('click', () => this.emit('next'));
        window.find('.play-pause-btn').on('click', () => this.emit('togglePlay'));
        window.find('.mode-btn').on('click', () => this.emit('toggleMode'));
        window.find('.filter-btn').on('click', (e) => {
            const filter = $(e.target).closest('.filter-btn').data('filter');
            this.emit('filterChange', filter);
        });
    }

    // 绑定视频事件
    bindVideoEvents() {
        // 视频控制事件绑定逻辑
        // 这里简化处理，实际实现需要更详细的视频控制逻辑
    }

    // 窗口拖动相关方法
    startDrag(e) {
        this.isDragging = true;
        const window = $(`#${this.windowId}`);
        const offset = window.offset();
        this.dragData = {
            startX: e.clientX,
            startY: e.clientY,
            startLeft: offset.left,
            startTop: offset.top
        };
    }

    handleDrag(e) {
        if (!this.dragData) return;
        
        const deltaX = e.clientX - this.dragData.startX;
        const deltaY = e.clientY - this.dragData.startY;
        
        const newX = this.dragData.startLeft + deltaX;
        const newY = this.dragData.startTop + deltaY;
        
        $(`#${this.windowId}`).css({
            left: newX + 'px',
            top: newY + 'px'
        });
    }

    async stopDrag() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        if (this.dragData) {
            const window = $(`#${this.windowId}`);
            const position = window.position();
            
            this.settings.position.x = position.left;
            this.settings.position.y = position.top;
            await this.configManager.updateConfig({ position: this.settings.position });
            
            this.dragData = null;
        }
    }

    // 窗口缩放相关方法
    startResize(e) {
        this.isResizing = true;
        const window = $(`#${this.windowId}`);
        this.resizeData = {
            startX: e.clientX,
            startY: e.clientY,
            startWidth: window.width(),
            startHeight: window.height()
        };
    }

    handleResize(e) {
        if (!this.resizeData) return;
        
        const deltaX = e.clientX - this.resizeData.startX;
        const deltaY = e.clientY - this.resizeData.startY;
        
        const newWidth = Math.max(300, this.resizeData.startWidth + deltaX);
        const newHeight = Math.max(200, this.resizeData.startHeight + deltaY);
        
        $(`#${this.windowId}`).css({
            width: newWidth + 'px',
            height: newHeight + 'px'
        });
    }

    async stopResize() {
        if (!this.isResizing) return;
        
        this.isResizing = false;
        if (this.resizeData) {
            const window = $(`#${this.windowId}`);
            
            this.settings.position.width = window.width();
            this.settings.position.height = window.height();
            await this.configManager.updateConfig({ position: this.settings.position });
            
            this.resizeData = null;
        }
    }

    // 窗口控制方法
    async toggleLock() {
        this.settings.isLocked = !this.settings.isLocked;
        await this.configManager.updateConfig({ isLocked: this.settings.isLocked });
        
        $(`#${this.windowId} .lock i`)
            .toggleClass('fa-lock', this.settings.isLocked)
            .toggleClass('fa-lock-open', !this.settings.isLocked);
        
        this.emit('lockChanged', this.settings.isLocked);
    }

    async toggleInfo() {
        this.settings.showInfo = !this.settings.showInfo;
        await this.configManager.updateConfig({ showInfo: this.settings.showInfo });
        
        $(`#${this.windowId} .toggle-info`).toggleClass('active', this.settings.showInfo);
        $(`#${this.windowId} .media-info`).toggleClass('hidden', !this.settings.showInfo);
    }

    async toggleVideoControls() {
        this.settings.showVideoControls = !this.settings.showVideoControls;
        await this.configManager.updateConfig({ showVideoControls: this.settings.showVideoControls });
        
        $(`#${this.windowId} .toggle-video-controls`).toggleClass('active', this.settings.showVideoControls);
        $(`#${this.windowId} .video-controls`).toggle(this.settings.showVideoControls);
    }

    async minimize() {
        this.settings.isWindowVisible = false;
        await this.configManager.updateConfig({ isWindowVisible: this.settings.isWindowVisible });
        $(`#${this.windowId}`).hide();
        this.emit('minimized');
    }

    close() {
        $(`#${this.windowId}`).remove();
        this.emit('closed');
    }

    // 更新窗口位置
    updateWindowPosition() {
        const window = $(`#${this.windowId}`);
        window.css({
            left: this.settings.position.x + 'px',
            top: this.settings.position.y + 'px',
            width: this.settings.position.width + 'px',
            height: this.settings.position.height + 'px'
        });
    }

    // 显示媒体
    displayMedia(media) {
        if (!media) return;
        
        const window = $(`#${this.windowId}`);
        const image = window.find('.image-player-image');
        const video = window.find('.image-player-video');
        
        // 隐藏所有媒体元素
        image.hide();
        video.hide();
        
        const mediaUrl = `${this.settings.serviceUrl}/file/${encodeURIComponent(media.rel_path)}`;
        
        if (media.media_type === 'image') {
            image.attr('src', mediaUrl).show();
            this.currentMediaType = 'image';
        } else if (media.media_type === 'video') {
            video.attr('src', mediaUrl).show();
            video.prop('loop', this.settings.videoLoop);
            video.prop('volume', this.settings.videoVolume);
            this.currentMediaType = 'video';
        }
        
        // 更新媒体信息
        this.updateMediaInfo(media);
        
        this.emit('mediaDisplayed', { media, type: media.media_type });
    }

    // 更新媒体信息
    updateMediaInfo(media) {
        if (!this.settings.showInfo) return;
        
        const info = $(`#${this.windowId} .media-info`);
        info.find('.media-name').text(media.name);
        info.find('.media-type').text(media.media_type === 'image' ? '图片' : '视频');
        info.find('.media-size').text(this.formatFileSize(media.size));
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 事件发射器
    emit(event, data) {
        // 这里需要实现事件发射逻辑
        // 实际实现中应该使用事件总线或回调函数
        console.log(`[PlayerWindow] Event: ${event}`, data);
    }

    // 销毁窗口
    destroy() {
        $(`#${this.windowId}`).remove();
        $(document).off('mousemove mouseup');
        console.log('[PlayerWindow] 播放器窗口已销毁');
    }
}

export { PlayerWindow };