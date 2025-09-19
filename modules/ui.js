import { deps } from "../core/deps.js";

// 模块私有变量
const winSelector = "#st-image-player-window";
let eventListeners = []; // 事件监听器集合

/**
 * 初始化UI模块
 */
export const init = () => {
  try {
    const settings = deps.settings.getSettings();

    // 注册事件监听（接收外部UI操作请求）
    const removeCreateWindowListener = deps.EventBus.on(
      "requestCreatePlayerWindow",
      createPlayerWindow
    );
    const removeCreatePanelListener = deps.EventBus.on(
      "requestCreateSettingsPanel",
      createSettingsPanel
    );
    const removeUpdateStatusListener = deps.EventBus.on(
      "requestUpdateStatusDisplay",
      updateStatusDisplay
    );
    const removeShowMediaListener = deps.EventBus.on(
      "requestShowInitialMedia",
      () => {
        if (settings.isWindowVisible) {
          deps.EventBus.emit("requestMediaPlay", { direction: "current" });
        }
      }
    );

    // 保存事件监听器
    eventListeners = [
      removeCreateWindowListener,
      removeCreatePanelListener,
      removeUpdateStatusListener,
      removeShowMediaListener,
    ];

    const $ = deps.jQuery;
    if (!$) {
      deps.toastr.error("jQuery 未加载，UI 功能无法使用");
      return;
    }

    // 创建扩展菜单按钮
    createExtensionButton();

    // 启用状态下创建UI
    if (settings.masterEnabled) {
      createPlayerWindow();
      createSettingsPanel();

      // 检查服务就绪后显示初始媒体
      const checkServiceAndShow = () => {
        const removeListener = deps.EventBus.on(
          "serviceStatusChecked",
          (status) => {
            removeListener();
            if (status.active && settings.isWindowVisible) {
              deps.EventBus.emit("requestShowInitialMedia");
            }
          }
        );
        deps.EventBus.emit("requestCheckServiceStatus");
      };

      checkServiceAndShow();
    }

    console.log(`[ui] UI模块初始化完成`);
  } catch (e) {
    deps.toastr.error(`[ui] 初始化失败: ${e.message}`);
    console.error(`[ui] 初始化错误:`, e);
  }
};

/**
 * 清理UI模块
 */
export const cleanup = () => {
  try {
    // 取消所有事件监听
    eventListeners.forEach((removeListener) => removeListener());
    eventListeners = [];

    // 移除UI元素
    const $ = deps.jQuery;
    if ($) {
      $(winSelector).remove();
      $("#st-image-player-settings").remove();
      $("#st-image-player-button").remove();
    }

    console.log(`[ui] UI模块已清理`);
  } catch (e) {
    deps.toastr.error(`[ui] 清理失败: ${e.message}`);
    console.error(`[ui] 清理错误:`, e);
  }
};

/**
 * 创建扩展菜单按钮
 */
const createExtensionButton = () => {
  const $ = deps.jQuery;
  if (!$) return;

  // 避免重复创建
  if ($("#st-image-player-button").length) return;

  const button = $(`
    <button id="st-image-player-button" class="btn btn-sm btn-primary" style="margin-left: 8px;">
      媒体播放器
    </button>
  `);

  button.on("click", () => {
    const $win = $(winSelector);
    if ($win.length) {
      // 切换窗口显示状态
      const isVisible = $win.is(":visible");
      $win.toggle(!isVisible);
      deps.settings.saveSettings({ isWindowVisible: !isVisible });

      if (!isVisible) {
        deps.EventBus.emit("requestShowInitialMedia");
      }
    } else {
      // 创建窗口并显示
      createPlayerWindow().then(() => {
        $(winSelector).show();
        deps.settings.saveSettings({ isWindowVisible: true });
        deps.EventBus.emit("requestShowInitialMedia");
      });
    }
  });

  // 添加到扩展菜单
  const menuContainer = $(".extensions-menu") || $(".main-menu");
  if (menuContainer.length) {
    menuContainer.append(button);
  } else {
    //  fallback: 添加到body
    $("body").append(button);
  }
};

/**
 * 创建播放器窗口
 */
const createPlayerWindow = async () => {
  const $ = deps.jQuery;
  if (!$) return;

  // 避免重复创建
  if ($(winSelector).length) return;

  const settings = deps.settings.getSettings();

  // 创建窗口HTML
  const windowHtml = `
    <div id="st-image-player-window" class="modal fade" style="display: ${
      settings.isWindowVisible ? "block" : "none"
    };">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">媒体播放器</h5>
            <button type="button" class="close" data-dismiss="modal">&times;</button>
          </div>
          <div class="modal-body" style="height: 500px; display: flex; flex-direction: column;">
            <div class="loading-animation" style="display: none; align-items: center; justify-content: center; height: 100%;">
              <div class="spinner-border text-primary" role="status">
                <span class="sr-only">Loading...</span>
              </div>
            </div>
            <div class="image-container" style="flex: 1; overflow: hidden; position: relative;">
              <img class="image-player-img fade-transition" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
              <video class="image-player-video" style="display: none; width: 100%; height: 100%; object-fit: contain;" controls></video>
              <div class="image-info" style="position: absolute; bottom: 10px; left: 10px; color: white; background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 4px;"></div>
            </div>
            <div class="video-controls" style="padding: 10px; border-top: 1px solid #eee;">
              <div class="progress" style="margin-bottom: 10px;">
                <input type="range" class="video-progress" min="0" max="100" value="0" style="width: 100%;">
              </div>
              <div class="d-flex justify-content-between align-items-center">
                <div>
                  <button class="btn btn-sm btn-secondary prev-media">上一个</button>
                  <button class="btn btn-sm btn-primary play-media">播放</button>
                  <button class="btn btn-sm btn-secondary next-media">下一个</button>
                  <button class="btn btn-sm btn-info settings-media">设置</button>
                </div>
                <div class="video-time">00:00 / 00:00</div>
                <div class="control-text"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 添加到页面
  $("body").append(windowHtml);
  const $win = $(winSelector);

  // 调整布局
  deps.utils.adjustVideoControlsLayout($win);

  // 绑定控制按钮事件
  $win.find(".prev-media").on("click", () => {
    deps.EventBus.emit("requestMediaPlay", { direction: "prev" });
  });

  $win.find(".next-media").on("click", () => {
    deps.EventBus.emit("requestMediaPlay", { direction: "next" });
  });

  $win.find(".play-media").on("click", function () {
    const isPlaying = deps.settings.getSettings().isPlaying;
    if (isPlaying) {
      deps.EventBus.emit("requestStopPlayback");
      $(this).text("播放");
    } else {
      deps.EventBus.emit("requestStartPlayback");
      $(this).text("暂停");
    }
  });

  $win.find(".settings-media").on("click", () => {
    const $settings = $("#st-image-player-settings");
    $settings.toggle($settings.is(":hidden"));
  });

  // 窗口关闭事件
  $win.find(".close, [data-dismiss='modal']").on("click", () => {
    $win.hide();
    deps.settings.saveSettings({ isWindowVisible: false });
  });

  console.log(`[ui] 播放器窗口已创建`);
};

/**
 * 创建设置面板
 */
const createSettingsPanel = () => {
  const $ = deps.jQuery;
  if (!$) return;

  // 避免重复创建
  if ($("#st-image-player-settings").length) return;

  const settings = deps.settings.getSettings();

  // 创建设置面板HTML
  const settingsHtml = `
    <div id="st-image-player-settings" class="modal fade" style="display: none;">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">媒体播放器设置</h5>
            <button type="button" class="close" data-dismiss="modal">&times;</button>
          </div>
          <div class="modal-body">
            <!-- 设置内容将在这里动态生成 -->
            <div class="settings-content">加载中...</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary save-settings">保存设置</button>
            <button class="btn btn-secondary" data-dismiss="modal">关闭</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // 添加到页面
  $("body").append(settingsHtml);
  const $settings = $("#st-image-player-settings");

  // 生成设置内容
  renderSettingsContent();

  // 保存设置事件
  $settings.find(".save-settings").on("click", saveUserSettings);

  console.log(`[ui] 设置面板已创建`);
};

/**
 * 渲染设置内容
 */
const renderSettingsContent = () => {
  const $ = deps.jQuery;
  if (!$) return;

  const settings = deps.settings.getSettings();
  const $content = $("#st-image-player-settings .settings-content");

  $content.html(`
    <div class="form-group">
      <label>服务地址</label>
      <input type="text" class="form-control service-url" value="${
        settings.serviceUrl
      }" placeholder="http://localhost:3000">
    </div>
    
    <div class="form-group">
      <label>媒体扫描目录</label>
      <input type="text" class="form-control scan-directory" value="${
        settings.serviceDirectory || ""
      }">
      <button class="btn btn-sm btn-secondary update-directory" style="margin-top: 5px;">更新目录</button>
    </div>
    
    <div class="form-group">
      <label>媒体筛选</label>
      <select class="form-control media-filter">
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
    
    <div class="form-group">
      <label>播放模式</label>
      <select class="form-control play-mode">
        <option value="sequential" ${
          settings.playMode === "sequential" ? "selected" : ""
        }>顺序播放</option>
        <option value="random" ${
          settings.playMode === "random" ? "selected" : ""
        }>随机播放</option>
      </select>
    </div>
    
    <div class="form-group">
      <label>切换模式</label>
      <select class="form-control auto-switch-mode">
        <option value="manual" ${
          settings.autoSwitchMode === "manual" ? "selected" : ""
        }>手动切换</option>
        <option value="timer" ${
          settings.autoSwitchMode === "timer" ? "selected" : ""
        }>定时切换</option>
        <option value="detect" ${
          settings.autoSwitchMode === "detect" ? "selected" : ""
        }>AI检测切换</option>
      </select>
    </div>
    
    <div class="form-group">
      <label>切换间隔(毫秒)</label>
      <input type="number" class="form-control switch-interval" value="${
        settings.switchInterval
      }" min="1000" step="1000">
    </div>
    
    <div class="form-group">
      <label>过渡效果</label>
      <select class="form-control transition-effect">
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
    
    <div class="form-check">
      <input type="checkbox" class="form-check-input video-loop" ${
        settings.videoLoop ? "checked" : ""
      }>
      <label class="form-check-label">视频循环播放</label>
    </div>
    
    <div class="form-check">
      <input type="checkbox" class="form-check-input preload-images" ${
        settings.preloadImages ? "checked" : ""
      }>
      <label class="form-check-label">预加载图片</label>
    </div>
    
    <div class="form-check">
      <input type="checkbox" class="form-check-input preload-videos" ${
        settings.preloadVideos ? "checked" : ""
      }>
      <label class="form-check-label">预加载视频（可能占用较多资源）</label>
    </div>
    
    <hr>
    <h6>AI检测设置</h6>
    
    <div class="form-check">
      <input type="checkbox" class="form-check-input ai-detect-enabled" ${
        settings.aiDetectEnabled ? "checked" : ""
      }>
      <label class="form-check-label">AI回复时切换媒体</label>
    </div>
    
    <div class="form-check">
      <input type="checkbox" class="form-check-input player-detect-enabled" ${
        settings.playerDetectEnabled ? "checked" : ""
      }>
      <label class="form-check-label">玩家发言时切换媒体</label>
    </div>
    
    <div class="form-group">
      <label>检测冷却时间(毫秒)</label>
      <input type="number" class="form-control ai-cooldown" value="${
        settings.aiResponseCooldown
      }" min="1000" step="500">
    </div>
  `);

  // 绑定目录更新按钮
  $content.find(".update-directory").on("click", () => {
    const newPath = $content.find(".scan-directory").val();
    deps.EventBus.emit("requestUpdateScanDirectory", { newPath });
  });
};

/**
 * 保存用户设置
 */
const saveUserSettings = () => {
  const $ = deps.jQuery;
  if (!$) return;

  const $content = $("#st-image-player-settings .settings-content");

  const newSettings = {
    serviceUrl: $content.find(".service-url").val(),
    mediaFilter: $content.find(".media-filter").val(),
    playMode: $content.find(".play-mode").val(),
    autoSwitchMode: $content.find(".auto-switch-mode").val(),
    switchInterval: parseInt($content.find(".switch-interval").val()),
    transitionEffect: $content.find(".transition-effect").val(),
    videoLoop: $content.find(".video-loop").is(":checked"),
    preloadImages: $content.find(".preload-images").is(":checked"),
    preloadVideos: $content.find(".preload-videos").is(":checked"),
    aiDetectEnabled: $content.find(".ai-detect-enabled").is(":checked"),
    playerDetectEnabled: $content.find(".player-detect-enabled").is(":checked"),
    aiResponseCooldown: parseInt($content.find(".ai-cooldown").val()),
  };

  // 保存设置
  deps.settings.saveSettings(newSettings);
  deps.toastr.success("设置已保存");

  // 刷新媒体列表
  deps.EventBus.emit("requestRefreshMediaList");

  // 关闭设置面板
  $("#st-image-player-settings").modal("hide");
};

/**
 * 更新状态显示
 */
const updateStatusDisplay = async () => {
  const $ = deps.jQuery;
  if (!$) return;

  const status = await new Promise((resolve) => {
    const removeListener = deps.EventBus.on(
      "serviceStatusChecked",
      (status) => {
        removeListener();
        resolve(status);
      }
    );
    deps.EventBus.emit("requestCheckServiceStatus");
  });

  const statusText = status.active
    ? `服务正常 - 图片: ${status.imageCount}, 视频: ${status.videoCount}`
    : `服务未连接: ${status.error || "未知错误"}`;

  $(winSelector).find(".control-text").text(statusText);
};
