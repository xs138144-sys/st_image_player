import { deps } from "../../core/deps.js";

const { EventBus, jQuery: $, utils } = deps;
const { formatTime, adjustVideoControlsLayout, applyTransitionEffect, safeJQuery } = utils;

const PLAYER_WINDOW_ID = "st-image-player-window";

// 拖拽和缩放状态
let isDragging = false;
let isResizing = false;
let dragStartX = 0;
let dragStartY = 0;
let initialLeft = 0;
let initialTop = 0;
let initialWidth = 0;
let initialHeight = 0;

/**
 * 创建播放器窗口
 */
export const createPlayerWindow = () => {
  return safeJQuery(() => {
    if ($(`#${PLAYER_WINDOW_ID}`).length) {
      console.log(`[playerWindow] 播放器窗口已存在`);
      return;
    }

    const settings = deps.settings.get();
    
    const windowHtml = `
      <div id="${PLAYER_WINDOW_ID}" class="${settings.isLocked ? 'locked' : ''}">
        <!-- 媒体容器 -->
        <div class="media-container">
          <div class="loading-animation">加载中...</div>
        </div>

        <!-- 控制栏 -->
        <div class="image-player-controls">
          <!-- 左侧控制组：播放模式 -->
          <div class="controls-group">
            <button class="control-btn" title="随机播放" data-mode="random">
              <i class="fa-solid fa-shuffle"></i>
            </button>
            <button class="control-btn" title="顺序播放" data-mode="sequential">
              <i class="fa-solid fa-arrow-right-arrow-left"></i>
            </button>
            <span class="control-text">${settings.playMode === 'random' ? '随机' : '顺序'}</span>
          </div>

          <!-- 中间控制组：播放控制 -->
          <div class="controls-group">
            <button class="control-btn" title="上一个" data-action="prev">
              <i class="fa-solid fa-backward-step"></i>
            </button>
            <button class="control-btn play-pause" title="播放/暂停" data-action="play-pause">
              <i class="fa-solid ${settings.isPlaying ? 'fa-pause' : 'fa-play'}"></i>
            </button>
            <button class="control-btn" title="下一个" data-action="next">
              <i class="fa-solid fa-forward-step"></i>
            </button>
          </div>

          <!-- 右侧控制组：媒体筛选 -->
          <div class="controls-group media-filter-group">
            <button class="control-btn ${settings.mediaFilter === 'all' ? 'active' : ''}" title="所有媒体" data-filter="all">
              <i class="fa-solid fa-layer-group"></i>
            </button>
            <button class="control-btn ${settings.mediaFilter === 'image' ? 'active' : ''}" title="仅图片" data-filter="image">
              <i class="fa-solid fa-image"></i>
            </button>
            <button class="control-btn ${settings.mediaFilter === 'video' ? 'active' : ''}" title="仅视频" data-filter="video">
              <i class="fa-solid fa-video"></i>
            </button>
          </div>

          <!-- 视频控制栏（动态显示） -->
          <div class="video-controls" style="display: none;">
            <span class="current-time">00:00</span>
            <input type="range" class="progress-bar" value="0" max="100">
            <span class="total-time">00:00</span>
            <button class="control-btn" title="音量" data-action="volume">
              <i class="fa-solid fa-volume-high"></i>
            </button>
            <button class="control-btn" title="循环" data-action="loop">
              <i class="fa-solid fa-repeat"></i>
            </button>
          </div>
        </div>

        <!-- 媒体信息显示 -->
        <div class="image-info" style="position: absolute; top: 10px; left: 10px; right: 10px; 
              color: #b0b0b0; font-size: 11px; text-align: center; opacity: 0.8; 
              text-shadow: 0 1px 2px rgba(0,0,0,0.8); pointer-events: none;
              ${settings.showInfo ? '' : 'display: none;'}">
        </div>

        <!-- 调整手柄 -->
        <div class="resize-handle resize-handle-nw"></div>
        <div class="resize-handle resize-handle-ne"></div>
        <div class="resize-handle resize-handle-sw"></div>
        <div class="resize-handle resize-handle-se"></div>
      </div>
    `;

    $("body").append(windowHtml);
    console.log(`[playerWindow] 播放器窗口创建完成`);

    // 绑定事件
    bindPlayerEvents();
    
    // 应用初始状态
    updatePlayerWindowState(settings);

    return $(`#${PLAYER_WINDOW_ID}`);
  });
};

/**
 * 绑定播放器事件
 */
const bindPlayerEvents = () => {
  const $player = $(`#${PLAYER_WINDOW_ID}`);
  if (!$player.length) return;

  // 播放控制按钮事件
  $player.find('[data-action]').on('click', (e) => {
    const action = $(e.currentTarget).data('action');
    handlePlayerAction(action);
  });

  // 播放模式按钮事件
  $player.find('[data-mode]').on('click', (e) => {
    const mode = $(e.currentTarget).data('mode');
    EventBus.emit('changePlayMode', mode);
  });

  // 媒体筛选按钮事件
  $player.find('[data-filter]').on('click', (e) => {
    const filterType = $(e.currentTarget).data('filter');
    EventBus.emit('changeMediaFilter', filterType);
  });

  // 拖拽事件
  bindDragEvents($player);
  
  // 缩放事件
  bindResizeEvents($player);

  // 视频控制事件
  bindVideoControlEvents($player);
};

/**
 * 处理播放器动作
 */
const handlePlayerAction = (action) => {
  switch (action) {
    case 'prev':
      EventBus.emit('requestMediaPlay', { direction: 'prev' });
      break;
    case 'next':
      EventBus.emit('requestMediaPlay', { direction: 'next' });
      break;
    case 'play-pause':
      const settings = deps.settings.get();
      if (settings.isPlaying) {
        EventBus.emit('requestMediaPause');
      } else {
        EventBus.emit('requestMediaPlay', { direction: 'current' });
      }
      break;
    case 'volume':
      // 音量控制逻辑
      break;
    case 'loop':
      // 循环控制逻辑
      break;
  }
};

/**
 * 绑定拖拽事件
 */
const bindDragEvents = ($player) => {
  $player.on('mousedown', (e) => {
    const settings = deps.settings.get();
    if (settings.isLocked || $(e.target).closest('.control-btn, .resize-handle').length) {
      return;
    }

    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialLeft = parseInt($player.css('left')) || 0;
    initialTop = parseInt($player.css('top')) || 0;

    $player.addClass('dragging');
    e.preventDefault();
  });

  $(document).on('mousemove', (e) => {
    if (!isDragging) return;

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    $player.css({
      left: initialLeft + deltaX,
      top: initialTop + deltaY
    });
  });

  $(document).on('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      $player.removeClass('dragging');
    }
  });
};

/**
 * 绑定缩放事件
 */
const bindResizeEvents = ($player) => {
  $player.find('.resize-handle').on('mousedown', (e) => {
    const settings = deps.settings.get();
    if (settings.isLocked) return;

    isResizing = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialWidth = $player.width();
    initialHeight = $player.height();
    initialLeft = parseInt($player.css('left')) || 0;
    initialTop = parseInt($player.css('top')) || 0;

    $player.addClass('resizing');
    e.preventDefault();
    e.stopPropagation();
  });

  $(document).on('mousemove', (e) => {
    if (!isResizing) return;

    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    // 根据不同的调整手柄处理不同的缩放方向
    const handleClass = $(e.target).attr('class') || '';
    
    if (handleClass.includes('resize-handle-se')) {
      $player.width(Math.max(200, initialWidth + deltaX));
      $player.height(Math.max(150, initialHeight + deltaY));
    } else if (handleClass.includes('resize-handle-sw')) {
      const newWidth = Math.max(200, initialWidth - deltaX);
      const newHeight = Math.max(150, initialHeight + deltaY);
      $player.width(newWidth);
      $player.height(newHeight);
      $player.css('left', initialLeft + deltaX);
    } else if (handleClass.includes('resize-handle-ne')) {
      const newWidth = Math.max(200, initialWidth + deltaX);
      const newHeight = Math.max(150, initialHeight - deltaY);
      $player.width(newWidth);
      $player.height(newHeight);
      $player.css('top', initialTop + deltaY);
    } else if (handleClass.includes('resize-handle-nw')) {
      const newWidth = Math.max(200, initialWidth - deltaX);
      const newHeight = Math.max(150, initialHeight - deltaY);
      $player.width(newWidth);
      $player.height(newHeight);
      $player.css('left', initialLeft + deltaX);
      $player.css('top', initialTop + deltaY);
    }

    // 调整视频控制栏布局
    adjustVideoControlsLayout();
  });

  $(document).on('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      $player.removeClass('resizing');
    }
  });
};

/**
 * 绑定视频控制事件
 */
const bindVideoControlEvents = ($player) => {
  const $progressBar = $player.find('.progress-bar');
  const $volumeBtn = $player.find('[data-action="volume"]');
  const $loopBtn = $player.find('[data-action="loop"]');

  // 进度条事件
  $progressBar.on('input', (e) => {
    const value = parseInt(e.target.value);
    EventBus.emit('requestSeekVideo', { position: value });
  });

  // 音量按钮事件
  $volumeBtn.on('click', () => {
    EventBus.emit('requestToggleMute');
  });

  // 循环按钮事件
  $loopBtn.on('click', () => {
    EventBus.emit('requestToggleLoop');
  });
};

/**
 * 更新播放器窗口状态
 */
export const updatePlayerWindowState = (settings) => {
  safeJQuery(() => {
    const $player = $(`#${PLAYER_WINDOW_ID}`);
    if (!$player.length) return;

    // 更新可见性
    if (settings.isWindowVisible) {
      $player.removeClass('hidden');
    } else {
      $player.addClass('hidden');
    }

    // 更新锁定状态
    if (settings.isLocked) {
      $player.addClass('locked');
    } else {
      $player.removeClass('locked');
    }

    // 更新播放按钮状态
    const $playPauseBtn = $player.find('[data-action="play-pause"]');
    const $playPauseIcon = $playPauseBtn.find('i');
    
    if (settings.isPlaying) {
      $playPauseIcon.removeClass('fa-play').addClass('fa-pause');
    } else {
      $playPauseIcon.removeClass('fa-pause').addClass('fa-play');
    }

    // 更新播放模式按钮状态
    $player.find('[data-mode]').removeClass('active');
    $player.find(`[data-mode="${settings.playMode}"]`).addClass('active');
    $player.find('.control-text').text(settings.playMode === 'random' ? '随机' : '顺序');

    // 更新媒体筛选按钮状态
    $player.find('[data-filter]').removeClass('active');
    $player.find(`[data-filter="${settings.mediaFilter}"]`).addClass('active');

    // 更新信息显示
    const $infoElement = $player.find('.image-info');
    if (settings.showInfo) {
      $infoElement.show();
    } else {
      $infoElement.hide();
    }
  });
};

/**
 * 显示媒体内容
 */
export const showMediaInPlayer = (media) => {
  safeJQuery(() => {
    const $player = $(`#${PLAYER_WINDOW_ID}`);
    if (!$player.length) return;

    const $mediaContainer = $player.find('.media-container');
    const $loading = $mediaContainer.find('.loading-animation');
    const $infoElement = $player.find('.image-info');
    const $videoControls = $player.find('.video-controls');

    // 隐藏加载动画
    $loading.hide();

    // 清除现有媒体
    $mediaContainer.find('img, video').remove();

    if (media && media.url) {
      // 更新媒体信息
      if (media.meta) {
        $infoElement.text(`${media.meta.name} (${media.meta.type} · ${media.meta.size})`);
      }

      // 根据媒体类型创建不同的元素
      if (media.meta.type === 'image') {
        const $img = $(`<img src="${media.url}" alt="${media.meta.name}" />`);
        $mediaContainer.append($img);
        $videoControls.hide();
      } else if (media.meta.type === 'video') {
        const $video = $(`
          <video 
            src="${media.url}" 
            ${deps.settings.get().videoLoop ? 'loop' : ''}
            volume="${deps.settings.get().videoVolume || 0.8}"
          ></video>
        `);
        $mediaContainer.append($video);
        $videoControls.show();
        
        // 调整视频控制栏布局
        adjustVideoControlsLayout();
      }

      // 应用过渡效果
      applyTransitionEffect($mediaContainer);
    }
  });
};

/**
 * 更新视频进度
 */
export const updateVideoProgress = (currentTime, duration) => {
  safeJQuery(() => {
    const $player = $(`#${PLAYER_WINDOW_ID}`);
    if (!$player.length) return;

    const $progressBar = $player.find('.progress-bar');
    const $currentTime = $player.find('.current-time');
    const $totalTime = $player.find('.total-time');

    if (duration > 0) {
      const progress = (currentTime / duration) * 100;
      $progressBar.val(progress);
    }
    
    $currentTime.text(formatTime(currentTime));
    $totalTime.text(formatTime(duration));
  });
};

/**
 * 清理播放器窗口
 */
export const cleanupPlayerWindow = () => {
  safeJQuery(() => {
    $(`#${PLAYER_WINDOW_ID}`).remove();
    console.log(`[playerWindow] 播放器窗口已清理`);
  });
};