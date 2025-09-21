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

const EXTENSION_NAME = "媒体播放器";
const EXTENSION_ID = "st_image_player";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings-panel";

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

    // 新增：监听媒体状态更新以同步UI
    const removeMediaStateListener = EventBus.on("mediaStateUpdated", (media) => {
      const $ = deps.jQuery;
      if (!$) return;

      // 更新媒体信息显示
      const infoElement = $(`#${PLAYER_WINDOW_ID} .image-info`);
      if (infoElement.length) {
        infoElement.text(`${media.meta.name} (${media.meta.type} · ${media.meta.size})`);
      }

      // 更新视频控制栏时间显示
      if (media.meta.type === "video") {
        $(`#${PLAYER_WINDOW_ID} .total-time`).text(formatTime(media.state.duration));
        $(`#${PLAYER_WINDOW_ID} .current-time`).text(formatTime(media.state.currentTime));
      }
    });

    // 保存取消监听方法（包含所有事件）
    window.uiEventListeners = [
      removeCreateWindowListener,
      removeCreatePanelListener,
      removeUpdateStatusListener,
      removeShowMediaListener,
      removeMediaStateListener
    ];

    // 使用safeJQuery确保jQuery可用
    safeJQuery(() => {
      const $ = deps.jQuery;
      if (!$) {
        toastr.error("jQuery 未加载，UI 功能无法使用");
        return;
      }

      // 创建扩展菜单按钮
      createExtensionButton();

      // 启用状态下创建UI
      if (settings.masterEnabled) {
        createPlayerWindow();
        createSettingsPanel();

        // 检查服务就绪后显示初始媒体
        const statusListener = EventBus.on(
          "serviceStatusChecked",
          (status) => {
            statusListener(); // 移除监听器
            if (status.active && settings.isWindowVisible) {
              EventBus.emit("requestShowInitialMedia");
            }
          }
        );
        EventBus.emit("requestCheckServiceStatus");
      }
    });

    console.log(`[ui] 初始化完成，已注册事件监听`);
  } catch (e) {
    console.error(`[ui] 初始化错误:`, e);
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[ui] 初始化失败: ${e.message}`);
    }
  }
};

/**
 * 清理UI资源（移除元素+取消监听）
 */
export const cleanup = () => {
  try {
    safeJQuery(() => {
      const $ = deps.jQuery;
      if ($) {
        // 移除UI元素
        $(`#${PLAYER_WINDOW_ID}`).remove();
        $(`#${SETTINGS_PANEL_ID}`).remove();
        $(`#ext_menu_${EXTENSION_ID}`).remove();
      }
    });

    // 取消事件监听
    if (window.uiEventListeners) {
      window.uiEventListeners.forEach((removeListener) => {
        if (typeof removeListener === "function") {
          removeListener();
        }
      });
      window.uiEventListeners = null;
    }

    console.log(`[ui] 资源清理完成`);
  } catch (e) {
    console.error(`[ui] 清理错误:`, e);
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[ui] 清理失败: ${e.message}`);
    }
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
    <div id="ext_menu_${EXTENSION_ID}" class="list-group-item flex-container flexGap5">
      <div class="fa-solid fa-film"></div>
      <span>${EXTENSION_NAME}</span>
      <span class="media-info" style="margin-left:8px; font-size:10px; color:#a0a0a0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${settings.showInfo ? "加载中..." : "隐藏信息"}
      </span>
      <span class="play-status" style="margin-left:auto; font-size:10px; color:#a0a0a0;">${settings.isPlaying ? "播放中" : "已暂停"}</span>
      <span class="mode-text" style="margin-left:8px; font-size:10px; color:#a0a0a0;">${settings.playMode === "random" ? "随机" : "顺序"}</span>
      <span class="filter-text" style="margin-left:8px; font-size:10px; color:#a0a0a0;">${settings.mediaFilter === "all" ? "所有" : settings.mediaFilter === "image" ? "图片" : "视频"}</span>
    </div>
  `;

  // 添加到扩展菜单
  if ($("#extensionsMenu").length) {
    $("#extensionsMenu").append(buttonHtml);
  } else {
    // 备选位置
    $("body").append(`
      <div id="extensionsMenu" class="extensions-menu">
        ${buttonHtml}
      </div>
    `);
  }

  // 绑定按钮事件
  $(`#ext_menu_${EXTENSION_ID}`).on("click", () => {
    $("#extensions-settings-button").trigger("click");
    $(`#${SETTINGS_PANEL_ID}`).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });

  // 增强菜单状态更新
  setInterval(() => {
    const settings = get();
    const menuBtn = $(`#ext_menu_${EXTENSION_ID}`); // 修复: 使用正确的ID选择器
    const win = $(`#${PLAYER_WINDOW_ID}`);
    const infoElement = win.find(".image-info");

    // 同步播放状态
    menuBtn.find(".play-status").text(settings.isPlaying ? "播放中" : "已暂停");
    // 同步播放模式
    menuBtn.find(".mode-text").text(settings.playMode === "random" ? "随机" : "顺序");
    // 同步媒体筛选
    menuBtn.find(".filter-text").text(
      settings.mediaFilter === "all" ? "所有" :
        settings.mediaFilter === "image" ? "图片" : "视频"
    );
    // 同步媒体信息
    if (settings.showInfo && infoElement.is(":visible")) {
      menuBtn.find(".media-info").text(infoElement.text()).show();
    } else {
      menuBtn.find(".media-info").text("隐藏信息").show();
    }
  }, 1000);
};

/**
 * 创建播放器窗口
 */
export const createPlayerWindow = async () => {
  const settings = get();

  safeJQuery(() => {
    const $ = deps.jQuery;
    if (!$ || !settings.masterEnabled || $(`#${PLAYER_WINDOW_ID}`).length) return;

    const html = `
      <div id="${PLAYER_WINDOW_ID}" class="image-player-window ${settings.hideBorder ? "no-border" : ""}">
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
            <img class="image-player-img" onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFAAH/l8iC5gAAAABJRU5ErkJggg=='" />
            <video class="image-player-video" preload="metadata" ${settings.videoLoop ? "loop" : ""}>您的浏览器不支持HTML5视频</video>
            ${settings.showVideoControls ? `
              <div class="video-controls">
                ${settings.customVideoControls.showProgress ? `
                  <div class="progress-container">
                    <div class="progress-bar">
                      <div class="progress-loaded"></div>
                      <div class="progress-played"></div>
                      <div class="progress-handle"></div>
                    </div>
                  </div>
                ` : ""}
                <div class="video-control-group">
                  ${settings.customVideoControls.showVolume ? `
                    <button class="video-control-btn volume-btn">
                      <i class="fa-solid ${settings.videoVolume > 0 ? "fa-volume-high" : "fa-volume-mute"}"></i>
                    </button>
                    <div class="volume-slider-container">
                      <input type="range" class="volume-slider" min="0" max="1" step="0.05" value="${settings.videoVolume}" />
                    </div>
                  ` : ""}
                  ${settings.customVideoControls.showLoop ? `
                    <button class="video-control-btn loop-btn ${settings.videoLoop ? "active" : ""}">
                      <i class="fa-solid fa-repeat"></i>
                    </button>
                  ` : ""}
                  ${settings.customVideoControls.showTime ? `
                    <div class="time-display">
                      <span class="current-time">00:00</span> / <span class="total-time">00:00</span>
                    </div>
                  ` : ""}
                </div>
              </div>
            ` : ""}
          </div>
          <div class="image-info" ${!settings.showInfo ? 'style="display:none;"' : ""}>加载中...</div>
        </div>
        <div class="image-player-controls">
          <div class="controls-group">
            <button class="control-btn play-pause"><i class="fa-solid ${settings.isPlaying ? "fa-pause" : "fa-play"}"></i></button>
            <button class="control-btn mode-switch" title="${settings.playMode === "random" ? "随机模式" : "顺序模式"}">
              <i class="fa-solid ${settings.playMode === "random" ? "fa-shuffle" : "fa-list-ol"}"></i>
            </button>
            <button class="control-btn switch-mode-toggle ${settings.autoSwitchMode === "detect" ? "active" : ""}" title="${settings.autoSwitchMode === "detect" ? "检测播放" : "定时切换"
      }">
              <i class="fa-solid ${settings.autoSwitchMode === "detect" ? "fa-robot" : "fa-clock"}"></i>
            </button>
          </div>
          <div class="controls-group">
            <button class="control-btn prev" title="上一个"><i class="fa-solid fa-backward-step"></i></button>
            <div class="control-text">${settings.playMode === "random" ? "随机模式" : "顺序模式: 0/0"
      }</div>
            <button class="control-btn next" title="下一个"><i class="fa-solid fa-forward-step"></i></button>
          </div>
          <div class="controls-group media-filter-group">
            <button class="control-btn media-filter-btn ${settings.mediaFilter === "all" ? "active" : ""}" data-type="all" title="所有媒体">
              <i class="fa-solid fa-film"></i>
            </button>
            <button class="control-btn media-filter-btn ${settings.mediaFilter === "image" ? "active" : ""}" data-type="image" title="仅图片">
              <i class="fa-solid fa-image"></i>
            </button>
            <button class="control-btn media-filter-btn ${settings.mediaFilter === "video" ? "active" : ""}" data-type="video" title="仅视频">
              <i class="fa-solid fa-video"></i>
            </button>
          </div>
          <div class="resize-handle"></div>
        </div>
      </div>
    `;

    $("body").append(html);
    setupWindowEvents();
    positionWindow();
    bindVideoControls();
    bindPlayerControls(); // 绑定新增控制栏事件

    // 初始化筛选状态同步
    const filterBtn = $(`#${PLAYER_WINDOW_ID} .media-filter-btn[data-type="${settings.mediaFilter}"]`);
    filterBtn.addClass("active");

    const video = $(`#${PLAYER_WINDOW_ID} .image-player-video`)[0];
    if (video) video.volume = settings.videoVolume;
    console.log(`[ui] 播放器窗口创建完成（含完整控制栏）`);
  });
};

// 新增控制栏事件绑定
const bindPlayerControls = () => {
  const $ = deps.jQuery;
  const $win = $(`#${PLAYER_WINDOW_ID}`);

  // 播放/暂停按钮
  $win.find(".play-pause").on("click", () => {
    EventBus.emit("togglePlayPause");
  });

  // 模式切换按钮
  $win.find(".mode-switch").on("click", () => {
    const settings = get();
    const newMode = settings.playMode === "random" ? "sequence" : "random";
    EventBus.emit("changePlayMode", newMode);
  });

  // 自动切换模式
  $win.find(".switch-mode-toggle").on("click", () => {
    const settings = get();
    const newMode = settings.autoSwitchMode === "detect" ? "timer" : "detect";
    EventBus.emit("changeAutoSwitchMode", newMode);
  });

  // 上一个/下一个按钮
  $win.find(".prev").on("click", () => {
    EventBus.emit("requestMediaPlay", { direction: "prev" });
  });
  $win.find(".next").on("click", () => {
    EventBus.emit("requestMediaPlay", { direction: "next" });
  });

  // 媒体筛选按钮
  $win.find(".media-filter-btn").on("click", function () {
    const type = $(this).data("type");
    $win.find(".media-filter-btn").removeClass("active");
    $(this).addClass("active");
    EventBus.emit("changeMediaFilter", type);
  });
};

// 修复后的 createSettingsPanel 函数
export const createSettingsPanel = async () => {
  const settings = deps.settings.get();
  const $ = deps.jQuery;
  if (!$ || !settings.masterEnabled || $(`#${SETTINGS_PANEL_ID}`).length) return;

  // 获取服务状态
  const serviceStatus = await new Promise((resolve) => {
    const removeListener = EventBus.on("serviceStatusChecked", (status) => {
      removeListener();
      resolve(status);
    });
    EventBus.emit("requestCheckServiceStatus");
  });

  const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
  const serviceDir = serviceStatus.directory || settings.serviceDirectory || "未设置";

  const html = `
    <div id="${SETTINGS_PANEL_ID}" class="extension_settings inline-drawer">
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
              <input type="checkbox" id="master-enabled" ${settings.masterEnabled ? "checked" : ""} />
              <i class="fa-solid fa-power-off"></i>启用媒体播放器扩展
            </label>
          </div>
          
          <!-- 服务状态 -->
          <div class="settings-row">
            <label class="service-status">
              <i class="fa-solid ${serviceStatus.active ? "fa-plug-circle-check" : "fa-plug"}"></i>
              服务状态: <span class="${serviceStatus.active ? "status-success" : "status-error"}">${serviceActive}（监控: ${serviceStatus.observerActive ? "已启用" : "已禁用"} | 总计: ${serviceStatus.totalCount || 0} | 图片: ${serviceStatus.imageCount || 0} | 视频: ${serviceStatus.videoCount || 0}）</span>
            </label>
          </div>
          
          <!-- 基础配置 -->
          <div class="settings-row">
            <label><i class="fa-solid fa-link"></i>服务地址</label>
            <input type="text" id="player-service-url" value="${settings.serviceUrl}" placeholder="http://localhost:9000" />
          </div>
          
          <div class="settings-row">
            <label><i class="fa-solid fa-folder"></i>媒体目录</label>
            <input type="text" id="player-scan-directory" value="${settings.serviceDirectory || serviceStatus.directory}" placeholder="输入完整路径" />
            <button id="update-directory" class="menu-button">更新目录</button>
          </div>
          
          <!-- 媒体大小限制 -->
          <div class="settings-group">
            <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
              <i class="fa-solid fa-maximize"></i> 媒体大小限制
            </h4>
            <div class="settings-row">
              <label><i class="fa-solid fa-image"></i>图片最大尺寸</label>
              <input type="number" id="image-max-size" value="${settings.mediaConfig?.image_max_size_mb || 5}" min="1" max="50" step="1" />
              <span>MB</span>
              
              <label><i class="fa-solid fa-video"></i>视频最大尺寸</label>
              <input type="number" id="video-max-size" value="${settings.mediaConfig?.video_max_size_mb || 100}" min="10" max="500" step="10" />
              <span>MB</span>
              
              <button id="update-size-limit" class="menu-button">应用限制</button>
            </div>
          </div>
          
          <!-- 媒体更新提示开关 -->
          <div class="settings-row">
            <label class="checkbox_label">
              <input type="checkbox" id="show-media-update-toast" ${settings.showMediaUpdateToast ? "checked" : ""} />
              <i class="fa-solid fa-bell"></i>显示媒体库更新提示
            </label>
          </div>
          
          <!-- 边框隐藏 -->
          <div class="settings-row">
            <label class="checkbox_label">
              <input type="checkbox" id="player-hide-border" ${settings.hideBorder ? "checked" : ""} />
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
                <input type="checkbox" id="custom-show-progress" ${settings.customVideoControls.showProgress ? "checked" : ""} />
                显示进度条
              </label>
              <label class="checkbox_label">
                <input type="checkbox" id="custom-show-volume" ${settings.customVideoControls.showVolume ? "checked" : ""} />
                显示音量控制
              </label>
              <label class="checkbox_label">
                <input type="checkbox" id="custom-show-loop" ${settings.customVideoControls.showLoop ? "checked" : ""} />
                显示循环按钮
              </label>
              <label class="checkbox_label">
                <input type="checkbox" id="custom-show-time" ${settings.customVideoControls.showTime ? "checked" : ""} />
                显示时间戳
              </label>
            </div>
          </div>
          
          <!-- 播放模式切换 -->
          <div class="function-toggle-group">
            <div class="function-toggle ${settings.autoSwitchMode === "timer" ? "active" : ""}" id="toggle-timer-mode">
              <i class="fa-solid fa-clock"></i>
              <span>定时播放</span>
            </div>
            <div class="function-toggle ${settings.autoSwitchMode === "detect" ? "active" : ""}" id="toggle-detect-mode">
              <i class="fa-solid fa-robot"></i>
              <span>检测播放</span>
            </div>
          </div>
          
          <!-- 检测模式子选项 -->
          <div class="settings-group" ${settings.autoSwitchMode !== "detect" ? 'style="display:none;"' : ""} id="detect-sub-options">
            <div class="settings-row">
              <label class="checkbox_label">
                <input type="checkbox" id="player-ai-detect" ${settings.aiDetectEnabled ? "checked" : ""} />
                <i class="fa-solid fa-comment-dots"></i>AI回复时切换
              </label>
              <label class="checkbox_label">
                <input type="checkbox" id="player-player-detect" ${settings.playerDetectEnabled ? "checked" : ""} />
                <i class="fa-solid fa-keyboard"></i>玩家发送时切换
              </label>
            </div>
          </div>
          
          <!-- 核心配置 -->
          <div class="settings-row">
            <label><i class="fa-solid fa-clone"></i>播放模式</label>
            <select id="player-play-mode">
              <option value="random" ${settings.playMode === "random" ? "selected" : ""}>随机播放</option>
              <option value="sequential" ${settings.playMode === "sequential" ? "selected" : ""}>顺序播放</option>
            </select>
            
            <label><i class="fa-solid fa-filter"></i>媒体筛选</label>
            <select id="player-media-filter">
              <option value="all" ${settings.mediaFilter === "all" ? "selected" : ""}>所有媒体</option>
              <option value="image" ${settings.mediaFilter === "image" ? "selected" : ""}>仅图片</option>
              <option value="video" ${settings.mediaFilter === "video" ? "selected" : ""}>仅视频</option>
            </select>
          </div>
          
          <div class="settings-row">
            <label class="checkbox_label">
              <input type="checkbox" id="player-slideshow-mode" ${settings.slideshowMode ? "checked" : ""} ${settings.playMode === "random" ? "disabled" : ""} />
              <i class="fa-solid fa-repeat"></i>图片循环播放
            </label>
            <label class="checkbox_label">
              <input type="checkbox" id="player-video-loop" ${settings.videoLoop ? "checked" : ""} />
              <i class="fa-solid fa-repeat"></i>视频循环播放
            </label>
            <label class="checkbox_label">
              <input type="checkbox" id="player-show-info" ${settings.showInfo ? "checked" : ""} />
              <i class="fa-solid fa-circle-info"></i>显示媒体信息
            </label>
          </div>
          
          <div class="settings-row">
            <label class="checkbox_label">
              <input type="checkbox" id="player-preload-images" ${settings.preloadImages ? "checked" : ""} />
              <i class="fa-solid fa-bolt"></i>预加载图片
            </label>
            <label class="checkbox_label">
              <input type="checkbox" id="player-preload-videos" ${settings.preloadVideos ? "checked" : ""} />
              <i class="fa-solid fa-bolt"></i>预加载视频（耗流量）
            </label>
            <label class="checkbox_label">
              <input type="checkbox" id="player-show-video-controls" ${settings.showVideoControls ? "checked" : ""} />
              <i class="fa-solid fa-video"></i>显示视频控制栏
            </label>
          </div>
          
          <!-- 时间配置 -->
          <div class="settings-row">
            <label><i class="fa-solid fa-clock"></i>定时切换间隔</label>
            <input type="number" id="player-interval" value="${settings.switchInterval}" min="1000" max="60000" step="500" />
            <span>毫秒</span>
          </div>
          
          <div class="settings-row">
            <label><i class="fa-solid fa-sync"></i>服务轮询间隔</label>
            <input type="number" id="player-polling-interval" value="${settings.pollingInterval}" min="5000" max="300000" step="5000" />
            <span>毫秒</span>
          </div>
          
          <!-- 图片过渡效果 -->
          <div class="settings-row">
            <label><i class="fa-solid fa-paint-brush"></i>图片过渡效果</label>
            <select id="player-transition-effect">
              <option value="none" ${settings.transitionEffect === "none" ? "selected" : ""}>无效果</option>
              <option value="fade" ${settings.transitionEffect === "fade" ? "selected" : ""}>淡入淡出</option>
              <option value="slide" ${settings.transitionEffect === "slide" ? "selected" : ""}>滑动</option>
              <option value="zoom" ${settings.transitionEffect === "zoom" ? "selected" : ""}>缩放</option>
            </select>
          </div>
          
          <!-- 检测冷却时间 -->
          <div class="settings-group">
            <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
              <i class="fa-solid fa-robot"></i> 检测设置
            </h4>
            <div class="settings-row">
              <label><i class="fa-solid fa-hourglass-half"></i>切换冷却时间</label>
              <input type="number" id="player-ai-cooldown" value="${settings.aiResponseCooldown}" min="1000" max="30000" step="500" />
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
  `;

  $("#extensions_settings").append(html);
  setupSettingsEvents();

  console.log(`[ui] 设置面板创建完成`);
};

// 设置面板事件绑定
const setupSettingsEvents = () => {
  const $ = deps.jQuery;
  const $panel = $(`#${SETTINGS_PANEL_ID}`);
  if (!$panel.length) return;

  // 折叠面板切换
  $panel.find(".inline-drawer-toggle").click(function () {
    $panel.toggleClass("is-open");
    $panel.find(".inline-drawer-content").slideToggle();
  });

  // 总开关
  $panel.find("#master-enabled").change(function () {
    const enabled = $(this).is(":checked");
    deps.settings.update({ masterEnabled: enabled });

    if (enabled) {
      createPlayerWindow();
      EventBus.emit("requestCheckServiceStatus");
    } else {
      $(`#${PLAYER_WINDOW_ID}`).remove();
    }
  });

  // 服务地址更新
  $panel.find("#player-service-url").change(function () {
    const newUrl = $(this).val().trim();
    if (newUrl) {
      deps.settings.update({ serviceUrl: newUrl });
      EventBus.emit("requestCheckServiceStatus");
      toastr.info("服务地址已更新");
    }
  });

  // 更新目录
  $panel.find("#update-directory").click(function () {
    const newPath = $panel.find("#player-scan-directory").val().trim();
    if (newPath) {
      // 移除目录有效性检查（网页版无法进行）
      EventBus.emit("requestUpdateScanDirectory", { newPath });
      toastr.info("正在更新目录...");
    } else {
      toastr.warning("请输入有效的目录路径");
    }
  });

  // 应用大小限制
  $panel.find("#update-size-limit").click(function () {
    const imageMaxMb = parseInt($panel.find("#image-max-size").val());
    const videoMaxMb = parseInt($panel.find("#video-max-size").val());

    if (isNaN(imageMaxMb) || isNaN(videoMaxMb)) {
      toastr.warning("请输入有效的数值");
      return;
    }

    EventBus.emit("requestUpdateMediaSizeLimit", { imageMaxMb, videoMaxMb });
  });

  // 媒体更新提示
  $panel.find("#show-media-update-toast").change(function () {
    deps.settings.update({ showMediaUpdateToast: $(this).is(":checked") });
  });

  // 边框隐藏
  $panel.find("#player-hide-border").change(function () {
    const hideBorder = $(this).is(":checked");
    deps.settings.update({ hideBorder });

    const $playerWindow = $(`#${PLAYER_WINDOW_ID}`);
    if ($playerWindow.length) {
      $playerWindow.toggleClass("no-border", hideBorder);
    }
  });

  // 视频控制自定义选项
  $panel.find("#custom-show-progress").change(function () {
    deps.settings.update({
      customVideoControls: {
        ...deps.settings.get().customVideoControls,
        showProgress: $(this).is(":checked")
      }
    });
    // 重新创建播放器窗口以应用设置
    $(`#${PLAYER_WINDOW_ID}`).remove();
    createPlayerWindow();
  });

  $panel.find("#custom-show-volume").change(function () {
    deps.settings.update({
      customVideoControls: {
        ...deps.settings.get().customVideoControls,
        showVolume: $(this).is(":checked")
      }
    });
    $(`#${PLAYER_WINDOW_ID}`).remove();
    createPlayerWindow();
  });

  $panel.find("#custom-show-loop").change(function () {
    deps.settings.update({
      customVideoControls: {
        ...deps.settings.get().customVideoControls,
        showLoop: $(this).is(":checked")
      }
    });
    $(`#${PLAYER_WINDOW_ID}`).remove();
    createPlayerWindow();
  });

  $panel.find("#custom-show-time").change(function () {
    deps.settings.update({
      customVideoControls: {
        ...deps.settings.get().customVideoControls,
        showTime: $(this).is(":checked")
      }
    });
    $(`#${PLAYER_WINDOW_ID}`).remove();
    createPlayerWindow();
  });

  // 功能切换按钮组
  $panel.find("#toggle-timer-mode").click(function () {
    deps.settings.update({ autoSwitchMode: "timer" });
    $panel.find("#toggle-timer-mode").addClass("active");
    $panel.find("#toggle-detect-mode").removeClass("active");
    $panel.find("#detect-sub-options").hide();
  });

  $panel.find("#toggle-detect-mode").click(function () {
    deps.settings.update({ autoSwitchMode: "detect" });
    $panel.find("#toggle-detect-mode").addClass("active");
    $panel.find("#toggle-timer-mode").removeClass("active");
    $panel.find("#detect-sub-options").show();
  });

  // 检测模式子选项
  $panel.find("#player-ai-detect").change(function () {
    deps.settings.update({ aiDetectEnabled: $(this).is(":checked") });
  });

  $panel.find("#player-player-detect").change(function () {
    deps.settings.update({ playerDetectEnabled: $(this).is(":checked") });
  });

  // 播放模式
  $panel.find("#player-play-mode").change(function () {
    const playMode = $(this).val();
    deps.settings.update({ playMode });

    // 随机模式下禁用幻灯片模式
    if (playMode === "random") {
      $panel.find("#player-slideshow-mode").prop("checked", false).prop("disabled", true);
      deps.settings.update({ slideshowMode: false });
    } else {
      $panel.find("#player-slideshow-mode").prop("disabled", false);
    }
  });

  // 媒体筛选
  $panel.find("#player-media-filter").change(function () {
    deps.settings.update({ mediaFilter: $(this).val() });
    EventBus.emit("requestRefreshMediaList", { filterType: $(this).val() });
  });

  // 循环播放设置
  $panel.find("#player-slideshow-mode").change(function () {
    deps.settings.update({ slideshowMode: $(this).is(":checked") });
  });

  $panel.find("#player-video-loop").change(function () {
    deps.settings.update({ videoLoop: $(this).is(":checked") });

    const $playerWindow = $(`#${PLAYER_WINDOW_ID}`);
    if ($playerWindow.length) {
      const video = $playerWindow.find(".image-player-video")[0];
      if (video) video.loop = $(this).is(":checked");
    }
  });

  $panel.find("#player-show-info").change(function () {
    const showInfo = $(this).is(":checked");
    deps.settings.update({ showInfo });

    const $playerWindow = $(`#${PLAYER_WINDOW_ID}`);
    if ($playerWindow.length) {
      $playerWindow.find(".image-info").toggle(showInfo);
      $playerWindow.find(".toggle-info").toggleClass("active", showInfo);
    }
  });

  // 预加载设置
  $panel.find("#player-preload-images").change(function () {
    deps.settings.update({ preloadImages: $(this).is(":checked") });
  });

  $panel.find("#player-preload-videos").change(function () {
    deps.settings.update({ preloadVideos: $(this).is(":checked") });
  });

  $panel.find("#player-show-video-controls").change(function () {
    const showVideoControls = $(this).is(":checked");
    deps.settings.update({ showVideoControls });

    const $playerWindow = $(`#${PLAYER_WINDOW_ID}`);
    if ($playerWindow.length) {
      $playerWindow.find(".video-controls").toggle(showVideoControls);
      $playerWindow.find(".toggle-video-controls").toggleClass("active", showVideoControls);
      adjustVideoControlsLayout($playerWindow);
    }
  });

  // 时间间隔设置
  $panel.find("#player-interval").change(function () {
    const interval = parseInt($(this).val());
    if (!isNaN(interval) && interval >= 1000 && interval <= 60000) {
      deps.settings.update({ switchInterval: interval });
    }
  });

  $panel.find("#player-polling-interval").change(function () {
    const interval = parseInt($(this).val());
    if (!isNaN(interval) && interval >= 5000 && interval <= 300000) {
      deps.settings.update({ pollingInterval: interval });
    }
  });

  // 过渡效果
  $panel.find("#player-transition-effect").change(function () {
    deps.settings.update({ transitionEffect: $(this).val() });
  });

  // 检测冷却时间
  $panel.find("#player-ai-cooldown").change(function () {
    const cooldown = parseInt($(this).val());
    if (!isNaN(cooldown) && cooldown >= 1000 && cooldown <= 30000) {
      deps.settings.update({ aiResponseCooldown: cooldown });
    }
  });

  // 操作按钮
  $panel.find("#show-player").click(function () {
    const $playerWindow = $(`#${PLAYER_WINDOW_ID}`);
    if (!$playerWindow.length) {
      createPlayerWindow();
    }
    $playerWindow.show();
    deps.settings.update({ isWindowVisible: true });
  });

  $panel.find("#player-refresh").click(function () {
    EventBus.emit("requestCheckServiceStatus");
    EventBus.emit("requestRefreshMediaList");
    toastr.info("正在刷新服务状态...");
  });

  $panel.find("#clear-random-history").click(function () {
    if (confirm("确定要清理随机播放历史记录吗？这将重置随机播放算法。")) {
      EventBus.emit("requestClearRandomHistory");
      toastr.info("随机播放历史已清理");
    }
  });

  $panel.find("#cleanup-media").click(function () {
    if (confirm("确定要清理无效的媒体文件吗？此操作不会删除实际文件，仅从媒体库中移除记录。")) {
      EventBus.emit("requestCleanupInvalidMedia");
    }
  });
};

const setupWindowEvents = () => {
  const $ = deps.jQuery;
  const $window = $(`#${PLAYER_WINDOW_ID}`);
  if (!$window.length) return;

  const settings = get();

  // 窗口拖动 - 使用老版本的类名
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

    $(`#ext_menu_${EXTENSION_ID} .showhide i`)
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