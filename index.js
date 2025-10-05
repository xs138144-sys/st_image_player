import {
  saveSettingsDebounced,
  eventSource as importedEventSource,
  event_types as importedEventTypes,
} from "../../../../script.js";
// 全局依赖直接使用导入的变量（老版本兼容，避免导入时机问题）
const EXTENSION_ID = "st_image_player";
const EXTENSION_NAME = "媒体播放器";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings";
const eventSource = importedEventSource || window.eventSource;
const event_types = importedEventTypes || window.event_types;
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

const getExtensionSettings = () => {
  // 关键修复：优先读取 SillyTavern 核心管理的全局设置（含本地存储）
  const globalSettings = getSafeGlobal("extension_settings", {});
  // 若全局设置中已有该扩展配置，直接返回（确保加载已保存的 enabled 状态）
  if (globalSettings[EXTENSION_ID]) {
    return globalSettings[EXTENSION_ID];
  }

  // 兜底机制：如果核心设置不可用，尝试从 localStorage 读取
  try {
    const key = `st_image_player_settings_${EXTENSION_ID}`;
    const storedSettings = localStorage.getItem(key);
    if (storedSettings) {
      const parsedSettings = JSON.parse(storedSettings);
      console.log(`[${EXTENSION_ID}] 从本地存储兜底读取设置`);
      return parsedSettings;
    }
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 本地存储兜底读取失败:`, error);
  }

  // 仅当完全无配置时，才创建默认设置（避免覆盖已保存状态）
  const defaultSettings = {
    masterEnabled: true, // 新增：总开关，控制整个扩展的启用/禁用
    enabled: true, // 播放器启用状态
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
    slideshowMode: false,
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
    isMediaLoading: false,
    currentRandomIndex: -1,
    showMediaUpdateToast: false,
    aiEventRegistered: false,
    filterTriggerSource: null,
  };

  // 将默认设置写入全局，供后续保存使用
  globalSettings[EXTENSION_ID] = defaultSettings;
  return defaultSettings;
};

const saveSafeSettings = () => {
  const saveFn = getSafeGlobal("saveSettingsDebounced", null);
  // 关键：通过 SillyTavern 核心函数保存设置到本地存储
  if (saveFn && typeof saveFn === "function") {
    saveFn();
    console.log(
      `[${EXTENSION_ID}] 设置已保存: enabled=${getExtensionSettings().enabled}`
    );
  } else {
    // 兜底机制：如果核心保存函数不可用，使用 localStorage 直接保存
    try {
      const settings = getExtensionSettings();
      const key = `st_image_player_settings_${EXTENSION_ID}`;
      localStorage.setItem(key, JSON.stringify(settings));
      console.log(`[${EXTENSION_ID}] 设置已保存到本地存储兜底`);
    } catch (error) {
      console.error(`[${EXTENSION_ID}] 本地存储兜底保存失败:`, error);
    }
  }
};

// 全局状态（沿用老版本简单管理）
let mediaList = [];
let currentMediaIndex = 0;
let switchTimer = null;
let slideshowTimer = null;



// 无边框模式下的控制栏自动隐藏/显示
function setupBorderlessModeInteractions() {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);

  if (settings.hideBorder) {
    // 无边框模式下：依赖CSS自动隐藏逻辑
    // CSS中已定义：.image-player-window.no-border .image-player-controls { opacity: 0; }
    // CSS中已定义：.image-player-window.no-border:hover .image-player-controls { opacity: 1; }
    // CSS中已定义：.image-player-window.no-border .toggle-border { opacity: 0; }
    // CSS中已定义：.image-player-window.no-border:hover .toggle-border { opacity: 1; }
    
    // 移除JavaScript中的冲突逻辑，让CSS生效
    win.off('mouseenter mouseleave');
  } else {
    // 有边框模式下，移除鼠标事件，控制栏和切换按钮始终显示
    win.off('mouseenter mouseleave');
    win.find('.image-player-controls').show();
    win.find('.toggle-border').show();
  }
}
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
let controlBarDrag = false;
let controlBarDragData = null;
let wsReconnectDelay = 10000;
let wsReconnectTimer = null;

const createMinimalSettingsPanel = () => {
  if ($(`#${SETTINGS_PANEL_ID}-minimal`).length) return;

  // 先获取设置
  const settings = getExtensionSettings();
  
  const html = `
    <div id="${SETTINGS_PANEL_ID}-minimal">
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
                <input type="checkbox" id="master-enabled-minimal" ${settings.masterEnabled ? 'checked' : ''} />
                <i class="fa-solid fa-power-off"></i>启用媒体播放器扩展
              </label>
            </div>
            <!-- 播放器开关 -->
            <div class="settings-row">
              <label class="checkbox_label" style="min-width:auto;">
                <input type="checkbox" class="toggle-player-enabled" ${settings.enabled ? 'checked' : ''} />
                <i class="fa-solid fa-play"></i>启用播放器
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  $("#extensions_settings").append(html);
  $(`#${SETTINGS_PANEL_ID}-minimal #master-enabled-minimal`).prop("checked", settings.masterEnabled);

  // 设置事件
  $(`#${SETTINGS_PANEL_ID}-minimal #master-enabled-minimal`).on(
    "change",
    function () {
      const settings = getExtensionSettings();
      settings.masterEnabled = $(this).prop("checked");
      settings.enabled = settings.masterEnabled; // 强制同步 enabled 字段

      console.log(`[${EXTENSION_ID}] 最小面板点击: masterEnabled=${settings.masterEnabled}, enabled=${settings.enabled}`);

      // 关键修复：强制同步到全局设置和本地存储
      if (window.extension_settings) {
        window.extension_settings[EXTENSION_ID] = settings;
        console.log(`[${EXTENSION_ID}] 全局设置强制同步完成:`, window.extension_settings[EXTENSION_ID]);
      }

      // 强制覆盖本地存储，避免旧数据覆盖新设置
      try {
        const key = `st_image_player_settings_${EXTENSION_ID}`;
        localStorage.setItem(key, JSON.stringify(settings));
        console.log(`[${EXTENSION_ID}] 本地存储强制覆盖完成`);
      } catch (error) {
        console.error(`[${EXTENSION_ID}] 本地存储覆盖失败:`, error);
      }

      saveSafeSettings();

      if (settings.masterEnabled) {
        console.log(`[${EXTENSION_ID}] 开始启用扩展，移除最小面板`);
        // 启用扩展：先移除最小面板，再延迟初始化确保状态同步
        $(`#${SETTINGS_PANEL_ID}-minimal`).remove();
        console.log(`[${EXTENSION_ID}] 最小面板已移除，延迟100ms调用initExtension`);

        // 关键修复：强制同步全局设置状态
        setTimeout(() => {
          // 再次确认状态同步
          const finalSettings = getExtensionSettings();
          console.log(`[${EXTENSION_ID}] 延迟结束，最终状态: masterEnabled=${finalSettings.masterEnabled}, enabled=${finalSettings.enabled}`);

          // 强制同步到全局设置
          if (window.extension_settings && window.extension_settings[EXTENSION_ID]) {
            window.extension_settings[EXTENSION_ID].masterEnabled = finalSettings.masterEnabled;
            window.extension_settings[EXTENSION_ID].enabled = finalSettings.enabled;
            console.log(`[${EXTENSION_ID}] 最终全局设置同步:`, window.extension_settings[EXTENSION_ID]);
          }

          console.log(`[${EXTENSION_ID}] 开始调用initExtension`);
          initExtension(); // 延迟初始化，确保状态已同步
        }, 100); // 延迟100ms
        toastr.success("媒体播放器扩展已启用");
      }
    }
  );

  // 播放器开关事件（单独绑定）
  $(`#${SETTINGS_PANEL_ID}-minimal .toggle-player-enabled`).on("change", function () {
    const settings = getExtensionSettings();
    settings.enabled = $(this).prop("checked");
    saveSafeSettings();

    // 显示状态提示
    toastr.success(`媒体播放器${settings.enabled ? "已启用" : "已关闭"}`);

    console.log(`[${EXTENSION_ID}] 播放器状态切换: enabled=${settings.enabled}`);
  });
};

const disableExtension = () => {
  // 停止所有定时器
  if (pollingTimer) clearTimeout(pollingTimer);
  if (switchTimer) clearTimeout(switchTimer);
  if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
  stopProgressUpdate();

  // 关闭WebSocket
  if (ws) {
    ws.close();
    ws = null;
  }

  // 隐藏播放器窗口和设置面板
  $(`#${PLAYER_WINDOW_ID}`).remove();
  $(`#${SETTINGS_PANEL_ID}`).remove();

  // 移除菜单按钮
  $(`#ext_menu_${EXTENSION_ID}`).remove();

  // 重置状态
  mediaList = [];
  currentMediaIndex = 0;
  serviceStatus = { active: false };

  // 创建最小化设置面板以便重新启用
  createMinimalSettingsPanel();
};

// ==================== API 通信（无修改，确保稳定） ====================
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

const refreshMediaList = async () => {
  const settings = getExtensionSettings();
  const oldListLength = mediaList.length;

  // 强制重新拉取媒体列表，避免缓存空列表
  mediaList = await fetchMediaList(settings.mediaFilter);
  settings.randomMediaList = [...mediaList];

  // 列表变化或为空时，重置索引并提示用户
  if (mediaList.length === 0) {
    currentMediaIndex = 0;
    settings.randomPlayedIndices = [];
    settings.currentRandomIndex = -1;
    toastr.warning("当前筛选无可用媒体，请检查目录或筛选条件");
  } else if (mediaList.length !== oldListLength) {
    currentMediaIndex = 0;
    settings.randomPlayedIndices = [];
    settings.currentRandomIndex = -1;
  }

  // 若正在播放，重新启动定时器（避免列表更新后停住）
  if (settings.isPlaying && settings.autoSwitchMode === "timer") {
    clearTimeout(switchTimer);
    startPlayback();
  }

  clearTimeout(switchTimer);
  return mediaList;
};

// ==================== WebSocket 通信（无修改） ====================
const initWebSocket = () => {
  const settings = getExtensionSettings();
  // 总开关禁用：不初始化WebSocket（核心修复）
  if (!settings.enabled || ws) return;

  try {
    const wsUrl =
      settings.serviceUrl.replace("http://", "ws://") + "/socket.io";
    ws = new WebSocket(wsUrl);
    console.log(`[${EXTENSION_ID}] 尝试连接WebSocket: ${wsUrl}`);

    ws.onopen = () => {
      console.log(`[${EXTENSION_ID}] WebSocket连接成功`);
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      refreshMediaList();
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "media_updated":
          serviceStatus.totalCount = data.total_count;
          serviceStatus.imageCount = data.image_count;
          serviceStatus.videoCount = data.video_count;
          await refreshMediaList();
          if (settings.showMediaUpdateToast) {
            toastr.info(
              `媒体库更新: 总计${data.total_count}（图片${data.image_count} | 视频${data.video_count}）`
            );
          }
          updateStatusDisplay();
          break;
        case "pong":
          break;
      }
    };

    ws.onclose = () => {
      console.log(`[${EXTENSION_ID}] WebSocket连接关闭`);
      ws = null;
      // 仅在启用时尝试重连
      if (settings.enabled) {
        wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
      }
    };

    ws.onerror = (e) => {
      console.error(`[${EXTENSION_ID}] WebSocket错误`, e);
      ws = null;
      // 仅在启用时尝试重连
      if (settings.enabled) {
        wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
      }
    };

    // 心跳检测（仅在启用时发送）
    setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && settings.enabled) {
        ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, 30000);
  } catch (e) {
    console.error(`[${EXTENSION_ID}] WebSocket初始化失败`, e);
    ws = null;
    // 仅在启用时尝试重连
    if (settings.enabled) {
      wsReconnectTimer = setTimeout(initWebSocket, wsReconnectDelay);
    }
  }
};

// ==================== 视频控制工具（无修改） ====================
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

const updateProgressBar = (progress) => {
  const settings = getExtensionSettings();
  if (!settings.customVideoControls.showProgress) return;
  progress = Math.max(0, Math.min(1, progress));
  $(`#${PLAYER_WINDOW_ID} .progress-played`).css("width", `${progress * 100}%`);
  $(`#${PLAYER_WINDOW_ID} .progress-handle`).css("left", `${progress * 100}%`);
};

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

const bindVideoControls = () => {
  const winSelector = `#${PLAYER_WINDOW_ID}`;
  const settings = getExtensionSettings();

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

  // 修复音量按钮事件绑定（使用直接绑定而非事件委托）
  $(winSelector).find(".volume-btn").off("click").on("click", function () {
    const settings = getExtensionSettings();
    const volume = $(winSelector).find(".volume-slider").val();
    updateVolume(volume > 0 ? 0 : settings.videoVolume);
  });

  // 修复循环按钮事件绑定（使用直接绑定而非事件委托）
  $(winSelector).find(".loop-btn").off("click").on("click", function () {
    const settings = getExtensionSettings();
    settings.videoLoop = !settings.videoLoop;
    saveSafeSettings();
    $(this).toggleClass("active", settings.videoLoop);
    $(`#${SETTINGS_PANEL_ID} #player-video-loop`).prop(
      "checked",
      settings.videoLoop
    );
    const video = $(winSelector).find(".image-player-video")[0];
    if (video) video.loop = settings.videoLoop;
    toastr.info(settings.videoLoop ? "视频循环已启用" : "视频循环已禁用");
  });

  $(document).off("mousedown", `${winSelector} .volume-slider`);
  $(document).on("mousedown", `${winSelector} .volume-slider`, () => {
    volumeDrag = true;
  });
};

// ==================== 播放器窗口（修复媒体筛选同步） ====================
const createPlayerWindow = async () => {
  const settings = getExtensionSettings();
  // 总开关禁用：不创建播放器窗口（核心修复）
  if (!settings.enabled || $(`#${PLAYER_WINDOW_ID}`).length) return;

  // （以下为原函数的HTML创建、事件绑定等逻辑，无需修改）
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
                        <i class="fa-solid ${settings.videoVolume > 0
        ? "fa-volume-high"
        : "fa-volume-mute"
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

  const html = `
        <div id="${PLAYER_WINDOW_ID}" class="image-player-window ${settings.hideBorder ? "no-border" : ""
    }">
            <div class="image-player-header">
                <div class="title"><i class="fa-solid fa-film"></i> ${EXTENSION_NAME}</div>
                <div class="window-controls">
                    <button class="lock"><i class="fa-solid ${settings.isLocked ? "fa-lock" : "fa-lock-open"}"></i></button>
                    <button class="toggle-info ${settings.showInfo ? "active" : ""}"><i class="fa-solid fa-circle-info"></i></button>
                    <button class="toggle-video-controls ${settings.showVideoControls ? "active" : ""}" title="${settings.showVideoControls ? "隐藏视频控制" : "显示视频控制"}">
                        <i class="fa-solid fa-video"></i>
                    </button>
                    <button class="hide"><i class="fa-solid fa-minus"></i></button>
                </div>
            </div>
            <div class="image-player-body">
                <div class="image-container">
                    <div class="loading-animation">加载中...</div>
                    <img class="image-player-img fade-transition" onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFAAH/l8iC5gAAAABJRU5ErkJggg=='" />
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
                        <i class="fa-solid ${settings.playMode === "random"
      ? "fa-shuffle"
      : "fa-list-ol"
    }"></i>
                    </button>
                    <button class="control-btn switch-mode-toggle ${settings.autoSwitchMode === "detect" ? "active" : ""
    }" title="${settings.autoSwitchMode === "detect" ? "检测播放" : "定时切换"
    }">
                        <i class="fa-solid ${settings.autoSwitchMode === "detect"
      ? "fa-robot"
      : "fa-clock"
    }"></i>
                    </button>

                </div>
                <div class="controls-group center">
                    <button class="control-btn prev" title="上一个"><i class="fa-solid fa-backward-step"></i></button>
                    <div class="control-text">${settings.playMode === "random"
      ? "随机模式"
      : "顺序模式: 0/0"
    }</div>
                    <button class="control-btn next" title="下一个"><i class="fa-solid fa-forward-step"></i></button>
                </div>
                <div class="controls-group right">
                    <div class="media-filter-group">
                        <button class="control-btn media-filter-btn" data-type="all" title="所有媒体">
                            <i class="fa-solid fa-film"></i>
                        </button>
                        <button class="control-btn media-filter-btn" data-type="image" title="仅图片">
                            <i class="fa-solid fa-image"></i>
                        </button>
                        <button class="control-btn media-filter-btn" data-type="video" title="仅视频">
                            <i class="fa-solid fa-video"></i>
                        </button>
                    </div>
                    <!-- 切换边框按钮 - 移到设置栏，跟随设置栏自动浮现隐藏 -->
                    <button class="control-btn toggle-border ${settings.hideBorder ? "active" : ""}" title="${settings.hideBorder ? "显示边框" : "隐藏边框"}">
                        <i class="fa-solid fa-border-none"></i>
                    </button>
                    <button class="control-btn transition-effect-toggle" title="过渡效果: ${settings.transitionEffect === 'none' ? '无效果' : 
      settings.transitionEffect === 'fade' ? '淡入淡出' :
      settings.transitionEffect === 'slide' ? '滑动' :
      settings.transitionEffect === 'zoom' ? '缩放' :
      settings.transitionEffect === 'drift' ? '动态漂移' :
      settings.transitionEffect === 'push' ? '推动' :
      settings.transitionEffect === 'rotate' ? '旋转' :
      settings.transitionEffect === 'bounce' ? '弹跳' :
      settings.transitionEffect === 'flip' ? '翻转' :
      '淡入缩放'}">
                        <i class="fa-solid fa-paint-brush"></i>
                    </button>
                    <button class="control-btn media-fit-toggle ${settings.mediaFitMode === 'fill' ? 'active' : ''
    }" title="${settings.mediaFitMode === 'fill' ? '填充模式' : '自适应模式'}">
                        <i class="fa-solid ${settings.mediaFitMode === 'fill' ? 'fa-expand' : 'fa-compress'
    }"></i>
                    </button>
                    <button class="control-btn toggle-controls-custom" title="自定义控制栏">
                        <i class="fa-solid fa-sliders"></i>
                    </button>
                </div>
            </div>
            <!-- 四边四角拉伸手柄 -->
            <div class="resize-handle top-left"></div>
            <div class="resize-handle top-right"></div>
            <div class="resize-handle bottom-left"></div>
            <div class="resize-handle bottom-right"></div>
            <div class="resize-handle top"></div>
            <div class="resize-handle bottom"></div>
            <div class="resize-handle left"></div>
            <div class="resize-handle right"></div>
        </div>
    `;

  $("body").append(html);
  setupWindowEvents();
  positionWindow();
  bindVideoControls();

  // 初始化筛选状态（修复同步）
  const filterBtn = $(
    `#${PLAYER_WINDOW_ID} .media-filter-btn[data-type="${settings.mediaFilter}"]`
  );
  filterBtn.addClass("active");

  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video) video.volume = settings.videoVolume;
  console.log(`[${EXTENSION_ID}] 播放器窗口创建完成`);
};

const positionWindow = () => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);

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

  if (settings.hideBorder) {
    // 无边框模式：依赖CSS自动隐藏逻辑
    // CSS中已定义：.image-player-window.no-border .image-player-controls { opacity: 0; }
    // CSS中已定义：.image-player-window.no-border:hover .image-player-controls { opacity: 1; }
    
    // 移除JavaScript中的冲突逻辑，让CSS生效
    const container = win.find(".image-container");
    container.off("mouseenter mouseleave");
  } else {
    // 有边框模式：控制栏正常显示，切换按钮始终显示在右上角
    if (settings.showVideoControls) {
      win.find(".video-controls").show();
    }
    // 确保切换按钮在有边框模式下正常显示且不自动隐藏
    win.find(".toggle-border").css({ opacity: 1 });
    
    // 移除有边框模式下的自动隐藏逻辑
    const container = win.find(".image-container");
    container.off("mouseenter mouseleave");
  }

  adjustVideoControlsLayout();
};

const adjustVideoControlsLayout = () => {
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const controlsHeight = win.find(".video-controls").outerHeight() || 40;
  win
    .find(".image-container")
    .css("height", `calc(100% - ${controlsHeight}px)`);
};

// 应用媒体自适应模式
const applyMediaFitMode = () => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const imgElement = win.find(".image-player-img")[0];
  const videoElement = win.find(".image-player-video")[0];

  if (settings.mediaFitMode === "fill") {
    // 填充模式：媒体填充整个容器
    $(imgElement).css({
      "object-fit": "fill",
      "width": "100%",
      "height": "100%"
    });
    $(videoElement).css({
      "object-fit": "fill",
      "width": "100%",
      "height": "100%"
    });
  } else {
    // 自适应模式（默认）：保持比例自适应
    $(imgElement).css({
      "object-fit": "contain",
      "max-width": "100%",
      "max-height": "100%"
    });
    $(videoElement).css({
      "object-fit": "contain",
      "max-width": "100%",
      "max-height": "100%"
    });
  }
};

const setupWindowEvents = () => {
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const header = win.find(".image-player-header")[0];
  const resizeHandle = win.find(".resize-handle")[0];
  const settings = getExtensionSettings();
  const panel = $(`#${SETTINGS_PANEL_ID}`);
  const menuBtn = $(`#ext_menu_${EXTENSION_ID}`);

  // 1. 窗口拖拽
  header.addEventListener("mousedown", (e) => {
    if (settings.isLocked || settings.hideBorder) return;
    dragData = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: win.offset().left,
      startTop: win.offset().top,
    };
  });

  // 2. 窗口调整大小（四边四角拉伸）
  const resizeHandles = win.find(".resize-handle");
  resizeHandles.each(function () {
    this.addEventListener("mousedown", (e) => {
      if (settings.isLocked || settings.hideBorder) return;
      e.preventDefault();
      const handleClass = this.className;
      const isTop = handleClass.includes("top");
      const isBottom = handleClass.includes("bottom");
      const isLeft = handleClass.includes("left");
      const isRight = handleClass.includes("right");

      resizeData = {
        startX: e.clientX,
        startY: e.clientY,
        startWidth: win.width(),
        startHeight: win.height(),
        startLeft: win.offset().left,
        startTop: win.offset().top,
        isTop: isTop,
        isBottom: isBottom,
        isLeft: isLeft,
        isRight: isRight
      };
    });
  });

  // 3. 全局鼠标移动
  document.addEventListener("mousemove", (e) => {
    if (dragData) {
      const diffX = e.clientX - dragData.startX;
      const diffY = e.clientY - dragData.startY;
      win.css({
        left: `${dragData.startLeft + diffX}px`,
        top: `${dragData.startTop + diffY}px`,
      });
    }

    if (resizeData) {
      const diffX = e.clientX - resizeData.startX;
      const diffY = e.clientY - resizeData.startY;

      let newWidth = resizeData.startWidth;
      let newHeight = resizeData.startHeight;
      let newLeft = resizeData.startLeft;
      let newTop = resizeData.startTop;

      // 四边四角拉伸逻辑
      if (resizeData.isLeft) {
        newWidth = Math.max(300, resizeData.startWidth - diffX);
        newLeft = resizeData.startLeft + diffX;
      } else if (resizeData.isRight) {
        newWidth = Math.max(300, resizeData.startWidth + diffX);
      }

      if (resizeData.isTop) {
        newHeight = Math.max(200, resizeData.startHeight - diffY);
        newTop = resizeData.startTop + diffY;
      } else if (resizeData.isBottom) {
        newHeight = Math.max(200, resizeData.startHeight + diffY);
      }

      win.css({
        width: `${newWidth}px`,
        height: `${newHeight}px`,
        left: `${newLeft}px`,
        top: `${newTop}px`
      });
      adjustVideoControlsLayout();
      applyMediaFitMode(); // 窗口调整大小时重新应用媒体自适应模式
    }
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
    if (volumeDrag && settings.customVideoControls.showVolume) {
      const slider = win.find(".volume-slider")[0];
      const rect = slider.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const volume = clickX / rect.width;
      updateVolume(volume);
    }
  });

  // 4. 全局鼠标松开
  document.addEventListener("mouseup", () => {
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

    if (progressDrag && settings.customVideoControls.showProgress) {
      const video = win.find(".image-player-video")[0];
      if (video && settings.isPlaying && video.paused) {
        video.play().catch((err) => console.warn("视频播放失败:", err));
      }
    }
    progressDrag = false;
    volumeDrag = false;
  });

  // 5. 锁定按钮
  win.find(".lock").on("click", function () {
    settings.isLocked = !settings.isLocked;
    saveSafeSettings();
    $(this).find("i").toggleClass("fa-lock fa-lock-open");
    win.toggleClass("locked");
    toastr.info(`窗口已${settings.isLocked ? "锁定" : "解锁"}`);
  });

  // 6. 播放/暂停按钮
  win.find(".play-pause").on("click", function () {
    const oldIsPlaying = settings.isPlaying;
    settings.isPlaying = !oldIsPlaying;
    saveSafeSettings();
    const icon = $(this).find("i");
    icon.toggleClass("fa-play fa-pause");
    const video = win.find(".image-player-video")[0];
    const isVideoVisible = video && video.style.display !== "none";
    if (!settings.isPlaying) {
      clearTimeout(switchTimer);
      stopProgressUpdate();
      if (isVideoVisible && !video.paused) {
        video.pause();
      }
      win.find(".control-text").text("已暂停");
    } else {
      if (isVideoVisible) {
        video.play().catch((err) => {
          console.warn("视频自动播放失败（浏览器限制）:", err);
          toastr.warning("请点击视频手动播放");
        });
        startProgressUpdate();
      } else {
        clearTimeout(switchTimer);
        startPlayback();
      }
      win.find(".control-text").text("播放中");
    }
  });

  // 7. 播放模式切换（删除外部重复代码，此处逻辑完整）
  win.find(".mode-switch").on("click", function () {
    settings.playMode =
      settings.playMode === "random" ? "sequential" : "random";
    saveSafeSettings();
    const icon = $(this).find("i");
    icon.toggleClass("fa-shuffle fa-list-ol");
    if (settings.playMode === "random") {
      settings.randomMediaList = [...mediaList];
      settings.randomPlayedIndices = [];
      settings.currentRandomIndex = -1;
      toastr.info("切换为随机播放模式");
    } else {
      currentMediaIndex = 0;
      toastr.info("切换为顺序播放模式");
    }
    showMedia("current");
    updateExtensionMenu();
  });

  // 8. 媒体信息显示切换
  win.find(".toggle-info").on("click", function () {
    settings.showInfo = !settings.showInfo;
    saveSafeSettings();
    $(this).toggleClass("active", settings.showInfo);
    win.find(".image-info").toggle(settings.showInfo);
    updateExtensionMenu();
  });

  // 9. 视频控制栏显示切换
  win.find(".toggle-video-controls").on("click", function () {
    settings.showVideoControls = !settings.showVideoControls;
    saveSafeSettings();
    $(this).toggleClass("active", settings.showVideoControls);
    win.find(".video-controls").toggle(settings.showVideoControls);
    adjustVideoControlsLayout();
    $(`#${SETTINGS_PANEL_ID} #player-show-video-controls`).prop(
      "checked",
      settings.showVideoControls
    );
    updateExtensionMenu();
  });

  // 10. 底部控制栏拖拽移动播放器窗口（使用与标题栏相同的拖拽逻辑）
  win.find(".image-player-controls").on("mousedown", function (e) {
    if (settings.isLocked || settings.hideBorder) return;
    // 排除按钮点击，只响应控制栏空白区域拖拽
    if ($(e.target).is("button, .control-btn, .media-filter-btn, .progress-bar, .volume-slider, .volume-btn, .loop-btn, .time-display")) return;

    e.preventDefault();
    dragData = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: win.offset().left,
      startTop: win.offset().top,
    };
  });

  // 11. 媒体自适应模式切换
  win.find(".media-fit-toggle").on("click", function () {
    settings.mediaFitMode = settings.mediaFitMode === "contain" ? "fill" : "contain";
    saveSafeSettings();
    $(this).toggleClass("active", settings.mediaFitMode === "fill");
    $(this).attr("title", settings.mediaFitMode === "fill" ? "填充模式" : "自适应模式");
    $(this).find("i")
      .toggleClass("fa-expand", settings.mediaFitMode === "fill")
      .toggleClass("fa-compress", settings.mediaFitMode === "contain");
    applyMediaFitMode();
    toastr.info(`已切换到${settings.mediaFitMode === "fill" ? "填充" : "自适应"}模式`);
  });

  // 12. 无边框模式切换
  win.find(".toggle-border").on("click", function () {
    const settings = getExtensionSettings();
    settings.hideBorder = !settings.hideBorder;
    saveSafeSettings();
    $(this).toggleClass("active", settings.hideBorder);
    $(this).attr("title", settings.hideBorder ? "显示边框" : "隐藏边框");
    $(`#${PLAYER_WINDOW_ID}`).toggleClass("no-border", settings.hideBorder);
    setupBorderlessModeInteractions(); // 初始化无边框模式交互
    toastr.info(settings.hideBorder ? "已切换到无边框模式" : "已显示边框");
  });

  // 13. 控制栏自定义设置切换
  win.find(".toggle-controls-custom").on("click", function () {
    const settings = getExtensionSettings();
    settings.customVideoControls.showProgress = !settings.customVideoControls.showProgress;
    settings.customVideoControls.showVolume = !settings.customVideoControls.showVolume;
    settings.customVideoControls.showLoop = !settings.customVideoControls.showLoop;
    settings.customVideoControls.showTime = !settings.customVideoControls.showTime;
    saveSafeSettings();
    bindVideoControls();
    toastr.info("控制栏自定义设置已更新");
    // 应用控制栏自定义设置
    applyCustomControlsSettings();
  });

  // 14. 隐藏窗口
  win.find(".hide").on("click", function () {
    const settings = getExtensionSettings();
    win.hide();
    settings.isWindowVisible = false;
    saveSafeSettings();
    const video = win.find(".image-player-video")[0];
    if (video) video.pause();
    stopProgressUpdate();
    clearTimeout(switchTimer);
  });

  // 15. 上一个/下一个
  win.find(".prev").on("click", () => {
    const settings = getExtensionSettings();
    if (settings.isMediaLoading) return;
    clearTimeout(switchTimer);
    const video = win.find(".image-player-video")[0];
    if (video) {
      video.pause();
      stopProgressUpdate();
    }
    showMedia("prev");
  });
  win.find(".next").on("click", () => {
    const settings = getExtensionSettings();
    if (settings.isMediaLoading) return;
    clearTimeout(switchTimer);
    const video = win.find(".image-player-video")[0];
    if (video) {
      video.pause();
      stopProgressUpdate();
    }
    showMedia("next");
  });

  // 16. 切换模式（AI检测/定时）
  win.find(".switch-mode-toggle").on("click", function () {
    const settings = getExtensionSettings();
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
    const video = win.find(".image-player-video")[0];
    if (video) video.pause();
    stopProgressUpdate();
    clearTimeout(switchTimer);
    if (settings.isPlaying && settings.autoSwitchMode === "timer") {
      startPlayback();
    }
    updateExtensionMenu();
  });

  // 17. 播放器过渡效果切换
  win.find(".transition-effect-toggle").on("click", function (e) {
    e.stopPropagation();
    showTransitionEffectPanel();
  });

  // 18. 播放器媒体筛选
  win.find(".media-filter-btn").on("click", function (e) {
    e.stopPropagation();
    const filterType = $(this).data("type");
    const settings = getExtensionSettings();

    // 直接更新筛选状态，不限制触发源（关键修复）
    settings.mediaFilter = filterType;
    saveSafeSettings();

    // 同步播放器按钮状态
    win.find(".media-filter-btn").removeClass("active");
    $(this).addClass("active");

    // 刷新媒体列表并同步到面板和菜单
    refreshMediaList().then(() => {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      settings.currentRandomIndex = -1;
      showMedia("current");
      // 同步面板下拉框
      panel.find("#player-media-filter").val(filterType);
      // 同步菜单筛选文本
      menuBtn
        .find(".filter-text")
        .text(
          filterType === "all"
            ? "所有"
            : filterType === "image"
              ? "图片"
              : "视频"
        );
      updateExtensionMenu();
    });
  });

  // 18. 视频事件监听（逻辑完整，无占位符）
  const video = win.find(".image-player-video")[0];
  if (video) {
    video.addEventListener("loadedmetadata", () => {
      if (settings.customVideoControls.showTime) {
        win.find(".total-time").text(formatTime(video.duration));
      }
      win.find(".progress-loaded").css("width", "0%");
    });

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

    video.addEventListener("ended", () => {
      if (settings.customVideoControls.showProgress) {
        updateProgressBar(0);
        win.find(".current-time").text("00:00");
      }
      // 仅定时模式+未开循环+播放中，才自动切换
      if (
        settings.isPlaying &&
        !settings.videoLoop &&
        settings.autoSwitchMode === "timer"
      ) {
        showMedia("next");
      }
      // AI模式：回到开头等待切换
      else if (settings.isPlaying && settings.autoSwitchMode === "detect") {
        video.currentTime = 0;
        video
          .play()
          .catch((err) => console.warn("AI模式下视频重新播放失败:", err));
      }
    });
  }
}; // 函数仅此处闭合，无提前或重复闭合

// ==================== 播放控制（修复图片播放停住） ====================
// 替换 index.js 中的 startPlayback 函数（约第 1290-1320 行）
const startPlayback = () => {
  const settings = getExtensionSettings();
  // 严格前置判断：排除无效状态，避免定时器残留
  if (
    !settings.enabled ||
    !settings.isPlaying ||
    settings.autoSwitchMode !== "timer"
  ) {
    clearTimeout(switchTimer);
    return;
  }

  const win = $(`#${PLAYER_WINDOW_ID}`);
  const video = win.find(".image-player-video")[0];
  const isVideoVisible = video && video.style.display !== "none";

  // 核心：无论视频/图片，先清除旧定时器，再执行逻辑（避免叠加）
  clearTimeout(switchTimer);

  // 视频播放逻辑（不变，确保定时器续期）
  if (isVideoVisible) {
    if (video.paused) {
      video.play().catch((err) => {
        console.warn("视频自动播放失败:", err);
        toastr.warning("请点击视频手动播放");
      });
      startProgressUpdate();
    }
    // 强制续设定时器（即使视频播放异常，也不中断定时逻辑）
    switchTimer = setTimeout(startPlayback, settings.switchInterval);
    return;
  }

  // 图片播放逻辑：用“立即执行函数+强制定时器”确保不中断
  (async () => {
    try {
      await showMedia("next");
      console.log(`[${EXTENSION_ID}] 图片切换成功`);

      // 关键修复：定时器续期必须在异步操作完成后执行
      if (
        settings.enabled &&
        settings.isPlaying &&
        settings.autoSwitchMode === "timer"
      ) {
        const delay = Math.max(1000, settings.switchInterval);
        switchTimer = setTimeout(startPlayback, delay);
        console.log(`[${EXTENSION_ID}] 定时器续期: ${delay}ms`);
      }
    } catch (err) {
      console.error(`[${EXTENSION_ID}] 图片切换失败，重试当前媒体`, err);
      // 失败时强制显示当前媒体，避免空白
      if (settings.isPlaying) await showMedia("current");
    }
  })();
};
// 修复随机索引管理：确保始终有可用索引
const getRandomMediaIndex = () => {
  const settings = getExtensionSettings();
  const list = settings.randomMediaList || [];
  if (list.length === 0) return 0; // 空列表兜底

  // 所有媒体播放过：强制重置已播放索引（核心修复）
  if (settings.randomPlayedIndices.length >= list.length) {
    settings.randomPlayedIndices = [];
    toastr.info("随机播放列表已循环，重新开始"); // 可选：提示用户
  }

  // 筛选可用索引（排除已播放）
  let availableIndices = list
    .map((_, i) => i)
    .filter((i) => !settings.randomPlayedIndices.includes(i));

  // 极端情况：索引筛选为空时强制重置（避免死循环）
  if (availableIndices.length === 0) {
    settings.randomPlayedIndices = [];
    availableIndices = list.map((_, i) => i);
  }

  // 随机选择索引并记录
  const randomIndex =
    availableIndices[Math.floor(Math.random() * availableIndices.length)];
  settings.currentRandomIndex = randomIndex;
  settings.randomPlayedIndices.push(randomIndex); // 记录已播放，避免重复
  return randomIndex;
};

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

const applyTransitionEffect = (imgElement, effect) => {
  if (!imgElement || !imgElement.classList) {
    console.warn(`[${EXTENSION_ID}] applyTransitionEffect: imgElement无效`, imgElement);
    return;
  }
  
  imgElement.classList.remove(
    "fade-transition",
    "slide-transition",
    "zoom-transition",
    "drift-transition",
    "push-transition",
    "rotate-transition",
    "bounce-transition",
    "flip-transition",
    "fade-scale-transition",
    "show"
  );
  if (effect !== "none") {
    imgElement.classList.add(`${effect}-transition`);
  }
};

// 加载控制栏自定义设置
const loadCustomControlsSettings = () => {
  const settings = getExtensionSettings();
  console.log(`[${EXTENSION_ID}] 加载控制栏自定义设置:`, settings.customVideoControls);
  applyCustomControlsSettings();
};

// 应用控制栏自定义设置
const applyCustomControlsSettings = () => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);

  // 应用进度条显示/隐藏
  if (settings.customVideoControls.showProgress) {
    win.find(".progress-container").show();
  } else {
    win.find(".progress-container").hide();
  }

  // 应用音量控制显示/隐藏
  if (settings.customVideoControls.showVolume) {
    win.find(".volume-container").show();
  } else {
    win.find(".volume-container").hide();
  }

  // 应用循环按钮显示/隐藏
  if (settings.customVideoControls.showLoop) {
    win.find(".loop-btn").show();
  } else {
    win.find(".loop-btn").hide();
  }

  // 应用时间戳显示/隐藏
  if (settings.customVideoControls.showTime) {
    win.find(".time-display").show();
  } else {
    win.find(".time-display").hide();
  }

  console.log(`[${EXTENSION_ID}] 控制栏自定义设置已应用`);
};

const showMedia = async (direction) => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const imgElement = win.find(".image-player-img")[0];
  const videoElement = win.find(".image-player-video")[0];
  const loadingElement = win.find(".loading-animation")[0];
  const infoElement = win.find(".image-info")[0];

  if (settings.isMediaLoading) {
    console.log(`[${EXTENSION_ID}] 媒体加载中，跳过重复调用`);
    return Promise.resolve();
  }
  settings.isMediaLoading = true;

  if (
    settings.playMode === "sequential" &&
    settings.slideshowMode &&
    settings.autoSwitchMode === "timer" && // 新增：仅定时模式生效
    mediaList.length > 0
  ) {
    if (direction === "next" && currentMediaIndex >= mediaList.length - 1) {
      currentMediaIndex = 0;
    } else if (direction === "prev" && currentMediaIndex <= 0) {
      currentMediaIndex = mediaList.length - 1;
    }
  }

  try {
    if (switchTimer) clearTimeout(switchTimer);
    win.find(".control-text").text("加载中...");

    win.find(".control-text").text("加载中...");
    $(imgElement).hide();
    $(videoElement).hide();
    $(loadingElement).show();

    const status = await checkServiceStatus();
    if (!status.active) throw new Error("媒体服务未连接");

    let mediaUrl, mediaName, mediaType;
    const filterType = settings.mediaFilter;

    if (settings.playMode === "random") {
      if (settings.randomMediaList.length === 0) {
        settings.randomMediaList = await fetchMediaList(filterType);
        settings.randomPlayedIndices = [];
        settings.currentRandomIndex = -1;
      }

      let randomIndex = -1;
      if (direction === "next") {
        randomIndex = getRandomMediaIndex();
        settings.randomPlayedIndices.push(randomIndex);
      } else if (direction === "prev") {
        if (settings.randomPlayedIndices.length > 1) {
          settings.randomPlayedIndices.pop();
          randomIndex = settings.randomPlayedIndices.pop();
          settings.randomPlayedIndices.push(randomIndex);
          settings.currentRandomIndex = randomIndex;
        } else {
          randomIndex = settings.randomPlayedIndices[0] || 0;
        }
      } else if (direction === "current") {
        randomIndex =
          settings.currentRandomIndex !== -1
            ? settings.currentRandomIndex
            : getRandomMediaIndex();
      }

      if (randomIndex < 0 || randomIndex >= settings.randomMediaList.length) {
        randomIndex = 0;
        settings.currentRandomIndex = 0;
      }

      const media = settings.randomMediaList[randomIndex];
      mediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
        media.rel_path
      )}`;
      mediaName = media.name;
      mediaType = media.media_type;
    } else {
      if (mediaList.length === 0) {
        mediaList = await fetchMediaList(filterType);
      }
      if (mediaList.length === 0) throw new Error("无可用媒体");

      if (direction === "next") {
        currentMediaIndex = (currentMediaIndex + 1) % mediaList.length;
      } else if (direction === "prev") {
        currentMediaIndex =
          (currentMediaIndex - 1 + mediaList.length) % mediaList.length;
      } else if (direction === "current") {
        currentMediaIndex = Math.max(
          0,
          Math.min(currentMediaIndex, mediaList.length - 1)
        );
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

    if (mediaType === "image") {
      // 先隐藏图片，应用过渡效果
      $(imgElement).hide();
      applyTransitionEffect(imgElement, settings.transitionEffect);
      
      // 使用新的Image对象加载图片，确保事件能正确触发
      await new Promise((resolve, reject) => {
        const tempImg = new Image();
        tempImg.onload = () => {
          $(imgElement).attr("src", mediaUrl);
          // 延迟显示以触发过渡效果
          setTimeout(() => {
            $(imgElement).show();
            // 添加show类触发过渡动画
            imgElement.classList.add("show");
            resolve();
          }, 50);
        };
        tempImg.onerror = () => {
          console.error("图片加载失败:", mediaUrl);
          $(imgElement).attr("src", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFAAH/l8iC5gAAAABJRU5ErkJggg==");
          setTimeout(() => {
            $(imgElement).show();
            imgElement.classList.add("show");
            resolve();
          }, 50);
        };
        tempImg.src = mediaUrl;
      });
      
      $(videoElement).hide();
    } else if (mediaType === "video") {
      videoElement.currentTime = 0;
      videoElement.loop = settings.videoLoop;
      $(videoElement).attr("src", mediaUrl).show();

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

    if (settings.showInfo) {
      $(infoElement).text(`${mediaName}(${mediaType})`).show();
    } else {
      $(infoElement).hide();
    }

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
        `${settings.playMode === "random" ? "随机模式" : "顺序模式"
        }: ${currentCount}/${totalCount}(${mediaType})`
      );

    // 媒体加载完成后应用自适应模式
    applyMediaFitMode();

    retryCount = 0;
    
    // 增强预加载：预加载接下来3张图片
    const preloadUrls = [];
    const preloadTypes = [];
    
    if (settings.playMode === "random") {
      // 随机模式：预加载接下来3个随机索引
      for (let i = 0; i < 3; i++) {
        const nextIndex = getRandomMediaIndex();
        if (nextIndex >= 0 && nextIndex < settings.randomMediaList.length) {
          const nextMedia = settings.randomMediaList[nextIndex];
          preloadUrls.push(`${settings.serviceUrl}/file/${encodeURIComponent(
            nextMedia.rel_path
          )}`);
          preloadTypes.push(nextMedia.media_type);
        }
      }
    } else {
      // 顺序模式：预加载接下来3张图片
      for (let i = 1; i <= 3; i++) {
        const nextIndex = (currentMediaIndex + i) % mediaList.length;
        const nextMedia = mediaList[nextIndex];
        preloadUrls.push(`${settings.serviceUrl}/file/${encodeURIComponent(
          nextMedia.rel_path
        )}`);
        preloadTypes.push(nextMedia.media_type);
      }
    }

    // 并行预加载多张图片
    if (preloadUrls.length > 0) {
      const preloadPromises = preloadUrls.map((url, index) => 
        preloadMediaItem(url, preloadTypes[index])
      );
      
      try {
        const preloadedResults = await Promise.allSettled(preloadPromises);
        let successCount = 0;
        
        preloadedResults.forEach((result, index) => {
          if (result.status === "fulfilled" && result.value) {
            successCount++;
            console.log(`[${EXTENSION_ID}] 预加载成功: ${preloadUrls[index]}`);
          } else {
            console.warn(`[${EXTENSION_ID}] 预加载失败: ${preloadUrls[index]}`);
          }
        });
        
        console.log(`[${EXTENSION_ID}] 预加载完成: ${successCount}/${preloadUrls.length} 成功`);
        
        // 主预加载对象设为第一张预加载图片
        preloadedMedia = preloadedResults[0].status === "fulfilled" ? preloadedResults[0].value : null;
        
      } catch (e) {
        console.warn(`[${EXTENSION_ID}] 预加载过程中出错:`, e);
        preloadedMedia = null;
      }
    }

    return Promise.resolve();
  } catch (e) {
    console.error(`[${EXTENSION_ID}] 加载媒体失败`, e);
    let errorMsg = "媒体加载失败";
    if (e.message.includes("Failed to fetch")) errorMsg = "服务连接失败";
    else if (e.message.includes("404")) errorMsg = "媒体文件不存在";
    else if (e.message.includes("无可用媒体"))
      errorMsg = `无可用${filterType === "all" ? "媒体" : filterType}文件`;

    if (retryCount < 3 && settings.enabled) {
      retryCount++;
      toastr.warning(`${errorMsg}，重试中（${retryCount}/3)`);
      setTimeout(() => showMedia(direction), 3000);
    } else {
      toastr.error(`${errorMsg}，已停止重试`);
      win.find(".control-text").text("加载失败");
      $(loadingElement).hide();
    }

    return Promise.reject(e);
  } finally {
    settings.isMediaLoading = false;
  }
};

// ==================== AI/玩家消息检测（无修改） ====================
const onAIResponse = () => {
  console.log(`[${EXTENSION_ID}] 检测到AI回复事件触发(来自SillyTavern)`); // 新增日志
  const settings = getExtensionSettings();
  if (!settings.enabled || settings.isMediaLoading) return;

  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video && video.style.display !== "none" && settings.videoLoop) {
    console.log(`[${EXTENSION_ID}] 视频循环中,跳过AI切换`);
    return;
  }

  if (
    settings.autoSwitchMode !== "detect" ||
    !settings.aiDetectEnabled ||
    !settings.isWindowVisible
  ) {
    return;
  }

  const now = performance.now();
  if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) {
    return;
  }

  settings.lastAISwitchTime = now;
  saveSafeSettings();
  showMedia("next");
  console.log(`[${EXTENSION_ID}] AI回复触发媒体切换`);
};

const onPlayerMessage = () => {
  const settings = getExtensionSettings();
  if (!settings.enabled || settings.isMediaLoading) return;

  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video && video.style.display !== "none" && settings.videoLoop) {
    console.log(`[${EXTENSION_ID}] 视频循环中，跳过玩家切换`);
    return;
  }

  if (
    settings.autoSwitchMode !== "detect" ||
    !settings.playerDetectEnabled ||
    !settings.isWindowVisible
  ) {
    return;
  }

  const now = performance.now();
  if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) {
    return;
  }

  settings.lastAISwitchTime = now;
  saveSafeSettings();
  showMedia("next");
  console.log(`[${EXTENSION_ID}] 玩家消息触发媒体切换`);
};

// ==================== 服务轮询（无修改） ====================
const startPollingService = () => {
  const settings = getExtensionSettings();
  // 总开关禁用：停止轮询并清理定时器（核心修复）
  if (!settings.enabled) {
    if (pollingTimer) clearTimeout(pollingTimer);
    return;
  }

  // 清除旧定时器，避免叠加
  if (pollingTimer) clearTimeout(pollingTimer);

  const poll = async () => {
    try {
      const prevCount = serviceStatus.totalCount;
      await checkServiceStatus();
      // 媒体数量变化时刷新列表
      if (serviceStatus.totalCount !== prevCount) {
        await refreshMediaList();
        if (settings.showMediaUpdateToast) {
          toastr.info(
            `媒体库更新: 总计${serviceStatus.totalCount}（图片${serviceStatus.imageCount} | 视频${serviceStatus.videoCount}）`
          );
        }
        updateStatusDisplay();
      }
    } catch (e) {
      console.error(`[${EXTENSION_ID}] 服务轮询失败`, e);
    } finally {
      // 仅在启用时续设定时器
      if (settings.enabled) {
        pollingTimer = setTimeout(poll, settings.pollingInterval);
      }
    }
  };

  poll();
};

// ==================== 设置面板（修复状态同步） ====================
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

const createSettingsPanel = async () => {
  const settings = getExtensionSettings();
  // 总开关禁用：不创建设置面板（核心修复）
  if (!settings.masterEnabled || $(`#${SETTINGS_PANEL_ID}`).length) return;

  await checkServiceStatus();
  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const observerStatus = serviceStatus.observerActive ? "已启用" : "已禁用";
  const statusText = `${serviceActive}（监控: ${observerStatus} | 总计: ${serviceStatus.totalCount} | 图片: ${serviceStatus.imageCount} | 视频: ${serviceStatus.videoCount}）`;

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
                <input type="checkbox" id="master-enabled" ${settings.masterEnabled ? "checked" : ""
    } />
                <i class="fa-solid fa-power-off"></i>启用媒体播放器扩展
              </label>
            </div>
            
            <!-- 播放器开关 -->
            <div class="settings-row">
              <label class="checkbox_label" style="min-width:auto;">
                <input type="checkbox" id="extension-enabled" ${settings.enabled ? "checked" : ""
    } />
                <i class="fa-solid fa-play"></i>启用播放器
              </label>
            </div>
                        
                        <!-- 服务状态 -->
                        <div class="settings-row">
                            <label class="service-status">
                                <i class="fa-solid ${serviceStatus.active
      ? "fa-plug-circle-check"
      : "fa-plug"
    }"></i>
                                服务状态: <span class="${serviceStatus.active
      ? "status-success"
      : "status-error"
    }">${statusText}</span>
                            </label>
                        </div>
                        
                        <!-- 基础配置 -->
                        <div class="settings-row">
                            <label><i class="fa-solid fa-link"></i>服务地址</label>
                            <input type="text" id="player-service-url" value="${settings.serviceUrl
    }" placeholder="http://localhost:9000" />
                        </div>
                        
                        <div class="settings-row">
                            <label><i class="fa-solid fa-folder"></i>媒体目录</label>
                            <input type="text" id="player-scan-directory" value="${settings.serviceDirectory ||
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
                                <input type="number" id="image-max-size" value="${settings.mediaConfig?.image_max_size_mb || 5
    }" min="1" max="50" step="1" />
                                <span>MB</span>
                                
                                <label><i class="fa-solid fa-video"></i>视频最大尺寸</label>
                                <input type="number" id="video-max-size" value="${settings.mediaConfig?.video_max_size_mb || 100
    }" min="10" max="500" step="10" />
                                <span>MB</span>
                                
                                <button id="update-size-limit" class="menu-button">应用限制</button>
                            </div>
                        </div>
                        
                        <!-- 媒体更新提示开关 -->
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="show-media-update-toast" ${settings.showMediaUpdateToast ? "checked" : ""
    } />
                                <i class="fa-solid fa-bell"></i>显示媒体库更新提示
                            </label>
                        </div>
                        
                        <!-- 边框隐藏 -->
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-hide-border" ${settings.hideBorder ? "checked" : ""
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
                                    <input type="checkbox" id="custom-show-progress" ${settings.customVideoControls.showProgress
      ? "checked"
      : ""
    } />
                                    显示进度条
                                </label>
                                <label class="checkbox_label">
                                    <input type="checkbox" id="custom-show-volume" ${settings.customVideoControls.showVolume
      ? "checked"
      : ""
    } />
                                    显示音量控制
                                </label>
                                <label class="checkbox_label">
                                    <input type="checkbox" id="custom-show-loop" ${settings.customVideoControls.showLoop
      ? "checked"
      : ""
    } />
                                    显示循环按钮
                                </label>
                                <label class="checkbox_label">
                                    <input type="checkbox" id="custom-show-time" ${settings.customVideoControls.showTime
      ? "checked"
      : ""
    } />
                                    显示时间戳
                                </label>
                            </div>
                        </div>
                        
                        <!-- 播放模式切换 -->
                        <div class="function-toggle-group">
                            <div class="function-toggle ${settings.autoSwitchMode === "timer"
      ? "active"
      : ""
    }" id="toggle-timer-mode">
                                <i class="fa-solid fa-clock"></i>
                                <span>定时播放</span>
                            </div>
                            <div class="function-toggle ${settings.autoSwitchMode === "detect"
      ? "active"
      : ""
    }" id="toggle-detect-mode">
                                <i class="fa-solid fa-robot"></i>
                                <span>检测播放</span>
                            </div>
                        </div>
                        
                        <!-- 检测模式子选项 -->
                        <div class="settings-group" ${settings.autoSwitchMode !== "detect"
      ? 'style="display:none;"'
      : ""
    } id="detect-sub-options">
                            <div class="settings-row">
                                <label class="checkbox_label">
                                    <input type="checkbox" id="player-ai-detect" ${settings.aiDetectEnabled ? "checked" : ""
    } />
                                    <i class="fa-solid fa-comment-dots"></i>AI回复时切换
                                </label>
                                <label class="checkbox_label">
                                    <input type="checkbox" id="player-player-detect" ${settings.playerDetectEnabled
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
                                <option value="random" ${settings.playMode === "random"
      ? "selected"
      : ""
    }>随机播放</option>
                                <option value="sequential" ${settings.playMode === "sequential"
      ? "selected"
      : ""
    }>顺序播放</option>
                            </select>
                            
                            <label><i class="fa-solid fa-filter"></i>媒体筛选</label>
                            <select id="player-media-filter">
                                <option value="all" ${settings.mediaFilter === "all"
      ? "selected"
      : ""
    }>所有媒体</option>
                                <option value="image" ${settings.mediaFilter === "image"
      ? "selected"
      : ""
    }>仅图片</option>
                                <option value="video" ${settings.mediaFilter === "video"
      ? "selected"
      : ""
    }>仅视频</option>
                            </select>
                        </div>
                        
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-video-loop" ${settings.videoLoop ? "checked" : ""
    } />
                                <i class="fa-solid fa-repeat"></i>视频循环播放
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-show-info" ${settings.showInfo ? "checked" : ""
    } />
                                <i class="fa-solid fa-circle-info"></i>显示媒体信息
                            </label>
                        </div>
                        
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-preload-images" ${settings.preloadImages ? "checked" : ""
    } />
                                <i class="fa-solid fa-bolt"></i>预加载图片
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-preload-videos" ${settings.preloadVideos ? "checked" : ""
    } />
                                <i class="fa-solid fa-bolt"></i>预加载视频（耗流量）
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-show-video-controls" ${settings.showVideoControls ? "checked" : ""
    } />
                                <i class="fa-solid fa-video"></i>显示视频控制栏
                            </label>
                        </div>
                        
                        <!-- 时间配置 -->
                        <div class="settings-row">
                            <label><i class="fa-solid fa-clock"></i>定时切换间隔</label>
                            <input type="number" id="player-interval" value="${settings.switchInterval
    }" min="1000" max="60000" step="500" />
                            <span>毫秒</span>
                        </div>
                        
                        <div class="settings-row">
                            <label><i class="fa-solid fa-sync"></i>服务轮询间隔</label>
                            <input type="number" id="player-polling-interval" value="${settings.pollingInterval
    }" min="5000" max="300000" step="5000" />
                            <span>毫秒</span>
                        </div>
                        
                        <!-- 图片过渡效果 -->
                        <div class="settings-row">
                            <label><i class="fa-solid fa-paint-brush"></i>图片过渡效果</label>
                            <select id="player-transition-effect">
                                <option value="none" ${settings.transitionEffect === "none"
      ? "selected"
      : ""
    }>无效果</option>
                                <option value="fade" ${settings.transitionEffect === "fade"
      ? "selected"
      : ""
    }>淡入淡出</option>
                                <option value="slide" ${settings.transitionEffect === "slide"
      ? "selected"
      : ""
    }>滑动</option>
                                <option value="zoom" ${settings.transitionEffect === "zoom"
      ? "selected"
      : ""
    }>缩放</option>
                                <option value="drift" ${settings.transitionEffect === "drift"
      ? "selected"
      : ""
    }>动态漂移</option>
                                <option value="push" ${settings.transitionEffect === "push"
      ? "selected"
      : ""
    }>推动效果</option>
                                <option value="rotate" ${settings.transitionEffect === "rotate"
      ? "selected"
      : ""
    }>旋转进入</option>
                                <option value="bounce" ${settings.transitionEffect === "bounce"
      ? "selected"
      : ""
    }>弹跳效果</option>
                                <option value="flip" ${settings.transitionEffect === "flip"
      ? "selected"
      : ""
    }>翻转效果</option>
                                <option value="fade-scale" ${settings.transitionEffect === "fade-scale"
      ? "selected"
      : ""
    }>淡入缩放</option>
                            </select>
                        </div>
                        
                        <!-- 检测冷却时间 -->
                        <div class="settings-group">
                            <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                                <i class="fa-solid fa-robot"></i> 检测设置
                            </h4>
                            <div class="settings-row">
                                <label><i class="fa-solid fa-hourglass-half"></i>切换冷却时间</label>
                                <input type="number" id="player-ai-cooldown" value="${settings.aiResponseCooldown
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

  $("#extensions_settings").append(html);
  setupSettingsEvents();
  console.log(`[${EXTENSION_ID}] 设置面板创建完成`);
};

const setupSettingsEvents = () => {
  const settings = getExtensionSettings();
  const panel = $(`#${SETTINGS_PANEL_ID}`);

  // 监听总开关变化
  panel.find("#master-enabled").on("change", function () {
    settings.masterEnabled = $(this).prop("checked");
    saveSafeSettings();

    if (settings.masterEnabled) {
      // 启用扩展
      initExtension();
      toastr.success("媒体播放器扩展已启用");
    } else {
      // 禁用扩展
      disableExtension();
      toastr.info("媒体播放器扩展已禁用");
    }
  });

  const saveCurrentSettings = () => {
    // 1. 同步总开关状态（核心：绑定“启用媒体播放器”复选框）
    settings.enabled = panel.find("#extension-enabled").prop("checked");

    // 2. 同步其他基础设置
    settings.serviceUrl = panel.find("#player-service-url").val().trim();
    settings.serviceDirectory = panel
      .find("#player-scan-directory")
      .val()
      .trim();
    settings.playMode = panel.find("#player-play-mode").val();
    settings.mediaFilter = panel.find("#player-media-filter").val();

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
    settings.showMediaUpdateToast = panel
      .find("#show-media-update-toast")
      .prop("checked");
    settings.customVideoControls = {
      showProgress: panel.find("#custom-show-progress").prop("checked"),
      showVolume: panel.find("#custom-show-volume").prop("checked"),
      showLoop: panel.find("#custom-show-loop").prop("checked"),
      showTime: panel.find("#custom-show-time").prop("checked"),
    };

    // 3. 持久化保存设置
    saveSafeSettings();

    // 4. 总开关联动：禁用时清理所有资源（核心修复）
    if (!settings.enabled) {
      // 停止服务轮询
      if (pollingTimer) clearTimeout(pollingTimer);
      // 关闭WebSocket连接
      if (ws) {
        ws.close();
        ws = null;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      }
      // 停止播放定时器
      if (switchTimer) clearTimeout(switchTimer);
      // 停止视频进度更新
      stopProgressUpdate();
      // 隐藏播放器窗口
      $(`#${PLAYER_WINDOW_ID}`).hide();
      settings.isWindowVisible = false;
      settings.isPlaying = false;
    } else {
      // 启用时重启核心功能
      startPollingService();
      initWebSocket();
      // 显示播放器窗口（若之前隐藏）
      if (settings.isWindowVisible) $(`#${PLAYER_WINDOW_ID}`).show();
    }

    // 5. 同步UI状态
    $(`#${PLAYER_WINDOW_ID}`).toggleClass("no-border", settings.hideBorder);
    panel
      .find("#player-slideshow-mode")
      .prop("disabled", settings.playMode === "random");
    updateExtensionMenu();
  };

  // 刷新服务
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
    settings.currentRandomIndex = -1;
    saveSafeSettings();
    toastr.success("随机播放记录已清理");
    showMedia("current");
  });

  // 清理无效媒体
  panel.find("#cleanup-media").on("click", async () => {
    if (!confirm("确定清理无效/超大小限制的媒体文件？（不可逆）")) return;
    const result = await cleanupInvalidMedia();
    if (result) {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      settings.currentRandomIndex = -1;
      showMedia("current");
    }
  });

  // 更新扫描目录
  panel.find("#update-directory").on("click", async () => {
    const newPath = panel.find("#player-scan-directory").val().trim();
    if (!newPath) {
      toastr.warning("请输入有效目录路径");
      return;
    }
    const success = await updateScanDirectory(newPath);
    if (success) {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      settings.currentRandomIndex = -1;
      panel.find("#player-scan-directory").val(newPath);
      showMedia("current");
    }
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
    await refreshMediaList();
    showMedia("current");
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
  panel.find("#player-play-mode").on("change", function () {
    const newMode = $(this).val();
    const slideshowCheckbox = panel.find("#player-slideshow-mode");
    const settings = getExtensionSettings();

    // 仅在“顺序播放”时启用循环选项，“随机播放”时禁用（关键修复）
    slideshowCheckbox.prop("disabled", newMode === "random");
    // 若切换到随机播放，自动关闭循环
    if (newMode === "random") {
      settings.slideshowMode = false;
      slideshowCheckbox.prop("checked", false);
    }

    saveCurrentSettings();

    if (newMode === "random") {
      settings.randomMediaList = [...mediaList];
      settings.randomPlayedIndices = [];
      settings.currentRandomIndex = -1;
    } else {
      currentMediaIndex = 0;
    }

    showMedia("current");
  });

  // 媒体筛选变更（根据触发源避免循环同步）
  panel.find("#player-media-filter").on("change", function () {
    const newFilter = $(this).val();
    const settings = getExtensionSettings();
    const win = $(`#${PLAYER_WINDOW_ID}`);
    const menuBtn = $(`#ext_menu_${EXTENSION_ID}`);

    // 直接更新筛选状态，不限制触发源（关键修复）
    settings.mediaFilter = newFilter;
    saveSafeSettings();

    // 刷新媒体列表并同步到播放器和菜单
    refreshMediaList().then(() => {
      currentMediaIndex = 0;
      settings.randomPlayedIndices = [];
      settings.currentRandomIndex = -1;
      showMedia("current");
      // 同步播放器按钮状态
      win.find(".media-filter-btn").removeClass("active");
      win
        .find(`.media-filter-btn[data-type="${newFilter}"]`)
        .addClass("active");
      // 同步菜单筛选文本
      menuBtn
        .find(".filter-text")
        .text(
          newFilter === "all" ? "所有" : newFilter === "image" ? "图片" : "视频"
        );
      updateExtensionMenu();
    });
  });

  // 过渡效果变更
  panel.find("#player-transition-effect").on("change", function () {
    saveCurrentSettings();
    const imgElement = $(`#${PLAYER_WINDOW_ID} .image-player-img`)[0];
    if (imgElement && $(imgElement).is(":visible")) {
      applyTransitionEffect(imgElement, settings.transitionEffect);
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
    if (mediaList.length === 0) {
      toastr.info("未检测到媒体，请先配置扫描目录");
    } else {
      showMedia("current");
    }
  });

  // 基础设置项变更绑定
  panel
    .find(
      "#player-service-url, #player-interval, #player-ai-cooldown, #player-polling-interval, " +
      "#image-max-size, #video-max-size, #show-media-update-toast"
    )
    .on("change", saveCurrentSettings);

  // 复选框类设置项变更绑定（同步所有状态）
  panel
    .find(
      "#player-slideshow-mode, #player-video-loop, #player-show-info, #player-preload-images, " +
      "#player-preload-videos, #player-show-video-controls, #player-ai-detect, #player-player-detect, " +
      "#extension-enabled, #player-hide-border, #custom-show-progress, #custom-show-volume, " +
      "#custom-show-loop, #custom-show-time"
    )
    .on("change", function () {
      saveCurrentSettings();

      // 视频循环状态同步到播放器
      if ($(this).attr("id") === "player-video-loop") {
        const isChecked = $(this).prop("checked");
        settings.videoLoop = isChecked;
        $(`#${PLAYER_WINDOW_ID} .loop-btn`).toggleClass("active", isChecked);
        const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
        if (video) video.loop = isChecked;
      }

      // 视频控制栏显示状态同步
      if ($(this).attr("id") === "player-show-video-controls") {
        const isChecked = $(this).prop("checked");
        settings.showVideoControls = isChecked;
        $(`#${PLAYER_WINDOW_ID} .toggle-video-controls`).toggleClass(
          "active",
          isChecked
        );
        $(`#${PLAYER_WINDOW_ID} .video-controls`).toggle(isChecked);
        adjustVideoControlsLayout();
      }

      // 视频控制栏自定义设置同步（仅保存设置，不进行UI同步）
      if ($(this).attr("id") === "custom-show-progress") {
        settings.customVideoControls.showProgress = $(this).prop("checked");
        bindVideoControls();
        applyCustomControlsSettings();
      }

      if ($(this).attr("id") === "custom-show-volume") {
        settings.customVideoControls.showVolume = $(this).prop("checked");
        bindVideoControls();
        applyCustomControlsSettings();
      }

      if ($(this).attr("id") === "custom-show-loop") {
        settings.customVideoControls.showLoop = $(this).prop("checked");
        bindVideoControls();
        applyCustomControlsSettings();
      }

      if ($(this).attr("id") === "custom-show-time") {
        settings.customVideoControls.showTime = $(this).prop("checked");
        bindVideoControls();
        applyCustomControlsSettings();
      }
    });
}; // 闭合 setupSettingsEvents 函数

// ==================== 状态同步核心函数（修复菜单与播放器同步） ====================
const updateExtensionMenu = () => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);
  const panel = $(`#${SETTINGS_PANEL_ID}`);
  const menuBtn = $(`#ext_menu_${EXTENSION_ID}`);
  if (!win.length || !panel.length || !menuBtn.length) return;

  // 1. 播放状态同步（菜单+播放器按钮）
  const playIcon = win.find(".play-pause i");
  playIcon
    .toggleClass("fa-play", !settings.isPlaying)
    .toggleClass("fa-pause", settings.isPlaying);
  menuBtn.find(".play-status").text(settings.isPlaying ? "播放中" : "已暂停");

  // 2. 播放模式同步（菜单+播放器+面板下拉框）
  const modeIcon = win.find(".mode-switch i");
  modeIcon
    .toggleClass("fa-shuffle", settings.playMode === "random")
    .toggleClass("fa-list-ol", settings.playMode === "sequential");
  menuBtn
    .find(".mode-text")
    .text(settings.playMode === "random" ? "随机" : "顺序");
  panel.find("#player-play-mode").val(settings.playMode); // 同步面板下拉框

  // 3. 媒体筛选同步（菜单+播放器按钮+面板下拉框）
  win.find(".media-filter-btn").removeClass("active");
  win
    .find(`.media-filter-btn[data-type="${settings.mediaFilter}"]`)
    .addClass("active");
  panel.find("#player-media-filter").val(settings.mediaFilter);
  const filterTextMap = { all: "所有", image: "图片", video: "视频" };
  menuBtn
    .find(".filter-text")
    .text(filterTextMap[settings.mediaFilter] || "所有");

  // 4. 定时/检测模式同步（播放器按钮+面板切换器）
  const switchModeBtn = win.find(".switch-mode-toggle");
  switchModeBtn
    .toggleClass("active", settings.autoSwitchMode === "detect")
    .find("i")
    .toggleClass("fa-robot", settings.autoSwitchMode === "detect")
    .toggleClass("fa-clock", settings.autoSwitchMode === "timer");
  panel
    .find("#toggle-timer-mode")
    .toggleClass("active", settings.autoSwitchMode === "timer");
  panel
    .find("#toggle-detect-mode")
    .toggleClass("active", settings.autoSwitchMode === "detect");
  panel
    .find("#detect-sub-options")
    .toggle(settings.autoSwitchMode === "detect");

  // 5. 视频循环同步（播放器按钮+面板复选框）
  win.find(".loop-btn").toggleClass("active", settings.videoLoop);
  panel.find("#player-video-loop").prop("checked", settings.videoLoop);
  const video = win.find(".image-player-video")[0];
  if (video) video.loop = settings.videoLoop;

  // 6. 边框隐藏同步（播放器样式+面板复选框）
  win.toggleClass("no-border", settings.hideBorder);
  panel.find("#player-hide-border").prop("checked", settings.hideBorder);
  // 新增：同步“媒体信息”状态（菜单+播放器+面板）
  const showInfo = settings.showInfo;
  // 同步播放器开关
  win.find(".toggle-info").toggleClass("active", showInfo);
  win.find(".image-info").toggle(showInfo);
  // 同步面板复选框
  panel.find("#player-show-info").prop("checked", showInfo);
  // 同步菜单显示
  menuBtn
    .find(".media-info")
    .text(showInfo ? win.find(".image-info").text() : "隐藏信息");

  // 同步图片循环状态（面板+设置）
  panel
    .find("#player-slideshow-mode")
    .prop("disabled", settings.playMode === "random")
    .prop("checked", settings.slideshowMode);
};
// ==================== AI事件注册（完全沿用老版本v1.3.0逻辑） ====================
const registerAIEventListeners = () => {
  console.log(`[st_image_player] registerAIEventListeners 函数开始执行`);
  const maxRetries = 8;
  const retryDelay = 1500;
  let retries = 0;
  const tryRegister = () => {
    try {
      console.log(
        `[st_image_player] 动态依赖检查: eventSource=${!!eventSource}, event_types=${!!event_types}`
      );
      if (
        !eventSource ||
        !event_types ||
        !event_types.MESSAGE_RECEIVED ||
        !event_types.MESSAGE_SENT
      ) {
        throw new Error(
          `依赖未就绪: eventSource=${!!eventSource}, event_types=${!!event_types}`
        );
      }
      // 新增：兼容性处理：优先使用 addEventListener，其次使用 on 方法
      const bindEvent = (eventName, callback) => {
        if (typeof eventSource.addEventListener === "function") {
          eventSource.addEventListener(eventName, callback);
        } else if (typeof eventSource.on === "function") {
          eventSource.on(eventName, callback);
        } else {
          throw new Error(
            `eventSource 不支持事件绑定（无 addEventListener/on 方法）`
          );
        }
      };
      // AI回复事件（使用兼容的绑定方法）
      bindEvent(event_types.MESSAGE_RECEIVED, () => {
        const settings = getExtensionSettings();
        if (
          settings.enabled &&
          settings.autoSwitchMode === "detect" &&
          settings.aiDetectEnabled &&
          settings.isWindowVisible
        ) {
          onAIResponse();
        }
      });
      // 玩家消息事件（同上）
      bindEvent(event_types.MESSAGE_SENT, () => {
        const settings = getExtensionSettings();
        if (
          settings.enabled &&
          settings.autoSwitchMode === "detect" &&
          settings.playerDetectEnabled &&
          settings.isWindowVisible
        ) {
          onPlayerMessage();
        }
      });
      // 标记注册成功，避免重复尝试
      const settings = getExtensionSettings();
      settings.aiEventRegistered = true;
      saveSafeSettings();
      console.log(
        `[${EXTENSION_ID}] AI/玩家事件监听注册成功（老版本原生方式）`
      );
      toastr.success("AI检测/玩家消息切换功能就绪");
    } catch (error) {
      console.error(`[st_image_player] AI事件注册失败原因:${error.message}`);
      retries++;
      if (retries < maxRetries) {
        console.warn(
          `[${EXTENSION_ID}] AI事件注册失败(${retries}/${maxRetries}），原因：${error.message}，${retryDelay}ms后重试`
        );
        setTimeout(tryRegister, retryDelay);
      } else {
        console.error(`[${EXTENSION_ID}] AI事件注册失败(已达最大重试次数）`);
        toastr.error("AI/玩家消息切换功能未启用，请刷新页面重试");
      }
    }
  };
  // 延迟3秒启动首次尝试（确保老版本核心脚本加载完成）
  setTimeout(tryRegister, 3000);
};

// ==================== 扩展菜单按钮（含筛选状态显示） ====================
const addMenuButton = () => {
  const menuBtnId = `ext_menu_${EXTENSION_ID}`;
  if ($(`#${menuBtnId}`).length) return;
  const settings = getExtensionSettings();

  // 总开关禁用：不添加菜单按钮
  if (!settings.masterEnabled) return;

  // 新增“媒体信息”显示项（显示当前播放的文件名+类型）
  const btnHtml = `
    <div id="${menuBtnId}" class="list-group-item flex-container flexGap5">
      <div class="fa-solid fa-film"></div>
      <span>${EXTENSION_NAME}</span>
      <!-- 简化：启用/关闭播放器复选框 -->
      <label style="margin-left:8px; font-size:12px; cursor:pointer;">
        <input type="checkbox" class="toggle-player-enabled" ${settings.enabled ? 'checked' : ''} style="margin-right:4px;">
        启用播放器
      </label>
      <!-- 新增：媒体信息显示 -->
      <span class="media-info" style="margin-left:8px; font-size:10px; color:#a0a0a0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${settings.showInfo ? "加载中..." : "隐藏信息"}
      </span>
      <span class="play-status" style="margin-left:auto; font-size:10px; color:#a0a0a0;">${settings.isPlaying ? "播放中" : "已暂停"
    }</span>
      <span class="mode-text" style="margin-left:8px; font-size:10px; color:#a0a0a0;">${settings.playMode === "random" ? "随机" : "顺序"
    }</span>
      <span class="filter-text" style="margin-left:8px; font-size:10px; color:#a0a0a0;">${settings.mediaFilter === "all"
      ? "所有"
      : settings.mediaFilter === "image"
        ? "图片"
        : "视频"
    }</span>
    </div>
  `;
  $("#extensionsMenu").append(btnHtml);

  // 菜单点击跳转设置面板
  $(`#${menuBtnId}`).on("click", () => {
    $("#extensions-settings-button").trigger("click");
    $(`#${SETTINGS_PANEL_ID}`).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });

  // 启用/关闭播放器复选框点击事件
  $(`#${menuBtnId} .toggle-player-enabled`).on("change", (e) => {
    e.stopPropagation(); // 阻止冒泡到菜单点击事件
    const settings = getExtensionSettings();
    settings.enabled = $(e.target).is(":checked");
    saveSafeSettings();

    // 同步播放器状态
    updateExtensionMenu();

    // 显示状态提示
    toastr.success(`媒体播放器${settings.enabled ? "已启用" : "已关闭"}`);

    console.log(`[${EXTENSION_ID}] 播放器状态切换: enabled=${settings.enabled}`);
  });

  // 增强菜单状态更新：1秒同步一次，包含媒体信息
  setInterval(() => {
    const settings = getExtensionSettings();
    const menuBtn = $(`#${menuBtnId}`);
    const win = $(`#${PLAYER_WINDOW_ID}`);
    const infoElement = win.find(".image-info");

    // 0. 同步启用/关闭复选框状态
    menuBtn.find(".toggle-player-enabled").prop("checked", settings.enabled);
    // 1. 同步播放状态
    menuBtn.find(".play-status").text(settings.isPlaying ? "播放中" : "已暂停");
    // 2. 同步播放模式
    menuBtn
      .find(".mode-text")
      .text(settings.playMode === "random" ? "随机" : "顺序");
    // 3. 同步媒体筛选
    menuBtn
      .find(".filter-text")
      .text(
        settings.mediaFilter === "all"
          ? "所有"
          : settings.mediaFilter === "image"
            ? "图片"
            : "视频"
      );
    // 4. 同步媒体信息（关键修复）
    if (settings.showInfo && infoElement.is(":visible")) {
      menuBtn.find(".media-info").text(infoElement.text()).show();
    } else {
      menuBtn.find(".media-info").text("隐藏信息").show();
    }
  }, 1000);
};

// ==================== 扩展核心初始化（确保AI注册时机正确） ====================
const initExtension = async () => {
  const settings = getExtensionSettings();

  console.log(`[${EXTENSION_ID}] initExtension开始: masterEnabled=${settings.masterEnabled}, enabled=${settings.enabled}`);

  // 总开关禁用：终止初始化
  if (!settings.masterEnabled) {
    console.log(`[${EXTENSION_ID}] 扩展总开关关闭，不进行初始化`);
    // 即使总开关关闭，也显示一个最小化的设置面板以便重新启用
    // 先检查extensions_settings容器是否存在
    if ($("#extensions_settings").length) {
      createMinimalSettingsPanel();
    } else {
      console.warn(`[${EXTENSION_ID}] extensions_settings容器不存在，无法创建最小面板`);
    }
    return;
  }

  console.log(`[${EXTENSION_ID}] 总开关已启用，开始清理旧面板`);
  // 关键：初始化前清理旧面板
  $(`#${SETTINGS_PANEL_ID}-minimal`).remove();
  $(`#${SETTINGS_PANEL_ID}`).remove();
  console.log(`[${EXTENSION_ID}] 旧面板清理完成，开始创建完整设置面板`);
  try {
    console.log(`[${EXTENSION_ID}] 开始初始化(SillyTavern老版本适配)`);
    // 1. 初始化全局设置容器（兼容老版本存储）
    if (typeof window.extension_settings === "undefined") {
      window.extension_settings = {};
    }
    if (!window.extension_settings[EXTENSION_ID]) {
      // 用JSON深拷贝快速覆盖所有默认设置，避免手动复制遗漏
      window.extension_settings[EXTENSION_ID] = JSON.parse(
        JSON.stringify(settings)
      );
      // 补充修复相关字段（覆盖默认值）
      window.extension_settings[EXTENSION_ID].isMediaLoading = false;
      window.extension_settings[EXTENSION_ID].currentRandomIndex = -1;
      window.extension_settings[EXTENSION_ID].showMediaUpdateToast = false;
      window.extension_settings[EXTENSION_ID].aiEventRegistered = false;
      window.extension_settings[EXTENSION_ID].filterTriggerSource = null;
      // 修复：将save和log缩进进if块内，且删除多余的“};”
      saveSafeSettings();
      console.log(`[${EXTENSION_ID}] 初始化默认扩展设置`);
    }
    // 2. 按顺序创建基础组件（菜单→窗口→设置面板）
    addMenuButton();
    await createPlayerWindow();
    await createSettingsPanel();

    // 修复ST抽屉组件：手动触发ST的抽屉初始化
    setTimeout(() => {
      const $drawer = $(`#${SETTINGS_PANEL_ID} .inline-drawer`);
      if ($drawer.length > 0) {
        console.log(`[${EXTENSION_ID}] 手动初始化ST抽屉组件`);

        // 绑定ST标准的抽屉点击事件
        $drawer.find('.inline-drawer-toggle').off('click').on('click', function (e) {
          e.stopPropagation();

          const $this = $(this);
          const $parentDrawer = $this.closest('.inline-drawer');
          const $content = $parentDrawer.find('.inline-drawer-content');
          const $icon = $this.find('.glyphicon');

          if ($parentDrawer.hasClass('is-open')) {
            $parentDrawer.removeClass('is-open');
            $content.slideUp(200);
            $icon.removeClass('glyphicon-chevron-up').addClass('glyphicon-chevron-down');
          } else {
            $parentDrawer.addClass('is-open');
            $content.slideDown(200);
            $icon.removeClass('glyphicon-chevron-down').addClass('glyphicon-chevron-up');
          }
        });

        // 初始状态：默认展开
        $drawer.addClass('is-open');
        $drawer.find('.inline-drawer-content').show();
        $drawer.find('.inline-drawer-toggle .glyphicon')
          .removeClass('glyphicon-chevron-down')
          .addClass('glyphicon-chevron-up');

        console.log(`[${EXTENSION_ID}] ST抽屉组件初始化完成`);
      }
    }, 100);

    // 3. 初始化服务通信（WebSocket+轮询）
    initWebSocket();
    startPollingService();
    // 4. 加载媒体列表（确保播放有数据）
    await refreshMediaList();
    if (mediaList.length > 0) {
      showMedia("current");
    } else {
      toastr.info(`未检测到媒体文件，请在设置中配置扫描目录`);
    }
    // 5. 初始状态校准（默认暂停，避免自动播放）
    settings.isPlaying = false;
    $(`#${PLAYER_WINDOW_ID} .play-pause i`)
      .removeClass("fa-pause")
      .addClass("fa-play");
    saveSafeSettings();

    // 6. 初始化媒体自适应模式
    applyMediaFitMode();

    // 7. 初始化无边框模式交互
    setupBorderlessModeInteractions();

    // 8. 加载控制栏自定义设置
    loadCustomControlsSettings();
    // 7. 【替换原setTimeout】确保registerAIEventListeners必被触发，添加兜底重试
    const triggerAIRegister = () => {
      const currentSettings = getExtensionSettings();
      if (currentSettings.aiEventRegistered) {
        console.log(`[${EXTENSION_ID}] AI事件已注册,无需重复触发`);
        return;
      }
      console.log(`[${EXTENSION_ID}] 触发AI事件注册(首次尝试）`);
      registerAIEventListeners();
      // 兜底：3秒后检查是否注册成功，未成功则重试一次
      setTimeout(() => {
        const checkSettings = getExtensionSettings();
        if (!checkSettings.aiEventRegistered) {
          console.warn(`[${EXTENSION_ID}] AI注册未成功,启动二次重试`);
          registerAIEventListeners();
        }
      }, 3000);
    };
    // 延迟3秒触发（给eventSource最终初始化留足时间）
    setTimeout(triggerAIRegister, 3000);

    console.log(`[${EXTENSION_ID}] 扩展初始化完成（老版本适配）`);
    toastr.success(`${EXTENSION_NAME}扩展加载成功（点击播放按钮开始播放）`);
  } catch (error) {
    console.error(`[${EXTENSION_ID}] 初始化错误:`, error);
    toastr.error(`初始化失败: ${error.message},1.5秒后重试`);
    // 重试时重置关键状态
    const resetSettings = getExtensionSettings();
    resetSettings.isMediaLoading = false;
    resetSettings.currentRandomIndex = -1;
    saveSafeSettings();
    setTimeout(initExtension, 1500);
  }
};

// ==================== 页面就绪触发（兼容SillyTavern DOM加载顺序） ====================
jQuery(() => {
  console.log(`[${EXTENSION_ID}] 脚本开始加载(等待DOM+全局设置就绪)`);
  const initWhenReady = () => {
    console.log(`[${EXTENSION_ID}] initWhenReady开始执行`);

    // 新增：等待全局设置（含本地存储）加载完成，最多等待5秒
    const checkGlobalSettings = () => {
      const globalSettings = getSafeGlobal("extension_settings", {});
      // 条件1：DOM就绪（扩展菜单+设置面板容器存在）
      const isDOMReady =
        document.getElementById("extensionsMenu") &&
        document.getElementById("extensions_settings");
      // 条件2：全局设置已加载（或超时强制尝试）
      // 修改：即使没有全局设置也允许初始化，使用默认设置
      const isSettingsReady = true;

      console.log(`[${EXTENSION_ID}] DOM检查: extensionsMenu=${!!document.getElementById("extensionsMenu")}, extensions_settings=${!!document.getElementById("extensions_settings")}`);
      console.log(`[${EXTENSION_ID}] 设置检查: globalSettings[EXTENSION_ID]=${!!globalSettings[EXTENSION_ID]}, 耗时=${Date.now() - startTime}ms`);

      if (isDOMReady && isSettingsReady) {
        clearInterval(checkTimer);
        const settings = getExtensionSettings();
        console.log(
          `[${EXTENSION_ID}] 初始化前总开关状态: masterEnabled=${settings.masterEnabled}, enabled=${settings.enabled}`
        );

        // 根据总开关状态决定是否初始化扩展
        if (settings.masterEnabled) {
          initExtension();
        } else {
          console.log(`[${EXTENSION_ID}] 总开关关闭，准备创建最小设置面板`);
          console.log(`[${EXTENSION_ID}] 检查extensions_settings元素:`, document.getElementById("extensions_settings"));
          createMinimalSettingsPanel();
          console.log(`[${EXTENSION_ID}] 最小设置面板创建完成，检查元素:`, $(`#${SETTINGS_PANEL_ID}-minimal`).length);
        }

        console.log(`[${EXTENSION_ID}] DOM+全局设置均就绪,启动初始化`);
        return;
      }

      // 超时保护：5秒后强制初始化（避免无限等待）
      if (Date.now() - startTime > 5000) {
        clearInterval(checkTimer);
        const finalDOMReady =
          document.getElementById("extensionsMenu") &&
          document.getElementById("extensions_settings");
        if (finalDOMReady) {
          console.warn(`[${EXTENSION_ID}] 5秒超时,强制启动初始化`);
          initExtension();
        } else {
          console.error(`[${EXTENSION_ID}] 5秒超时,DOM未就绪,初始化失败`);
          toastr.error("扩展初始化失败,核心DOM未加载");
        }
      }
    };

    const startTime = Date.now();
    const checkTimer = setInterval(checkGlobalSettings, 300); // 每300ms检查一次
  };

  initWhenReady();
});
// 脚本加载完成标识
console.log(`[${EXTENSION_ID}] 脚本文件加载完成(SillyTavern老版本适配版)`);

// ==================== 过渡效果选择面板 ====================
const showTransitionEffectPanel = () => {
  const settings = getExtensionSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);
  
  // 移除已存在的面板
  $(".transition-effect-panel").remove();
  
  // 创建过渡效果选择面板
  const panelHtml = `
    <div class="transition-effect-panel" style="
      position: absolute;
      top: 50px;
      right: 10px;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid #444;
      border-radius: 8px;
      padding: 15px;
      z-index: 1000;
      min-width: 200px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    ">
      <div style="
        color: #fff;
        font-size: 14px;
        font-weight: bold;
        margin-bottom: 10px;
        border-bottom: 1px solid #444;
        padding-bottom: 8px;
      ">
        <i class="fa-solid fa-paint-brush"></i> 过渡效果
      </div>
      <div class="transition-options" style="display: grid; grid-template-columns: 1fr; gap: 8px;">
        <button class="transition-option ${settings.transitionEffect === 'none' ? 'active' : ''}" data-effect="none" style="
          background: ${settings.transitionEffect === 'none' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">无效果</button>
        <button class="transition-option ${settings.transitionEffect === 'fade' ? 'active' : ''}" data-effect="fade" style="
          background: ${settings.transitionEffect === 'fade' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">淡入淡出</button>
        <button class="transition-option ${settings.transitionEffect === 'slide' ? 'active' : ''}" data-effect="slide" style="
          background: ${settings.transitionEffect === 'slide' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">滑动效果</button>
        <button class="transition-option ${settings.transitionEffect === 'zoom' ? 'active' : ''}" data-effect="zoom" style="
          background: ${settings.transitionEffect === 'zoom' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">缩放效果</button>
        <button class="transition-option ${settings.transitionEffect === 'drift' ? 'active' : ''}" data-effect="drift" style="
          background: ${settings.transitionEffect === 'drift' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">动态漂移</button>
        <button class="transition-option ${settings.transitionEffect === 'push' ? 'active' : ''}" data-effect="push" style="
          background: ${settings.transitionEffect === 'push' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">推动效果</button>
        <button class="transition-option ${settings.transitionEffect === 'rotate' ? 'active' : ''}" data-effect="rotate" style="
          background: ${settings.transitionEffect === 'rotate' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">旋转进入</button>
        <button class="transition-option ${settings.transitionEffect === 'bounce' ? 'active' : ''}" data-effect="bounce" style="
          background: ${settings.transitionEffect === 'bounce' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">弹跳效果</button>
        <button class="transition-option ${settings.transitionEffect === 'flip' ? 'active' : ''}" data-effect="flip" style="
          background: ${settings.transitionEffect === 'flip' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">翻转效果</button>
        <button class="transition-option ${settings.transitionEffect === 'fade-scale' ? 'active' : ''}" data-effect="fade-scale" style="
          background: ${settings.transitionEffect === 'fade-scale' ? '#007bff' : '#333'};
          color: white;
          border: 1px solid #555;
          border-radius: 4px;
          padding: 8px 12px;
          cursor: pointer;
          text-align: left;
          font-size: 12px;
          transition: all 0.2s;
        ">淡入缩放</button>
      </div>
    </div>
  `;
  
  // 添加到播放器窗口
  win.append(panelHtml);
  
  // 绑定选项点击事件
  win.find(".transition-option").on("click", function(e) {
    e.stopPropagation();
    const effect = $(this).data("effect");
    settings.transitionEffect = effect;
    saveSafeSettings();
    
    // 更新按钮标题
    win.find(".transition-effect-toggle").attr("title", `过渡效果: ${
      effect === 'none' ? '无效果' :
      effect === 'fade' ? '淡入淡出' :
      effect === 'slide' ? '滑动' :
      effect === 'zoom' ? '缩放' :
      effect === 'drift' ? '动态漂移' :
      effect === 'push' ? '推动' :
      effect === 'rotate' ? '旋转' :
      effect === 'bounce' ? '弹跳' :
      effect === 'flip' ? '翻转' :
      '淡入缩放'
    }`);
    
    // 更新设置面板中的选项
    $(`#player-transition-effect`).val(effect);
    
    // 关闭面板
    $(".transition-effect-panel").remove();
    
    toastr.success(`已切换到${effect === 'none' ? '无效果' :
      effect === 'fade' ? '淡入淡出' :
      effect === 'slide' ? '滑动' :
      effect === 'zoom' ? '缩放' :
      effect === 'drift' ? '动态漂移' :
      effect === 'push' ? '推动' :
      effect === 'rotate' ? '旋转' :
      effect === 'bounce' ? '弹跳' :
      effect === 'flip' ? '翻转' :
      '淡入缩放'}过渡效果`);
  });
  
  // 点击其他地方关闭面板
  $(document).on("click.transition-panel", function(e) {
    if (!$(e.target).closest(".transition-effect-panel").length && 
        !$(e.target).closest(".transition-effect-toggle").length) {
      $(".transition-effect-panel").remove();
      $(document).off("click.transition-panel");
    }
  });
};
