import { deps } from "../core/deps.js";

const {
  EventBus,
  toastr,
  settings: { get, save, disableExtension },
  utils,
} = deps;
const {
  formatTime,
  adjustVideoControlsLayout,
  applyTransitionEffect,
  safeJQuery,
} = utils;

const EXTENSION_ID = "st_image_player";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings";

/**
 * 初始化UI模块（创建界面+绑定事件）
 */
export const init = () => {
  try {
    const settings = get();

    // 注册事件监听（接收外部UI操作请求）
    const removeCreateWindowListener = EventBus.on(
      "requestCreatePlayerWindow",
      createPlayerWindow
    );
    const removeCreatePanelListener = EventBus.on(
      "requestCreateSettingsPanel",
      createSettingsPanel
    );
    const removeUpdateStatusListener = EventBus.on(
      "requestUpdateStatusDisplay",
      updateStatusDisplay
    );
    const removeShowMediaListener = EventBus.on(
      "requestShowInitialMedia",
      () => {
        if (settings.isWindowVisible) {
          EventBus.emit("requestMediaPlay", { direction: "current" });
        }
      }
    );

    // 保存取消监听方法
    window.uiEventListeners = [
      removeCreateWindowListener,
      removeCreatePanelListener,
      removeUpdateStatusListener,
      removeShowMediaListener,
    ];

    const $ = deps.jQuery;
    if (!$) {
      toastr.error("jQuery 未加载，UI 功能无法使用");
      return;
    }

    // 创建扩展菜单按钮
    createExtensionButton();

    // 启用状态下创建UI
    if (settings.masterEnabled) {
      safeJQuery(async () => {
        await createPlayerWindow();
        await createSettingsPanel();
        // 检查服务就绪后显示初始媒体
        const status = await new Promise((resolve) => {
          const removeListener = EventBus.on(
            "serviceStatusChecked",
            (status) => {
              removeListener();
              resolve(status);
            }
          );
          EventBus.emit("requestCheckServiceStatus");
        });
        if (status.active && settings.isWindowVisible) {
          EventBus.emit("requestShowInitialMedia");
        }
      });
    }

    console.log(`[ui] 初始化完成，已注册事件监听`);
  } catch (e) {
    toastr.error(`[ui] 初始化失败: ${e.message}`);
    console.error(`[ui] 初始化错误:`, e);
  }
};

/**
 * 清理UI资源（移除元素+取消监听）
 */
export const cleanup = () => {
  try {
    const $ = deps.jQuery;
    if ($) {
      // 移除UI元素
      $(`#${PLAYER_WINDOW_ID}`).remove();
      $(`#${SETTINGS_PANEL_ID}`).remove();
      $(`#ext_menu_${EXTENSION_ID}`).remove();
    }

    // 取消事件监听
    if (window.uiEventListeners) {
      window.uiEventListeners.forEach((removeListener) => removeListener());
      window.uiEventListeners = null;
    }

    console.log(`[ui] 资源清理完成`);
  } catch (e) {
    toastr.error(`[ui] 清理失败: ${e.message}`);
    console.error(`[ui] 清理错误:`, e);
  }
};

/**
 * 创建扩展菜单按钮
 */
const createExtensionButton = () => {
  const $ = deps.jQuery;
  if (!$ || $(`#ext_menu_${EXTENSION_ID}`).length) return;

  const settings = get();
  const buttonHtml = `
    <div id="ext_menu_${EXTENSION_ID}" class="extension-menu-item">
      <div class="extension-title">
        <i class="fa-solid fa-film"></i> 媒体播放器
        <div class="extension-toggle">
          <label class="switch">
            <input type="checkbox" ${settings.masterEnabled ? "checked" : ""} id="${EXTENSION_ID}_toggle">
            <span class="slider round"></span>
          </label>
        </div>
      </div>
      <div class="extension-actions">
        <button class="extension-action ${EXTENSION_ID}_settings" title="设置">
          <i class="fa-solid fa-cog"></i>
        </button>
        <button class="extension-action ${EXTENSION_ID}_showhide" title="${settings.isWindowVisible ? "隐藏" : "显示"}">
          <i class="fa-solid ${settings.isWindowVisible ? "fa-eye-slash" : "fa-eye"}"></i>
        </button>
      </div>
    </div>
  `;

  // 添加到扩展菜单
  if ($("#extensions_menu").length) {
    $("#extensions_menu").append(buttonHtml);
  } else {
    // 备选位置
    $("body").append(`
      <div id="extensions_menu" class="extensions-menu">
        ${buttonHtml}
      </div>
    `);
  }

  // 绑定按钮事件
  $(`#${EXTENSION_ID}_toggle`).on("change", function () {
    const enabled = $(this).is(":checked");
    const settings = get();
    settings.masterEnabled = enabled;

    if (enabled) {
      // 启用扩展
      createPlayerWindow();
      createSettingsPanel();
      EventBus.emit("requestCheckServiceStatus");
      toastr.success("媒体播放器已启用");
    } else {
      // 禁用扩展
      cleanup();
      toastr.info("媒体播放器已禁用");
    }

    save();
  });

  $(`.${EXTENSION_ID}_settings`).on("click", () => {
    const panel = $(`#${SETTINGS_PANEL_ID}`);
    if (panel.is(":visible")) {
      panel.hide();
    } else {
      panel.show();
      positionSettingsPanel();
    }
  });

  $(`.${EXTENSION_ID}_showhide`).on("click", () => {
    const settings = get();
    settings.isWindowVisible = !settings.isWindowVisible;
    save();

    const $btn = $(`.${EXTENSION_ID}_showhide i`);
    $btn.toggleClass("fa-eye fa-eye-slash");

    if (settings.isWindowVisible) {
      $(`#${PLAYER_WINDOW_ID}`).show();
      EventBus.emit("requestShowInitialMedia");
    } else {
      $(`#${PLAYER_WINDOW_ID}`).hide();
    }
  });
};

/**
 * 创建播放器窗口
 */
export const createPlayerWindow = async () => {
  const settings = get();
  const $ = deps.jQuery;
  if (!$ || !settings.masterEnabled || $(`#${PLAYER_WINDOW_ID}`).length) return;

  // 视频控制栏HTML（根据设置动态生成）
  const videoControlsHtml = settings.showVideoControls
    ? `
    <div class="video-controls">
      ${settings.customVideoControls.showProgress
      ? `
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-loaded"></div>
            <div class="progress-played"></div>
            <div class="progress-handle"></div>
          </div>
        </div>
      `
      : ""
    }
      <div class="video-control-group">
        ${settings.customVideoControls.showVolume
      ? `
          <button class="video-control-btn volume-btn">
            <i class="fa-solid ${settings.videoVolume > 0 ? "fa-volume-high" : "fa-volume-mute"
      }"></i>
          </button>
          <div class="volume-slider-container">
            <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="${settings.videoVolume
      }" />
          </div>
        `
      : ""
    }
        ${settings.customVideoControls.showLoop
      ? `
          <button class="video-control-btn loop-btn ${settings.videoLoop ? "active" : ""
      }">
            <i class="fa-solid fa-repeat"></i>
          </button>
        `
      : ""
    }
        ${settings.customVideoControls.showTime
      ? `
          <div class="time-display">
            <span class="current-time">00:00</span> / <span class="total-time">00:00</span>
          </div>
        `
      : ""
    }
      </div>
    </div>
  `
    : "";

  // 播放器窗口HTML
  const html = `
    <div id="${PLAYER_WINDOW_ID}" class="image-player-window ${settings.hideBorder ? "no-border" : ""
    }" style="${settings.windowPosition ? `left: ${settings.windowPosition.left}px; top: ${settings.windowPosition.top}px; width: ${settings.windowSize?.width || 640}px; height: ${settings.windowSize?.height || 480}px;` : ""}">
      <div class="image-player-header">
        <div class="title"><i class="fa-solid fa-film"></i> 媒体播放器</div>
        <div class="window-controls">
          <button class="lock"><i class="fa-solid ${settings.isLocked ? "fa-lock" : "fa-lock-open"
    }"></i></button>
          <button class="toggle-info ${settings.showInfo ? "active" : ""
    }"><i class="fa-solid fa-circle-info"></i></button>
          <button class="toggle-video-controls ${settings.showVideoControls ? "active" : ""
    }" title="${settings.showVideoControls ? "隐藏视频控制" : "显示视频控制"
    }">
            <i class="fa-solid fa-video"></i>
          </button>
          <button class="hide"><i class="fa-solid fa-minus"></i></button>
        </div>
      </div>
      <div class="image-player-body">
        <div class="image-container">
          <div class="loading-animation">加载中...</div>
          <img class="image-player-img" onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFAAH/l8iC5gAAAABJRU5ErkJggg=='" />
          <video class="image-player-video" preload="metadata" ${settings.videoLoop ? "loop" : ""
    }>您的浏览器不支持HTML5视频</video>
          ${videoControlsHtml}
        </div>
        <div class="image-info" ${!settings.showInfo ? 'style="display:none;"' : ""
    }>加载中...</div>
      </div>
      <div class="image-player-controls">
        <div class="controls-group">
          <button class="control-btn play-pause"><i class="fa-solid ${settings.isPlaying ? "fa-pause" : "fa-play"
    }"></i></button>
          <button class="control-btn mode-switch" title="${settings.playMode === "random" ? "随机模式" : "顺序模式"
    }">
            <i class="fa-solid ${settings.playMode === "random" ? "fa-shuffle" : "fa-list-ol"
    }"></i>
          </button>
          <button class="control-btn switch-mode-toggle ${settings.autoSwitchMode === "detect" ? "active" : ""
    }" title="${settings.autoSwitchMode === "detect" ? "检测播放" : "定时切换"
    }">
            <i class="fa-solid ${settings.autoSwitchMode === "detect" ? "fa-robot" : "fa-clock"
    }"></i>
          </button>
        </div>
        <div class="controls-group">
          <button class="control-btn prev" title="上一个"><i class="fa-solid fa-backward-step"></i></button>
          <div class="control-text">${settings.playMode === "random" ? "随机模式" : "顺序模式: 0/0"
    }</div>
          <button class="control-btn next" title="下一个"><i class="fa-solid fa-forward-step"></i></button>
        </div>
        <div class="controls-group media-filter-group">
          <button class="control-btn media-filter-btn ${settings.mediaFilter === "all" ? "active" : ""
    }" data-type="all" title="所有媒体">
            <i class="fa-solid fa-film"></i>
          </button>
          <button class="control-btn media-filter-btn ${settings.mediaFilter === "image" ? "active" : ""
    }" data-type="image" title="仅图片">
            <i class="fa-solid fa-image"></i>
          </button>
          <button class="control-btn media-filter-btn ${settings.mediaFilter === "video" ? "active" : ""
    }" data-type="video" title="仅视频">
            <i class="fa-solid fa-video"></i>
          </button>
        </div>
        <div class="resize-handle"></div>
      </div>
    </div>
  `;

  $("body").append(html);
  setupWindowEvents(); // 绑定窗口交互事件
  positionWindow(); // 定位窗口
  bindVideoControls(); // 绑定视频控制事件

  // 初始化视频音量
  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video) video.volume = settings.videoVolume;

  console.log(`[ui] 播放器窗口创建完成`);
};

/**
 * 创建设置面板
 */
export const createSettingsPanel = async () => {
  const settings = get();
  const $ = deps.jQuery;
  if (!$ || !settings.masterEnabled || $(`#${SETTINGS_PANEL_ID}`).length)
    return;

  // 获取服务状态（通过EventBus异步获取）
  const serviceStatus = await new Promise((resolve) => {
    const removeListener = EventBus.on("serviceStatusChecked", (status) => {
      removeListener();
      resolve(status);
    });
    EventBus.emit("requestCheckServiceStatus");
  });

  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const serviceDir = serviceStatus.directory || settings.serviceDirectory || "未设置";

  // 过渡效果选项
  const transitionOptions = [
    { value: "fade", label: "淡入淡出" },
    { value: "slide", label: "滑动" },
    { value: "zoom", label: "缩放" },
    { value: "none", label: "无效果" }
  ];

  // 设置面板HTML
  const html = `
    <div id="${SETTINGS_PANEL_ID}" class="st-settings-panel">
      <div class="settings-header">
        <h3><i class="fa-solid fa-film"></i> 媒体播放器设置</h3>
        <button class="close-btn"><i class="fa-solid fa-x"></i></button>
      </div>
      
      <div class="settings-content">
        <div class="settings-section">
          <h4><i class="fa-solid fa-server"></i> 服务状态</h4>
          <div class="setting-item">
            <label>服务连接:</label>
            <div class="setting-value status-indicator ${serviceStatus.active ? 'success' : 'error'}">${serviceActive}</div>
          </div>
          <div class="setting-item">
            <label>媒体目录:</label>
            <div class="setting-value">${serviceDir}</div>
          </div>
          <div class="setting-item">
            <label>媒体统计:</label>
            <div class="setting-value">
              总计: ${serviceStatus.totalCount || 0} | 图片: ${serviceStatus.imageCount || 0} | 视频: ${serviceStatus.videoCount || 0}
            </div>
          </div>
          <div class="setting-actions">
            <button class="btn refresh-service">刷新服务状态</button>
          </div>
        </div>
        
        <div class="settings-section">
          <h4><i class="fa-solid fa-folder-open"></i> 媒体目录设置</h4>
          <div class="setting-item">
            <label for="scan-directory">扫描目录:</label>
            <input type="text" id="scan-directory" value="${settings.serviceDirectory || ''}" placeholder="输入媒体文件目录">
          </div>
          <div class="setting-actions">
            <button class="btn update-directory">更新目录</button>
            <button class="btn cleanup-media">清理无效文件</button>
          </div>
        </div>
        
        <div class="settings-section">
          <h4><i class="fa-solid fa-sliders"></i> 媒体大小限制</h4>
          <div class="setting-item">
            <label for="image-max-size">图片最大尺寸 (MB):</label>
            <input type="number" id="image-max-size" min="1" max="50" value="${settings.mediaConfig.image_max_size_mb || 5}">
          </div>
          <div class="setting-item">
            <label for="video-max-size">视频最大尺寸 (MB):</label>
            <input type="number" id="video-max-size" min="10" max="500" value="${settings.mediaConfig.video_max_size_mb || 100}">
          </div>
          <div class="setting-actions">
            <button class="btn update-size-limits">更新限制</button>
          </div>
        </div>
        
        <div class="settings-section">
          <h4><i class="fa-solid fa-magic"></i> 播放设置</h4>
          <div class="setting-item">
            <label for="transition-effect">图片过渡效果:</label>
            <select id="transition-effect">
              ${transitionOptions.map(option =>
    `<option value="${option.value}" ${settings.transitionEffect === option.value ? 'selected' : ''}>${option.label}</option>`
  ).join('')}
            </select>
          </div>
          <div class="setting-item">
            <label for="auto-switch-interval">自动切换间隔 (秒):</label>
            <input type="number" id="auto-switch-interval" min="1" max="60" value="${settings.autoSwitchInterval || 5}">
          </div>
          <div class="setting-item">
            <label for="polling-interval">服务轮询间隔 (秒):</label>
            <input type="number" id="polling-interval" min="5" max="300" value="${settings.pollingInterval / 1000 || 30}">
          </div>
        </div>
        
        <div class="settings-section">
          <h4><i class="fa-solid fa-eye"></i> 显示设置</h4>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="hide-border" ${settings.hideBorder ? 'checked' : ''}>
              隐藏窗口边框
            </label>
          </div>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="show-info" ${settings.showInfo ? 'checked' : ''}>
              显示媒体信息
            </label>
          </div>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="show-video-controls" ${settings.showVideoControls ? 'checked' : ''}>
              显示视频控制栏
            </label>
          </div>
        </div>
        
        <div class="settings-section">
          <h4><i class="fa-solid fa-video"></i> 视频控制设置</h4>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="show-progress" ${settings.customVideoControls.showProgress ? 'checked' : ''}>
              显示进度条
            </label>
          </div>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="show-volume" ${settings.customVideoControls.showVolume ? 'checked' : ''}>
              显示音量控制
            </label>
          </div>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="show-loop" ${settings.customVideoControls.showLoop ? 'checked' : ''}>
              显示循环按钮
            </label>
          </div>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="show-time" ${settings.customVideoControls.showTime ? 'checked' : ''}>
              显示时间戳
            </label>
          </div>
        </div>
        
        <div class="settings-section">
          <h4><i class="fa-solid fa-download"></i> 预加载设置</h4>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="preload-images" ${settings.mediaConfig.preload_strategy?.image !== false ? 'checked' : ''}>
              预加载图片
            </label>
          </div>
          <div class="setting-item checkbox-item">
            <label>
              <input type="checkbox" id="preload-videos" ${settings.mediaConfig.preload_strategy?.video === true ? 'checked' : ''}>
              预加载视频 (可能占用较多资源)
            </label>
          </div>
        </div>
      </div>
      
      <div class="settings-footer">
        <button class="btn save-settings">保存设置</button>
        <button class="btn cancel-settings">取消</button>
      </div>
    </div>
  `;

  $("body").append(html);
  bindSettingsEvents();
  positionSettingsPanel();

  console.log(`[ui] 设置面板创建完成`);
};

/**
 * 绑定窗口交互事件
 */
const setupWindowEvents = () => {
  const $ = deps.jQuery;
  const $window = $(`#${PLAYER_WINDOW_ID}`);
  if (!$window.length) return;

  const settings = get();

  // 窗口拖动
  let isDragging = false;
  let offsetX, offsetY;

  $window.find(".image-player-header").mousedown(function (e) {
    if (settings.isLocked) return;

    isDragging = true;
    const windowPos = $window.position();
    offsetX = e.clientX - windowPos.left;
    offsetY = e.clientY - windowPos.top;
    $window.addClass("dragging");
  });

  $(document).mousemove(function (e) {
    if (!isDragging || settings.isLocked) return;

    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;

    // 限制在可视区域内
    const maxX = $(window).width() - $window.width();
    const maxY = $(window).height() - $window.height();
    const constrainedX = Math.max(0, Math.min(x, maxX));
    const constrainedY = Math.max(0, Math.min(y, maxY));

    $window.css({
      left: constrainedX + "px",
      top: constrainedY + "px"
    });

    // 保存位置
    settings.windowPosition = { left: constrainedX, top: constrainedY };
    save();
  });

  $(document).mouseup(function () {
    if (isDragging) {
      isDragging = false;
      $window.removeClass("dragging");
    }
  });

  // 窗口大小调整
  let isResizing = false;
  const $resizeHandle = $window.find(".resize-handle");

  $resizeHandle.mousedown(function (e) {
    if (settings.isLocked) return;

    isResizing = true;
    e.preventDefault();
    $window.addClass("resizing");
  });

  $(document).mousemove(function (e) {
    if (!isResizing || settings.isLocked) return;

    const newWidth = e.clientX - $window.offset().left;
    const newHeight = e.clientY - $window.offset().top;

    // 限制最小尺寸
    if (newWidth > 320 && newHeight > 240) {
      $window.css({
        width: newWidth + "px",
        height: newHeight + "px"
      });

      // 调整视频控制栏布局
      adjustVideoControlsLayout($window);

      // 保存大小
      settings.windowSize = { width: newWidth, height: newHeight };
      save();
    }
  });

  $(document).mouseup(function () {
    if (isResizing) {
      isResizing = false;
      $window.removeClass("resizing");
    }
  });

  // 播放/暂停按钮
  $window.find(".play-pause").click(function () {
    const settings = get();
    if (settings.isPlaying) {
      EventBus.emit("requestMediaPause");
    } else {
      EventBus.emit("requestMediaPlay", { direction: "current" });
    }
  });

  // 上一个/下一个按钮
  $window.find(".prev").click(function () {
    EventBus.emit("requestMediaPrev");
  });

  $window.find(".next").click(function () {
    EventBus.emit("requestMediaNext");
  });

  // 模式切换按钮
  $window.find(".mode-switch").click(function () {
    EventBus.emit("requestTogglePlayMode");
  });

  // 自动切换模式按钮
  $window.find(".switch-mode-toggle").click(function () {
    EventBus.emit("requestToggleAutoSwitchMode");
  });

  // 媒体筛选按钮
  $window.find(".media-filter-btn").click(function () {
    const filterType = $(this).data("type");
    const settings = get();

    if (settings.mediaFilter !== filterType) {
      settings.mediaFilter = filterType;
      save();
      EventBus.emit("requestRefreshMediaList", { filterType });
    }
  });

  // 锁定/解锁按钮
  $window.find(".lock").click(function () {
    const settings = get();
    settings.isLocked = !settings.isLocked;
    save();

    $(this).find("i")
      .removeClass("fa-lock fa-lock-open")
      .addClass(settings.isLocked ? "fa-lock" : "fa-lock-open");

    toastr.info(settings.isLocked ? "播放器已锁定" : "播放器已解锁");
  });

  // 显示/隐藏信息按钮
  $window.find(".toggle-info").click(function () {
    const settings = get();
    settings.showInfo = !settings.showInfo;
    save();

    $(this).toggleClass("active");
    $window.find(".image-info").toggle(settings.showInfo);
  });

  // 显示/隐藏视频控制按钮
  $window.find(".toggle-video-controls").click(function () {
    const settings = get();
    settings.showVideoControls = !settings.showVideoControls;
    save();

    $(this).toggleClass("active");
    $window.find(".video-controls").toggle(settings.showVideoControls);
    adjustVideoControlsLayout($window);
  });

  // 隐藏窗口按钮
  $window.find(".hide").click(function () {
    const settings = get();
    settings.isWindowVisible = false;
    save();
    $window.hide();

    $(`.${EXTENSION_ID}_showhide i`)
      .removeClass("fa-eye fa-eye-slash")
      .addClass("fa-eye");
  });
};

/**
 * 绑定视频控制事件
 */
const bindVideoControls = () => {
  const $ = deps.jQuery;
  const $window = $(`#${PLAYER_WINDOW_ID}`);
  if (!$window.length) return;

  // 音量滑块
  $window.find(".volume-slider").on("input", function () {
    const volume = parseFloat($(this).val());
    EventBus.emit("requestUpdateVolume", volume);
  });

  // 音量按钮（静音切换）
  $window.find(".volume-btn").click(function () {
    const settings = get();
    const newVolume = settings.videoVolume > 0 ? 0 : 0.8;
    $window.find(".volume-slider").val(newVolume);
    EventBus.emit("requestUpdateVolume", newVolume);
  });

  // 循环按钮
  $window.find(".loop-btn").click(function () {
    const settings = get();
    settings.videoLoop = !settings.videoLoop;
    save();

    $(this).toggleClass("active");

    const video = $window.find(".image-player-video")[0];
    if (video) video.loop = settings.videoLoop;
  });

  // 进度条交互
  const $progressBar = $window.find(".progress-bar");
  const $progressPlayed = $window.find(".progress-played");

  $progressBar.click(function (e) {
    const video = $window.find(".image-player-video")[0];
    if (!video) return;

    const rect = $progressBar[0].getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
    $progressPlayed.css("width", `${pos * 100}%`);
  });
};

/**
 * 绑定设置面板事件
 */
const bindSettingsEvents = () => {
  const $ = deps.jQuery;
  const $panel = $(`#${SETTINGS_PANEL_ID}`);
  if (!$panel.length) return;

  // 关闭按钮
  $panel.find(".close-btn, .cancel-settings").click(function () {
    $panel.hide();
  });

  // 刷新服务状态
  $panel.find(".refresh-service").click(function () {
    EventBus.emit("requestCheckServiceStatus");
    EventBus.emit("requestRefreshMediaList");
    toastr.info("正在刷新服务状态...");
  });

  // 更新目录
  $panel.find(".update-directory").click(function () {
    const newPath = $panel.find("#scan-directory").val().trim();
    if (newPath) {
      EventBus.emit("requestUpdateScanDirectory", { newPath });
    } else {
      toastr.warning("请输入有效的目录路径");
    }
  });

  // 清理无效文件
  $panel.find(".cleanup-media").click(function () {
    if (confirm("确定要清理无效的媒体文件吗？此操作不会删除实际文件，仅从媒体库中移除记录。")) {
      EventBus.emit("requestCleanupInvalidMedia");
    }
  });

  // 更新大小限制
  $panel.find(".update-size-limits").click(function () {
    const imageMaxMb = parseInt($panel.find("#image-max-size").val());
    const videoMaxMb = parseInt($panel.find("#video-max-size").val());

    if (isNaN(imageMaxMb) || isNaN(videoMaxMb)) {
      toastr.warning("请输入有效的数值");
      return;
    }

    EventBus.emit("requestUpdateMediaSizeLimit", { imageMaxMb, videoMaxMb });
  });

  // 保存设置
  $panel.find(".save-settings").click(function () {
    const settings = get();

    // 保存过渡效果
    settings.transitionEffect = $panel.find("#transition-effect").val();

    // 保存自动切换间隔
    const interval = parseInt($panel.find("#auto-switch-interval").val());
    if (!isNaN(interval) && interval >= 1 && interval <= 60) {
      settings.autoSwitchInterval = interval * 1000;
    }

    // 保存轮询间隔
    const polling = parseInt($panel.find("#polling-interval").val());
    if (!isNaN(polling) && polling >= 5 && polling <= 300) {
      settings.pollingInterval = polling * 1000;
    }

    // 保存显示设置
    settings.hideBorder = $panel.find("#hide-border").is(":checked");
    settings.showInfo = $panel.find("#show-info").is(":checked");
    settings.showVideoControls = $panel.find("#show-video-controls").is(":checked");

    // 保存视频控制设置
    settings.customVideoControls.showProgress = $panel.find("#show-progress").is(":checked");
    settings.customVideoControls.showVolume = $panel.find("#show-volume").is(":checked");
    settings.customVideoControls.showLoop = $panel.find("#show-loop").is(":checked");
    settings.customVideoControls.showTime = $panel.find("#show-time").is(":checked");

    // 保存预加载设置
    if (!settings.mediaConfig.preload_strategy) {
      settings.mediaConfig.preload_strategy = {};
    }
    settings.mediaConfig.preload_strategy.image = $panel.find("#preload-images").is(":checked");
    settings.mediaConfig.preload_strategy.video = $panel.find("#preload-videos").is(":checked");

    save();

    // 重新创建播放器窗口以应用设置
    $(`#${PLAYER_WINDOW_ID}`).remove();
    createPlayerWindow();

    toastr.success("设置已保存");
    $panel.hide();
  });
};

/**
 * 定位窗口
 */
const positionWindow = () => {
  const $ = deps.jQuery;
  const $window = $(`#${PLAYER_WINDOW_ID}`);
  if (!$window.length) return;

  const settings = get();

  // 如果有保存的位置，则使用保存的位置
  if (settings.windowPosition) {
    $window.css({
      left: settings.windowPosition.left + "px",
      top: settings.windowPosition.top + "px"
    });
  } else {
    // 否则居中显示
    const left = ($(window).width() - $window.width()) / 2;
    const top = ($(window).height() - $window.height()) / 2;
    $window.css({ left: left + "px", top: top + "px" });

    // 保存初始位置
    settings.windowPosition = { left, top };
    save();
  }

  // 调整视频控制栏布局
  adjustVideoControlsLayout($window);
};

/**
 * 定位设置面板
 */
const positionSettingsPanel = () => {
  const $ = deps.jQuery;
  const $panel = $(`#${SETTINGS_PANEL_ID}`);
  if (!$panel.length) return;

  // 显示在屏幕中央
  const left = ($(window).width() - $panel.width()) / 2;
  const top = ($(window).height() - $panel.height()) / 2;
  $panel.css({ left: left + "px", top: top + "px" });
};

/**
 * 更新状态显示
 */
const updateStatusDisplay = (status) => {
  const $ = deps.jQuery;
  const $panel = $(`#${SETTINGS_PANEL_ID}`);
  if (!$panel.length) return;

  // 更新服务状态
  $panel.find(".status-indicator")
    .removeClass("success error")
    .addClass(status.active ? "success" : "error")
    .text(status.active ? "已连接" : "服务离线");

  // 更新媒体统计
  $panel.find(".setting-value:contains('总计:')").text(
    `总计: ${status.totalCount || 0} | 图片: ${status.imageCount || 0} | 视频: ${status.videoCount || 0}`
  );

  // 更新目录显示
  if (status.directory) {
    $panel.find("#scan-directory").val(status.directory);
    $panel.find(".setting-value:contains('媒体目录:')").text(status.directory);
  }
};