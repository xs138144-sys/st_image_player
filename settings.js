import { getSafeToastr } from "./utils.js";
import { closeWebSocket } from "./websocket.js";
import { stopPlayback, stopProgressUpdate } from "./mediaPlayer.js";

const EXTENSION_ID = "st_image_player";
const toastr = getSafeToastr();

// 默认设置（集中定义，便于维护）
export const DEFAULT_SETTINGS = {
  masterEnabled: false, // 总开关
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

/**
 * 获取扩展设置（优先全局→localStorage→默认）
 * @returns {object} 扩展设置
 */
export const getExtensionSettings = () => {
  // 初始化全局设置容器
  if (!window.extension_settings) window.extension_settings = {};

  // 1. 全局设置已存在 → 直接返回
  if (window.extension_settings[EXTENSION_ID]) {
    // 旧版本设置迁移（补全缺失字段）
    const settings = window.extension_settings[EXTENSION_ID];
    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
      if (settings[key] === undefined) settings[key] = DEFAULT_SETTINGS[key];
    });
    return settings;
  }

  // 2. 从localStorage加载
  try {
    const saved = localStorage.getItem("extension_settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed[EXTENSION_ID]) {
        // 补全缺失字段
        Object.keys(DEFAULT_SETTINGS).forEach((key) => {
          if (parsed[EXTENSION_ID][key] === undefined) {
            parsed[EXTENSION_ID][key] = DEFAULT_SETTINGS[key];
          }
        });
        window.extension_settings[EXTENSION_ID] = parsed[EXTENSION_ID];
        return parsed[EXTENSION_ID];
      }
    }
  } catch (e) {
    console.warn(`[${EXTENSION_ID}] 加载localStorage失败:`, e);
  }

  // 3. 使用默认设置
  window.extension_settings[EXTENSION_ID] = JSON.parse(
    JSON.stringify(DEFAULT_SETTINGS)
  );
  saveSafeSettings();
  return window.extension_settings[EXTENSION_ID];
};

/**
 * 安全保存设置（支持SillyTavern核心函数+localStorage备用）
 */
export const saveSafeSettings = () => {
  const settings = getExtensionSettings();
  const saveFn = window.saveSettingsDebounced || null;

  // 更新全局设置
  window.extension_settings[EXTENSION_ID] = settings;

  // 1. 使用SillyTavern核心函数保存
  if (saveFn && typeof saveFn === "function") {
    try {
      saveFn();
      console.log(`[${EXTENSION_ID}] 设置已保存（核心函数）`);
      return;
    } catch (e) {
      console.error(`[${EXTENSION_ID}] 核心保存函数失败:`, e);
    }
  }

  // 2. localStorage备用
  try {
    localStorage.setItem(
      "extension_settings",
      JSON.stringify(window.extension_settings)
    );
    console.log(`[${EXTENSION_ID}] 设置已保存（localStorage备用）`);
  } catch (e) {
    console.error(`[${EXTENSION_ID}] localStorage保存失败:`, e);
    toastr.error("设置保存失败，请检查存储权限");
  }
};

/**
 * 禁用扩展（清理资源+隐藏UI）
 */
export const disableExtension = () => {
  const settings = getExtensionSettings();
  const winSelector = "#st-image-player-window";
  const panelSelector = "#st-image-player-settings";
  const menuBtnSelector = `#ext_menu_${EXTENSION_ID}`;

  // 1. 清理定时器
  if (window.pollingTimer) clearTimeout(window.pollingTimer);
  stopPlayback(); // 停止播放定时器
  stopProgressUpdate(); // 停止进度更新
  if (window.wsReconnectTimer) clearTimeout(window.wsReconnectTimer);

  // 2. 关闭WebSocket
  closeWebSocket();

  // 3. 隐藏/移除UI
  $(winSelector).remove();
  $(panelSelector).remove();
  $(menuBtnSelector).remove();

  // 4. 重置状态
  window.mediaList = [];
  window.currentMediaIndex = 0;
  settings.isPlaying = false;
  settings.isWindowVisible = false;
  saveSafeSettings();

  toastr.info("媒体播放器扩展已禁用");
};

/**
 * 快捷获取设置（简化调用）
 * @returns {object} 扩展设置
 */
export const getSettings = () => getExtensionSettings();
