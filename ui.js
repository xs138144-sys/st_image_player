import { getSettings, saveSafeSettings, disableExtension } from "./settings.js";
import {
  getSafeToastr,
  formatTime,
  adjustVideoControlsLayout,
  applyTransitionEffect,
} from "./utils.js";
import {
  showMedia,
  startPlayback,
  stopPlayback,
  updateProgressBar,
  updateVolume,
  startProgressUpdate,
  stopProgressUpdate,
} from "./mediaPlayer.js";
import {
  refreshMediaList,
  cleanupInvalidMedia,
  updateScanDirectory,
  updateMediaSizeLimit,
} from "./api.js";
import { registerAIEventListeners } from "./aiEvents.js";

const toastr = getSafeToastr();
const EXTENSION_ID = "st_image_player";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings";
let panel = null; // 设置面板缓存

// ------------------------------ UI创建 ------------------------------
/**
 * 创建播放器窗口
 * @returns {Promise<void>}
 */
export const createPlayerWindow = async () => {
  const settings = getSettings();
  if (!settings.enabled || $(`#${PLAYER_WINDOW_ID}`).length) return;

  // 视频控制栏HTML（根据设置动态生成）
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
              settings.videoVolume > 0 ? "fa-volume-high" : "fa-volume-mute"
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

  // 播放器窗口HTML
  const html = `
    <div id="${PLAYER_WINDOW_ID}" class="image-player-window ${
    settings.hideBorder ? "no-border" : ""
  }">
      <div class="image-player-header">
        <div class="title"><i class="fa-solid fa-film"></i> 媒体播放器</div>
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
              settings.playMode === "random" ? "fa-shuffle" : "fa-list-ol"
            }"></i>
          </button>
          <button class="control-btn switch-mode-toggle ${
            settings.autoSwitchMode === "detect" ? "active" : ""
          }" title="${
    settings.autoSwitchMode === "detect" ? "检测播放" : "定时切换"
  }">
            <i class="fa-solid ${
              settings.autoSwitchMode === "detect" ? "fa-robot" : "fa-clock"
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
    </div>
  `;

  $("body").append(html);
  setupWindowEvents(); // 绑定窗口事件
  positionWindow(); // 定位窗口
  bindVideoControls(); // 绑定视频控制事件

  // 初始化视频音量
  const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
  if (video) video.volume = settings.videoVolume;

  console.log(`[UI] 播放器窗口创建完成`);
};

/**
 * 创建设置面板
 * @returns {Promise<void>}
 */
export const createSettingsPanel = async () => {
  const settings = getSettings();
  if (!settings.masterEnabled || $(`#${SETTINGS_PANEL_ID}`).length) return;

  // 获取服务状态
  const serviceStatus = await import("./api.js").then(
    ({ checkServiceStatus }) => checkServiceStatus()
  );
  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const observerStatus = serviceStatus.observerActive ? "已启用" : "已禁用";
  const statusText = `${serviceActive}（监控: ${observerStatus} | 总计: ${serviceStatus.totalCount} | 图片: ${serviceStatus.imageCount} | 视频: ${serviceStatus.videoCount}）`;

  // 设置面板HTML
  const html = `
    <div id="${SETTINGS_PANEL_ID}">
      <div class="extension_settings inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b><i class="fa-solid fa-cog"></i> 媒体播放器</b>
          <div class="inline-drawer-icon">
            <span class="glyphicon glyphicon-chevron-down"></span>
          </div>
        </div>
        <div class="inline-drawer-content">
          <div class="image-player-settings">
            <!-- 总开关 -->
            <div class="settings-row">
              <label class="checkbox_label" style="min-width:auto;">
                <input type="checkbox" id="master-enabled" ${
                  settings.masterEnabled ? "checked" : ""
                } />
                <i class="fa-solid fa-power-off"></i>启用媒体播放器扩展
              </label>
            </div>
            
            <!-- 服务状态 -->
            <div class="settings-row">
              <label class="service-status">
                <i class="fa-solid ${
                  serviceStatus.active ? "fa-plug-circle-check" : "fa-plug"
                }"></i>
                服务状态: <span class="${
                  serviceStatus.active ? "status-success" : "status-error"
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
                settings.serviceDirectory || serviceStatus.directory
              }" placeholder="输入完整路径" />
              <button id="update-directory" class="menu-button">更新目录</button>
            </div>
            
            <!-- 媒体大小限制 -->
            <div class="settings-group">
              <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                <i class="fa-solid fa-maximize"></i> 媒体大小限制
              </h4>
              <div class="settings-row">
                <label>图片最大尺寸 (MB)</label>
                <input type="number" id="image-max-size" min="1" max="50" value="${
                  serviceStatus.mediaConfig?.image_max_size_mb || 10
                }" />
              </div>
              <div class="settings-row">
                <label>视频最大尺寸 (MB)</label>
                <input type="number" id="video-max-size" min="10" max="500" value="${
                  serviceStatus.mediaConfig?.video_max_size_mb || 100
                }" />
                <button id="update-size-limits" class="menu-button">更新限制</button>
              </div>
            </div>
            
            <!-- 播放设置 -->
            <div class="settings-group">
              <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                <i class="fa-solid fa-play"></i> 播放设置
              </h4>
              <div class="settings-row">
                <label><i class="fa-solid fa-random"></i>播放模式</label>
                <select id="play-mode">
                  <option value="random" ${
                    settings.playMode === "random" ? "selected" : ""
                  }>随机播放</option>
                  <option value="sequential" ${
                    settings.playMode === "sequential" ? "selected" : ""
                  }>顺序播放</option>
                </select>
              </div>
              <div class="settings-row">
                <label><i class="fa-solid fa-exchange"></i>切换模式</label>
                <select id="auto-switch-mode">
                  <option value="timer" ${
                    settings.autoSwitchMode === "timer" ? "selected" : ""
                  }>定时切换</option>
                  <option value="detect" ${
                    settings.autoSwitchMode === "detect" ? "selected" : ""
                  }>AI检测切换</option>
                </select>
              </div>
              <div class="settings-row" id="switch-interval-row" ${
                settings.autoSwitchMode !== "timer"
                  ? 'style="display:none;"'
                  : ""
              }>
                <label><i class="fa-solid fa-clock"></i>切换间隔 (毫秒)</label>
                <input type="number" id="switch-interval" min="1000" max="30000" value="${
                  settings.switchInterval
                }" />
              </div>
              <div class="settings-row">
                <label><i class="fa-solid fa-arrows-rotate"></i>视频循环</label>
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="video-loop" ${
                    settings.videoLoop ? "checked" : ""
                  } />
                  启用视频循环播放
                </label>
              </div>
            </div>
            
            <!-- 显示设置 -->
            <div class="settings-group">
              <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                <i class="fa-solid fa-desktop"></i> 显示设置
              </h4>
              <div class="settings-row">
                <label><i class="fa-solid fa-magic"></i>过渡效果</label>
                <select id="transition-effect">
                  <option value="fade" ${
                    settings.transitionEffect === "fade" ? "selected" : ""
                  }>淡入淡出</option>
                  <option value="slide" ${
                    settings.transitionEffect === "slide" ? "selected" : ""
                  }>滑动</option>
                  <option value="zoom" ${
                    settings.transitionEffect === "zoom" ? "selected" : ""
                  }>缩放</option>
                  <option value="none" ${
                    settings.transitionEffect === "none" ? "selected" : ""
                  }>无效果</option>
                </select>
              </div>
              <div class="settings-row">
                <label><i class="fa-solid fa-border-all"></i>窗口边框</label>
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="hide-border" ${
                    settings.hideBorder ? "checked" : ""
                  } />
                  隐藏窗口边框
                </label>
              </div>
              <div class="settings-row">
                <label><i class="fa-solid fa-info-circle"></i>媒体信息</label>
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="show-info" ${
                    settings.showInfo ? "checked" : ""
                  } />
                  显示媒体名称和类型
                </label>
              </div>
            </div>
            
            <!-- AI检测设置 -->
            <div class="settings-group">
              <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                <i class="fa-solid fa-robot"></i> AI检测设置
              </h4>
              <div class="settings-row">
                <label><i class="fa-solid fa-comments"></i>AI回复检测</label>
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="ai-detect-enabled" ${
                    settings.aiDetectEnabled ? "checked" : ""
                  } />
                  AI回复时切换媒体
                </label>
              </div>
              <div class="settings-row">
                <label><i class="fa-solid fa-user"></i>玩家消息检测</label>
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="player-detect-enabled" ${
                    settings.playerDetectEnabled ? "checked" : ""
                  } />
                  玩家发送消息时切换媒体
                </label>
              </div>
              <div class="settings-row">
                <label><i class="fa-solid fa-hourglass"></i>检测冷却时间 (毫秒)</label>
                <input type="number" id="ai-cooldown" min="1000" max="10000" value="${
                  settings.aiResponseCooldown
                }" />
              </div>
            </div>
            
            <!-- 高级设置 -->
            <div class="settings-group">
              <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                <i class="fa-solid fa-sliders"></i> 高级设置
              </h4>
              <div class="settings-row">
                <label><i class="fa-solid fa-download"></i>预加载图片</label>
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="preload-images" ${
                    settings.preloadImages ? "checked" : ""
                  } />
                  预加载下一张图片
                </label>
              </div>
              <div class="settings-row">
                <label><i class="fa-solid fa-download"></i>预加载视频</label>
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="preload-videos" ${
                    settings.preloadVideos ? "checked" : ""
                  } />
                  预加载下一个视频（谨慎使用）
                </label>
              </div>
              <div class="settings-row">
                <label><i class="fa-solid fa-bell"></i>媒体更新提示</label>
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="show-media-update-toast" ${
                    settings.showMediaUpdateToast ? "checked" : ""
                  } />
                  媒体库更新时显示提示
                </label>
              </div>
              <div class="settings-row">
                <button id="cleanup-media" class="menu-button danger">
                  <i class="fa-solid fa-trash"></i> 清理无效媒体
                </button>
                <span class="hint">删除不存在或超过大小限制的媒体记录</span>
              </div>
              <div class="settings-row">
                <button id="refresh-media-list" class="menu-button">
                  <i class="fa-solid fa-sync"></i> 刷新媒体列表
                </button>
                <span class="hint">手动更新媒体库内容</span>
              </div>
            </div>
            
            <!-- 底部按钮 -->
            <div class="settings-actions">
              <button id="save-settings" class="menu-button primary">
                <i class="fa-solid fa-save"></i> 保存设置
              </button>
              <button id="reset-settings" class="menu-button">
                <i class="fa-solid fa-rotate-left"></i> 重置默认
              </button>
              <button id="close-settings" class="menu-button">
                <i class="fa-solid fa-xmark"></i> 关闭
              </button>
              <button id="disable-extension" class="menu-button danger" style="margin-left:auto;">
                <i class="fa-solid fa-power-off"></i> 禁用扩展
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 添加到设置面板
  const settingsContainer =
    document.querySelector("#extensions_settings") ||
    document.querySelector(".extensions-container") ||
    document.body;
  $(settingsContainer).append(html);
  panel = $(`#${SETTINGS_PANEL_ID}`);

  // 绑定设置面板事件
  bindSettingsEvents();
  console.log(`[UI] 设置面板创建完成`);
};

/**
 * 创建扩展菜单按钮
 */
export const createExtensionButton = () => {
  if ($(`#ext_menu_${EXTENSION_ID}`).length) return;

  const button = $(`
    <button id="ext_menu_${EXTENSION_ID}" class="menu-button extension-button">
      <i class="fa-solid fa-film"></i> 媒体播放器
    </button>
  `);

  // 添加到菜单
  const menuContainer =
    document.querySelector("#extensions_menu") ||
    document.querySelector(".extensions-menu") ||
    document.querySelector("#main_menu");
  if (menuContainer) {
    $(menuContainer).append(button);
  } else {
    // 极端情况：添加到body
    $("body").append(button);
  }

  // 点击显示/隐藏设置面板
  button.on("click", async () => {
    const panel = $(`#${SETTINGS_PANEL_ID}`);
    if (panel.length) {
      panel.toggle();
    } else {
      await createSettingsPanel();
    }
  });
};

// ------------------------------ 事件绑定 ------------------------------
/**
 * 设置窗口位置和大小
 */
export const positionWindow = () => {
  const settings = getSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);

  if (!win.length) return;

  // 应用位置和大小
  win.css({
    left: `${settings.position.x}px`,
    top: `${settings.position.y}px`,
    width: `${settings.position.width}px`,
    height: `${settings.position.height}px`,
    display: settings.isWindowVisible ? "block" : "none",
  });

  // 调整控制栏布局
  adjustVideoControlsLayout(win);
};

/**
 * 绑定窗口相关事件（拖动、缩放等）
 */
export const setupWindowEvents = () => {
  const settings = getSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);
  if (!win.length) return;

  // 窗口拖动
  let isDragging = false;
  let dragStartX, dragStartY, windowStartX, windowStartY;

  win.find(".image-player-header").on("mousedown", (e) => {
    if (settings.isLocked) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    windowStartX = parseInt(win.css("left"));
    windowStartY = parseInt(win.css("top"));
    win.addClass("dragging");
  });

  $(document).on("mousemove", (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    win.css({
      left: `${windowStartX + deltaX}px`,
      top: `${windowStartY + deltaY}px`,
    });
  });

  $(document).on("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      win.removeClass("dragging");
      // 保存位置
      settings.position.x = parseInt(win.css("left"));
      settings.position.y = parseInt(win.css("top"));
      saveSafeSettings();
    }
  });

  // 窗口缩放
  let isResizing = false;
  let resizeStartX, resizeStartY, windowStartWidth, windowStartHeight;

  win.find(".resize-handle").on("mousedown", (e) => {
    if (settings.isLocked) return;
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    windowStartWidth = parseInt(win.css("width"));
    windowStartHeight = parseInt(win.css("height"));
    win.addClass("resizing");
    e.preventDefault();
  });

  $(document).on("mousemove", (e) => {
    if (!isResizing) return;
    const deltaX = e.clientX - resizeStartX;
    const deltaY = e.clientY - resizeStartY;
    const newWidth = Math.max(300, windowStartWidth + deltaX);
    const newHeight = Math.max(200, windowStartHeight + deltaY);

    win.css({
      width: `${newWidth}px`,
      height: `${newHeight}px`,
    });

    // 调整控制栏布局
    adjustVideoControlsLayout(win);
  });

  $(document).on("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      win.removeClass("resizing");
      // 保存大小
      settings.position.width = parseInt(win.css("width"));
      settings.position.height = parseInt(win.css("height"));
      saveSafeSettings();
    }
  });

  // 窗口控制按钮
  win.find(".window-controls .lock").on("click", () => {
    settings.isLocked = !settings.isLocked;
    win
      .find(".window-controls .lock i")
      .removeClass("fa-lock fa-lock-open")
      .addClass(settings.isLocked ? "fa-lock" : "fa-lock-open");
    saveSafeSettings();
    toastr.info(settings.isLocked ? "窗口已锁定" : "窗口已解锁");
  });

  win.find(".window-controls .toggle-info").on("click", function () {
    settings.showInfo = !settings.showInfo;
    $(this).toggleClass("active");
    win.find(".image-info").toggle(settings.showInfo);
    saveSafeSettings();
  });

  win.find(".window-controls .toggle-video-controls").on("click", function () {
    settings.showVideoControls = !settings.showVideoControls;
    $(this).toggleClass("active");
    win.find(".video-controls").toggle(settings.showVideoControls);
    adjustVideoControlsLayout(win);
    saveSafeSettings();
  });

  win.find(".window-controls .hide").on("click", () => {
    settings.isWindowVisible = false;
    win.hide();
    saveSafeSettings();
  });

  // 播放控制按钮
  win.find(".play-pause").on("click", () => {
    settings.isPlaying = !settings.isPlaying;
    win
      .find(".play-pause i")
      .removeClass("fa-play fa-pause")
      .addClass(settings.isPlaying ? "fa-pause" : "fa-play");

    if (settings.isPlaying) {
      startPlayback();
    } else {
      stopPlayback();
    }
    saveSafeSettings();
  });

  win.find(".mode-switch").on("click", () => {
    settings.playMode =
      settings.playMode === "random" ? "sequential" : "random";
    win
      .find(".mode-switch i")
      .removeClass("fa-shuffle fa-list-ol")
      .addClass(settings.playMode === "random" ? "fa-shuffle" : "fa-list-ol");

    // 重置随机播放状态
    if (settings.playMode === "random") {
      settings.randomPlayedIndices = [];
      settings.currentRandomIndex = -1;
    }

    win
      .find(".control-text")
      .text(`${settings.playMode === "random" ? "随机模式" : "顺序模式"}: 0/0`);
    saveSafeSettings();
  });

  win.find(".switch-mode-toggle").on("click", function () {
    settings.autoSwitchMode =
      settings.autoSwitchMode === "detect" ? "timer" : "detect";
    $(this).toggleClass("active");
    win
      .find(".switch-mode-toggle i")
      .removeClass("fa-robot fa-clock")
      .addClass(settings.autoSwitchMode === "detect" ? "fa-robot" : "fa-clock");

    // 重启播放以应用新模式
    if (settings.isPlaying) {
      stopPlayback();
      startPlayback();
    }
    saveSafeSettings();
  });

  // 上一个/下一个按钮
  win.find(".prev").on("click", () => showMedia("prev"));
  win.find(".next").on("click", () => showMedia("next"));

  // 媒体筛选按钮
  win.find(".media-filter-btn").on("click", function () {
    const type = $(this).data("type");
    if (settings.mediaFilter === type) return;

    settings.mediaFilter = type;
    win.find(".media-filter-btn").removeClass("active");
    $(this).addClass("active");

    // 刷新媒体列表
    (async () => {
      await refreshMediaList();
      showMedia("current");
    })();

    saveSafeSettings();
  });
};

/**
 * 绑定视频控制相关事件
 */
export const bindVideoControls = () => {
  const settings = getSettings();
  const win = $(`#${PLAYER_WINDOW_ID}`);
  if (!win.length) return;

  const video = win.find(".image-player-video")[0];
  const progressBar = win.find(".progress-bar");
  const progressPlayed = win.find(".progress-played");
  const progressHandle = win.find(".progress-handle");
  const currentTimeDisplay = win.find(".current-time");
  const totalTimeDisplay = win.find(".total-time");
  const volumeBtn = win.find(".volume-btn");
  const volumeSlider = win.find(".volume-slider");
  const loopBtn = win.find(".loop-btn");

  // 视频元数据加载完成
  $(video).on("loadedmetadata", () => {
    if (isNaN(video.duration)) return;
    totalTimeDisplay.text(formatTime(video.duration));
    updateProgressBar(0);
    startProgressUpdate();
  });

  // 视频播放/暂停
  $(video).on("play", () => {
    startProgressUpdate();
  });

  $(video).on("pause", () => {
    stopProgressUpdate();
  });

  // 视频结束
  $(video).on("ended", () => {
    if (!settings.videoLoop) {
      // 视频结束后自动切换
      showMedia("next");
    }
  });

  // 进度条点击
  progressBar.on("click", (e) => {
    if (!video || isNaN(video.duration)) return;
    const rect = progressBar[0].getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
    updateProgressBar(pos);
  });

  // 进度条拖动
  let progressDrag = false;
  progressHandle.on("mousedown", () => {
    progressDrag = true;
  });
  $(document).on("mousemove", (e) => {
    if (!progressDrag || !video || isNaN(video.duration)) return;
    const rect = progressBar[0].getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pos * video.duration;
    updateProgressBar(pos);
  });
  $(document).on("mouseup", () => {
    progressDrag = false;
  });

  // 音量按钮
  volumeBtn.on("click", () => {
    const newVolume = video.volume > 0 ? 0 : settings.videoVolume || 0.8;
    video.volume = newVolume;
    updateVolume(newVolume);
  });

  // 音量滑块
  volumeSlider.on("input", function () {
    const volume = parseFloat($(this).val());
    updateVolume(volume);
  });

  // 循环按钮
  loopBtn.on("click", () => {
    settings.videoLoop = !settings.videoLoop;
    $(this).toggleClass("active");
    if (video) video.loop = settings.videoLoop;
    saveSafeSettings();
  });
};

/**
 * 绑定设置面板事件
 */
export const bindSettingsEvents = () => {
  const settings = getSettings();
  const panel = $(`#${SETTINGS_PANEL_ID}`);
  if (!panel.length) return;

  // 总开关
  panel.find("#master-enabled").on("change", function () {
    const enabled = $(this).is(":checked");
    settings.masterEnabled = enabled;

    if (enabled) {
      createPlayerWindow();
      import("./websocket.js").then(({ initWebSocket }) => initWebSocket());
      if (!settings.aiEventRegistered) registerAIEventListeners();
      toastr.success("媒体播放器已启用");
    } else {
      stopPlayback();
      import("./websocket.js").then(({ closeWebSocket }) => closeWebSocket());
      $(`#${PLAYER_WINDOW_ID}`).hide();
      settings.isWindowVisible = false;
      toastr.info("媒体播放器已禁用");
    }

    saveSafeSettings();
  });

  // 切换模式选择
  panel.find("#auto-switch-mode").on("change", function () {
    const mode = $(this).val();
    panel.find("#switch-interval-row").toggle(mode === "timer");
  });

  // 更新目录按钮
  panel.find("#update-directory").on("click", async () => {
    const newPath = panel.find("#player-scan-directory").val().trim();
    await updateScanDirectory(newPath);
  });

  // 更新大小限制
  panel.find("#update-size-limits").on("click", async () => {
    const imageMax = parseInt(panel.find("#image-max-size").val()) || 10;
    const videoMax = parseInt(panel.find("#video-max-size").val()) || 100;
    await updateMediaSizeLimit(imageMax, videoMax);
  });

  // 清理媒体按钮
  panel.find("#cleanup-media").on("click", async () => {
    if (
      confirm("确定要清理无效媒体吗？这将删除不存在或超过大小限制的媒体记录。")
    ) {
      await cleanupInvalidMedia();
    }
  });

  // 刷新媒体列表
  panel.find("#refresh-media-list").on("click", async () => {
    toastr.info("正在刷新媒体列表...");
    const list = await refreshMediaList();
    toastr.success(`媒体列表已刷新，共${list.length}个媒体`);
  });

  // 保存设置按钮
  panel.find("#save-settings").on("click", () => {
    // 收集设置
    settings.serviceUrl =
      panel.find("#player-service-url").val().trim() || "http://localhost:9000";
    settings.playMode = panel.find("#play-mode").val();
    settings.autoSwitchMode = panel.find("#auto-switch-mode").val();
    settings.switchInterval = Math.max(
      1000,
      parseInt(panel.find("#switch-interval").val()) || 5000
    );
    settings.transitionEffect = panel.find("#transition-effect").val();
    settings.hideBorder = panel.find("#hide-border").is(":checked");
    settings.showInfo = panel.find("#show-info").is(":checked");
    settings.aiDetectEnabled = panel.find("#ai-detect-enabled").is(":checked");
    settings.playerDetectEnabled = panel
      .find("#player-detect-enabled")
      .is(":checked");
    settings.aiResponseCooldown = Math.max(
      1000,
      parseInt(panel.find("#ai-cooldown").val()) || 3000
    );
    settings.preloadImages = panel.find("#preload-images").is(":checked");
    settings.preloadVideos = panel.find("#preload-videos").is(":checked");
    settings.showMediaUpdateToast = panel
      .find("#show-media-update-toast")
      .is(":checked");
    settings.videoLoop = panel.find("#video-loop").is(":checked");

    // 应用视频循环设置
    const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
    if (video) video.loop = settings.videoLoop;

    // 应用窗口边框设置
    const win = $(`#${PLAYER_WINDOW_ID}`);
    if (win.length) {
      win.toggleClass("no-border", settings.hideBorder);
      win.find(".image-info").toggle(settings.showInfo);
    }

    // 重启播放以应用新设置
    if (settings.isPlaying) {
      stopPlayback();
      startPlayback();
    }

    // 重启WebSocket连接
    import("./websocket.js").then(({ closeWebSocket, initWebSocket }) => {
      closeWebSocket();
      initWebSocket();
    });

    saveSafeSettings();
    toastr.success("设置已保存");
  });

  // 重置默认设置
  panel.find("#reset-settings").on("click", () => {
    if (confirm("确定要重置为默认设置吗？当前设置将丢失。")) {
      import("./settings.js").then(({ DEFAULT_SETTINGS }) => {
        // 重置设置
        Object.assign(settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));

        // 重启WebSocket
        import("./websocket.js").then(({ closeWebSocket, initWebSocket }) => {
          closeWebSocket();
          initWebSocket();
        });

        // 重新创建UI
        $(`#${PLAYER_WINDOW_ID}`).remove();
        $(`#${SETTINGS_PANEL_ID}`).remove();
        createPlayerWindow();
        createSettingsPanel();

        saveSafeSettings();
        toastr.success("已重置为默认设置");
      });
    }
  });

  // 关闭设置面板
  panel.find("#close-settings").on("click", () => {
    panel.hide();
  });

  // 禁用扩展
  panel.find("#disable-extension").on("click", () => {
    if (confirm("确定要禁用媒体播放器扩展吗？所有窗口将关闭。")) {
      disableExtension();
      panel.remove();
    }
  });
};

/**
 * 更新状态显示（服务状态、媒体数量等）
 */
export const updateStatusDisplay = async () => {
  const panel = $(`#${SETTINGS_PANEL_ID}`);
  if (!panel.length) return;

  const serviceStatus = await import("./api.js").then(
    ({ checkServiceStatus }) => checkServiceStatus()
  );
  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const observerStatus = serviceStatus.observerActive ? "已启用" : "已禁用";
  const statusText = `${serviceActive}（监控: ${observerStatus} | 总计: ${serviceStatus.totalCount} | 图片: ${serviceStatus.imageCount} | 视频: ${serviceStatus.videoCount}）`;

  panel
    .find(".service-status .status-success, .service-status .status-error")
    .removeClass("status-success status-error")
    .addClass(serviceStatus.active ? "status-success" : "status-error")
    .text(statusText);
};

/**
 * 初始化UI
 */
export const initUI = async () => {
  createExtensionButton();
  const settings = getSettings();

  if (settings.masterEnabled) {
    await createPlayerWindow();
    await createSettingsPanel();

    // 初始显示第一张媒体
    if (
      settings.isWindowVisible &&
      (
        await import("./api.js").then(({ checkServiceStatus }) =>
          checkServiceStatus()
        )
      ).active
    ) {
      showMedia("current");
    }
  }
};
