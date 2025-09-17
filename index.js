// 媒体播放器扩展（基于老版本重构，支持图片+视频）
import {
  eventSource,
  event_types,
  saveSettingsDebounced,
} from "../../../../script.js";

const EXTENSION_ID = "st_image_player";
const EXTENSION_NAME = "媒体播放器";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings";

// 安全工具函数
const getSafeGlobal = (name, defaultValue) =>
  window[name] === undefined ? defaultValue : window[name];
const getSafeToastr = () => {
  return (
    window.toastr || {
      success: (msg) => console.log(`SUCCESS: ${msg}`),
      info: (msg) => console.info(`INFO: ${msg}`),
      warning: (msg) => console.warn(`WARNING: ${msg}`),
      error: (msg) => console.error(`ERROR: ${msg}`),
    }
  );
};
const toastr = getSafeToastr();

// 扩展设置（新增视频相关配置）
const getExtensionSettings = () => {
  const settings = getSafeGlobal("extension_settings", {});
  if (!settings[EXTENSION_ID]) {
    settings[EXTENSION_ID] = {
      enabled: true,
      serviceUrl: "http://localhost:9000",
      playMode: "random",
      autoSwitchMode: "timer",
      switchInterval: 5000,
      position: { x: 100, y: 100, width: 600, height: 400 },
      isLocked: false,
      isWindowVisible: true,
      showInfo: false,
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
      // 新增视频配置
      videoLoop: false,
      videoVolume: 0.8,
      mediaFilter: "all",
      showVideoControls: true,
      hideBorder: false,
      customVideoControls: {
        showProgress: true,
        showVolume: true,
        showLoop: true,
        showTime: true,
      },
      progressUpdateInterval: null,
      serviceDirectory: "",
    };
  }
  return settings[EXTENSION_ID];
};

const saveSafeSettings = () => {
  const saveFn = getSafeGlobal("saveSettingsDebounced", null);
  if (saveFn && typeof saveFn === "function") saveFn();
};

// 全局状态
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
// 检查服务状态
const checkServiceStatus = async () => {
  const settings = getExtensionSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
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
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 服务检查失败`, e);
    return { active: false, error: e.message };
  }
};

// 获取媒体列表（支持筛选）
const fetchMediaList = async (filterType = "all") => {
  const settings = getExtensionSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/media?type=${filterType}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.media || [];
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 获取媒体列表失败`, e);
    toastr.error("获取媒体列表失败");
    return [];
  }
};

// 更新扫描目录
const updateScanDirectory = async (newPath) => {
  const settings = getExtensionSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: newPath }),
    });
    if (!res.ok) throw new Error((await res.json()).message || "更新目录失败");
    settings.serviceDirectory = newPath;
    saveSafeSettings();
    toastr.success(`目录已更新: ${newPath}`);
    await refreshMediaList();
    return true;
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 更新目录失败`, e);
    toastr.error(`更新失败: ${e.message}`);
    return false;
  }
};

// 更新媒体大小限制
const updateMediaSizeLimit = async (imageMaxMb, videoMaxMb) => {
  const settings = getExtensionSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: settings.serviceDirectory || serviceStatus.directory,
        image_max_mb: imageMaxMb,
        video_max_mb: videoMaxMb,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).message || "更新限制失败");
    settings.mediaConfig = {
      image_max_size_mb: imageMaxMb,
      video_max_size_mb: videoMaxMb,
    };
    saveSafeSettings();
    toastr.success(`大小限制更新: 图片${imageMaxMb}MB | 视频${videoMaxMb}MB`);
    await refreshMediaList();
    return true;
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 更新限制失败`, e);
    toastr.error(`更新失败: ${e.message}`);
    return false;
  }
};

// 清理无效媒体
const cleanupInvalidMedia = async () => {
  const settings = getExtensionSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/cleanup`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("清理失败");
    const data = await res.json();
    toastr.success(
      `清理完成: 移除${data.removed}个无效文件，剩余${data.remaining_total}个`
    );
    await refreshMediaList();
    return data;
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 清理失败`, e);
    toastr.error(`清理失败: ${e.message}`);
    return null;
  }
};

// 刷新媒体列表
const refreshMediaList = async () => {
  const settings = getExtensionSettings();
  mediaList = await fetchMediaList(settings.mediaFilter);
  settings.randomMediaList = [...mediaList];
  currentMediaIndex = 0;
  settings.randomPlayedIndices = [];
  clearTimeout(switchTimer);
  return mediaList;
};

// ==================== WebSocket 实时更新 ====================
const initWebSocket = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || ws) return;

  try {
    const wsUrl =
      settings.serviceUrl.replace("http://", "ws://") + "/socket.io";
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`[${EXTENSION_ID}] WebSocket连接成功`);
      refreshMediaList().then(() => showMedia("current"));
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
            `媒体库更新: 总计${data.total_count}（图片${data.image_count} | 视频${data.video_count}）`
          );
          updateStatusDisplay();
          break;
        case "pong":
          break;
      }
    };

    ws.onclose = () => {
      console.log(`[${EXTENSION_ID}] WebSocket关闭`);
      ws = null;
      if (settings.enabled) setTimeout(initWebSocket, 5000);
    };

    ws.onerror = (e) => {
      console.error(`[${EXTENSION_ID}] WebSocket错误`, e);
      ws = null;
      if (settings.enabled) setTimeout(initWebSocket, 5000);
    };

    // 心跳保持
    setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, 10000);
  } catch (e) {
    console.error(`[${EXTENSION_ID}] WebSocket初始化失败`, e);
    ws = null;
    if (settings.enabled) setTimeout(initWebSocket, 5000);
  }
};

// ==================== 视频控制工具 ====================
// 格式化时间（秒转分:秒）
const formatTime = (seconds) => {
  if (isNaN(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
};

// 更新进度条
const updateProgressBar = (progress) => {
  const settings = getExtensionSettings();
  if (!settings.customVideoControls.showProgress) return;

  progress = Math.max(0, Math.min(1, progress));
  $(`#${PLAYER_WINDOW_ID} .progress-played`).css("width", `${progress * 100}%`);
  $(`#${PLAYER_WINDOW_ID} .progress-handle`).css("left", `${progress * 100}%`);
};

// 更新音量
const updateVolume = (volume) => {
  const settings = getExtensionSettings();
  if (!settings.customVideoControls.showVolume) return;

  volume = Math.max(0, Math.min(1, volume));
  settings.videoVolume = volume;
  saveSafeSettings();

  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video) video.volume = volume;

  const icon = $(`#${PLAYER_WINDOW_ID} .volume-btn i`);
  if (volume === 0) {
    icon.removeClass("fa-volume-high fa-volume-low").addClass("fa-volume-mute");
  } else if (volume < 0.5) {
    icon.removeClass("fa-volume-high fa-volume-mute").addClass("fa-volume-low");
  } else {
    icon.removeClass("fa-volume-low fa-volume-mute").addClass("fa-volume-high");
  }

  $(`#${PLAYER_WINDOW_ID} .volume-slider`).val(volume);
};

// 启动/停止进度更新
const startProgressUpdate = () => {
  const settings = getExtensionSettings();
  if (
    !settings.customVideoControls.showProgress &&
    !settings.customVideoControls.showTime
  )
    return;

  stopProgressUpdate();
  settings.progressUpdateInterval = setInterval(() => {
    const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
    if (!video || video.paused || isNaN(video.duration)) return;

    const progress = video.currentTime / video.duration;
    updateProgressBar(progress);
    if (settings.customVideoControls.showTime) {
      $(`#${PLAYER_WINDOW_ID} .current-time`).text(
        formatTime(video.currentTime)
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

// 绑定视频控制事件
const bindVideoControls = () => {
  const winSelector = `#${PLAYER_WINDOW_ID}`;
  const settings = getExtensionSettings();

  // 进度条点击/拖拽
  $(document).off("mousedown", `${winSelector} .progress-bar`);
  $(document).on("mousedown", `${winSelector} .progress-bar`, (e) => {
    const video = $(winSelector).find(".image-player-video")[0];
    if (!video) return;

    progressDrag = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const progress = clickX / rect.width;
    video.currentTime = (video.duration || 0) * progress;
    updateProgressBar(progress);
    if (!video.paused) video.pause();
  });

  // 音量按钮
  $(document).off("click", `${winSelector} .volume-btn`);
  $(document).on("click", `${winSelector} .volume-btn`, () => {
    const volume = $(winSelector).find(".volume-slider").val();
    updateVolume(volume > 0 ? 0 : settings.videoVolume);
  });

  // 循环按钮
  $(document).off("click", `${winSelector} .loop-btn`);
  $(document).on("click", `${winSelector} .loop-btn`, function () {
    settings.videoLoop = !settings.videoLoop;
    saveSafeSettings();
    $(this).toggleClass("active", settings.videoLoop);

    const video = $(winSelector).find(".image-player-video")[0];
    if (video) video.loop = settings.videoLoop;

    toastr.info(settings.videoLoop ? "视频循环已启用" : "视频循环已禁用");
  });

  // 音量条拖拽
  $(document).off("mousedown", `${winSelector} .volume-slider`);
  $(document).on("mousedown", `${winSelector} .volume-slider`, () => {
    volumeDrag = true;
  });
};

// ==================== 播放器窗口 ====================
const createPlayerWindow = async () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || $(`#${PLAYER_WINDOW_ID}`).length) return;

  // 视频控制栏HTML
  const videoControlsHtml = settings.showVideoControls
    ? `
        <div class="video-controls">
            ${
              settings.customVideoControls.showProgress
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
                ${
                  settings.customVideoControls.showVolume
                    ? `
                    <button class="video-control-btn volume-btn">
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
                    </div>
                `
                    : ""
                }
                ${
                  settings.customVideoControls.showLoop
                    ? `
                    <button class="video-control-btn loop-btn ${
                      settings.videoLoop ? "active" : ""
                    }">
                        <i class="fa-solid fa-repeat"></i>
                    </button>
                `
                    : ""
                }
                ${
                  settings.customVideoControls.showTime
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

  // 窗口HTML
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
                    <div class="loading-animation">加载中...</div>
                    <img class="image-player-img" onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFAAH/l8iC5gAAAABJRU5ErkJggg=='" />
                    <video class="image-player-video" preload="metadata" ${
                      settings.videoLoop ? "loop" : ""
                    }>您的浏览器不支持HTML5视频</video>
                    ${videoControlsHtml}
                </div>
                <div class="image-info" ${
                  !settings.showInfo ? 'style="display:none;"' : ""
                }>加载中...</div>
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
                    }" title="${
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
                      settings.playMode === "random"
                        ? "随机模式"
                        : "顺序模式: 0/0"
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
        </div>
    `;

  // 添加到DOM
  $("body").append(html);
  setupWindowEvents();
  positionWindow();
  bindVideoControls();

  // 初始化视频音量
  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video) video.volume = settings.videoVolume;

  console.log(`[${EXTENSION_ID}] 播放器窗口创建完成`);
};

// 窗口定位
const positionWindow = () => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);

  // 基础定位
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

  // 边框隐藏模式：控制栏悬浮显示
  if (settings.hideBorder && settings.showVideoControls) {
    const container = win.find(".image-container");
    const controls = win.find(".video-controls");

    // 初始隐藏控制栏
    controls.css({ bottom: "-40px", opacity: 0 });

    // 鼠标悬浮显示
    container.off("mouseenter mouseleave");
    container.on("mouseenter", () => {
      controls.css({ bottom: 0, opacity: 1 });
    });
    container.on("mouseleave", () => {
      setTimeout(() => {
        if (!progressDrag && !volumeDrag) {
          controls.css({ bottom: "-40px", opacity: 0 });
        }
      }, 3000);
    });
  }

  // 调整视频控制栏布局
  adjustVideoControlsLayout();
};

// 调整视频控制栏布局
const adjustVideoControlsLayout = () => {
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const controlsHeight = win.find(".video-controls").outerHeight() || 40;
  win
    .find(".image-container")
    .css("height", `calc(100% - ${controlsHeight}px)`);
};

// 窗口事件绑定
const setupWindowEvents = () => {
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const header = win.find(".image-player-header")[0];
  const resizeHandle = win.find(".resize-handle")[0];
  const settings = getExtensionSettings();

  // 窗口拖拽
  header.addEventListener("mousedown", (e) => {
    if (settings.isLocked || settings.hideBorder) return;
    dragData = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: win.offset().left,
      startTop: win.offset().top,
    };
  });

  // 窗口调整大小
  resizeHandle.addEventListener("mousedown", (e) => {
    if (settings.isLocked || settings.hideBorder) return;
    e.preventDefault();
    resizeData = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: win.width(),
      startHeight: win.height(),
    };
  });

  // 全局鼠标事件
  document.addEventListener("mousemove", (e) => {
    // 拖拽处理
    if (dragData) {
      const diffX = e.clientX - dragData.startX;
      const diffY = e.clientY - dragData.startY;
      win.css({
        left: `${dragData.startLeft + diffX}px`,
        top: `${dragData.startTop + diffY}px`,
      });
    }

    // 调整大小处理
    if (resizeData) {
      const diffX = e.clientX - resizeData.startX;
      const diffY = e.clientY - resizeData.startY;
      const newWidth = Math.max(300, resizeData.startWidth + diffX);
      const newHeight = Math.max(200, resizeData.startHeight + diffY);
      win.css({ width: `${newWidth}px`, height: `${newHeight}px` });
      adjustVideoControlsLayout();
    }

    // 进度条拖拽
    if (progressDrag && settings.customVideoControls.showProgress) {
      const bar = win.find(".progress-bar")[0];
      const rect = bar.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const progress = clickX / rect.width;
      updateProgressBar(progress);

      const video = win.find(".image-player-video")[0];
      if (video) {
        const currentTime = (video.duration || 0) * progress;
        win.find(".current-time").text(formatTime(currentTime));
      }
    }

    // 音量条拖拽
    if (volumeDrag && settings.customVideoControls.showVolume) {
      const slider = win.find(".volume-slider")[0];
      const rect = slider.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const volume = clickX / rect.width;
      updateVolume(volume);
    }
  });

  // 鼠标松开：保存状态
  document.addEventListener("mouseup", () => {
    // 保存窗口位置/大小
    if (dragData || resizeData) {
      settings.position = {
        x: win.offset().left,
        y: win.offset().top,
        width: win.width(),
        height: win.height(),
      };
      saveSafeSettings();
      dragData = null;
      resizeData = null;
    }

    // 进度条拖拽结束：恢复播放
    if (progressDrag && settings.customVideoControls.showProgress) {
      const video = win.find(".image-player-video")[0];
      if (video && settings.isPlaying && video.paused) {
        video.play().catch((err) => console.warn("视频播放失败:", err));
      }
    }

    progressDrag = false;
    volumeDrag = false;
  });

  // 锁定按钮
  win.find(".lock").on("click", function () {
    settings.isLocked = !settings.isLocked;
    saveSafeSettings();
    $(this).find("i").toggleClass("fa-lock fa-lock-open");
    win.toggleClass("locked");
    toastr.info(`窗口已${settings.isLocked ? "锁定" : "解锁"}`);
  });

  // 播放/暂停按钮
  win.find(".play-pause").on("click", function () {
    settings.isPlaying = !settings.isPlaying;
    saveSafeSettings();
    const icon = $(this).find("i");
    icon.toggleClass("fa-play fa-pause");

    const video = win.find(".image-player-video")[0];
    const isVideoVisible = video && video.style.display !== "none";

    if (settings.isPlaying) {
      // 视频：直接播放
      if (isVideoVisible) {
        video.play().catch((err) => {
          console.warn("视频自动播放失败（浏览器限制）:", err);
          toastr.warning("请点击视频手动播放");
        });
        startProgressUpdate();
      }
      // 图片：启动定时切换
      else {
        startPlayback();
      }
    } else {
      // 暂停逻辑
      clearTimeout(switchTimer);
      stopProgressUpdate();
      if (isVideoVisible && !video.paused) {
        video.pause();
      }
    }
  });

  // 播放模式切换（随机/顺序）
  win.find(".mode-switch").on("click", function () {
    settings.playMode =
      settings.playMode === "random" ? "sequential" : "random";
    saveSafeSettings();
    const icon = $(this).find("i");
    icon.toggleClass("fa-shuffle fa-list-ol");

    // 重置随机播放记录
    if (settings.playMode === "random") {
      settings.randomMediaList = [...mediaList];
      settings.randomPlayedIndices = [];
      toastr.info("切换为随机播放模式");
    } else {
      toastr.info("切换为顺序播放模式");
    }

    showMedia("current");
  });

  // 媒体信息显示切换
  win.find(".toggle-info").on("click", function () {
    settings.showInfo = !settings.showInfo;
    saveSafeSettings();
    $(this).toggleClass("active", settings.showInfo);
    win.find(".image-info").toggle(settings.showInfo);
  });

  // 视频控制栏显示切换
  win.find(".toggle-video-controls").on("click", function () {
    settings.showVideoControls = !settings.showVideoControls;
    saveSafeSettings();
    $(this).toggleClass("active", settings.showVideoControls);
    win.find(".video-controls").toggle(settings.showVideoControls);
    adjustVideoControlsLayout();
  });

  // 隐藏窗口
  win.find(".hide").on("click", function () {
    win.hide();
    settings.isWindowVisible = false;
    saveSafeSettings();

    // 暂停视频
    const video = win.find(".image-player-video")[0];
    if (video) video.pause();
    stopProgressUpdate();
  });

  // 上一个/下一个媒体
  win.find(".prev").on("click", () => {
    clearTimeout(switchTimer);
    const video = win.find(".image-player-video")[0];
    if (video) {
      video.pause();
      stopProgressUpdate();
    }
    showMedia("prev");
  });

  win.find(".next").on("click", () => {
    clearTimeout(switchTimer);
    const video = win.find(".image-player-video")[0];
    if (video) {
      video.pause();
      stopProgressUpdate();
    }
    showMedia("next");
  });

  // 切换模式（定时/检测）
  win.find(".switch-mode-toggle").on("click", function () {
    settings.autoSwitchMode =
      settings.autoSwitchMode === "detect" ? "timer" : "detect";
    settings.isPlaying = settings.autoSwitchMode !== null;
    saveSafeSettings();

    $(this)
      .toggleClass("active", settings.autoSwitchMode === "detect")
      .find("i")
      .toggleClass("fa-robot fa-clock");

    win
      .find(".play-pause i")
      .toggleClass("fa-play", !settings.isPlaying)
      .toggleClass("fa-pause", settings.isPlaying);

    // 暂停当前视频
    const video = win.find(".image-player-video")[0];
    if (video) video.pause();
    stopProgressUpdate();

    // 启动播放（若切换为定时模式）
    if (settings.isPlaying && settings.autoSwitchMode === "timer") {
      startPlayback();
    }
  });

  // 媒体筛选
  win.find(".media-filter-btn").on("click", function () {
    const filterType = $(this).data("type");
    settings.mediaFilter = filterType;
    saveSafeSettings();

    // 更新按钮状态
    win.find(".media-filter-btn").removeClass("active");
    $(this).addClass("active");

    // 刷新媒体列表并显示
    refreshMediaList().then(() => {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      showMedia("current");
    });
  });

  // 视频事件监听
  const video = win.find(".image-player-video")[0];
  if (video) {
    // 视频加载完成：更新总时长
    video.addEventListener("loadedmetadata", () => {
      if (settings.customVideoControls.showTime) {
        win.find(".total-time").text(formatTime(video.duration));
      }
      win.find(".progress-loaded").css("width", "0%");
    });

    // 视频缓冲：更新已加载进度
    video.addEventListener("progress", () => {
      if (
        video.buffered.length > 0 &&
        settings.customVideoControls.showProgress
      ) {
        const loadedProgress =
          video.buffered.end(video.buffered.length - 1) / video.duration;
        win.find(".progress-loaded").css("width", `${loadedProgress * 100}%`);
      }
    });

    // 视频结束：切换下一个（非循环模式）
    video.addEventListener("ended", () => {
      if (settings.isPlaying && !settings.videoLoop) {
        showMedia("next");
      } else if (settings.customVideoControls.showProgress) {
        updateProgressBar(0);
        win.find(".current-time").text("00:00");
      }
    });
  }
};

// ==================== 播放控制 ====================
// 启动播放（区分图片/视频）
const startPlayback = () => {
  const settings = getExtensionSettings();
  if (!settings.isPlaying) return;

  clearTimeout(switchTimer);
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const video = win.find(".image-player-video")[0];
  const isVideoVisible = video && video.style.display !== "none";

  // 定时模式：图片定时切换，视频仅在结束后切换
  if (settings.autoSwitchMode === "timer") {
    if (isVideoVisible) {
      // 视频：播放并监听结束事件
      if (video.paused) {
        video.play().catch((err) => {
          console.warn("视频播放失败:", err);
          toastr.warning("请点击视频手动播放");
        });
        startProgressUpdate();
      }
    } else {
      // 图片：定时切换
      showMedia("next");
      switchTimer = setTimeout(startPlayback, settings.switchInterval);
    }
  }
};

// 获取随机媒体索引
const getRandomMediaIndex = () => {
  const settings = getExtensionSettings();
  const list = settings.randomMediaList || [];

  // 所有媒体已播放过：重置记录
  if (settings.randomPlayedIndices.length >= list.length) {
    settings.randomPlayedIndices = [];
  }

  // 筛选未播放的索引
  const availableIndices = list
    .map((_, i) => i)
    .filter((i) => !settings.randomPlayedIndices.includes(i));

  if (availableIndices.length === 0) return 0;
  return availableIndices[Math.floor(Math.random() * availableIndices.length)];
};

// 预加载媒体
const preloadMediaItem = async (url, type) => {
  const settings = getExtensionSettings();
  if (
    (type === "video" && !settings.preloadVideos) ||
    (type === "image" && !settings.preloadImages)
  ) {
    return null;
  }

  try {
    return await new Promise((resolve, reject) => {
      if (type === "image") {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("图片预加载失败"));
        img.src = url;
      } else if (type === "video") {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve(video);
        video.onerror = () => reject(new Error("视频预加载失败"));
        video.src = url;
      } else {
        resolve(null);
      }
    });
  } catch (e) {
    console.warn(`[${EXTENSION_ID}] 预加载${type}失败`, e);
    return null;
  }
};

// 图片过渡效果
const applyTransitionEffect = (imgElement, effect) => {
  imgElement.classList.remove(
    "fade-transition",
    "slide-transition",
    "zoom-transition"
  );
  if (effect !== "none") {
    imgElement.classList.add(`${effect}-transition`);
  }
};

// 显示媒体（核心逻辑）
const showMedia = async (direction) => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const imgElement = win.find(".image-player-img")[0];
  const videoElement = win.find(".image-player-video")[0];
  const loadingElement = win.find(".loading-animation")[0];
  const infoElement = win.find(".image-info")[0];

  // 初始化加载状态
  win.find(".control-text").text("加载中...");
  $(imgElement).hide();
  $(videoElement).hide();
  $(loadingElement).show();

  try {
    // 检查服务状态
    const status = await checkServiceStatus();
    if (!status.active) throw new Error("媒体服务未连接");

    let mediaUrl, mediaName, mediaType;
    const filterType = settings.mediaFilter;

    // 随机播放逻辑
    if (settings.playMode === "random") {
      if (settings.randomMediaList.length === 0) {
        settings.randomMediaList = await fetchMediaList(filterType);
        settings.randomPlayedIndices = [];
      }

      let randomIndex = -1;
      if (direction === "next") {
        randomIndex = getRandomMediaIndex();
        settings.randomPlayedIndices.push(randomIndex);
      } else if (direction === "prev") {
        // 上一个：回退播放记录
        if (settings.randomPlayedIndices.length > 1) {
          settings.randomPlayedIndices.pop();
          randomIndex = settings.randomPlayedIndices.pop();
          settings.randomPlayedIndices.push(randomIndex);
        } else {
          randomIndex = settings.randomPlayedIndices[0] || 0;
        }
      } else if (direction === "current") {
        randomIndex =
          settings.randomPlayedIndices.length > 0
            ? settings.randomPlayedIndices[
                settings.randomPlayedIndices.length - 1
              ]
            : getRandomMediaIndex();
      }

      // 验证索引有效性
      if (randomIndex < 0 || randomIndex >= settings.randomMediaList.length) {
        throw new Error("无可用媒体");
      }

      const media = settings.randomMediaList[randomIndex];
      mediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
        media.rel_path
      )}`;
      mediaName = media.name;
      mediaType = media.media_type;
    }
    // 顺序播放逻辑
    else {
      if (mediaList.length === 0) {
        mediaList = await fetchMediaList(filterType);
      }
      if (mediaList.length === 0) throw new Error("无可用媒体");

      // 更新索引
      if (direction === "next") {
        currentMediaIndex = (currentMediaIndex + 1) % mediaList.length;
      } else if (direction === "prev") {
        currentMediaIndex =
          (currentMediaIndex - 1 + mediaList.length) % mediaList.length;
      }

      const media = mediaList[currentMediaIndex];
      mediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
        media.rel_path
      )}`;
      mediaName = media.name;
      mediaType = media.media_type;
    }

    currentMediaType = mediaType;
    $(loadingElement).hide();

    // 显示图片
    if (mediaType === "image") {
      applyTransitionEffect(imgElement, settings.transitionEffect);

      // 使用预加载图片
      if (preloadedMedia && preloadedMedia.src === mediaUrl) {
        $(imgElement).attr("src", mediaUrl).show();
      } else {
        // 加载图片
        const img = new Image();
        img.src = mediaUrl;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error("图片加载失败"));
        });
        $(imgElement).attr("src", mediaUrl).show();
      }

      $(videoElement).hide();
    }
    // 显示视频
    else if (mediaType === "video") {
      // 重置视频状态
      videoElement.currentTime = 0;
      videoElement.loop = settings.videoLoop;
      $(videoElement).attr("src", mediaUrl).show();

      // 等待视频元数据加载
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

      $(imgElement).hide();

      // 自动播放（若处于播放状态）
      if (settings.isPlaying) {
        videoElement
          .play()
          .then(() => {
            startProgressUpdate();
          })
          .catch((err) => {
            console.warn("视频自动播放失败:", err);
            win.find(".control-text").text("点击视频播放");
          });
      }
    }

    // 更新媒体信息
    if (settings.showInfo) {
      $(infoElement).text(`${mediaName}（${mediaType}）`).show();
    } else {
      $(infoElement).hide();
    }

    // 更新控制栏文本
    const totalCount =
      settings.playMode === "random"
        ? settings.randomMediaList.length
        : mediaList.length;
    const currentCount =
      settings.playMode === "random"
        ? settings.randomPlayedIndices.length
        : currentMediaIndex + 1;
    win
      .find(".control-text")
      .text(
        `${
          settings.playMode === "random" ? "随机模式" : "顺序模式"
        }: ${currentCount}/${totalCount}（${mediaType}）`
      );

    // 预加载下一个媒体
    retryCount = 0;
    let nextUrl, nextType;
    if (settings.playMode === "random") {
      const nextIndex = getRandomMediaIndex();
      if (nextIndex >= 0 && nextIndex < settings.randomMediaList.length) {
        const nextMedia = settings.randomMediaList[nextIndex];
        nextUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
          nextMedia.rel_path
        )}`;
        nextType = nextMedia.media_type;
      }
    } else {
      const nextIndex = (currentMediaIndex + 1) % mediaList.length;
      const nextMedia = mediaList[nextIndex];
      nextUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
        nextMedia.rel_path
      )}`;
      nextType = nextMedia.media_type;
    }

    if (nextUrl && nextType) {
      preloadedMedia = await preloadMediaItem(nextUrl, nextType);
    }
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 加载媒体失败`, e);
    let errorMsg = "媒体加载失败";
    if (e.message.includes("Failed to fetch")) errorMsg = "服务连接失败";
    else if (e.message.includes("404")) errorMsg = "媒体文件不存在";
    else if (e.message.includes("无可用媒体"))
      errorMsg = `无可用${filterType === "all" ? "媒体" : filterType}文件`;

    // 重试机制
    if (retryCount < 3 && settings.enabled) {
      retryCount++;
      toastr.warning(`${errorMsg}，重试中（${retryCount}/3）`);
      setTimeout(() => showMedia(direction), 3000);
    } else {
      toastr.error(`${errorMsg}，已停止重试`);
      win.find(".control-text").text("加载失败");
      $(loadingElement).hide();
    }
  }
};

// ==================== AI/玩家消息检测 ====================
// AI回复检测切换
const onAIResponse = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return;

  // 视频循环时禁用切换
  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video && video.style.display !== "none" && settings.videoLoop) {
    console.log(`[${EXTENSION_ID}] 视频循环中，跳过AI切换`);
    return;
  }

  // 检测模式验证
  if (
    settings.autoSwitchMode !== "detect" ||
    !settings.aiDetectEnabled ||
    !settings.isWindowVisible
  ) {
    return;
  }

  // 冷却时间验证
  const now = performance.now();
  if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) {
    return;
  }

  settings.lastAISwitchTime = now;
  saveSafeSettings();
  showMedia("next");
  console.log(`[${EXTENSION_ID}] AI回复触发媒体切换`);
};

// 玩家消息检测切换
const onPlayerMessage = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) return;

  // 视频循环时禁用切换
  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video && video.style.display !== "none" && settings.videoLoop) {
    console.log(`[${EXTENSION_ID}] 视频循环中，跳过玩家切换`);
    return;
  }

  // 检测模式验证
  if (
    settings.autoSwitchMode !== "detect" ||
    !settings.playerDetectEnabled ||
    !settings.isWindowVisible
  ) {
    return;
  }

  // 冷却时间验证
  const now = performance.now();
  if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) {
    return;
  }

  settings.lastAISwitchTime = now;
  saveSafeSettings();
  showMedia("next");
  console.log(`[${EXTENSION_ID}] 玩家消息触发媒体切换`);
};

// ==================== 服务轮询 ====================
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

      // 媒体数量变化时刷新列表
      if (serviceStatus.totalCount !== prevCount) {
        if (settings.playMode === "random") {
          settings.randomMediaList = await fetchMediaList(settings.mediaFilter);
          settings.randomPlayedIndices = [];
        } else {
          mediaList = await fetchMediaList(settings.mediaFilter);
        }
        toastr.info(
          `媒体库更新: 总计${serviceStatus.totalCount}（图片${serviceStatus.imageCount} | 视频${serviceStatus.videoCount}）`
        );
        updateStatusDisplay();
      }
    } catch (e) {
      console.error(`[${EXTENSION_ID}] 服务轮询失败`, e);
    } finally {
      pollingTimer = setTimeout(poll, settings.pollingInterval);
    }
  };

  poll();
};

// ==================== 设置面板 ====================
// 更新状态显示
const updateStatusDisplay = () => {
  const settingsPanel = $(`#${SETTINGS_PANEL_ID}`);
  if (!settingsPanel.length) return;

  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const observerStatus = serviceStatus.observerActive ? "已启用" : "已禁用";
  const statusText = `${serviceActive}（监控: ${observerStatus} | 总计: ${serviceStatus.totalCount} | 图片: ${serviceStatus.imageCount} | 视频: ${serviceStatus.videoCount}）`;

  settingsPanel
    .find(".service-status span")
    .removeClass("status-success status-error")
    .addClass(serviceStatus.active ? "status-success" : "status-error")
    .text(statusText);
};

// 创建设置面板
const createSettingsPanel = async () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || $(`#${SETTINGS_PANEL_ID}`).length) return;

  // 服务状态初始化
  await checkServiceStatus();
  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const observerStatus = serviceStatus.observerActive ? "已启用" : "已禁用";
  const statusText = `${serviceActive}（监控: ${observerStatus} | 总计: ${serviceStatus.totalCount} | 图片: ${serviceStatus.imageCount} | 视频: ${serviceStatus.videoCount}）`;

  // 设置面板HTML
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
                        <!-- 总开关 -->
                        <div class="settings-row">
                            <label class="checkbox_label" style="min-width:auto;">
                                <input type="checkbox" id="extension-enabled" ${
                                  settings.enabled ? "checked" : ""
                                } />
                                <i class="fa-solid fa-power-off"></i>启用媒体播放器
                            </label>
                        </div>
                        
                        <!-- 服务状态 -->
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
                                }">${statusText}</span>
                            </label>
                        </div>
                        
                        <!-- 基础配置 -->
                        <div class="settings-row">
                            <label><i class="fa-solid fa-link"></i>服务地址</label>
                            <input type="text" id="player-service-url" value="${
                              settings.serviceUrl
                            }" placeholder="http://localhost:9000" />
                        </div>
                        
                        <div class="settings-row">
                            <label><i class="fa-solid fa-folder"></i>媒体目录</label>
                            <input type="text" id="player-scan-directory" value="${
                              settings.serviceDirectory ||
                              serviceStatus.directory
                            }" placeholder="输入完整路径" />
                            <button id="update-directory" class="menu-button">更新目录</button>
                        </div>
                        
                        <!-- 媒体大小限制 -->
                        <div class="settings-group">
                            <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                                <i class="fa-solid fa-maximize"></i> 媒体大小限制
                            </h4>
                            <div class="settings-row">
                                <label><i class="fa-solid fa-image"></i>图片最大尺寸</label>
                                <input type="number" id="image-max-size" value="${
                                  settings.mediaConfig?.image_max_size_mb || 5
                                }" min="1" max="50" step="1" />
                                <span>MB</span>
                                
                                <label><i class="fa-solid fa-video"></i>视频最大尺寸</label>
                                <input type="number" id="video-max-size" value="${
                                  settings.mediaConfig?.video_max_size_mb || 100
                                }" min="10" max="500" step="10" />
                                <span>MB</span>
                                
                                <button id="update-size-limit" class="menu-button">应用限制</button>
                            </div>
                        </div>
                        
                        <!-- 边框隐藏 -->
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-hide-border" ${
                                  settings.hideBorder ? "checked" : ""
                                } />
                                <i class="fa-solid fa-border-none"></i>隐藏播放器边框（仅显示内容）
                            </label>
                        </div>
                        
                        <!-- 视频控制自定义 -->
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
                        
                        <!-- 播放模式切换 -->
                        <div class="function-toggle-group">
                            <div class="function-toggle ${
                              settings.autoSwitchMode === "timer"
                                ? "active"
                                : ""
                            }" id="toggle-timer-mode">
                                <i class="fa-solid fa-clock"></i>
                                <span>定时播放</span>
                            </div>
                            <div class="function-toggle ${
                              settings.autoSwitchMode === "detect"
                                ? "active"
                                : ""
                            }" id="toggle-detect-mode">
                                <i class="fa-solid fa-robot"></i>
                                <span>检测播放</span>
                            </div>
                        </div>
                        
                        <!-- 检测模式子选项 -->
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
                                      settings.playerDetectEnabled
                                        ? "checked"
                                        : ""
                                    } />
                                    <i class="fa-solid fa-keyboard"></i>玩家发送时切换
                                </label>
                            </div>
                        </div>
                        
                        <!-- 核心配置 -->
                        <div class="settings-row">
                            <label><i class="fa-solid fa-clone"></i>播放模式</label>
                            <select id="player-play-mode">
                                <option value="random" ${
                                  settings.playMode === "random"
                                    ? "selected"
                                    : ""
                                }>随机播放</option>
                                <option value="sequential" ${
                                  settings.playMode === "sequential"
                                    ? "selected"
                                    : ""
                                }>顺序播放</option>
                            </select>
                            
                            <label><i class="fa-solid fa-filter"></i>媒体筛选</label>
                            <select id="player-media-filter">
                                <option value="all" ${
                                  settings.mediaFilter === "all"
                                    ? "selected"
                                    : ""
                                }>所有媒体</option>
                                <option value="image" ${
                                  settings.mediaFilter === "image"
                                    ? "selected"
                                    : ""
                                }>仅图片</option>
                                <option value="video" ${
                                  settings.mediaFilter === "video"
                                    ? "selected"
                                    : ""
                                }>仅视频</option>
                            </select>
                        </div>
                        
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-slideshow-mode" ${
                                  settings.slideshowMode ? "checked" : ""
                                } ${
    settings.playMode === "random" ? "disabled" : ""
  } />
                                <i class="fa-solid fa-repeat"></i>图片循环播放
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-video-loop" ${
                                  settings.videoLoop ? "checked" : ""
                                } />
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
                        
                        <!-- 时间配置 -->
                        <div class="settings-row">
                            <label><i class="fa-solid fa-clock"></i>定时切换间隔</label>
                            <input type="number" id="player-interval" value="${
                              settings.switchInterval
                            }" min="1000" max="60000" step="500" />
                            <span>毫秒</span>
                        </div>
                        
                        <div class="settings-row">
                            <label><i class="fa-solid fa-sync"></i>服务轮询间隔</label>
                            <input type="number" id="player-polling-interval" value="${
                              settings.pollingInterval
                            }" min="5000" max="300000" step="5000" />
                            <span>毫秒</span>
                        </div>
                        
                        <!-- 图片过渡效果 -->
                        <div class="settings-row">
                            <label><i class="fa-solid fa-paint-brush"></i>图片过渡效果</label>
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
                        
                        <!-- 检测冷却时间 -->
                        <div class="settings-group">
                            <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                                <i class="fa-solid fa-robot"></i> 检测设置
                            </h4>
                            <div class="settings-row">
                                <label><i class="fa-solid fa-hourglass-half"></i>切换冷却时间</label>
                                <input type="number" id="player-ai-cooldown" value="${
                                  settings.aiResponseCooldown
                                }" min="1000" max="30000" step="500" />
                                <span>毫秒</span>
                            </div>
                        </div>
                        
                        <!-- 操作按钮 -->
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
        </div>
    `;

  // 添加到设置区域
  $("#extensions_settings").append(html);
  setupSettingsEvents();
  console.log(`[${EXTENSION_ID}] 设置面板创建完成`);
};

// 设置面板事件绑定
const setupSettingsEvents = () => {
  const settings = getExtensionSettings();
  const panel = $(`#${SETTINGS_PANEL_ID}`);

  // 保存当前设置
  const saveCurrentSettings = () => {
    settings.enabled = panel.find("#extension-enabled").prop("checked");
    settings.serviceUrl = panel.find("#player-service-url").val().trim();
    settings.serviceDirectory = panel
      .find("#player-scan-directory")
      .val()
      .trim();
    settings.playMode = panel.find("#player-play-mode").val();
    settings.mediaFilter = panel.find("#player-media-filter").val();
    settings.slideshowMode = panel
      .find("#player-slideshow-mode")
      .prop("checked");
    settings.videoLoop = panel.find("#player-video-loop").prop("checked");
    settings.showInfo = panel.find("#player-show-info").prop("checked");
    settings.preloadImages = panel
      .find("#player-preload-images")
      .prop("checked");
    settings.preloadVideos = panel
      .find("#player-preload-videos")
      .prop("checked");
    settings.showVideoControls = panel
      .find("#player-show-video-controls")
      .prop("checked");
    settings.transitionEffect = panel.find("#player-transition-effect").val();
    settings.pollingInterval =
      parseInt(panel.find("#player-polling-interval").val()) || 30000;
    settings.switchInterval =
      parseInt(panel.find("#player-interval").val()) || 5000;
    settings.aiResponseCooldown =
      parseInt(panel.find("#player-ai-cooldown").val()) || 3000;
    settings.aiDetectEnabled = panel.find("#player-ai-detect").prop("checked");
    settings.playerDetectEnabled = panel
      .find("#player-player-detect")
      .prop("checked");
    settings.hideBorder = panel.find("#player-hide-border").prop("checked");
    settings.customVideoControls = {
      showProgress: panel.find("#custom-show-progress").prop("checked"),
      showVolume: panel.find("#custom-show-volume").prop("checked"),
      showLoop: panel.find("#custom-show-loop").prop("checked"),
      showTime: panel.find("#custom-show-time").prop("checked"),
    };

    // 保存设置
    saveSafeSettings();

    // 应用边框隐藏模式
    $(`#${PLAYER_WINDOW_ID}`).toggleClass("no-border", settings.hideBorder);

    // 启用/禁用图片循环（随机模式下禁用）
    panel
      .find("#player-slideshow-mode")
      .prop("disabled", settings.playMode === "random");

    // 重启轮询
    startPollingService();

    // 刷新播放器UI
    updateExtensionMenu();
  };

  // 刷新服务状态
  panel.find("#player-refresh").on("click", async () => {
    await checkServiceStatus();
    updateStatusDisplay();
    await refreshMediaList();
    showMedia("current");
    toastr.success("服务状态已刷新");
  });

  // 清理随机记录
  panel.find("#clear-random-history").on("click", () => {
    settings.randomPlayedIndices = [];
    saveSafeSettings();
    toastr.success("随机播放记录已清理");
    showMedia("current");
  });

  // 清理无效媒体
  panel.find("#cleanup-media").on("click", async () => {
    if (!confirm("确定清理无效/超大小限制的媒体文件？（不可逆）")) return;
    await cleanupInvalidMedia();
  });

  // 更新扫描目录
  panel.find("#update-directory").on("click", async () => {
    const newPath = panel.find("#player-scan-directory").val().trim();
    if (!newPath) {
      toastr.warning("请输入有效目录路径");
      return;
    }
    await updateScanDirectory(newPath);
  });

  // 更新媒体大小限制
  panel.find("#update-size-limit").on("click", async () => {
    const imageMaxMb = parseInt(panel.find("#image-max-size").val()) || 5;
    const videoMaxMb = parseInt(panel.find("#video-max-size").val()) || 100;

    if (imageMaxMb < 1 || imageMaxMb > 50) {
      toastr.warning("图片大小限制需在1-50MB之间");
      return;
    }
    if (videoMaxMb < 10 || videoMaxMb > 500) {
      toastr.warning("视频大小限制需在10-500MB之间");
      return;
    }

    await updateMediaSizeLimit(imageMaxMb, videoMaxMb);
    panel.find("#image-max-size").val(imageMaxMb);
    panel.find("#video-max-size").val(videoMaxMb);
  });

  // 定时播放模式切换
  panel.find("#toggle-timer-mode").on("click", () => {
    const wasActive = settings.autoSwitchMode === "timer";
    if (wasActive) {
      settings.autoSwitchMode = null;
      settings.isPlaying = false;
      clearTimeout(switchTimer);
      stopProgressUpdate();
    } else {
      settings.autoSwitchMode = "timer";
      settings.isPlaying = true;
      startPlayback();
    }

    saveSafeSettings();
    panel.find("#toggle-timer-mode").toggleClass("active", !wasActive);
    panel.find("#toggle-detect-mode").removeClass("active");
    panel.find("#detect-sub-options").hide();
    updateExtensionMenu();
  });

  // 检测播放模式切换
  panel.find("#toggle-detect-mode").on("click", () => {
    const wasActive = settings.autoSwitchMode === "detect";
    if (wasActive) {
      settings.autoSwitchMode = null;
      settings.isPlaying = false;
      stopProgressUpdate();
    } else {
      settings.autoSwitchMode = "detect";
      settings.isPlaying = true;
    }

    saveSafeSettings();
    panel.find("#toggle-detect-mode").toggleClass("active", !wasActive);
    panel.find("#toggle-timer-mode").removeClass("active");
    panel.find("#detect-sub-options").toggle(!wasActive);
    updateExtensionMenu();
  });

  // 播放模式变更
  panel.find("#player-play-mode").on("change", () => {
    panel
      .find("#player-slideshow-mode")
      .prop("disabled", $(this).val() === "random");
    saveCurrentSettings();
    if (settings.playMode === "random") {
      settings.randomMediaList = [...mediaList];
      settings.randomPlayedIndices = [];
    }
    showMedia("current");
  });

  // 媒体筛选变更
  panel.find("#player-media-filter").on("change", () => {
    settings.mediaFilter = $(this).val();
    saveSafeSettings();
    refreshMediaList().then(() => {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      showMedia("current");
    });
  });

  // 过渡效果变更
  panel.find("#player-transition-effect").on("change", () => {
    saveCurrentSettings();
    const imgElement = $(`#${PLAYER_WINDOW_ID} .image-player-img`)[0];
    if (imgElement && $(imgElement).is(":visible")) {
      applyTransitionEffect(imgElement, settings.transitionEffect);
      // 重新加载图片触发过渡效果
      const currentSrc = imgElement.src;
      imgElement.src = "";
      imgElement.src = currentSrc;
    }
  });

  // 显示播放器
  panel.find("#show-player").on("click", () => {
    settings.isWindowVisible = true;
    saveSafeSettings();
    $(`#${PLAYER_WINDOW_ID}`).show();
    showMedia("current");
  });

  // 基础设置项变更绑定
  panel
    .find(
      "#player-service-url, #player-interval, #player-ai-cooldown, #player-polling-interval"
    )
    .on("change", saveCurrentSettings);

  // 复选框类设置项变更绑定
  panel
    .find(
      "#player-slideshow-mode, #player-video-loop, #player-show-info, #player-preload-images, " +
        "#player-preload-videos, #player-show-video-controls, #player-ai-detect, #player-player-detect, " +
        "#extension-enabled, #player-hide-border, #custom-show-progress, #custom-show-volume, " +
        "#custom-show-loop, #custom-show-time"
    )
    .on("change", saveCurrentSettings);
};

// 更新扩展菜单与播放器UI同步
const updateExtensionMenu = () => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const panel = $(`#${SETTINGS_PANEL_ID}`);
  if (!win.length || !panel.length) return;

  // 1. 播放状态同步
  win
    .find(".play-pause i")
    .toggleClass("fa-play", !settings.isPlaying)
    .toggleClass("fa-pause", settings.isPlaying);

  // 2. 播放模式同步（随机/顺序）
  win
    .find(".mode-switch i")
    .toggleClass("fa-shuffle", settings.playMode === "random")
    .toggleClass("fa-list-ol", settings.playMode === "sequential");
  panel.find("#player-play-mode").val(settings.playMode);

  // 3. 媒体筛选同步
  win.find(".media-filter-btn").removeClass("active");
  win
    .find(`.media-filter-btn[data-type="${settings.mediaFilter}"]`)
    .addClass("active");
  panel.find("#player-media-filter").val(settings.mediaFilter);

  // 4. 视频控制栏状态同步
  win
    .find(".toggle-video-controls")
    .toggleClass("active", settings.showVideoControls);
  win.find(".video-controls").toggle(settings.showVideoControls);
  panel
    .find("#player-show-video-controls")
    .prop("checked", settings.showVideoControls);

  // 5. 视频循环状态同步
  win.find(".loop-btn").toggleClass("active", settings.videoLoop);
  panel.find("#player-video-loop").prop("checked", settings.videoLoop);
  const videoElement = win.find(".image-player-video")[0];
  if (videoElement) videoElement.loop = settings.videoLoop;

  // 6. 边框隐藏模式同步
  win.toggleClass("no-border", settings.hideBorder);
  panel.find("#player-hide-border").prop("checked", settings.hideBorder);

  // 7. 自动切换模式同步（定时/检测）
  win
    .find(".switch-mode-toggle")
    .toggleClass("active", settings.autoSwitchMode === "detect")
    .find("i")
    .toggleClass("fa-robot", settings.autoSwitchMode === "detect")
    .toggleClass("fa-clock", settings.autoSwitchMode !== "detect");
  panel
    .find("#toggle-timer-mode")
    .toggleClass("active", settings.autoSwitchMode === "timer");
  panel
    .find("#toggle-detect-mode")
    .toggleClass("active", settings.autoSwitchMode === "detect");
  panel
    .find("#detect-sub-options")
    .toggle(settings.autoSwitchMode === "detect");

  // 8. 媒体信息显示同步
  win.find(".toggle-info").toggleClass("active", settings.showInfo);
  win.find(".image-info").toggle(settings.showInfo);
  panel.find("#player-show-info").prop("checked", settings.showInfo);

  // 9. 图片过渡效果同步
  panel.find("#player-transition-effect").val(settings.transitionEffect);

  // 10. 图片循环禁用状态同步（随机模式下禁用）
  panel
    .find("#player-slideshow-mode")
    .prop("disabled", settings.playMode === "random");
};

// 带重试的AI/玩家事件监听注册（兼容老版本加载顺序）
const registerEventListenersWithRetry = () => {
  const maxRetries = 8;
  const retryDelay = 2000;
  let retries = 0;

  const tryRegister = () => {
    try {
      // 依赖检查：确保eventSource和event_types已加载（老版本核心依赖）
      if (
        !window.eventSource ||
        !window.event_types ||
        !window.event_types.MESSAGE_RECEIVED ||
        !window.event_types.MESSAGE_SENT
      ) {
        throw new Error(
          `依赖缺失: eventSource=${!!window.eventSource}, event_types=${!!window.event_types}`
        );
      }

      // 先解绑旧事件避免重复触发
      window.eventSource.off(window.event_types.MESSAGE_RECEIVED, onAIResponse);
      window.eventSource.off(window.event_types.MESSAGE_SENT, onPlayerMessage);

      // 1. AI回复事件注册
      window.eventSource.on(window.event_types.MESSAGE_RECEIVED, () => {
        const settings = getExtensionSettings();
        if (
          settings.enabled &&
          settings.autoSwitchMode === "detect" &&
          settings.aiDetectEnabled &&
          settings.isPlaying &&
          settings.isWindowVisible
        ) {
          onAIResponse();
        }
      });

      // 2. 玩家消息事件注册
      window.eventSource.on(window.event_types.MESSAGE_SENT, () => {
        const settings = getExtensionSettings();
        if (
          settings.enabled &&
          settings.autoSwitchMode === "detect" &&
          settings.playerDetectEnabled &&
          settings.isPlaying &&
          settings.isWindowVisible
        ) {
          onPlayerMessage();
        }
      });

      console.log(`[${EXTENSION_ID}] AI/玩家事件监听注册成功`);
      toastr.success("AI检测/玩家消息切换功能就绪");
    } catch (error) {
      retries++;
      if (retries < maxRetries) {
        console.warn(
          `[${EXTENSION_ID}] 事件监听注册失败（${retries}/${maxRetries}），原因：${error.message}，${retryDelay}ms后重试`
        );
        setTimeout(tryRegister, retryDelay);
      } else {
        console.error(`[${EXTENSION_ID}] 事件监听注册失败（已达最大重试次数）`);
        toastr.error("AI/玩家消息切换功能未启用，请刷新页面重试");
      }
    }
  };

  // 延迟5秒启动首次尝试（确保老版本核心脚本加载完成）
  setTimeout(tryRegister, 5000);
};

// 添加扩展菜单按钮
const addMenuButton = () => {
  const menuBtnId = `ext_menu_${EXTENSION_ID}`;
  if ($(`#${menuBtnId}`).length) return;

  const btnHtml = `
        <div id="${menuBtnId}" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-film"></div>
            <span>${EXTENSION_NAME}</span>
            <span class="play-status" style="margin-left:auto; font-size:10px; color:#a0a0a0;">${
              getExtensionSettings().isPlaying ? "播放中" : "已暂停"
            }</span>
            <span class="mode-text" style="margin-left:8px; font-size:10px; color:#a0a0a0;">${
              getExtensionSettings().playMode === "random" ? "随机" : "顺序"
            }</span>
        </div>
    `;
  $("#extensionsMenu").append(btnHtml);

  // 菜单按钮点击跳转设置面板
  $(`#${menuBtnId}`).on("click", () => {
    $("#extensions-settings-button").trigger("click");
    $(`#${SETTINGS_PANEL_ID}`).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });

  // 播放状态与模式实时更新
  setInterval(() => {
    const settings = getExtensionSettings();
    $(`#${menuBtnId} .play-status`).text(
      settings.isPlaying ? "播放中" : "已暂停"
    );
    $(`#${menuBtnId} .mode-text`).text(
      settings.playMode === "random" ? "随机" : "顺序"
    );
  }, 1000);
};

// 扩展核心初始化
const initExtension = async () => {
  const settings = getExtensionSettings();
  if (!settings.enabled) {
    console.log(`[${EXTENSION_ID}] 扩展当前禁用，3秒后重新检查`);
    setTimeout(initExtension, 3000);
    return;
  }

  try {
    console.log(`[${EXTENSION_ID}] 开始初始化媒体播放器扩展`);

    // 1. 初始化全局设置容器
    if (typeof window.extension_settings === "undefined") {
      window.extension_settings = {};
    }
    if (!window.extension_settings[EXTENSION_ID]) {
      window.extension_settings[EXTENSION_ID] = settings;
      saveSafeSettings();
      console.log(`[${EXTENSION_ID}] 初始化默认扩展设置`);
    }

    // 2. 基础组件创建
    addMenuButton();
    await createPlayerWindow();
    await createSettingsPanel();

    // 3. 实时通信与服务初始化
    initWebSocket();
    startPollingService();
    registerEventListenersWithRetry();

    // 4. 媒体列表初始化
    await refreshMediaList();
    if (mediaList.length > 0) {
      showMedia("current");
    } else {
      toastr.info(`未检测到媒体文件，请在设置中配置扫描目录`);
    }

    // 5. 初始状态校准
    settings.isPlaying = false;
    $(`#${PLAYER_WINDOW_ID} .play-pause i`)
      .removeClass("fa-pause")
      .addClass("fa-play");
    saveSafeSettings();

    console.log(`[${EXTENSION_ID}] 扩展初始化完成`);
    toastr.success(`${EXTENSION_NAME}扩展加载成功（点击播放按钮开始播放）`);
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 初始化错误:`, error);
    toastr.error(`扩展初始化失败: ${error.message}，1.5秒后重试`);
    setTimeout(initExtension, 1500);
  }
};

// 页面就绪触发初始化
jQuery(() => {
  console.log(`[${EXTENSION_ID}] 脚本开始加载（等待页面就绪）`);

  const initWhenReady = () => {
    if (
      document.readyState === "complete" ||
      document.readyState === "interactive"
    ) {
      initExtension();
    } else {
      $(document).on("ready", initExtension);
      setTimeout(initExtension, 1000);
    }
  };

  initWhenReady();
});

console.log(`[${EXTENSION_ID}] 脚本文件加载完成`);
