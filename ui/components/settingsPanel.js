import { deps } from "../../core/deps.js";

const { EventBus, jQuery: $, utils } = deps;
const { safeJQuery } = utils;

const SETTINGS_PANEL_ID = "st-image-player-settings-panel";

/**
 * 创建设置面板
 */
export const createSettingsPanel = () => {
  return safeJQuery(() => {
    if ($(`#${SETTINGS_PANEL_ID}`).length) {
      console.log(`[settingsPanel] 设置面板已存在`);
      return;
    }

    const settings = deps.settings.get();
    
    const panelHtml = `
      <div id="${SETTINGS_PANEL_ID}" style="display: none;">
        <div class="settings-header">
          <h3 class="settings-title">媒体播放器设置</h3>
          <button class="settings-close" title="关闭">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- 基本设置 -->
        <div class="settings-section">
          <h4 class="section-title">基本设置</h4>
          
          <div class="setting-row">
            <span class="setting-label">启用扩展</span>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="master-enabled" ${settings.masterEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">显示播放器窗口</span>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="window-visible" ${settings.isWindowVisible ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">锁定位置</span>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="window-locked" ${settings.isLocked ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">显示媒体信息</span>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="show-info" ${settings.showInfo ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- 播放设置 -->
        <div class="settings-section">
          <h4 class="section-title">播放设置</h4>
          
          <div class="setting-row">
            <span class="setting-label">播放模式</span>
            <div class="setting-control">
              <select id="play-mode">
                <option value="random" ${settings.playMode === 'random' ? 'selected' : ''}>随机播放</option>
                <option value="sequential" ${settings.playMode === 'sequential' ? 'selected' : ''}>顺序播放</option>
              </select>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">自动切换模式</span>
            <div class="setting-control">
              <select id="auto-switch-mode">
                <option value="none" ${settings.autoSwitchMode === 'none' ? 'selected' : ''}>手动切换</option>
                <option value="timer" ${settings.autoSwitchMode === 'timer' ? 'selected' : ''}>定时切换</option>
                <option value="detect" ${settings.autoSwitchMode === 'detect' ? 'selected' : ''}>AI检测切换</option>
              </select>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">媒体音量</span>
            <div class="setting-control">
              <div class="slider-container">
                <input type="range" id="media-volume" min="0" max="100" value="${settings.volume * 100}">
                <span class="slider-value">${Math.round(settings.volume * 100)}%</span>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">视频音量</span>
            <div class="setting-control">
              <div class="slider-container">
                <input type="range" id="video-volume" min="0" max="100" value="${settings.videoVolume * 100}">
                <span class="slider-value">${Math.round(settings.videoVolume * 100)}%</span>
              </div>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">视频循环播放</span>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="video-loop" ${settings.videoLoop ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- 服务设置 -->
        <div class="settings-section">
          <h4 class="section-title">服务设置</h4>
          
          <div class="setting-row">
            <span class="setting-label">服务状态</span>
            <div class="setting-control">
              <span id="service-status" class="status-indicator status-connecting"></span>
              <span>检测中...</span>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">服务地址</span>
            <div class="setting-control">
              <input type="text" id="service-url" value="${settings.serviceUrl}" placeholder="http://127.0.0.1:9000">
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">媒体目录</span>
            <div class="setting-control">
              <input type="text" id="service-directory" value="${settings.serviceDirectory}" placeholder="媒体文件目录路径">
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">轮询间隔 (ms)</span>
            <div class="setting-control">
              <input type="number" id="polling-interval" value="${settings.pollingInterval}" min="1000" max="60000">
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">WebSocket超时 (ms)</span>
            <div class="setting-control">
              <input type="number" id="websocket-timeout" value="${settings.websocket_timeout}" min="1000" max="30000">
            </div>
          </div>
        </div>

        <!-- 媒体配置 -->
        <div class="settings-section">
          <h4 class="section-title">媒体配置</h4>
          
          <div class="setting-row">
            <span class="setting-label">图片最大大小 (MB)</span>
            <div class="setting-control">
              <input type="number" id="image-max-size" value="${settings.mediaConfig.image_max_size_mb}" min="1" max="50">
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">视频最大大小 (MB)</span>
            <div class="setting-control">
              <input type="number" id="video-max-size" value="${settings.mediaConfig.video_max_size_mb}" min="10" max="500">
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">预加载图片</span>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="preload-images" ${settings.mediaConfig.preload_strategy.image ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <span class="setting-label">预加载视频</span>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" id="preload-videos" ${settings.mediaConfig.preload_strategy.video ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="button-group">
          <button class="settings-button" id="save-settings">保存设置</button>
          <button class="settings-button" id="refresh-media">刷新媒体列表</button>
          <button class="settings-button danger" id="reset-settings">重置设置</button>
        </div>
      </div>
    `;

    // 添加到SillyTavern扩展设置容器
    ensureExtensionsSettingsContainer();
    $("#extensionsSettings").append(panelHtml);
    console.log(`[settingsPanel] 设置面板创建完成`);

    // 绑定事件
    bindSettingsEvents();
    
    // 检查服务状态
    checkServiceStatus();

    return $(`#${SETTINGS_PANEL_ID}`);
  });
};

/**
 * 确保扩展设置容器存在
 */
const ensureExtensionsSettingsContainer = () => {
  if ($("#extensionsSettings").length === 0) {
    $("body").append(`
      <div id="extensionsSettings" class="extensions-settings"></div>
    `);
  }
};

/**
 * 绑定设置面板事件
 */
const bindSettingsEvents = () => {
  const $panel = $(`#${SETTINGS_PANEL_ID}`);
  if (!$panel.length) return;

  // 关闭按钮
  $panel.find('.settings-close').on('click', () => {
    hideSettingsPanel();
  });

  // 开关设置
  $panel.find('input[type="checkbox"]').on('change', handleCheckboxChange);
  
  // 下拉选择
  $panel.find('select').on('change', handleSelectChange);
  
  // 滑块设置
  $panel.find('input[type="range"]').on('input', handleSliderChange);
  
  // 文本输入
  $panel.find('input[type="text"], input[type="number"]').on('change', handleInputChange);
  
  // 操作按钮
  $panel.find('#save-settings').on('click', saveAllSettings);
  $panel.find('#refresh-media').on('click', refreshMediaList);
  $panel.find('#reset-settings').on('click', resetSettings);
};

/**
 * 处理复选框变化
 */
const handleCheckboxChange = (e) => {
  const $input = $(e.target);
  const id = $input.attr('id');
  const checked = $input.is(':checked');

  const settings = deps.settings.get();
  
  switch (id) {
    case 'master-enabled':
      settings.masterEnabled = checked;
      if (!checked) {
        // 禁用扩展时隐藏播放器
        EventBus.emit('requestHidePlayerWindow');
      }
      break;
    case 'window-visible':
      settings.isWindowVisible = checked;
      if (checked) {
        EventBus.emit('requestCreatePlayerWindow');
      } else {
        EventBus.emit('requestHidePlayerWindow');
      }
      break;
    case 'window-locked':
      settings.isLocked = checked;
      EventBus.emit('requestUpdatePlayerLockState', { locked: checked });
      break;
    case 'show-info':
      settings.showInfo = checked;
      EventBus.emit('requestUpdateInfoDisplay', { show: checked });
      break;
    case 'video-loop':
      settings.videoLoop = checked;
      EventBus.emit('requestUpdateVideoLoop', { loop: checked });
      break;
    case 'preload-images':
      settings.mediaConfig.preload_strategy.image = checked;
      break;
    case 'preload-videos':
      settings.mediaConfig.preload_strategy.video = checked;
      break;
  }

  deps.settings.save();
};

/**
 * 处理下拉选择变化
 */
const handleSelectChange = (e) => {
  const $select = $(e.target);
  const id = $select.attr('id');
  const value = $select.val();

  const settings = deps.settings.get();
  
  switch (id) {
    case 'play-mode':
      settings.playMode = value;
      EventBus.emit('changePlayMode', value);
      break;
    case 'auto-switch-mode':
      settings.autoSwitchMode = value;
      EventBus.emit('changeAutoSwitchMode', value);
      break;
  }

  deps.settings.save();
};

/**
 * 处理滑块变化
 */
const handleSliderChange = (e) => {
  const $slider = $(e.target);
  const id = $slider.attr('id');
  const value = parseInt($slider.val());
  
  // 更新显示值
  const $valueDisplay = $slider.next('.slider-value');
  if ($valueDisplay.length) {
    $valueDisplay.text(`${value}%`);
  }

  const settings = deps.settings.get();
  
  switch (id) {
    case 'media-volume':
      settings.volume = value / 100;
      EventBus.emit('requestUpdateVolume', { volume: value / 100 });
      break;
    case 'video-volume':
      settings.videoVolume = value / 100;
      EventBus.emit('requestUpdateVideoVolume', { volume: value / 100 });
      break;
  }

  deps.settings.save();
};

/**
 * 处理文本输入变化
 */
const handleInputChange = (e) => {
  const $input = $(e.target);
  const id = $input.attr('id');
  const value = $input.val();

  const settings = deps.settings.get();
  
  switch (id) {
    case 'service-url':
      settings.serviceUrl = value;
      // 服务地址变化时重新检查状态
      checkServiceStatus();
      break;
    case 'service-directory':
      settings.serviceDirectory = value;
      break;
    case 'polling-interval':
      settings.pollingInterval = parseInt(value) || 30000;
      break;
    case 'websocket-timeout':
      settings.websocket_timeout = parseInt(value) || 10000;
      break;
    case 'image-max-size':
      settings.mediaConfig.image_max_size_mb = parseInt(value) || 5;
      break;
    case 'video-max-size':
      settings.mediaConfig.video_max_size_mb = parseInt(value) || 100;
      break;
  }

  deps.settings.save();
};

/**
 * 保存所有设置
 */
const saveAllSettings = () => {
  deps.settings.save();
  if (deps.toastr && typeof deps.toastr.success === 'function') {
    deps.toastr.success('设置已保存');
  }
  console.log('[settingsPanel] 所有设置已保存');
};

/**
 * 刷新媒体列表
 */
const refreshMediaList = () => {
  EventBus.emit('requestRefreshMediaList');
  if (deps.toastr && typeof deps.toastr.info === 'function') {
    deps.toastr.info('正在刷新媒体列表...');
  }
};

/**
 * 重置设置
 */
const resetSettings = () => {
  if (confirm('确定要重置所有设置为默认值吗？')) {
    const defaultSettings = {
      enabled: true,
      lastPlayed: null,
      volume: 0.8,
      masterEnabled: true,
      isWindowVisible: true,
      playMode: "random",
      autoSwitchMode: "detect",
      showVideoControls: true,
      customVideoControls: {
        showProgress: true,
        showVolume: true,
        showLoop: true,
        showTime: true
      },
      videoVolume: 0.8,
      videoLoop: false,
      hideBorder: false,
      showInfo: true,
      isLocked: false,
      mediaFilter: "all",
      isPlaying: false,
      serviceDirectory: "",
      serviceUrl: "http://127.0.0.1:9000",
      mediaConfig: {
        image_max_size_mb: 5,
        video_max_size_mb: 100,
        preload_strategy: {
          image: true,
          video: false
        }
      },
      pollingInterval: 30000,
      websocket_timeout: 10000,
      transitionEffect: "fade",
      randomPlayedIndices: [],
      config_version: "1.4.2"
    };

    Object.assign(deps.extension_settings["st_image_player"], defaultSettings);
    deps.settings.save();
    
    // 重新加载设置面板
    hideSettingsPanel();
    createSettingsPanel();
    
    if (deps.toastr && typeof deps.toastr.success === 'function') {
      deps.toastr.success('设置已重置为默认值');
    }
  }
};

/**
 * 检查服务状态
 */
const checkServiceStatus = () => {
  EventBus.emit('requestCheckServiceStatus');
};

/**
 * 更新服务状态显示
 */
export const updateServiceStatus = (status) => {
  safeJQuery(() => {
    const $status = $(`#${SETTINGS_PANEL_ID} #service-status`);
    const $statusText = $status.next('span');
    
    if (!$status.length) return;

    $status.removeClass('status-online status-offline status-connecting');
    
    if (status.active) {
      $status.addClass('status-online');
      $statusText.text('在线');
    } else if (status.error) {
      $status.addClass('status-offline');
      $statusText.text('离线: ' + status.error);
    } else {
      $status.addClass('status-connecting');
      $statusText.text('检测中...');
    }
  });
};

/**
 * 显示设置面板
 */
export const showSettingsPanel = () => {
  safeJQuery(() => {
    const $panel = $(`#${SETTINGS_PANEL_ID}`);
    if ($panel.length) {
      $panel.show();
    } else {
      createSettingsPanel().then($panel => {
        if ($panel) $panel.show();
      });
    }
  });
};

/**
 * 隐藏设置面板
 */
export const hideSettingsPanel = () => {
  safeJQuery(() => {
    $(`#${SETTINGS_PANEL_ID}`).hide();
  });
};

/**
 * 清理设置面板
 */
export const cleanupSettingsPanel = () => {
  safeJQuery(() => {
    $(`#${SETTINGS_PANEL_ID}`).remove();
    console.log(`[settingsPanel] 设置面板已清理`);
  });
};