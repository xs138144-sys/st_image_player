// 媒体播放器扩展（修复：视频循环时AI检测切换无效 + 全量优化）
import {
  eventSource,
  event_types,
  saveSettingsDebounced,
  is_send_press,
} from "../../../../script.js";
const EXTENSION_ID = "st_image_player";
const EXTENSION_NAME = "媒体播放器";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings";

// 安全访问全局对象
const getSafeGlobal = (name, defaultValue) => {
  return window[name] === undefined ? defaultValue : window[name];
};

// 安全访问扩展设置（含总开关、自定义控制栏、边框隐藏等新配置）
const getExtensionSettings = () => {
  const settings = getSafeGlobal("extension_settings", {});
  if (!settings[EXTENSION_ID]) {
    settings[EXTENSION_ID] = {
      enabled: true,
      serviceUrl: "http://localhost:9000",
      playMode: "random",
      autoSwitch: false,
      slideshowMode: true,
      switchInterval: 5000,
      position: { x: 100, y: 100, width: 600, height: 400 },
      isLocked: false,
      isWindowVisible: true,
      showInfo: true,
      autoSwitchMode: "timer",
      aiResponseCooldown: 3000,
      lastAISwitchTime: 0,
      randomPlayedIndices: [],
      randomMediaList: [],
      isPlaying: false,
      transitionEffect: "fade",
      preloadImages: true,
      preloadVideos: false,
      playerDetectEnabled: true,
      aiDetectEnabled: true,
      pollingInterval: 30000,
      videoLoop: false,
      videoVolume: 0.8,
      mediaFilter: "all",
      showVideoControls: true,
      lastMediaIndex: 0,
      progressUpdateInterval: null,
      hideBorder: false,
      customVideoControls: {
        showProgress: true,
        showVolume: true,
        showLoop: true,
        showTime: true,
      },
    };
  }
  return settings[EXTENSION_ID];
};

// 安全设置方法
const saveSafeSettings = () => {
  const saveFn = getSafeGlobal("saveSettingsDebounced", null);
  if (saveFn && typeof saveFn === "function") {
    saveFn();
  }
};

// 安全 toastr 方案
const getSafeToastr = () => {
  const toastrExists = window.toastr && typeof window.toastr === "object";
  return toastrExists
    ? window.toastr
    : {
        success: (msg) => console.log(`TOAST_SUCCESS: ${msg}`),
        info: (msg) => console.info(`TOAST_INFO: ${msg}`),
        warning: (msg) => console.warn(`TOAST_WARNING: ${msg}`),
        error: (msg) => console.error(`TOAST_ERROR: ${msg}`),
      };
};
const toastr = getSafeToastr();

// ==================== 播放器状态 ====================
let mediaList = [];
let currentMediaIndex = 0;
let switchTimer = null;
let serviceStatus = {
  active: false,
  totalCount: 0,
  imageCount: 0,
  videoCount: 0,
};
let retryCount = 0;
let pollingTimer = null;
let preloadedMedia = null;
let currentMediaType = "image";
let ws = null;
let dragData = null;
let resizeData = null;
let progressDrag = false;
let volumeDrag = false;

// ==================== API 通信 ====================
const checkServiceStatus = async () => {
  const settings = getExtensionSettings();
  try {
    const response = await fetch(`${settings.serviceUrl}/status`);
    if (!response.ok) throw new Error(`HTTP错误 ${response.status}`);
    const data = await response.json();
    serviceStatus = {
      active: data.active,
      observerActive: data.observer_active || false,
      totalCount: data.total_count || 0,
      imageCount: data.image_count || 0,
      videoCount: data.video_count || 0,
      directory: data.directory || "",
      mediaConfig: data.media_config || {},
    };
    return serviceStatus;
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 服务检查失败`, error);
    return { active: false, error: error.message, observerActive: false };
  }
};

const fetchMediaList = async (filterType = "all") => {
  const settings = getExtensionSettings();
  if (!settings.serviceUrl) throw new Error("无服务地址");
  try {
    const response = await fetch(
      `${settings.serviceUrl}/images?type=${filterType}`
    );
    if (!response.ok) throw new Error(`HTTP错误 ${response.status}`);
    const data = await response.json();
    return data.media || [];
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 获取媒体列表失败`, error);
    toastr.error("获取媒体列表失败");
    return [];
  }
};

const updateMediaSizeLimit = async (imageMaxMb, videoMaxMb) => {
  const settings = getExtensionSettings();
  try {
    const response = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: settings.serviceDirectory || serviceStatus.directory,
        image_max_mb: imageMaxMb,
        video_max_mb: videoMaxMb,
      }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "更新媒体限制失败");
    }
    const result = await response.json();
    toastr.success(
      `媒体大小限制已更新（图片: ${imageMaxMb}MB | 视频: ${videoMaxMb}MB）`
    );
    return result;
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 更新媒体限制失败`, error);
    toastr.error(`更新媒体限制失败: ${error.message}`);
    return null;
  }
};

const updateScanDirectory = async (newPath) => {
  const settings = getExtensionSettings();
  try {
    const response = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: newPath,
        image_max_mb: settings.mediaConfig?.image_max_size_mb || 5,
        video_max_mb: settings.mediaConfig?.video_max_size_mb || 100,
      }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "更新目录失败");
    }
    const result = await response.json();
    settings.serviceDirectory = newPath;
    toastr.success(`扫描目录已更新: ${result.path}`);
    await refreshMediaList();
    return true;
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 更新目录失败`, error);
    toastr.error(`更新目录失败: ${error.message}`);
    return false;
  }
};

const cleanupInvalidMedia = async () => {
  const settings = getExtensionSettings();
  try {
    const response = await fetch(`${settings.serviceUrl}/cleanup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error("清理失败");
    const result = await response.json();
    toastr.success(
      `已清理${result.removed}个无效媒体文件，剩余${result.remaining_total}个`
    );
    await refreshMediaList();
    return result;
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 清理媒体失败`, error);
    toastr.error(`清理媒体失败: ${error.message}`);
    return null;
  }
};

const refreshMediaList = async () => {
  const settings = getExtensionSettings();
  mediaList = await fetchMediaList(settings.mediaFilter);
  settings.randomMediaList = [...mediaList];
  currentMediaIndex = 0;
  settings.lastMediaIndex = 0;
  settings.randomPlayedIndices = [];
  clearTimeout(switchTimer);
  return mediaList;
};

// ==================== WebSocket 实时更新 ====================
const initWebSocket = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || !settings.serviceUrl || ws) return;
  try {
    const wsUrl =
      settings.serviceUrl.replace("http://", "ws://") + "/socket.io";
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      console.log(`[${EXTENSION_ID}] WebSocket连接成功`);
      refreshMediaList().then(() => showImage("current"));
    };
    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "media_updated":
          serviceStatus.totalCount = data.total_count;
          serviceStatus.imageCount = data.image_count;
          serviceStatus.videoCount = data.video_count;
          await refreshMediaList();
          toastr.info(
            `媒体库已更新（总计: ${data.total_count} | 图片: ${data.image_count} | 视频: ${data.video_count}）`
          );
          updateStatusDisplay();
          break;
        case "filtered_media":
          console.log(
            `[${EXTENSION_ID}] 筛选媒体: ${data.media_type} (${data.count}个)`
          );
          break;
        case "pong":
          break;
      }
    };
    ws.onclose = () => {
      console.log(`[${EXTENSION_ID}] WebSocket连接关闭`);
      ws = null;
      if (settings.enabled) setTimeout(initWebSocket, 5000);
    };
    ws.onerror = (error) => {
      console.error(`[${EXTENSION_ID}] WebSocket错误`, error);
      ws = null;
      if (settings.enabled) setTimeout(initWebSocket, 5000);
    };
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, 10000);
  } catch (error) {
    console.error(`[${EXTENSION_ID}] WebSocket初始化失败`, error);
    ws = null;
    if (settings.enabled) setTimeout(initWebSocket, 5000);
  }
};

// ==================== 视频控制事件委托（新增） ====================
const bindVideoControlEvents = (winSelector) => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return;

  // 进度条点击
  $(document).off("mousedown", `${winSelector} #video-progress-bar`);
  $(document).on(
    "mousedown",
    `${winSelector} #video-progress-bar`,
    function (e) {
      const videoElement = $(winSelector).find(".image-player-video")[0];
      if (!videoElement) return;
      progressDrag = true;
      const barRect = this.getBoundingClientRect();
      const clickX = Math.max(
        0,
        Math.min(e.clientX - barRect.left, barRect.width)
      );
      const progress = clickX / barRect.width;
      videoElement.currentTime = (videoElement.duration || 0) * progress;
      updateProgressBar(progress);
      if (!videoElement.paused) videoElement.pause();
    }
  );

  // 音量按钮
  $(document).off("click", `${winSelector} .volume-btn`);
  $(document).on("click", `${winSelector} .volume-btn`, function () {
    const volumeSlider = $(winSelector).find(".volume-slider");
    const currentVolume = parseFloat(volumeSlider.val());
    const newVolume = currentVolume > 0 ? 0 : settings.videoVolume || 0.8;
    volumeSlider.val(newVolume);
    updateVolume(newVolume);
  });

  // 循环按钮
  $(document).off("click", `${winSelector} .loop-btn`);
  $(document).on("click", `${winSelector} .loop-btn`, function () {
    settings.videoLoop = !settings.videoLoop;
    saveSafeSettings();
    $(this).toggleClass("active", settings.videoLoop);
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) videoElement.loop = settings.videoLoop;
    toastr.info(
      settings.videoLoop ? "视频循环已启用（AI切换暂时无效）" : "视频循环已禁用"
    );
  });

  // 音量条拖拽
  $(document).off("mousedown", `${winSelector} .volume-slider`);
  $(document).on("mousedown", `${winSelector} .volume-slider`, function () {
    volumeDrag = true;
  });
};

// ==================== 播放器窗口 ====================
const createImagePlayerWindow = async () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || $(`#${PLAYER_WINDOW_ID}`).length > 0) return;

  const infoHTML = settings.showInfo
    ? `<div class="image-info">加载中...</div>`
    : "";

  const videoControlsHTML = settings.showVideoControls
    ? `
        <div class="video-controls">
            ${
              settings.customVideoControls.showProgress
                ? `
            <div class="progress-container">
                <div class="progress-bar" id="video-progress-bar">
                    <div class="progress-loaded"></div>
                    <div class="progress-played"></div>
                    <div class="progress-handle"></div>
                </div>
            </div>`
                : ""
            }
            <div class="video-control-group">
                ${
                  settings.customVideoControls.showVolume
                    ? `
                <button class="video-control-btn volume-btn" title="调整音量">
                    <i class="fa-solid ${
                      settings.videoVolume > 0
                        ? "fa-volume-high"
                        : "fa-volume-mute"
                    }"></i>
                </button>
                <div class="volume-slider-container">
                    <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="${
                      settings.videoVolume
                    }" />
                </div>`
                    : ""
                }
                ${
                  settings.customVideoControls.showLoop
                    ? `
                <button class="video-control-btn loop-btn ${
                  settings.videoLoop ? "active" : ""
                }" title="循环播放">
                    <i class="fa-solid fa-repeat"></i>
                </button>`
                    : ""
                }
                ${
                  settings.customVideoControls.showTime
                    ? `
                <div class="time-display">
                    <span class="current-time">00:00</span> / <span class="total-time">00:00</span>
                </div>`
                    : ""
                }
            </div>
        </div>
        `
    : "";

  const html = `
    <div id="${PLAYER_WINDOW_ID}" class="image-player-window ${
    settings.hideBorder ? "no-border" : ""
  }">
        <div class="image-player-header">
            <div class="title"><i class="fa-solid fa-film"></i> ${EXTENSION_NAME}</div>
            <div class="window-controls">
                <button class="lock"><i class="fa-solid ${
                  settings.isLocked ? "fa-lock" : "fa-lock-open"
                }"></i></button>
                <button class="toggle-info ${
                  settings.showInfo ? "active" : ""
                }"><i class="fa-solid fa-circle-info"></i></button>
                <button class="toggle-video-controls ${
                  settings.showVideoControls ? "active" : ""
                }" title="${
    settings.showVideoControls ? "隐藏视频控制" : "显示视频控制"
  }">
                    <i class="fa-solid fa-video"></i>
                </button>
                <button class="hide"><i class="fa-solid fa-minus"></i></button>
            </div>
        </div>
        <div class="image-player-body">
            <div class="image-container">
                <div class="loading-animation">加载媒体中...</div>
                <img class="image-player-img" 
                     onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFAAH/l8iC5gAAAABJRU5ErkJggg=='" />
                <video class="image-player-video" 
                       ${settings.videoLoop ? "loop" : ""}
                       preload="metadata"
                       style="display:none;max-width:100%;max-height:100%;object-fit:contain;">
                    您的浏览器不支持HTML5视频播放
                </video>
            </div>
            ${infoHTML}
            ${videoControlsHTML}
        </div>
        <div class="image-player-controls">
            <div class="controls-group">
                <button class="control-btn play-pause"><i class="fa-solid ${
                  settings.isPlaying ? "fa-pause" : "fa-play"
                }"></i></button>
                <button class="control-btn mode-switch" title="${
                  settings.playMode === "random" ? "随机模式" : "顺序模式"
                }">
                    <i class="fa-solid ${
                      settings.playMode === "random"
                        ? "fa-shuffle"
                        : "fa-list-ol"
                    }"></i>
                </button>
                <button class="control-btn switch-mode-toggle ${
                  settings.autoSwitchMode === "detect" ? "active" : ""
                }" title="切换模式: ${
    settings.autoSwitchMode === "detect" ? "检测播放" : "定时切换"
  }">
                    <i class="fa-solid ${
                      settings.autoSwitchMode === "detect"
                        ? "fa-robot"
                        : "fa-clock"
                    }"></i>
                </button>
            </div>
            <div class="controls-group">
                <button class="control-btn prev" title="上一个"><i class="fa-solid fa-backward-step"></i></button>
                <div class="control-text">${
                  settings.playMode === "random" ? "随机模式" : "顺序模式: 0/0"
                }</div>
                <button class="control-btn next" title="下一个"><i class="fa-solid fa-forward-step"></i></button>
            </div>
            <div class="controls-group media-filter-group">
                <button class="control-btn media-filter-btn ${
                  settings.mediaFilter === "all" ? "active" : ""
                }" data-type="all" title="所有媒体">
                    <i class="fa-solid fa-film"></i>
                </button>
                <button class="control-btn media-filter-btn ${
                  settings.mediaFilter === "image" ? "active" : ""
                }" data-type="image" title="仅图片">
                    <i class="fa-solid fa-image"></i>
                </button>
                <button class="control-btn media-filter-btn ${
                  settings.mediaFilter === "video" ? "active" : ""
                }" data-type="video" title="仅视频">
                    <i class="fa-solid fa-video"></i>
                </button>
            </div>
            <div class="resize-handle"></div>
        </div>
    </div>`;
  $("body").append(html);
  setupWindowEvents(PLAYER_WINDOW_ID);
  positionWindow(PLAYER_WINDOW_ID);
  const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (videoElement) videoElement.volume = settings.videoVolume;
  console.log(`[${EXTENSION_ID}] 媒体播放器窗口已创建`);
};

const positionWindow = (windowId) => {
  const settings = getExtensionSettings();
  const win = $(`#${windowId}`);
  const winSelector = `#${windowId}`;
  win
    .css({
      left: `${settings.position.x}px`,
      top: `${settings.position.y}px`,
      width: `${settings.position.width}px`,
      height: `${settings.position.height}px`,
    })
    .toggleClass("locked", settings.isLocked)
    .toggle(settings.isWindowVisible)
    .toggleClass("no-border", settings.hideBorder);

  // 边框隐藏时控制栏显示逻辑
  if (settings.hideBorder && settings.showVideoControls) {
    const videoContainer = win.find(".image-container");
    const videoControls = win.find(".video-controls");
    videoContainer.off("mouseenter mouseleave");

    videoContainer.on("mouseenter", () => {
      videoControls.css({ bottom: 0, opacity: 1 });
    });

    videoContainer.on("mouseleave", () => {
      setTimeout(() => {
        if (!progressDrag && !volumeDrag) {
          videoControls.css({ bottom: "-40px" });
        }
      }, 3000);
    });
    bindVideoControlEvents(winSelector);
  }
  adjustVideoControlsLayout();
};

const adjustVideoControlsLayout = () => {
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const settings = getExtensionSettings();
  const bodyHeight = win.find(".image-player-body").height();
  const videoControlsHeight = win.find(".video-controls").outerHeight() || 40;
  win
    .find(".image-container")
    .css("height", `calc(100% - ${videoControlsHeight}px)`);
  win.find(".progress-container").css("width", "100%");
};

// ==================== 窗口事件 ====================
const setupWindowEvents = (windowId) => {
  const winElement = document.getElementById(windowId);
  const header = winElement.querySelector(".image-player-header");
  const resizeHandle = winElement.querySelector(".resize-handle");
  const winSelector = `#${windowId}`;
  const settings = getExtensionSettings();

  // 窗口拖拽
  header.addEventListener("mousedown", (e) => {
    if (settings.isLocked || settings.hideBorder) return;
    dragData = {
      element: winElement,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: winElement.offsetLeft,
      startTop: winElement.offsetTop,
    };
  });

  // 窗口调整大小
  resizeHandle.addEventListener("mousedown", (e) => {
    if (settings.isLocked || settings.hideBorder) return;
    e.preventDefault();
    resizeData = {
      element: winElement,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: winElement.offsetWidth,
      startHeight: winElement.offsetHeight,
    };
  });

  // 全局鼠标事件
  document.addEventListener("mousemove", (e) => {
    // 窗口拖拽
    if (dragData) {
      const diffX = e.clientX - dragData.startX;
      const diffY = e.clientY - dragData.startY;
      dragData.element.style.left = `${dragData.startLeft + diffX}px`;
      dragData.element.style.top = `${dragData.startTop + diffY}px`;
    }

    // 窗口调整大小
    if (resizeData) {
      const diffX = e.clientX - resizeData.startX;
      const diffY = e.clientY - resizeData.startY;
      const newWidth = Math.max(300, resizeData.startWidth + diffX);
      const newHeight = Math.max(200, resizeData.startHeight + diffY);
      resizeData.element.style.width = `${newWidth}px`;
      resizeData.element.style.height = `${newHeight}px`;
      adjustVideoControlsLayout();
    }

    // 进度条拖拽
    if (progressDrag && settings.customVideoControls.showProgress) {
      const progressBar = $(winSelector).find("#video-progress-bar");
      const barRect = progressBar[0].getBoundingClientRect();
      const clickX = Math.max(
        0,
        Math.min(e.clientX - barRect.left, barRect.width)
      );
      const progress = clickX / barRect.width;
      updateProgressBar(progress);
      const videoElement = $(winSelector).find(".image-player-video")[0];
      const totalTime = videoElement?.duration || 0;
      const currentTime = totalTime * progress;
      $(winSelector).find(".current-time").text(formatTime(currentTime));
    }

    // 音量条拖拽
    if (volumeDrag && settings.customVideoControls.showVolume) {
      const volumeSlider = $(winSelector).find(".volume-slider");
      const sliderRect = volumeSlider[0].getBoundingClientRect();
      const clickX = Math.max(
        0,
        Math.min(e.clientX - sliderRect.left, sliderRect.width)
      );
      const volume = clickX / sliderRect.width;
      volumeSlider.val(volume);
      updateVolume(volume);
    }
  });

  document.addEventListener("mouseup", () => {
    // 保存窗口位置/大小
    if (dragData || resizeData) {
      const element = dragData?.element || resizeData?.element;
      settings.position = {
        x: element.offsetLeft,
        y: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
      saveSafeSettings();
      dragData = null;
      resizeData = null;
    }

    // 进度条拖拽结束
    if (progressDrag && settings.customVideoControls.showProgress) {
      const videoElement = $(winSelector).find(".image-player-video")[0];
      if (videoElement && !isNaN(videoElement.duration)) {
        const progress = videoElement.currentTime / videoElement.duration || 0;
        updateProgressBar(progress);
        if (settings.isPlaying && videoElement.paused) {
          videoElement
            .play()
            .catch((err) => console.warn("视频播放失败:", err));
        }
      }
    }

    progressDrag = false;
    volumeDrag = false;

    // 边框隐藏时延迟隐藏控制栏
    if (settings.hideBorder) {
      setTimeout(() => {
        const videoControls = $(winSelector).find(".video-controls");
        const videoContainer = $(winSelector).find(".image-container");
        if (!videoContainer.is(":hover")) {
          videoControls.css({ bottom: "-40px", opacity: 0 });
        }
      }, 1000);
    }
  });

  // 事件委托：窗口锁定
  $(document).off("click", `${winSelector} .lock`);
  $(document).on("click", `${winSelector} .lock`, function () {
    if (!settings.enabled) return;
    settings.isLocked = !settings.isLocked;
    saveSafeSettings();
    $(this).find("i").toggleClass("fa-lock fa-lock-open");
    $(this).closest(".image-player-window").toggleClass("locked");
    toastr.info(`窗口已${settings.isLocked ? "锁定" : "解锁"}`);
  });

  // 事件委托：播放/暂停
  $(document).off("click", `${winSelector} .play-pause`);
  $(document).on("click", `${winSelector} .play-pause`, function () {
    if (!settings.enabled) return;
    const videoElement = $(winSelector).find(".image-player-video")[0];
    const isCurrentVideo = videoElement && $(videoElement).is(":visible");
    const icon = $(this).find("i");

    if (isCurrentVideo) {
      if (videoElement.paused) {
        videoElement
          .play()
          .then(() => {
            settings.isPlaying = true;
            icon.removeClass("fa-play").addClass("fa-pause");
            startProgressUpdate();
          })
          .catch((err) => {
            console.warn("视频播放失败（浏览器限制）:", err);
            toastr.warning("视频自动播放受浏览器限制，请点击视频播放");
          });
      } else {
        videoElement.pause();
        settings.isPlaying = false;
        icon.removeClass("fa-pause").addClass("fa-play");
        stopProgressUpdate();
        clearTimeout(switchTimer);
      }
    } else {
      const wasPlaying = settings.isPlaying;
      settings.isPlaying = !wasPlaying;
      icon.toggleClass("fa-play fa-pause");
      if (settings.isPlaying && !wasPlaying) {
        startPlayback();
      } else {
        clearTimeout(switchTimer);
        stopProgressUpdate();
        const imgElement = $(winSelector).find(".image-player-img")[0];
        if (imgElement)
          imgElement.classList.remove(
            "fade-transition",
            "slide-transition",
            "zoom-transition"
          );
      }
    }
    saveSafeSettings();
  });

  // 事件委托：模式切换
  $(document).off("click", `${winSelector} .mode-switch`);
  $(document).on("click", `${winSelector} .mode-switch`, function () {
    if (!settings.enabled) return;
    settings.playMode =
      settings.playMode === "random" ? "sequential" : "random";
    saveSafeSettings();
    const icon = $(this).find("i");
    icon.toggleClass("fa-shuffle fa-list-ol");
    if (settings.playMode === "random") {
      settings.randomMediaList = [...mediaList];
      settings.randomPlayedIndices = [];
    }
    updateExtensionMenu();
    showImage("current");
  });

  // 事件委托：显示/隐藏媒体信息
  $(document).off("click", `${winSelector} .toggle-info`);
  $(document).on("click", `${winSelector} .toggle-info`, function () {
    if (!settings.enabled) return;
    settings.showInfo = !settings.showInfo;
    saveSafeSettings();
    $(this).toggleClass("active", settings.showInfo);
    $(this)
      .closest(".image-player-body")
      .find(".image-info")
      .toggle(settings.showInfo);
  });

  // 事件委托：显示/隐藏视频控制
  $(document).off("click", `${winSelector} .toggle-video-controls`);
  $(document).on("click", `${winSelector} .toggle-video-controls`, function () {
    if (!settings.enabled) return;
    settings.showVideoControls = !settings.showVideoControls;
    saveSafeSettings();
    $(this).toggleClass("active", settings.showVideoControls);
    $(`${winSelector} .video-controls`).toggle(settings.showVideoControls);
    adjustVideoControlsLayout();
    bindVideoControlEvents(winSelector);
  });

  // 事件委托：隐藏窗口
  $(document).off("click", `${winSelector} .hide`);
  $(document).on("click", `${winSelector} .hide`, function () {
    $(winElement).hide();
    settings.isWindowVisible = false;
    saveSafeSettings();
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) videoElement.pause();
    stopProgressUpdate();
  });

  // 事件委托：上一个
  $(document).off("click", `${winSelector} .prev`);
  $(document).on("click", `${winSelector} .prev`, () => {
    if (!settings.enabled) return;
    clearTimeout(switchTimer);
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) {
      videoElement.pause();
      stopProgressUpdate();
    }
    showImage("prev");
  });

  // 事件委托：下一个
  $(document).off("click", `${winSelector} .next`);
  $(document).on("click", `${winSelector} .next`, () => {
    if (!settings.enabled) return;
    clearTimeout(switchTimer);
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) {
      videoElement.pause();
      stopProgressUpdate();
    }
    showImage("next");
  });

  // 事件委托：切换模式
  $(document).off("click", `${winSelector} .switch-mode-toggle`);
  $(document).on("click", `${winSelector} .switch-mode-toggle`, function () {
    if (!settings.enabled) return;
    settings.autoSwitchMode =
      settings.autoSwitchMode === "detect" ? "timer" : "detect";
    settings.isPlaying = settings.autoSwitchMode !== null;
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) videoElement.pause();
    stopProgressUpdate();
    saveSafeSettings();
    $(this)
      .toggleClass("active", settings.autoSwitchMode === "detect")
      .find("i")
      .toggleClass("fa-robot fa-clock");
    $(`${winSelector} .play-pause i`)
      .toggleClass("fa-play", !settings.isPlaying)
      .toggleClass("fa-pause", settings.isPlaying);
  });

  // 事件委托：媒体筛选
  $(document).off("click", `${winSelector} .media-filter-btn`);
  $(document).on("click", `${winSelector} .media-filter-btn`, function () {
    if (!settings.enabled) return;
    const filterType = $(this).data("type");
    settings.mediaFilter = filterType;
    saveSafeSettings();
    $(`${winSelector} .media-filter-btn`).removeClass("active");
    $(this).addClass("active");
    refreshMediaList().then(() => {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      settings.randomMediaList = [...mediaList];
      showImage("current");
    });
  });

  // 视频事件监听
  const videoElement = $(winSelector).find(".image-player-video")[0];
  if (videoElement) {
    videoElement.onended = () => {
      if (settings.isPlaying && !settings.videoLoop) {
        showImage("next");
      } else {
        updateProgressBar(0);
        $(winSelector).find(".current-time").text("00:00");
      }
    };

    if (settings.customVideoControls.showProgress) {
      videoElement.onprogress = () => {
        if (videoElement.buffered.length > 0) {
          const loadedProgress =
            videoElement.buffered.end(videoElement.buffered.length - 1) /
            videoElement.duration;
          $(winSelector)
            .find(".progress-loaded")
            .css("width", `${loadedProgress * 100}%`);
        }
      };
    }

    if (settings.customVideoControls.showTime) {
      videoElement.onloadedmetadata = () => {
        $(winSelector)
          .find(".total-time")
          .text(formatTime(videoElement.duration));
        $(winSelector).find(".progress-loaded").css("width", "0%");
      };
    }
  }

  // 绑定视频控制事件
  bindVideoControlEvents(winSelector);
};

// ==================== 播放控制 ====================
const formatTime = (seconds) => {
  if (isNaN(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

const updateProgressBar = (progress) => {
  const settings = getExtensionSettings();
  if (!settings.customVideoControls.showProgress) return;
  progress = Math.max(0, Math.min(1, progress));
  $(`#${PLAYER_WINDOW_ID}`)
    .find(".progress-played")
    .css("width", `${progress * 100}%`);
  $(`#${PLAYER_WINDOW_ID}`)
    .find(".progress-handle")
    .css("left", `${progress * 100}%`);
};

const startProgressUpdate = () => {
  const settings = getExtensionSettings();
  if (
    !settings.customVideoControls.showProgress &&
    !settings.customVideoControls.showTime
  )
    return;
  stopProgressUpdate();
  settings.progressUpdateInterval = setInterval(() => {
    const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
    if (!videoElement || videoElement.paused || isNaN(videoElement.duration))
      return;
    if (settings.hideBorder && settings.showVideoControls) {
      const videoControls = $(`#${PLAYER_WINDOW_ID} .video-controls`);
      videoControls.css({ bottom: 0, opacity: 1 });
    }
    const progress = videoElement.currentTime / videoElement.duration;
    updateProgressBar(progress);
    if (settings.customVideoControls.showTime) {
      $(`#${PLAYER_WINDOW_ID} .current-time`).text(
        formatTime(videoElement.currentTime)
      );
    }
  }, 500);
};

const stopProgressUpdate = () => {
  const settings = getExtensionSettings();
  if (settings.progressUpdateInterval) {
    clearInterval(settings.progressUpdateInterval);
    settings.progressUpdateInterval = null;
  }
};

const updateVolume = (volume) => {
  const settings = getExtensionSettings();
  if (!settings.customVideoControls.showVolume) return;
  volume = Math.max(0, Math.min(1, volume));
  settings.videoVolume = volume;
  saveSafeSettings();
  const winSelector = `#${PLAYER_WINDOW_ID}`;
  const videoElement = $(winSelector).find(".image-player-video")[0];
  if (videoElement) videoElement.volume = volume;
  const volumeIcon = $(winSelector).find(".volume-btn i");
  if (volume === 0) {
    volumeIcon
      .removeClass("fa-volume-high fa-volume-low")
      .addClass("fa-volume-mute");
  } else if (volume < 0.5) {
    volumeIcon
      .removeClass("fa-volume-high fa-volume-mute")
      .addClass("fa-volume-low");
  } else {
    volumeIcon
      .removeClass("fa-volume-low fa-volume-mute")
      .addClass("fa-volume-high");
  }
  $(winSelector).find(".volume-slider").val(volume);
};

const startPlayback = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || !settings.isPlaying) return;
  clearTimeout(switchTimer);
  const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  const isCurrentVideo = videoElement && $(videoElement).is(":visible");

  if (settings.autoSwitchMode === "timer") {
    if (isCurrentVideo) {
      const playEndHandler = () => {
        if (!settings.videoLoop) {
          videoElement.removeEventListener("ended", playEndHandler);
          showImage("next");
        }
      };
      videoElement.addEventListener("ended", playEndHandler);
      if (videoElement.paused) {
        videoElement.play().catch((err) => console.warn("视频播放失败:", err));
        startProgressUpdate();
      }
    } else {
      showImage("next");
      switchTimer = setTimeout(startPlayback, settings.switchInterval);
    }
  }
};

const getRandomMediaIndex = () => {
  const settings = getExtensionSettings();
  const filteredList = settings.randomMediaList || [];
  if (filteredList.length === 0) return 0;
  if (settings.randomPlayedIndices.length >= filteredList.length) {
    settings.randomPlayedIndices = [];
  }
  const availableIndices = filteredList
    .map((_, index) => index)
    .filter((index) => !settings.randomPlayedIndices.includes(index));
  if (availableIndices.length === 0) return 0;
  const randomIndex = Math.floor(Math.random() * availableIndices.length);
  return availableIndices[randomIndex];
};

const preloadMediaItem = async (mediaUrl, mediaType) => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return null;
  if (mediaType === "video" && !settings.preloadVideos) return null;
  const maxRetries = 3;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await new Promise((resolve, reject) => {
        if (mediaType === "image") {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("图片预加载失败"));
          img.src = mediaUrl;
        } else if (mediaType === "video") {
          const video = document.createElement("video");
          video.preload = "metadata";
          video.onloadedmetadata = () => resolve(video);
          video.onerror = () => reject(new Error("视频预加载失败"));
          video.src = mediaUrl;
        } else {
          resolve(null);
        }
      });
    } catch (error) {
      retries++;
      console.warn(
        `[${EXTENSION_ID}] 预加载${mediaType}失败，重试中（${retries}/${maxRetries}）`,
        error
      );
      if (retries >= maxRetries) {
        console.error(
          `[${EXTENSION_ID}] 预加载${mediaType}失败（已达最大重试次数）`
        );
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null;
};

const applyTransitionEffect = (element, effectType, mediaType) => {
  if (mediaType === "video") return;
  element.classList.remove(
    "fade-transition",
    "slide-transition",
    "zoom-transition"
  );
  if (effectType !== "none") {
    element.classList.add(`${effectType}-transition`);
  }
};

const showImage = async (direction) => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return;
  const winId = `#${PLAYER_WINDOW_ID}`;
  const imgElement = $(winId).find(".image-player-img")[0];
  const videoElement = $(winId).find(".image-player-video")[0];
  const loadingElement = $(winId).find(".loading-animation")[0];

  stopProgressUpdate();
  $(imgElement).hide();
  $(videoElement).hide();
  $(loadingElement).show();
  $(winId).find(".control-text").text("加载中...");

  try {
    if (!settings.serviceUrl) throw new Error("无服务地址");
    const status = await checkServiceStatus();
    if (!status.active) throw new Error("媒体服务未连接");
    let mediaUrl, mediaName, mediaType;
    const filterType = settings.mediaFilter;

    if (settings.playMode === "random") {
      if (settings.randomMediaList.length === 0) {
        settings.randomMediaList = await fetchMediaList(filterType);
        settings.randomPlayedIndices = [];
      }
      let randomIndex = -1;
      if (direction === "next") {
        randomIndex = getRandomMediaIndex();
        if (randomIndex !== -1 && randomIndex !== undefined) {
          settings.randomPlayedIndices.push(randomIndex);
        }
      } else if (direction === "prev") {
        if (settings.randomPlayedIndices.length > 1) {
          settings.randomPlayedIndices.pop();
          randomIndex = settings.randomPlayedIndices.pop();
          settings.randomPlayedIndices.push(randomIndex);
        } else {
          randomIndex = settings.randomPlayedIndices[0] || 0;
        }
      } else if (direction === "current") {
        if (settings.randomPlayedIndices.length > 0) {
          randomIndex =
            settings.randomPlayedIndices[
              settings.randomPlayedIndices.length - 1
            ];
        } else {
          randomIndex = getRandomMediaIndex();
          if (randomIndex !== -1 && randomIndex !== undefined) {
            settings.randomPlayedIndices.push(randomIndex);
          }
        }
      }
      if (
        randomIndex === -1 ||
        randomIndex >= settings.randomMediaList.length ||
        randomIndex === undefined
      ) {
        throw new Error("无可用媒体文件");
      }
      const mediaItem = settings.randomMediaList[randomIndex];
      mediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
        mediaItem.rel_path
      )}`;
      mediaName = mediaItem.name;
      mediaType = mediaItem.media_type;
    } else {
      if (mediaList.length === 0) {
        mediaList = await fetchMediaList(filterType);
      }
      if (mediaList.length === 0) throw new Error("无可用媒体文件");
      if (direction === "next") {
        currentMediaIndex = (currentMediaIndex + 1) % mediaList.length;
        if (!settings.slideshowMode && currentMediaIndex === 0) {
          $(winId + " .play-pause i")
            .removeClass("fa-pause")
            .addClass("fa-play");
          settings.isPlaying = false;
          saveSafeSettings();
          return;
        }
      } else if (direction === "prev") {
        currentMediaIndex =
          (currentMediaIndex - 1 + mediaList.length) % mediaList.length;
      } else if (direction === "current") {
        if (currentMediaIndex >= mediaList.length) {
          currentMediaIndex = 0;
        }
      }
      const mediaItem = mediaList[currentMediaIndex];
      mediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
        mediaItem.rel_path
      )}`;
      mediaName = mediaItem.name;
      mediaType = mediaItem.media_type;
    }

    currentMediaType = mediaType;
    $(loadingElement).hide(); // 提前隐藏加载动画，避免闪烁

    if (mediaType === "image") {
      applyTransitionEffect(imgElement, settings.transitionEffect, mediaType);
      if (preloadedMedia && preloadedMedia.src === mediaUrl) {
        $(imgElement).attr("src", mediaUrl).show();
      } else {
        const img = new Image();
        img.src = mediaUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error("图片加载失败"));
        });
        $(imgElement).attr("src", mediaUrl).show();
      }
      $(videoElement).hide();
    } else if (mediaType === "video") {
      videoElement.currentTime = 0;
      videoElement.loop = settings.videoLoop;
      $(videoElement).attr("src", mediaUrl);
      await new Promise((resolve, reject) => {
        const loadHandler = () => {
          videoElement.removeEventListener("loadedmetadata", loadHandler);
          resolve();
        };
        const errorHandler = () => {
          videoElement.removeEventListener("error", errorHandler);
          reject(new Error("视频加载失败"));
        };
        videoElement.addEventListener("loadedmetadata", loadHandler);
        videoElement.addEventListener("error", errorHandler);
      });
      $(videoElement).show();
      $(imgElement).hide();
      if (settings.isPlaying) {
        videoElement
          .play()
          .then(() => startProgressUpdate())
          .catch((err) => {
            console.warn("视频自动播放失败（浏览器限制）:", err);
            $(winId).find(".control-text").text("点击视频播放");
          });
      }
    }

    if (settings.showInfo) {
      $(winId).find(".image-info").text(`${mediaName}（${mediaType}）`).show();
    } else {
      $(winId).find(".image-info").hide();
    }

    const totalCount =
      settings.playMode === "random"
        ? settings.randomMediaList.length || 0
        : mediaList.length || 0;
    const currentCount =
      settings.playMode === "random"
        ? settings.randomPlayedIndices.length || 0
        : currentMediaIndex + 1;
    const statusText = `${
      settings.playMode === "random" ? "随机模式" : "顺序模式"
    }: ${currentCount}/${totalCount}（${mediaType}）`;
    $(winId).find(".control-text").text(statusText);

    retryCount = 0;
    if (
      (mediaType === "image" && settings.preloadImages) ||
      (mediaType === "video" && settings.preloadVideos)
    ) {
      let nextMediaUrl, nextMediaType;
      if (settings.playMode === "random") {
        const nextRandomIndex = getRandomMediaIndex();
        if (
          nextRandomIndex !== -1 &&
          nextRandomIndex < settings.randomMediaList.length
        ) {
          const nextMediaItem = settings.randomMediaList[nextRandomIndex];
          nextMediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
            nextMediaItem.rel_path
          )}`;
          nextMediaType = nextMediaItem.media_type;
        }
      } else {
        const nextIndex = (currentMediaIndex + 1) % mediaList.length;
        const nextMediaItem = mediaList[nextIndex];
        nextMediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
          nextMediaItem.rel_path
        )}`;
        nextMediaType = nextMediaItem.media_type;
      }
      if (nextMediaUrl && nextMediaType) {
        preloadedMedia = await preloadMediaItem(nextMediaUrl, nextMediaType);
      }
    }
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 加载媒体失败`, error);
    let errorMessage = "媒体加载失败";
    if (error.message.includes("Failed to fetch")) {
      errorMessage = "无法连接到媒体服务";
    } else if (error.message.includes("404")) {
      errorMessage = "媒体文件不存在";
    } else if (error.message.includes("无可用媒体文件")) {
      errorMessage = `没有可用的${
        settings.mediaFilter === "all"
          ? "媒体"
          : settings.mediaFilter === "image"
          ? "图片"
          : "视频"
      }文件`;
    }
    if (retryCount < 3 && settings.enabled) {
      retryCount++;
      toastr.warning(`${errorMessage}，重试中 (${retryCount}/3)...`);
      setTimeout(() => showImage(direction), 3000);
    } else {
      toastr.error(`${errorMessage}，已停止重试`);
      $(winId).find(".control-text").text("加载失败");
      $(loadingElement).hide();
    }
  }
};

// ==================== AI回复/玩家消息检测 ====================
const onAIResponse = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return;
  const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  const isLoopingVideo =
    videoElement && $(videoElement).is(":visible") && settings.videoLoop;
  if (isLoopingVideo) {
    console.log(`[${EXTENSION_ID}] 视频正在循环播放，AI检测切换已禁用`);
    return;
  }
  if (settings.autoSwitchMode !== "detect") return;
  if (!settings.isWindowVisible) return;
  if (!settings.aiDetectEnabled) return;
  const now = performance.now();
  if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) {
    console.log(`[${EXTENSION_ID}] 冷却时间未结束`);
    return;
  }
  settings.lastAISwitchTime = now;
  saveSafeSettings();
  showImage("next");
  console.log(`[${EXTENSION_ID}] AI回复检测: 切换到下一张媒体`);
};

const onPlayerMessage = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return;
  const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  const isLoopingVideo =
    videoElement && $(videoElement).is(":visible") && settings.videoLoop;
  if (isLoopingVideo) {
    console.log(`[${EXTENSION_ID}] 视频正在循环播放，玩家消息检测切换已禁用`);
    return;
  }
  if (settings.autoSwitchMode !== "detect") return;
  if (!settings.isWindowVisible) return;
  if (!settings.playerDetectEnabled) return;
  const now = performance.now();
  if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) {
    console.log(`[${EXTENSION_ID}] 冷却时间未结束`);
    return;
  }
  settings.lastAISwitchTime = now;
  saveSafeSettings();
  showImage("next");
  console.log(`[${EXTENSION_ID}] 玩家消息检测: 切换到下一张媒体`);
};

// ==================== 轮询服务状态 ====================
const startPollingService = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) {
    if (pollingTimer) clearTimeout(pollingTimer);
    return;
  }
  if (pollingTimer) clearTimeout(pollingTimer);
  const poll = async () => {
    try {
      const prevCount = serviceStatus.totalCount;
      await checkServiceStatus();
      if (serviceStatus.totalCount !== prevCount) {
        if (settings.playMode === "random") {
          settings.randomMediaList = await fetchMediaList(settings.mediaFilter);
          settings.randomPlayedIndices = [];
        } else {
          mediaList = await fetchMediaList(settings.mediaFilter);
        }
        toastr.info(
          `媒体列表已更新（总计: ${serviceStatus.totalCount} | 图片: ${serviceStatus.imageCount} | 视频: ${serviceStatus.videoCount}）`
        );
        updateStatusDisplay();
      }
    } catch (error) {
      console.error(`[${EXTENSION_ID}] 轮询服务失败`, error);
    } finally {
      if (settings.enabled)
        pollingTimer = setTimeout(poll, settings.pollingInterval);
    }
  };
  poll();
};

// ==================== 设置面板 ====================
const saveCurrentSettings = () => {
  const settings = getExtensionSettings();
  const prevEnabled = settings.enabled;
  settings.enabled = $("#extension-enabled").prop("checked");
  if (settings.enabled !== prevEnabled) {
    toastr.info(settings.enabled ? "媒体播放器已启用" : "媒体播放器已禁用");
  }
  if (!settings.enabled) return;

  settings.serviceUrl = $("#player-service-url").val().trim();
  settings.serviceDirectory =
    $("#player-scan-directory").val().trim() || settings.serviceDirectory;
  settings.playMode = $("#player-play-mode").val();
  settings.mediaFilter = $("#player-media-filter").val();
  settings.slideshowMode = $("#player-slideshow-mode").prop("checked");
  settings.videoLoop = $("#player-video-loop").prop("checked");
  settings.showInfo = $("#player-show-info").prop("checked");
  settings.preloadImages = $("#player-preload-images").prop("checked");
  settings.preloadVideos = $("#player-preload-videos").prop("checked");
  settings.showVideoControls = $("#player-show-video-controls").prop("checked");
  settings.transitionEffect = $("#player-transition-effect").val();
  settings.pollingInterval =
    parseInt($("#player-polling-interval").val()) || 30000;
  settings.switchInterval = parseInt($("#player-interval").val()) || 5000;
  settings.aiResponseCooldown =
    parseInt($("#player-ai-cooldown").val()) || 3000;
  settings.aiDetectEnabled = $("#player-ai-detect").prop("checked");
  settings.playerDetectEnabled = $("#player-player-detect").prop("checked");
  settings.hideBorder = $("#player-hide-border").prop("checked");
  settings.customVideoControls = {
    showProgress: $("#custom-show-progress").prop("checked"),
    showVolume: $("#custom-show-volume").prop("checked"),
    showLoop: $("#custom-show-loop").prop("checked"),
    showTime: $("#custom-show-time").prop("checked"),
  };

  if (!settings.mediaConfig) settings.mediaConfig = {};
  settings.mediaConfig.image_max_size_mb =
    parseInt($("#image-max-size").val()) || 5;
  settings.mediaConfig.video_max_size_mb =
    parseInt($("#video-max-size").val()) || 100;

  saveSafeSettings();
  $("#player-slideshow-mode").prop("disabled", settings.playMode === "random");
  $(`#${PLAYER_WINDOW_ID}`).toggleClass("no-border", settings.hideBorder);

  if (settings.showVideoControls) {
    const videoControlsHTML = `
          <div class="video-controls">
              ${
                settings.customVideoControls.showProgress
                  ? `
              <div class="progress-container">
                  <div class="progress-bar" id="video-progress-bar">
                      <div class="progress-loaded"></div>
                      <div class="progress-played"></div>
                      <div class="progress-handle"></div>
                  </div>
              </div>`
                  : ""
              }
              <div class="video-control-group">
                  ${
                    settings.customVideoControls.showVolume
                      ? `
                  <button class="video-control-btn volume-btn" title="调整音量">
                      <i class="fa-solid ${
                        settings.videoVolume > 0
                          ? "fa-volume-high"
                          : "fa-volume-mute"
                      }"></i>
                  </button>
                  <div class="volume-slider-container">
                      <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="${
                        settings.videoVolume
                      }" />
                  </div>`
                      : ""
                  }
                  ${
                    settings.customVideoControls.showLoop
                      ? `
                  <button class="video-control-btn loop-btn ${
                    settings.videoLoop ? "active" : ""
                  }" title="循环播放">
                      <i class="fa-solid fa-repeat"></i>
                  </button>`
                      : ""
                  }
                  ${
                    settings.customVideoControls.showTime
                      ? `
                  <div class="time-display">
                      <span class="current-time">00:00</span> / <span class="total-time">00:00</span>
                  </div>`
                      : ""
                  }
              </div>
          </div>
          `;
    $(`#${PLAYER_WINDOW_ID} .video-controls`).replaceWith(
      $(videoControlsHTML).get(0)
    );
    setupWindowEvents(PLAYER_WINDOW_ID);
    bindVideoControlEvents(`#${PLAYER_WINDOW_ID}`);
  }

  startPollingService();
  updateExtensionMenu();
  if (settings.isPlaying && settings.autoSwitchMode === "timer") {
    startPlayback();
  }

  if (!settings.enabled) {
    $(`#${PLAYER_WINDOW_ID}`).hide();
    clearTimeout(switchTimer);
    stopProgressUpdate();
    if (ws) ws.close();
  }
};

const updateStatusDisplay = () => {
  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const observerStatus = serviceStatus.observerActive ? "已启用" : "已禁用";
  const mediaStats = `总计: ${serviceStatus.totalCount} | 图片: ${serviceStatus.imageCount} | 视频: ${serviceStatus.videoCount}`;
  const statusText = `${serviceActive} (监控: ${observerStatus} | ${mediaStats})`;
  if ($(`#${SETTINGS_PANEL_ID}`).length) {
    $(`#${SETTINGS_PANEL_ID} .service-status span`)
      .removeClass("status-success status-error")
      .addClass(serviceStatus.active ? "status-success" : "status-error")
      .text(statusText);
  }
};

const createSettingsPanel = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || $(`#${SETTINGS_PANEL_ID}`).length > 0) return;
  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const observerStatus = serviceStatus.observerActive ? "已启用" : "已禁用";
  const mediaStats = `总计: ${serviceStatus.totalCount} | 图片: ${serviceStatus.imageCount} | 视频: ${serviceStatus.videoCount}`;
  const html = `
    <div id="${SETTINGS_PANEL_ID}">
        <div class="extension_settings inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-cog"></i> ${EXTENSION_NAME}</b>
                <div class="inline-drawer-icon"> 
                    <span class="glyphicon glyphicon-chevron-down"></span>
                </div>
            </div>
            <div class="inline-drawer-content">
                <div class="image-player-settings">
                    <div class="settings-row">
                        <label class="checkbox_label" style="min-width: auto;">
                            <input type="checkbox" id="extension-enabled" ${
                              settings.enabled ? "checked" : ""
                            } />
                            <i class="fa-solid fa-power-off"></i>启用媒体播放器扩展
                        </label>
                    </div>
                    <div class="settings-row">
                        <label class="service-status">
                            <i class="fa-solid ${
                              serviceStatus.active
                                ? "fa-plug-circle-check"
                                : "fa-plug"
                            }"></i>
                            服务状态: <span class="${
                              serviceStatus.active
                                ? "status-success"
                                : "status-error"
                            }">${serviceActive}</span> 
                            (监控: ${observerStatus} | ${mediaStats})
                        </label>
                    </div>
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-link"></i>服务地址
                        </label>
                        <input type="text" id="player-service-url" value="${
                          settings.serviceUrl
                        }" placeholder="http://localhost:9000" />
                    </div>
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-folder"></i>媒体目录
                        </label>
                        <input type="text" id="player-scan-directory" value="${
                          settings.serviceDirectory || serviceStatus.directory
                        }" placeholder="输入完整路径" />
                        <button id="update-directory" class="menu-button">更新目录</button>
                    </div>
                    <div class="settings-group">
                        <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                            <i class="fa-solid fa-maximize"></i> 媒体大小限制
                        </h4>
                        <div class="settings-row">
                            <label>
                                <i class="fa-solid fa-image"></i>图片最大尺寸
                            </label>
                            <input type="number" id="image-max-size" value="${
                              settings.mediaConfig?.image_max_size_mb || 5
                            }" min="1" max="50" step="1" />
                            <span>MB</span>
                            <label>
                                <i class="fa-solid fa-video"></i>视频最大尺寸
                            </label>
                            <input type="number" id="video-max-size" value="${
                              settings.mediaConfig?.video_max_size_mb || 100
                            }" min="10" max="500" step="10" />
                            <span>MB</span>
                            <button id="update-size-limit" class="menu-button">应用限制</button>
                        </div>
                    </div>
                    <div class="settings-row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-hide-border" ${
                              settings.hideBorder ? "checked" : ""
                            } />
                            <i class="fa-solid fa-border-none"></i>隐藏播放器边框（仅显示内容）
                        </label>
                    </div>
                    <div class="settings-group">
                        <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                            <i class="fa-solid fa-sliders"></i> 视频控制栏自定义
                        </h4>
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="custom-show-progress" ${
                                  settings.customVideoControls.showProgress
                                    ? "checked"
                                    : ""
                                } />
                                显示进度条
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="custom-show-volume" ${
                                  settings.customVideoControls.showVolume
                                    ? "checked"
                                    : ""
                                } />
                                显示音量控制
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="custom-show-loop" ${
                                  settings.customVideoControls.showLoop
                                    ? "checked"
                                    : ""
                                } />
                                显示循环按钮
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="custom-show-time" ${
                                  settings.customVideoControls.showTime
                                    ? "checked"
                                    : ""
                                } />
                                显示时间戳
                            </label>
                        </div>
                    </div>
                    <div class="function-toggle-group">
                        <div class="function-toggle ${
                          settings.autoSwitchMode === "timer" ? "active" : ""
                        }" id="toggle-timer-mode">
                            <i class="fa-solid fa-clock"></i>
                            <span>定时播放</span>
                        </div>
                        <div class="function-toggle ${
                          settings.autoSwitchMode === "detect" ? "active" : ""
                        }" id="toggle-detect-mode">
                            <i class="fa-solid fa-robot"></i>
                            <span>检测播放</span>
                        </div>
                    </div>
                    <div class="settings-group" ${
                      settings.autoSwitchMode !== "detect"
                        ? 'style="display:none;"'
                        : ""
                    } id="detect-sub-options">
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-ai-detect" ${
                                  settings.aiDetectEnabled ? "checked" : ""
                                } />
                                <i class="fa-solid fa-comment-dots"></i>AI回复时切换
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-player-detect" ${
                                  settings.playerDetectEnabled ? "checked" : ""
                                } />
                                <i class="fa-solid fa-keyboard"></i>玩家发送时切换
                            </label>
                        </div>
                    </div>
                    <div class="settings-row">
                                            <label>
                            <i class="fa-solid fa-clone"></i>播放模式
                        </label>
                        <select id="player-play-mode">
                            <option value="random" ${
                              settings.playMode === "random" ? "selected" : ""
                            }>随机播放</option>
                            <option value="sequential" ${
                              settings.playMode === "sequential"
                                ? "selected"
                                : ""
                            }>顺序播放</option>
                        </select>
                        <label>
                            <i class="fa-solid fa-filter"></i>媒体筛选
                        </label>
                        <select id="player-media-filter">
                            <option value="all" ${
                              settings.mediaFilter === "all" ? "selected" : ""
                            }>所有媒体</option>
                            <option value="image" ${
                              settings.mediaFilter === "image" ? "selected" : ""
                            }>仅图片</option>
                            <option value="video" ${
                              settings.mediaFilter === "video" ? "selected" : ""
                            }>仅视频</option>
                        </select>
                    </div>
                    <div class="settings-row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-slideshow-mode" ${
                              settings.slideshowMode ? "checked" : ""
                            } ${
    settings.playMode === "random" ? "disabled" : ""
  }/>
                            <i class="fa-solid fa-repeat"></i>循环播放（图片）
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-video-loop" ${
                              settings.videoLoop ? "checked" : ""
                            }/>
                            <i class="fa-solid fa-repeat"></i>视频循环播放
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-show-info" ${
                              settings.showInfo ? "checked" : ""
                            } />
                            <i class="fa-solid fa-circle-info"></i>显示媒体信息
                        </label>
                    </div>
                    <div class="settings-row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-preload-images" ${
                              settings.preloadImages ? "checked" : ""
                            } />
                            <i class="fa-solid fa-bolt"></i>预加载图片
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-preload-videos" ${
                              settings.preloadVideos ? "checked" : ""
                            } />
                            <i class="fa-solid fa-bolt"></i>预加载视频（耗流量）
                        </label>
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-show-video-controls" ${
                              settings.showVideoControls ? "checked" : ""
                            } />
                            <i class="fa-solid fa-video"></i>显示视频控制栏
                        </label>
                    </div>
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-clock"></i>定时切换间隔
                        </label>
                        <input type="number" id="player-interval" value="${
                          settings.switchInterval
                        }" min="1000" max="60000" step="500" />
                        <span>毫秒</span>
                    </div>
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-sync"></i>服务轮询间隔
                        </label>
                        <input type="number" id="player-polling-interval" value="${
                          settings.pollingInterval
                        }" min="5000" max="300000" step="5000" />
                        <span>毫秒</span>
                    </div>
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-paint-brush"></i>图片过渡效果
                        </label>
                        <select id="player-transition-effect">
                            <option value="none" ${
                              settings.transitionEffect === "none"
                                ? "selected"
                                : ""
                            }>无效果</option>
                            <option value="fade" ${
                              settings.transitionEffect === "fade"
                                ? "selected"
                                : ""
                            }>淡入淡出</option>
                            <option value="slide" ${
                              settings.transitionEffect === "slide"
                                ? "selected"
                                : ""
                            }>滑动</option>
                            <option value="zoom" ${
                              settings.transitionEffect === "zoom"
                                ? "selected"
                                : ""
                            }>缩放</option>
                        </select>
                    </div>
                    <div class="settings-group">
                        <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                            <i class="fa-solid fa-robot"></i> 检测设置
                        </h4>
                        <div class="settings-row">
                            <label>
                                <i class="fa-solid fa-hourglass-half"></i>切换冷却时间
                            </label>
                            <input type="number" id="player-ai-cooldown" value="${
                              settings.aiResponseCooldown
                            }" min="1000" max="30000" step="500" />
                            <span>毫秒</span>
                        </div>
                    </div>
                    <div class="settings-action-row">
                        <button id="show-player" class="menu-button">
                            <i class="fa-solid fa-eye"></i>显示播放器
                        </button>
                        <button id="player-refresh" class="menu-button">
                            <i class="fa-solid fa-rotate"></i>刷新服务
                        </button>
                        <button id="clear-random-history" class="menu-button">
                            <i class="fa-solid fa-trash"></i>清理随机记录
                        </button>
                        <button id="cleanup-media" class="menu-button">
                            <i class="fa-solid fa-broom"></i>清理无效媒体
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
  $("#extensions_settings").append(html);
  setupSettingsEvents();
  console.log(`[${EXTENSION_ID}] 设置面板已创建`);
};

// 更新扩展菜单按钮状态
const updateExtensionMenu = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return;

  // 播放/暂停按钮状态
  $(`#${PLAYER_WINDOW_ID} .play-pause i`)
    .toggleClass("fa-play", !settings.isPlaying)
    .toggleClass("fa-pause", settings.isPlaying);

  // 播放模式状态
  $(`#${PLAYER_WINDOW_ID} .mode-switch i`)
    .toggleClass("fa-shuffle", settings.playMode === "random")
    .toggleClass("fa-list-ol", settings.playMode === "sequential");
  $("#player-play-mode").val(settings.playMode);

  // 切换模式按钮状态
  $(`#${PLAYER_WINDOW_ID} .switch-mode-toggle`)
    .toggleClass("active", settings.autoSwitchMode === "detect")
    .find("i")
    .toggleClass("fa-robot", settings.autoSwitchMode === "detect")
    .toggleClass("fa-clock", settings.autoSwitchMode !== "detect");
  $("#toggle-timer-mode").toggleClass(
    "active",
    settings.autoSwitchMode === "timer"
  );
  $("#toggle-detect-mode").toggleClass(
    "active",
    settings.autoSwitchMode === "detect"
  );
  $("#detect-sub-options").toggle(settings.autoSwitchMode === "detect");

  // 媒体筛选状态
  $(`#${PLAYER_WINDOW_ID} .media-filter-btn`).removeClass("active");
  $(
    `#${PLAYER_WINDOW_ID} .media-filter-btn[data-type="${settings.mediaFilter}"]`
  ).addClass("active");
  $("#player-media-filter").val(settings.mediaFilter);

  // 图片信息显示状态
  $(`#${PLAYER_WINDOW_ID} .toggle-info`).toggleClass(
    "active",
    settings.showInfo
  );
  $(`#${PLAYER_WINDOW_ID} .image-info`).toggle(settings.showInfo);
  $("#player-show-info").prop("checked", settings.showInfo);

  // 视频控制栏状态
  $(`#${PLAYER_WINDOW_ID} .toggle-video-controls`).toggleClass(
    "active",
    settings.showVideoControls
  );
  $(`#${PLAYER_WINDOW_ID} .video-controls`).toggle(settings.showVideoControls);
  $("#player-show-video-controls").prop("checked", settings.showVideoControls);

  // 视频循环状态
  $(`#${PLAYER_WINDOW_ID} .loop-btn`).toggleClass("active", settings.videoLoop);
  $("#player-video-loop").prop("checked", settings.videoLoop);

  // 边框隐藏状态
  $(`#${PLAYER_WINDOW_ID}`).toggleClass("no-border", settings.hideBorder);
  $("#player-hide-border").prop("checked", settings.hideBorder);

  // 自定义视频控制栏状态
  $("#custom-show-progress").prop(
    "checked",
    settings.customVideoControls.showProgress
  );
  $("#custom-show-volume").prop(
    "checked",
    settings.customVideoControls.showVolume
  );
  $("#custom-show-loop").prop("checked", settings.customVideoControls.showLoop);
  $("#custom-show-time").prop("checked", settings.customVideoControls.showTime);

  // 图片过渡效果
  $("#player-transition-effect").val(settings.transitionEffect);
  const imgElement = $(`#${PLAYER_WINDOW_ID} .image-player-img`)[0];
  if (imgElement && $(imgElement).is(":visible")) {
    applyTransitionEffect(imgElement, settings.transitionEffect, "image");
    const currentSrc = imgElement.src;
    imgElement.src = "";
    imgElement.src = currentSrc;
  }

  // 图片循环状态
  $("#player-slideshow-mode")
    .prop("checked", settings.slideshowMode)
    .prop("disabled", settings.playMode === "random");

  // 预加载状态
  $("#player-preload-images").prop("checked", settings.preloadImages);
  $("#player-preload-videos").prop("checked", settings.preloadVideos);

  // 检测开关状态
  $("#player-ai-detect").prop("checked", settings.aiDetectEnabled);
  $("#player-player-detect").prop("checked", settings.playerDetectEnabled);

  // 媒体大小限制
  $("#image-max-size").val(settings.mediaConfig?.image_max_size_mb || 5);
  $("#video-max-size").val(settings.mediaConfig?.video_max_size_mb || 100);
};

// 设置面板事件绑定
const setupSettingsEvents = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return;

  // 刷新服务状态
  $("#player-refresh").on("click", async () => {
    try {
      serviceStatus = await checkServiceStatus();
      toastr.info("服务状态已刷新");
      updateStatusDisplay();
      await refreshMediaList();
      showImage("current");
    } catch (error) {
      console.error(error);
      toastr.error("刷新服务失败");
    }
  });

  // 清理随机播放记录
  $("#clear-random-history").on("click", function () {
    settings.randomPlayedIndices = [];
    saveSafeSettings();
    toastr.success("随机播放记录已清理");
    showImage("current");
  });

  // 清理无效媒体
  $("#cleanup-media").on("click", async function () {
    const confirmClean = confirm(
      "确定要清理无效/超大小限制的媒体文件吗？（不可逆）"
    );
    if (!confirmClean) return;
    const result = await cleanupInvalidMedia();
    if (result) {
      showImage("current");
    }
  });

  // 更新扫描目录
  $("#update-directory").on("click", async function () {
    const newPath = $("#player-scan-directory").val().trim();
    if (!newPath) {
      toastr.warning("请输入有效的目录路径");
      return;
    }
    const success = await updateScanDirectory(newPath);
    if (success) {
      showImage("current");
    }
  });

  // 更新媒体大小限制
  $("#update-size-limit").on("click", async function () {
    const imageMaxMb = parseInt($("#image-max-size").val()) || 5;
    const videoMaxMb = parseInt($("#video-max-size").val()) || 100;
    if (imageMaxMb < 1 || imageMaxMb > 50) {
      toastr.warning("图片大小限制需在 1-50 MB 之间");
      return;
    }
    if (videoMaxMb < 10 || videoMaxMb > 500) {
      toastr.warning("视频大小限制需在 10-500 MB 之间");
      return;
    }
    const result = await updateMediaSizeLimit(imageMaxMb, videoMaxMb);
    if (result) {
      try {
        settings.mediaConfig = result.media_config || {
          image_max_size_mb: imageMaxMb,
          video_max_size_mb: videoMaxMb,
        };
        saveSafeSettings();
        await refreshMediaList();
        updateStatusDisplay();
        showImage("current");
        $("#image-max-size").val(settings.mediaConfig.image_max_size_mb);
        $("#video-max-size").val(settings.mediaConfig.video_max_size_mb);
      } catch (error) {
        console.error(`[${EXTENSION_ID}] 更新大小限制后刷新失败`, error);
        toastr.error("大小限制已应用，媒体列表刷新失败，请手动刷新");
      }
    } else {
      toastr.error("应用大小限制失败，请检查服务连接");
    }
  });

  // 定时播放模式切换
  $("#toggle-timer-mode").on("click", function () {
    const wasActive = settings.autoSwitchMode === "timer";
    if (wasActive) {
      settings.autoSwitchMode = null;
      settings.isPlaying = false;
      clearTimeout(switchTimer);
      stopProgressUpdate();
    } else {
      settings.autoSwitchMode = "timer";
      settings.isPlaying = true;
      const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
      if (videoElement) videoElement.pause();
      startPlayback();
    }
    saveSafeSettings();
    $(this).toggleClass("active", !wasActive);
    $("#toggle-detect-mode").toggleClass("active", false);
    $("#detect-sub-options").hide();
    updateExtensionMenu();
  });

  // 检测播放模式切换
  $("#toggle-detect-mode").on("click", function () {
    const wasActive = settings.autoSwitchMode === "detect";
    if (wasActive) {
      settings.autoSwitchMode = null;
      settings.isPlaying = false;
      stopProgressUpdate();
    } else {
      settings.autoSwitchMode = "detect";
      settings.isPlaying = true;
      const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
      if (videoElement) videoElement.pause();
    }
    saveSafeSettings();
    $(this).toggleClass("active", !wasActive);
    $("#toggle-timer-mode").toggleClass("active", false);
    $("#detect-sub-options").toggle(!wasActive);
    updateExtensionMenu();
  });

  // 播放模式变更
  $("#player-play-mode").on("change", function () {
    const playMode = $(this).val();
    $("#player-slideshow-mode").prop("disabled", playMode === "random");
    saveCurrentSettings();
    if (playMode === "random") {
      settings.randomMediaList = [...mediaList];
      settings.randomPlayedIndices = [];
    }
    showImage("current");
  });

  // 媒体筛选变更
  $("#player-media-filter").on("change", function () {
    const filterType = $(this).val();
    settings.mediaFilter = filterType;
    saveSafeSettings();
    refreshMediaList().then(() => {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      settings.randomMediaList = [...mediaList];
      showImage("current");
    });
  });

  // 过渡效果变更
  $("#player-transition-effect").on("change", function () {
    saveCurrentSettings();
    const imgElement = $(`#${PLAYER_WINDOW_ID} .image-player-img`)[0];
    if (imgElement && $(imgElement).is(":visible")) {
      applyTransitionEffect(imgElement, settings.transitionEffect, "image");
      const currentSrc = imgElement.src;
      imgElement.src = "";
      imgElement.src = currentSrc;
    }
  });

  // 显示播放器
  $("#show-player").on("click", function () {
    settings.isWindowVisible = true;
    saveSafeSettings();
    $(`#${PLAYER_WINDOW_ID}`).show();
    showImage("current");
  });

  // 其他设置项变更
  $(
    "#player-service-url, #player-interval, #player-ai-cooldown, #player-polling-interval, #image-max-size, #video-max-size"
  ).on("change", saveCurrentSettings);
  $(
    "#player-slideshow-mode, #player-video-loop, #player-show-info, #player-preload-images, #player-preload-videos, #player-show-video-controls, #player-ai-detect, #player-player-detect, #extension-enabled, #player-hide-border, #custom-show-progress, #custom-show-volume, #custom-show-loop, #custom-show-time"
  ).on("change", saveCurrentSettings);
};

// 事件监听注册（带重试）
function registerEventListenersWithRetry() {
  const maxRetries = 5;
  const delay = 1000;
  let retries = 0;
  const tryRegister = () => {
    try {
      if (!eventSource || !event_types) {
        throw new Error("事件源未就绪");
      }
      // AI回复事件
      eventSource.off(event_types.MESSAGE_RECEIVED, onAIResponse);
      eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        const settings = getExtensionSettings();
        if (
          settings.enabled &&
          settings.autoSwitchMode === "detect" &&
          settings.aiDetectEnabled &&
          settings.isPlaying &&
          settings.isWindowVisible
        ) {
          console.log(`[${EXTENSION_ID}] 检测到AI回复完成`);
          onAIResponse();
        }
      });
      // 玩家消息事件
      eventSource.off(event_types.MESSAGE_SENT, onPlayerMessage);
      eventSource.on(event_types.MESSAGE_SENT, () => {
        const settings = getExtensionSettings();
        if (
          settings.enabled &&
          settings.autoSwitchMode === "detect" &&
          settings.playerDetectEnabled &&
          settings.isPlaying &&
          settings.isWindowVisible
        ) {
          console.log(`[${EXTENSION_ID}] 检测到玩家发送消息`);
          onPlayerMessage();
        }
      });
      console.log(`[${EXTENSION_ID}] 成功注册事件监听器（AI回复+玩家消息）`);
    } catch (e) {
      retries++;
      if (retries < maxRetries) {
        console.warn(
          `[${EXTENSION_ID}] 事件监听注册失败，${delay}ms后重试(${retries}/${maxRetries})`
        );
        setTimeout(tryRegister, delay);
      } else {
        console.error(
          `[${EXTENSION_ID}] 事件监听注册失败（已达最大重试次数）`,
          e
        );
        toastr.error("事件监听注册失败，请刷新页面重试");
      }
    }
  };
  console.log(`[${EXTENSION_ID}] 计划2000ms后注册事件监听`);
  setTimeout(tryRegister, 2000);
}

// 扩展菜单按钮
function addMenuButton() {
  const menuButtonId = `#ext_menu_${EXTENSION_ID}`;
  if ($(menuButtonId).length > 0) return;
  console.log(`[${EXTENSION_ID}] 添加扩展菜单按钮`);
  const buttonHtml = `
        <div id="ext_menu_${EXTENSION_ID}" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-film"></div>
            <span>${EXTENSION_NAME}</span>
        </div>`;
  $("#extensionsMenu").append(buttonHtml);
  $(`#ext_menu_${EXTENSION_ID}`).on("click", function () {
    const settings = getExtensionSettings();
    if (!settings.enabled) {
      toastr.warning("请先在扩展设置中启用媒体播放器");
      return;
    }
    $("#extensions-settings-button").trigger("click");
    $(`#${SETTINGS_PANEL_ID}`).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

// 扩展初始化
async function initExtension() {
  const settings = getExtensionSettings();
  if (!settings.enabled) {
    console.log(`[${EXTENSION_ID}] 扩展已禁用，跳过初始化`);
    return;
  }
  try {
    console.log(`[${EXTENSION_ID}] 开始初始化媒体播放器扩展`);
    if (typeof window.extension_settings === "undefined") {
      window.extension_settings = {};
    }
    if (!window.extension_settings[EXTENSION_ID]) {
      window.extension_settings[EXTENSION_ID] = settings;
      saveSafeSettings();
      console.log(`[${EXTENSION_ID}] 初始化默认扩展设置`);
    }
    addMenuButton();
    await createImagePlayerWindow();
    createSettingsPanel();
    initWebSocket();
    startPollingService();
    registerEventListenersWithRetry();
    await refreshMediaList();
    if (mediaList.length > 0) {
      showImage("current");
    } else {
      toastr.info(`当前无可用媒体文件，请在设置中配置扫描目录`);
    }
    // 初始化后同步状态和事件
    updateExtensionMenu();
    const winSelector = `#${PLAYER_WINDOW_ID}`;
    bindVideoControlEvents(winSelector);
    positionWindow(PLAYER_WINDOW_ID);
    console.log(`[${EXTENSION_ID}] 扩展初始化完成`);
    toastr.success(`${EXTENSION_NAME}扩展加载成功（支持图片+视频播放）`);
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 初始化错误:`, e);
    const retryDelay = 1500;
    console.warn(`[${EXTENSION_ID}] ${retryDelay}ms后重新尝试初始化...`);
    window.setTimeout(initExtension, retryDelay);
  }
}

// 页面就绪触发
jQuery(async () => {
  console.log(`[${EXTENSION_ID}] 脚本开始加载（等待页面就绪）`);
  const initWhenReady = () => {
    const settings = getExtensionSettings();
    if (!settings.enabled) {
      console.log(`[${EXTENSION_ID}] 扩展当前禁用，3秒后重新检查`);
      setTimeout(initWhenReady, 3000);
      return;
    }
    initExtension();
  };
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    initWhenReady();
  } else {
    $(document).on("ready", initWhenReady);
    window.setTimeout(initWhenReady, 1000);
  }
});
console.log(`[${EXTENSION_ID}] 脚本文件加载完成`);
