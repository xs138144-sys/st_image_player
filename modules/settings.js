import { deps } from "../core/deps.js";

// 默认配置
export const DEFAULT_SETTINGS = {
  enabled: true,
  masterEnabled: true,
  serviceUrl: "http://localhost:3000",
  serviceDirectory: "",
  mediaFilter: "all",
  playMode: "sequential", // sequential/random
  transitionEffect: "fade", // fade/slide/zoom/none
  autoSwitchMode: "manual", // manual/timer/detect
  switchInterval: 5000,
  videoLoop: true,
  preloadImages: true,
  preloadVideos: false,
  showMediaUpdateToast: true,
  aiDetectEnabled: true,
  playerDetectEnabled: false,
  aiResponseCooldown: 3000,
  lastAISwitchTime: 0,
  isMediaLoading: false,
  isPlaying: false,
  isWindowVisible: false,
  randomMediaList: [],
  randomPlayedIndices: [],
  currentRandomIndex: -1,
  pollingInterval: 30000,
  aiEventRegistered: false,
  mediaConfig: {
    image_max_size_mb: 5,
    video_max_size_mb: 50,
  },
};

// 扩展存储键名
const STORAGE_KEY = "st_image_player_settings";

/**
 * 获取扩展配置
 */
export const getSettings = () => {
  // 从全局配置或本地存储获取
  const globalSettings = window.extension_settings?.[STORAGE_KEY];
  const storedSettings =
    globalSettings || JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

  // 合并默认配置
  return { ...DEFAULT_SETTINGS, ...storedSettings };
};

/**
 * 保存扩展配置
 * @param {Object} newSettings 新配置对象
 */
export const saveSettings = (newSettings) => {
  const current = getSettings();
  const updated = { ...current, ...newSettings };

  // 保存到全局配置和本地存储
  if (!window.extension_settings) window.extension_settings = {};
  window.extension_settings[STORAGE_KEY] = updated;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

  return updated;
};

/**
 * 禁用扩展
 */
export const disableExtension = () => {
  saveSettings({ enabled: false, masterEnabled: false });
  deps.EventBus.emit("extensionDisable");
  deps.toastr.info("媒体播放器扩展已禁用");
};

/**
 * 初始化配置模块
 */
export const init = () => {
  // 确保配置存在
  if (!getSettings()) {
    saveSettings({});
  }

  console.log(`[settings] 配置模块初始化完成`);
};

/**
 * 清理配置模块
 */
export const cleanup = () => {
  try {
    const current = getSettings();
    // 保存最终状态但重置临时变量
    saveSettings({
      ...current,
      isMediaLoading: false,
      retryCount: 0,
    });
    console.log(`[settings] 配置模块已清理`);
  } catch (e) {
    deps.toastr.error(`[settings] 清理失败: ${e.message}`);
    console.error(`[settings] 清理错误:`, e);
  }
};
