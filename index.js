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
      enabled: true, // 新增：扩展总开关（默认开启）
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
      // 视频核心配置
      videoLoop: false,
      videoVolume: 0.8,
      mediaFilter: "all",
      showVideoControls: true,
      lastMediaIndex: 0,
      progressUpdateInterval: null,
      // 新增：边框隐藏配置
      hideBorder: false,
      // 新增：自定义视频控制栏配置
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
let ws = null; // WebSocket连接

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

// 获取筛选后的媒体列表
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

// 更新媒体大小限制
const updateMediaSizeLimit = async (imageMaxMb, videoMaxMb) => {
  const settings = getExtensionSettings();
  try {
    const response = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

// 更新扫描目录
const updateScanDirectory = async (newPath) => {
  const settings = getExtensionSettings();
  try {
    const response = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

// 清理无效媒体文件
const cleanupInvalidMedia = async () => {
  const settings = getExtensionSettings();
  try {
    const response = await fetch(`${settings.serviceUrl}/cleanup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

// 刷新媒体列表
const refreshMediaList = async () => {
  const settings = getExtensionSettings();
  mediaList = await fetchMediaList(settings.mediaFilter);
  settings.randomMediaList = await fetchMediaList(settings.mediaFilter);
  currentMediaIndex = 0;
  settings.lastMediaIndex = 0;
  return mediaList;
};

// ==================== WebSocket 实时更新 ====================
const initWebSocket = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || !settings.serviceUrl || ws) return; // 总开关关闭则不初始化
  try {
    const wsUrl =
      settings.serviceUrl.replace("http://", "ws://") + "/socket.io";
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      console.log(`[${EXTENSION_ID}] WebSocket连接成功`);
      // 新增：WebSocket连接成功后刷新媒体列表
      refreshMediaList().then(() => {
        showImage("current"); // 重新显示当前媒体
      });
    };
    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "media_updated":
          serviceStatus.totalCount = data.total_count;
          serviceStatus.imageCount = data.image_count;
          serviceStatus.videoCount = data.video_count;
          await refreshMediaList();
          // 仅保留关键更新提示（可根据需求删除）
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
      if (settings.enabled) setTimeout(initWebSocket, 5000); // 总开关开启才重试
    };
    ws.onerror = (error) => {
      console.error(`[${EXTENSION_ID}] WebSocket错误`, error);
      ws = null;
      if (settings.enabled) setTimeout(initWebSocket, 5000); // 总开关开启才重试
    };
    // 心跳检测
    setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, 10000);
  } catch (error) {
    console.error(`[${EXTENSION_ID}] WebSocket初始化失败`, error);
    ws = null;
    if (settings.enabled) setTimeout(initWebSocket, 5000); // 总开关开启才重试
  }
};

// ==================== 播放器窗口 ====================
const createImagePlayerWindow = async () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || $(`#${PLAYER_WINDOW_ID}`).length > 0) return; // 总开关关闭/已存在则不创建

  const infoHTML = settings.showInfo
    ? `<div class="image-info">加载中...</div>`
    : "";

  // 视频控制栏HTML（支持自定义显示控件）
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
                <!-- 图片标签 -->
                <img class="image-player-img" 
                     onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFAAH/l8iC5gAAAABJRU5ErkJggg=='" />
                <!-- 视频标签 -->
                <video class="image-player-video" 
                       ${settings.videoLoop ? "loop" : ""}
                       preload="metadata"
                       style="display:none;max-width:100%;max-height:100%;object-fit:contain;">
                    您的浏览器不支持HTML5视频播放
                </video>
            </div>
            ${infoHTML}
            <!-- 视频控制栏 -->
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
            
            <!-- 媒体类型筛选按钮 -->
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
  // 初始化视频音量
  const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (videoElement) videoElement.volume = settings.videoVolume;
  console.log(`[${EXTENSION_ID}] 媒体播放器窗口已创建`);
};

const positionWindow = (windowId) => {
  const settings = getExtensionSettings();
  const win = $(`#${windowId}`);
  win
    .css({
      left: `${settings.position.x}px`,
      top: `${settings.position.y}px`,
      width: `${settings.position.width}px`,
      height: `${settings.position.height}px`,
    })
    .toggleClass("locked", settings.isLocked)
    .toggle(settings.isWindowVisible)
    .toggleClass("no-border", settings.hideBorder); // 应用边框隐藏样式

  // 新增：边框隐藏时确保视频控制栏事件正常（兼容hover显示）
  if (settings.hideBorder && settings.showVideoControls) {
    const videoContainer = win.find(".image-container");
    const videoControls = win.find(".video-controls");
    // 鼠标离开容器后3秒隐藏控制栏
    videoContainer.on("mouseleave", () => {
      setTimeout(() => {
        if (videoControls.is(":visible") && !progressDrag && !volumeDrag) {
          videoControls.css({ bottom: "-40px", opacity: 0 });
        }
      }, 3000); // 3秒延迟，避免频繁隐藏
    });
  }

  adjustVideoControlsLayout();
};

// 调整视频控制栏布局
const adjustVideoControlsLayout = () => {
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const bodyHeight = win.find(".image-player-body").height();
  const videoControlsHeight = win.find(".video-controls").outerHeight() || 30;
  win
    .find(".image-container")
    .css("height", `calc(100% - ${videoControlsHeight}px)`);
};

// ==================== 窗口事件 ====================
let dragData = null;
let resizeData = null;
let progressDrag = false;
let volumeDrag = false;

const setupWindowEvents = (windowId) => {
  const winElement = document.getElementById(windowId);
  const header = winElement.querySelector(".image-player-header");
  const resizeHandle = winElement.querySelector(".resize-handle");
  const winSelector = `#${windowId}`;
  const settings = getExtensionSettings();
  const videoElement = $(winSelector).find(".image-player-video")[0];

  // 窗口拖拽（边框隐藏时不允许拖拽）
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

  // 窗口调整大小（边框隐藏时不允许调整）
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

  // 全局事件（拖拽/调整/进度条/音量条）
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
    if (
      progressDrag &&
      videoElement &&
      settings.customVideoControls.showProgress
    ) {
      const progressBar = $(winSelector).find("#video-progress-bar");
      const barRect = progressBar[0].getBoundingClientRect();
      const clickX = Math.max(
        0,
        Math.min(e.clientX - barRect.left, barRect.width)
      );
      const progress = clickX / barRect.width;
      updateProgressBar(progress);
      const totalTime = videoElement.duration || 0;
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
    // 窗口拖拽/调整保存
    if (dragData || resizeData) {
      const settings = getExtensionSettings();
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
    if (
      progressDrag &&
      videoElement &&
      !isNaN(videoElement.duration) &&
      settings.customVideoControls.showProgress
    ) {
      const progress = videoElement.currentTime / videoElement.duration || 0;
      updateProgressBar(progress);
      if (settings.isPlaying && videoElement.paused) {
        videoElement.play().catch((err) => console.warn("视频播放失败:", err));
      }
    }
    progressDrag = false;
    volumeDrag = false;
    // 进度条/音量条拖拽结束后，延迟1秒再允许隐藏控制栏
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

  // 窗口锁定（事件委托，支持动态元素）
  $(document).on("click", `${winSelector} .lock`, function () {
    const settings = getExtensionSettings();
    // 总开关关闭时不执行
    if (!settings.enabled) return;
    settings.isLocked = !settings.isLocked;
    saveSafeSettings();
    // 更新图标和窗口样式
    $(this).find("i").toggleClass("fa-lock fa-lock-open");
    $(this).closest(".image-player-window").toggleClass("locked");
    toastr.info(`窗口已${settings.isLocked ? "锁定" : "解锁"}`);
  });

  // 播放/暂停按钮（适配视频）
  $(`${winSelector} .play-pause`).on("click", function () {
    const settings = getExtensionSettings();
    const videoElement = $(winSelector).find(".image-player-video")[0];
    const isCurrentVideo = videoElement && $(videoElement).is(":visible");
    const icon = $(this).find("i");

    if (isCurrentVideo) {
      // 视频播放/暂停
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
      }
    } else {
      // 图片播放/暂停
      const wasPlaying = settings.isPlaying;
      settings.isPlaying = !wasPlaying;
      icon.toggleClass("fa-play fa-pause");
      if (settings.isPlaying && !wasPlaying) {
        startPlayback();
      } else {
        clearTimeout(switchTimer);
        stopProgressUpdate();
      }
    }
    saveSafeSettings();
  });

  // 模式切换（移除冗余提示）
  $(`${winSelector} .mode-switch`).on("click", function () {
    const settings = getExtensionSettings();
    settings.playMode =
      settings.playMode === "random" ? "sequential" : "random";
    saveSafeSettings();
    const icon = $(this).find("i");
    icon.toggleClass("fa-shuffle fa-list-ol");
    // 重置随机列表
    if (settings.playMode === "random") {
      settings.randomMediaList = [...mediaList];
      settings.randomPlayedIndices = [];
    }
    updateExtensionMenu();
    showImage("current");
  });

  // 显示/隐藏媒体信息（事件委托，支持动态元素）
  $(document).on("click", `${winSelector} .toggle-info`, function () {
    const settings = getExtensionSettings();
    // 总开关关闭时不执行
    if (!settings.enabled) return;
    settings.showInfo = !settings.showInfo;
    saveSafeSettings();
    // 更新按钮状态和信息栏显示
    $(this).toggleClass("active", settings.showInfo);
    // 可靠获取当前窗口的信息栏（避免选择器冲突）
    $(this)
      .closest(".image-player-body")
      .find(".image-info")
      .toggle(settings.showInfo);
  });

  // 显示/隐藏视频控制（移除冗余提示）
  $(`${winSelector} .toggle-video-controls`).on("click", function () {
    const settings = getExtensionSettings();
    settings.showVideoControls = !settings.showVideoControls;
    saveSafeSettings();
    $(this).toggleClass("active", settings.showVideoControls);
    $(`${winSelector} .video-controls`).toggle(settings.showVideoControls);
    adjustVideoControlsLayout();
  });

  // 隐藏窗口
  $(`${winSelector} .hide`).on("click", function () {
    $(winElement).hide();
    const settings = getExtensionSettings();
    settings.isWindowVisible = false;
    saveSafeSettings();
    // 隐藏时暂停视频
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) videoElement.pause();
    stopProgressUpdate();
  });

  // 上一个/下一个
  $(`${winSelector} .prev`).on("click", () => {
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) {
      videoElement.pause();
      stopProgressUpdate();
    }
    showImage("prev");
  });
  $(`${winSelector} .next`).on("click", () => {
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) {
      videoElement.pause();
      stopProgressUpdate();
    }
    showImage("next");
  });

  // 切换模式按钮
  $(`${winSelector} .switch-mode-toggle`).on("click", function () {
    const settings = getExtensionSettings();
    settings.autoSwitchMode =
      settings.autoSwitchMode === "detect" ? "timer" : "detect";
    settings.isPlaying = settings.autoSwitchMode !== null;
    // 切换模式时暂停当前视频
    const videoElement = $(winSelector).find(".image-player-video")[0];
    if (videoElement) videoElement.pause();
    stopProgressUpdate();
    saveSafeSettings();
    $(this)
      .toggleClass("active", settings.autoSwitchMode === "detect")
      .find("i")
      .toggleClass("fa-robot fa-clock");
    // 更新播放按钮状态
    $(`${winSelector} .play-pause i`)
      .toggleClass("fa-play", !settings.isPlaying)
      .toggleClass("fa-pause", settings.isPlaying);
  });

  // 媒体类型筛选按钮事件（移除冗余提示）
  $(`${winSelector} .media-filter-btn`).on("click", function () {
    const filterType = $(this).data("type");
    const settings = getExtensionSettings();
    settings.mediaFilter = filterType;
    saveSafeSettings();
    // 更新按钮状态
    $(`${winSelector} .media-filter-btn`).removeClass("active");
    $(this).addClass("active");
    // 刷新媒体列表
    refreshMediaList().then(() => {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      settings.randomMediaList = [...mediaList];
      showImage("current");
    });
  });

  // 视频进度条点击事件（自定义控制栏判断）
  if (settings.customVideoControls.showProgress) {
    $(`${winSelector} #video-progress-bar`).on("mousedown", function (e) {
      if (!videoElement || (videoElement.paused && !settings.isPlaying)) return;
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
    });
  }

  // 音量按钮事件（自定义控制栏判断）
  if (settings.customVideoControls.showVolume) {
    $(`${winSelector} .volume-btn`).on("click", function () {
      const volumeSlider = $(winSelector).find(".volume-slider");
      const currentVolume = parseFloat(volumeSlider.val());
      const newVolume = currentVolume > 0 ? 0 : settings.videoVolume || 0.8;
      volumeSlider.val(newVolume);
      updateVolume(newVolume);
    });

    // 音量条拖拽开始
    $(`${winSelector} .volume-slider`).on("mousedown", function () {
      volumeDrag = true;
    });
  }

  // 循环播放按钮事件（自定义控制栏判断 + 提示优化）
  if (settings.customVideoControls.showLoop) {
    $(`${winSelector} .loop-btn`).on("click", function () {
      const settings = getExtensionSettings();
      settings.videoLoop = !settings.videoLoop;
      saveSafeSettings();
      $(this).toggleClass("active", settings.videoLoop);
      if (videoElement) videoElement.loop = settings.videoLoop;
      // 保留关键提示（循环对AI切换的影响）
      if (settings.videoLoop) {
        toastr.info(`视频循环播放已启用（AI检测/玩家消息切换将暂时无效）`);
      } else {
        toastr.info(`视频循环播放已禁用（AI检测/玩家消息切换恢复正常）`);
      }
    });
  }

  // 视频事件监听
  if (videoElement) {
    // 视频播放结束（自动下一个）
    videoElement.onended = () => {
      const settings = getExtensionSettings();
      if (settings.isPlaying && !settings.videoLoop) {
        showImage("next");
      } else {
        updateProgressBar(0);
        $(winSelector).find(".current-time").text("00:00");
      }
    };
    // 视频加载进度更新（自定义控制栏判断）
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
    // 视频元数据加载完成（自定义控制栏判断）
    if (settings.customVideoControls.showTime) {
      videoElement.onloadedmetadata = () => {
        $(winSelector)
          .find(".total-time")
          .text(formatTime(videoElement.duration));
        $(winSelector).find(".progress-loaded").css("width", "0%");
      };
    }
  }
};

// ==================== 播放控制 ====================
// 格式化时间（秒转分:秒）
const formatTime = (seconds) => {
  if (isNaN(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

// 更新进度条
const updateProgressBar = (progress) => {
  const winSelector = `#${PLAYER_WINDOW_ID}`;
  const settings = getExtensionSettings();
  if (!settings.customVideoControls.showProgress) return; // 自定义控制栏关闭则不更新

  progress = Math.max(0, Math.min(1, progress));
  $(winSelector)
    .find(".progress-played")
    .css("width", `${progress * 100}%`);
  $(winSelector)
    .find(".progress-handle")
    .css("left", `${progress * 100}%`);
};

// 启动进度条更新定时器
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

    // 新增：视频播放时临时显示控制栏（方便用户看进度）
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

// 停止进度条更新
const stopProgressUpdate = () => {
  const settings = getExtensionSettings();
  if (settings.progressUpdateInterval) {
    clearInterval(settings.progressUpdateInterval);
    settings.progressUpdateInterval = null;
  }
};

// 更新音量
const updateVolume = (volume) => {
  const settings = getExtensionSettings();
  if (!settings.customVideoControls.showVolume) return; // 自定义控制栏关闭则不更新

  volume = Math.max(0, Math.min(1, volume));
  settings.videoVolume = volume;
  saveSafeSettings();
  const winSelector = `#${PLAYER_WINDOW_ID}`;
  const videoElement = $(winSelector).find(".image-player-video")[0];
  if (videoElement) videoElement.volume = volume;
  // 更新音量图标
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
  if (!settings.enabled || !settings.isPlaying) return; // 总开关关闭则不执行

  clearTimeout(switchTimer);
  const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  const isCurrentVideo = videoElement && $(videoElement).is(":visible");
  if (settings.autoSwitchMode === "timer") {
    if (isCurrentVideo) {
      // 视频：播放完成后切换（非循环状态）
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
      // 图片：定时切换
      showImage("next");
      switchTimer = setTimeout(startPlayback, settings.switchInterval);
    }
  }
};

// 获取随机媒体索引
const getRandomMediaIndex = () => {
  const settings = getExtensionSettings();
  const filteredList = settings.randomMediaList || [];
  if (settings.randomPlayedIndices.length >= filteredList.length) {
    settings.randomPlayedIndices = [];
  }
  const availableIndices = filteredList
    .map((_, index) => index)
    .filter((index) => !settings.randomPlayedIndices.includes(index));
  if (availableIndices.length === 0) return -1;
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

// 应用过渡效果（视频不应用）
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

// 显示媒体
const showImage = async (direction) => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return; // 总开关关闭则不执行

  const winId = `#${PLAYER_WINDOW_ID}`;
  const imgElement = $(winId).find(".image-player-img")[0];
  const videoElement = $(winId).find(".image-player-video")[0];
  const loadingElement = $(winId).find(".loading-animation")[0];
  // 停止进度更新
  stopProgressUpdate();
  // 隐藏所有媒体元素，显示加载中
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

    // 获取当前媒体数据
    if (settings.playMode === "random") {
      if (settings.randomMediaList.length === 0) {
        settings.randomMediaList = await fetchMediaList(filterType);
        settings.randomPlayedIndices = [];
      }
      let randomIndex = -1;
      if (direction === "next") {
        randomIndex = getRandomMediaIndex();
        if (randomIndex === -1) {
          settings.randomPlayedIndices = [];
          randomIndex = getRandomMediaIndex();
        }
        if (randomIndex !== -1) {
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
          if (randomIndex !== -1) {
            settings.randomPlayedIndices.push(randomIndex);
          }
        }
      }
      if (
        randomIndex === -1 ||
        randomIndex >= settings.randomMediaList.length
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

    // 记录当前媒体类型
    currentMediaType = mediaType;
    // 根据媒体类型渲染
    if (mediaType === "image") {
      applyTransitionEffect(imgElement, settings.transitionEffect, mediaType);
      // 使用预加载的图片
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
      // 重置视频状态
      videoElement.currentTime = 0;
      videoElement.loop = settings.videoLoop;
      $(videoElement).attr("src", mediaUrl);
      // 加载视频元数据
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
      // 自动播放（根据播放状态）
      if (settings.isPlaying) {
        videoElement
          .play()
          .then(() => {
            startProgressUpdate();
          })
          .catch((err) => {
            console.warn("视频自动播放失败（浏览器限制）:", err);
            $(winId).find(".control-text").text("点击视频播放");
          });
      }
    }

    // 隐藏加载，更新信息
    $(loadingElement).hide();
    if (settings.showInfo) {
      $(winId).find(".image-info").text(`${mediaName}（${mediaType}）`).show();
    } else {
      $(winId).find(".image-info").hide();
    }

    // 更新控制栏文本
    let statusText;
    const totalCount =
      settings.playMode === "random"
        ? settings.randomMediaList.length || 0
        : mediaList.length || 0;
    const currentCount =
      settings.playMode === "random"
        ? settings.randomPlayedIndices.length || 0
        : currentMediaIndex + 1;
    statusText = `${
      settings.playMode === "random" ? "随机模式" : "顺序模式"
    }: ${currentCount}/${totalCount}（${mediaType}）`;
    $(winId).find(".control-text").text(statusText);

    // 重置重试计数
    retryCount = 0;

    // 预加载下一个媒体
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
    // 重试机制
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

// ==================== AI回复检测（核心修复：视频循环时无效） ====================
const onAIResponse = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return; // 总开关关闭则不执行

  // 视频循环时，AI检测切换无效
  const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  const isLoopingVideo =
    videoElement && $(videoElement).is(":visible") && settings.videoLoop;
  if (isLoopingVideo) {
    console.log(`[${EXTENSION_ID}] 视频正在循环播放，AI检测切换已禁用`);
    return;
  }

  // 原有判断逻辑
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

// ==================== 玩家消息检测（核心修复：视频循环时无效） ====================
const onPlayerMessage = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return; // 总开关关闭则不执行

  // 视频循环时，玩家消息检测切换无效
  const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  const isLoopingVideo =
    videoElement && $(videoElement).is(":visible") && settings.videoLoop;
  if (isLoopingVideo) {
    console.log(`[${EXTENSION_ID}] 视频正在循环播放，玩家消息检测切换已禁用`);
    return;
  }

  // 原有判断逻辑
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
    // 总开关关闭则停止轮询
    if (pollingTimer) clearTimeout(pollingTimer);
    return;
  }

  if (pollingTimer) clearTimeout(pollingTimer);
  const poll = async () => {
    try {
      const prevCount = serviceStatus.totalCount;
      await checkServiceStatus();
      if (serviceStatus.totalCount !== prevCount) {
        // 媒体数量变化，刷新列表
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
        pollingTimer = setTimeout(poll, settings.pollingInterval); // 总开关开启才继续轮询
    }
  };
  poll();
};

// ==================== 设置面板 ====================
// 保存当前设置（全局可调用）
const saveCurrentSettings = () => {
  const settings = getExtensionSettings();
  const prevEnabled = settings.enabled;
  settings.enabled = $("#extension-enabled").prop("checked");
  if (settings.enabled !== prevEnabled) {
    toastr.info(settings.enabled ? "媒体播放器已启用" : "媒体播放器已禁用");
  }
  if (!settings.enabled) return; // 总开关关闭则不保存

  // 更新所有设置项
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
  // 新增：总开关状态
  settings.enabled = $("#extension-enabled").prop("checked");
  // 新增：边框隐藏状态
  settings.hideBorder = $("#player-hide-border").prop("checked");
  // 新增：自定义视频控制栏配置
  settings.customVideoControls = {
    showProgress: $("#custom-show-progress").prop("checked"),
    showVolume: $("#custom-show-volume").prop("checked"),
    showLoop: $("#custom-show-loop").prop("checked"),
    showTime: $("#custom-show-time").prop("checked"),
  };
  // 媒体大小限制配置
  if (!settings.mediaConfig) settings.mediaConfig = {};
  settings.mediaConfig.image_max_size_mb =
    parseInt($("#image-max-size").val()) || 5;
  settings.mediaConfig.video_max_size_mb =
    parseInt($("#video-max-size").val()) || 100;

  // 保存并应用
  saveSafeSettings();

  // 启用/禁用依赖项（顺序模式下才允许图片循环）
  $("#player-slideshow-mode").prop("disabled", settings.playMode === "random");

  // 应用边框隐藏样式
  $(`#${PLAYER_WINDOW_ID}`).toggleClass("no-border", settings.hideBorder);

  // 重新渲染视频控制栏（若已显示）
  if (settings.showVideoControls) {
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
    $(`#${PLAYER_WINDOW_ID} .video-controls`).replaceWith(
      $(videoControlsHTML).get(0)
    );
    setupWindowEvents(PLAYER_WINDOW_ID); // 重新绑定事件
  }

  // 更新轮询服务
  startPollingService();

  // 更新播放器UI
  updateExtensionMenu();

  // 重启播放（定时模式下）
  if (settings.isPlaying && settings.autoSwitchMode === "timer") {
    startPlayback();
  }

  // 总开关关闭时的清理
  if (!settings.enabled) {
    $(`#${PLAYER_WINDOW_ID}`).hide();
    clearTimeout(switchTimer);
    stopProgressUpdate();
    if (ws) ws.close();
  }
};

// 更新服务状态显示
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
  if (!settings.enabled || $(`#${SETTINGS_PANEL_ID}`).length > 0) return; // 总开关关闭/已存在则不创建

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
                    <!-- 新增：扩展总开关 -->
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
                    
                    <!-- 媒体大小限制设置 -->
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

                    <!-- 新增：边框隐藏设置 -->
                    <div class="settings-row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-hide-border" ${
                              settings.hideBorder ? "checked" : ""
                            } />
                            <i class="fa-solid fa-border-none"></i>隐藏播放器边框（仅显示内容）
                        </label>
                    </div>

                    <!-- 新增：视频控制栏自定义 -->
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
                    
                    <!-- 检测播放子选项 -->
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

// 更新扩展菜单按钮状态（全量同步，修复状态不同步问题）
const updateExtensionMenu = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return; // 总开关关闭则不更新

  // 1. 播放/暂停按钮状态同步
  $(`#${PLAYER_WINDOW_ID} .play-pause i`)
    .toggleClass("fa-play", !settings.isPlaying)
    .toggleClass("fa-pause", settings.isPlaying);

  // 2. 播放模式状态同步（播放器+设置面板）
  $(`#${PLAYER_WINDOW_ID} .mode-switch i`)
    .toggleClass("fa-shuffle", settings.playMode === "random")
    .toggleClass("fa-list-ol", settings.playMode === "sequential");
  $("#player-play-mode").val(settings.playMode);

  // 3. 切换模式按钮状态同步（播放器+设置面板）
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

  // 4. 媒体筛选状态同步（播放器+设置面板）
  $(`#${PLAYER_WINDOW_ID} .media-filter-btn`).removeClass("active");
  $(
    `#${PLAYER_WINDOW_ID} .media-filter-btn[data-type="${settings.mediaFilter}"]`
  ).addClass("active");
  $("#player-media-filter").val(settings.mediaFilter);

  // 5. 图片信息显示状态同步（播放器+设置面板）
  $(`#${PLAYER_WINDOW_ID} .toggle-info`).toggleClass(
    "active",
    settings.showInfo
  );
  $(`#${PLAYER_WINDOW_ID} .image-info`).toggle(settings.showInfo);
  $("#player-show-info").prop("checked", settings.showInfo);

  // 6. 视频控制栏状态同步（播放器+设置面板）
  $(`#${PLAYER_WINDOW_ID} .toggle-video-controls`).toggleClass(
    "active",
    settings.showVideoControls
  );
  $(`#${PLAYER_WINDOW_ID} .video-controls`).toggle(settings.showVideoControls);
  $("#player-show-video-controls").prop("checked", settings.showVideoControls);

  // 7. 视频循环状态同步（播放器+设置面板）
  $(`#${PLAYER_WINDOW_ID} .loop-btn`).toggleClass("active", settings.videoLoop);
  $("#player-video-loop").prop("checked", settings.videoLoop);
  // 新增：同步播放器循环按钮的active类（修正变量未定义问题）
  $(`#${PLAYER_WINDOW_ID} .loop-btn`).toggleClass("active", settings.videoLoop);

  // 8. 边框隐藏状态同步（播放器+设置面板）
  $(`#${PLAYER_WINDOW_ID}`).toggleClass("no-border", settings.hideBorder);
  $("#player-hide-border").prop("checked", settings.hideBorder);

  // 9. 自定义视频控制栏状态同步（设置面板）
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

  // 10. 图片过渡效果同步（修复无效果问题）
  $("#player-transition-effect").val(settings.transitionEffect);
  const imgElement = $(`#${PLAYER_WINDOW_ID} .image-player-img`)[0];
  if (imgElement && $(imgElement).is(":visible")) {
    applyTransitionEffect(imgElement, settings.transitionEffect, "image");
    // 重新加载当前图片以立即应用效果
    const currentSrc = imgElement.src;
    imgElement.src = "";
    imgElement.src = currentSrc;
  }

  // 11. 图片循环状态同步（设置面板）
  $("#player-slideshow-mode")
    .prop("checked", settings.slideshowMode)
    .prop("disabled", settings.playMode === "random");

  // 12. 预加载状态同步（设置面板）
  $("#player-preload-images").prop("checked", settings.preloadImages);
  $("#player-preload-videos").prop("checked", settings.preloadVideos);

  // 13. 检测开关状态同步（设置面板）
  $("#player-ai-detect").prop("checked", settings.aiDetectEnabled);
  $("#player-player-detect").prop("checked", settings.playerDetectEnabled);

  // 14. 媒体大小限制同步（设置面板）
  $("#image-max-size").val(settings.mediaConfig?.image_max_size_mb || 5);
  $("#video-max-size").val(settings.mediaConfig?.video_max_size_mb || 100);
};

// 设置面板事件绑定（全量覆盖，确保所有功能生效）
const setupSettingsEvents = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return; // 总开关关闭则不绑定事件

  // 1. 刷新服务状态
  $("#player-refresh").on("click", async () => {
    try {
      serviceStatus = await checkServiceStatus();
      toastr.info("服务状态已刷新");
      updateStatusDisplay();
      // 刷新媒体列表并重新显示当前媒体
      await refreshMediaList();
      showImage("current");
    } catch (error) {
      console.error(error);
      toastr.error("刷新服务失败");
    }
  });

  // 2. 清理随机播放记录
  $("#clear-random-history").on("click", function () {
    settings.randomPlayedIndices = [];
    saveSafeSettings();
    toastr.success("随机播放记录已清理");
    showImage("current");
  });

  // 3. 清理无效媒体
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

  // 4. 更新扫描目录
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

  // 5. 更新媒体大小限制（含参数校验+列表刷新）
  $("#update-size-limit").on("click", async function () {
    const imageMaxMb = parseInt($("#image-max-size").val()) || 5;
    const videoMaxMb = parseInt($("#video-max-size").val()) || 100;

    // 参数合法性校验
    if (imageMaxMb < 1 || imageMaxMb > 50) {
      toastr.warning("图片大小限制需在 1-50 MB 之间");
      return;
    }
    if (videoMaxMb < 10 || videoMaxMb > 500) {
      toastr.warning("视频大小限制需在 10-500 MB 之间");
      return;
    }

    // 调用接口更新限制
    const result = await updateMediaSizeLimit(imageMaxMb, videoMaxMb);
    if (result) {
      try {
        // 同步本地配置+刷新媒体列表+更新UI
        settings.mediaConfig = result.media_config || {
          image_max_size_mb: imageMaxMb,
          video_max_size_mb: videoMaxMb,
        };
        saveSafeSettings();
        await refreshMediaList();
        updateStatusDisplay();
        showImage("current");
        // 同步设置面板输入框值
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

  // 6. 定时播放模式切换
  $("#toggle-timer-mode").on("click", function () {
    const wasActive = settings.autoSwitchMode === "timer";
    // 切换状态：取消激活则停止，激活则启动
    if (wasActive) {
      settings.autoSwitchMode = null;
      settings.isPlaying = false;
      clearTimeout(switchTimer);
      stopProgressUpdate();
    } else {
      settings.autoSwitchMode = "timer";
      settings.isPlaying = true;
      // 暂停当前视频
      const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
      if (videoElement) videoElement.pause();
      startPlayback();
    }
    saveSafeSettings();
    // 更新UI
    $(this).toggleClass("active", !wasActive);
    $("#toggle-detect-mode").toggleClass("active", false);
    $("#detect-sub-options").hide();
    updateExtensionMenu();
  });

  // 7. 检测播放模式切换
  $("#toggle-detect-mode").on("click", function () {
    const wasActive = settings.autoSwitchMode === "detect";
    // 切换状态：取消激活则停止，激活则启动
    if (wasActive) {
      settings.autoSwitchMode = null;
      settings.isPlaying = false;
      stopProgressUpdate();
    } else {
      settings.autoSwitchMode = "detect";
      settings.isPlaying = true;
      // 暂停当前视频
      const videoElement = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
      if (videoElement) videoElement.pause();
    }
    saveSafeSettings();
    // 更新UI
    $(this).toggleClass("active", !wasActive);
    $("#toggle-timer-mode").toggleClass("active", false);
    $("#detect-sub-options").toggle(!wasActive);
    updateExtensionMenu();
  });

  // 8. 播放模式变更（同步禁用图片循环）
  $("#player-play-mode").on("change", function () {
    const playMode = $(this).val();
    $("#player-slideshow-mode").prop("disabled", playMode === "random");
    saveCurrentSettings();
    // 重置随机列表
    if (playMode === "random") {
      settings.randomMediaList = [...mediaList];
      settings.randomPlayedIndices = [];
    }
    showImage("current");
  });

  // 9. 媒体筛选变更（即时刷新列表）
  $("#player-media-filter").on("change", function () {
    const filterType = $(this).val();
    settings.mediaFilter = filterType;
    saveSafeSettings();
    // 刷新列表+重置索引
    refreshMediaList().then(() => {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      settings.randomMediaList = [...mediaList];
      showImage("current");
    });
  });

  // 10. 过渡效果变更（即时应用）
  $("#player-transition-effect").on("change", function () {
    saveCurrentSettings();
    // 立即应用到当前图片
    const imgElement = $(`#${PLAYER_WINDOW_ID} .image-player-img`)[0];
    if (imgElement && $(imgElement).is(":visible")) {
      applyTransitionEffect(imgElement, settings.transitionEffect, "image");
      // 重新加载图片触发效果
      const currentSrc = imgElement.src;
      imgElement.src = "";
      imgElement.src = currentSrc;
    }
  });

  // 11. 显示播放器（隐藏后重新显示时刷新内容）
  $("#show-player").on("click", function () {
    settings.isWindowVisible = true;
    saveSafeSettings();
    $(`#${PLAYER_WINDOW_ID}`).show();
    // 刷新当前媒体，避免内容过期
    showImage("current");
  });

  // 12. 其他设置项变更（即时保存+同步）
  $(
    "#player-service-url, #player-interval, #player-ai-cooldown, #player-polling-interval, #image-max-size, #video-max-size"
  ).on("change", saveCurrentSettings);

  $(
    "#player-slideshow-mode, #player-video-loop, #player-show-info, #player-preload-images, #player-preload-videos, #player-show-video-controls, #player-ai-detect, #player-player-detect, #extension-enabled, #player-hide-border, #custom-show-progress, #custom-show-volume, #custom-show-loop, #custom-show-time"
  ).on("change", saveCurrentSettings);
};

// ==================== 带重试的事件监听注册（确保AI/玩家消息检测生效） ====================
function registerEventListenersWithRetry() {
  const maxRetries = 5;
  const delay = 1000;
  let retries = 0;
  const tryRegister = () => {
    try {
      // 关键依赖检查
      if (!eventSource || !event_types) {
        throw new Error("事件源未就绪");
      }

      // 1. 注册AI回复事件（MESSAGE_RECEIVED）
      eventSource.off(event_types.MESSAGE_RECEIVED, onAIResponse); // 先解绑避免重复
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

      // 2. 注册玩家消息事件（MESSAGE_SENT）
      eventSource.off(event_types.MESSAGE_SENT, onPlayerMessage); // 先解绑避免重复
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

  // 延迟初始尝试（确保环境稳定）
  console.log(`[${EXTENSION_ID}] 计划2000ms后注册事件监听`);
  setTimeout(tryRegister, 2000);
}

// ==================== 扩展菜单按钮（仅在总开关开启时显示） ====================
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

  // 点击事件：打开设置面板并滚动定位
  $(`#ext_menu_${EXTENSION_ID}`).on("click", function () {
    const settings = getExtensionSettings();
    if (!settings.enabled) {
      toastr.warning("请先在扩展设置中启用媒体播放器");
      return;
    }
    $("#extensions-settings-button").trigger("click");
    // 平滑滚动到当前扩展设置
    $(`#${SETTINGS_PANEL_ID}`).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

// ==================== 扩展初始化（总开关控制+失败重试） ====================
async function initExtension() {
  const settings = getExtensionSettings();
  if (!settings.enabled) {
    console.log(`[${EXTENSION_ID}] 扩展已禁用，跳过初始化`);
    return;
  }

  try {
    console.log(`[${EXTENSION_ID}] 开始初始化媒体播放器扩展`);
    // 1. 初始化全局扩展设置（确保安全创建）
    if (typeof window.extension_settings === "undefined") {
      window.extension_settings = {};
    }
    if (!window.extension_settings[EXTENSION_ID]) {
      window.extension_settings[EXTENSION_ID] = settings;
      saveSafeSettings();
      console.log(`[${EXTENSION_ID}] 初始化默认扩展设置`);
    }

    // 2. 添加扩展菜单按钮
    addMenuButton();

    // 3. 创建播放器窗口和设置面板
    await createImagePlayerWindow();
    createSettingsPanel();

    // 4. 初始化WebSocket实时连接
    initWebSocket();

    // 5. 启动服务轮询
    startPollingService();

    // 6. 注册事件监听（AI回复+玩家消息）
    registerEventListenersWithRetry();

    // 7. 初始加载媒体列表并显示第一个媒体
    await refreshMediaList();
    if (mediaList.length > 0) {
      showImage("current");
    } else {
      toastr.info(`当前无可用媒体文件，请在设置中配置扫描目录`);
    }

    console.log(`[${EXTENSION_ID}] 扩展初始化完成`);
    toastr.success(`${EXTENSION_NAME}扩展加载成功（支持图片+视频播放）`);
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 初始化错误:`, e);
    // 失败后重试机制
    const retryDelay = 1500;
    console.warn(`[${EXTENSION_ID}] ${retryDelay}ms后重新尝试初始化...`);
    window.setTimeout(initExtension, retryDelay);
  }
}

// ==================== 页面就绪触发初始化（兼容不同加载状态） ====================
jQuery(async () => {
  console.log(`[${EXTENSION_ID}] 脚本开始加载（等待页面就绪）`);
  // 确保页面完全加载后初始化
  const initWhenReady = () => {
    const settings = getExtensionSettings();
    // 若总开关关闭，延迟3秒后再次检查（允许用户在页面加载后开启）
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
    // 超时兜底（防止事件未触发）
    window.setTimeout(initWhenReady, 1000);
  }
});

console.log(`[${EXTENSION_ID}] 脚本文件加载完成`);
