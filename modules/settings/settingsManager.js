import { deps } from "../../core/deps.js";

/**
 * 设置管理器模块 - 负责设置的定义、获取和更新
 */
export const init = () => {
  console.log(`[settingsManager] 设置管理器开始初始化`);
  
  // 确保设置已正确初始化
  try {
    // 检查是否已有设置，如果没有则初始化默认设置
    if (!isInitialized()) {
      console.log(`[settingsManager] 初始化默认设置`);
      reset(); // 重置为默认设置
    } else {
      console.log(`[settingsManager] 设置已存在，跳过初始化`);
    }
    
    console.log(`[settingsManager] 设置管理器初始化完成`);
  } catch (error) {
    console.error(`[settingsManager] 初始化过程中出现错误:`, error);
    // 即使出错也继续，确保模块能正常加载
  }
};

export const cleanup = () => {
  console.log(`[settingsManager] 设置管理器无资源需清理`);
};

// 默认设置定义
export const DEFAULT_SETTINGS = {
  version: 1,
  serviceUrl: "http://localhost:8000",
  serviceDirectory: "",
  mediaSizeLimit: 10,
  mediaFilter: "all",
  autoSwitchMode: "timer",
  autoSwitchInterval: 5,
  isPlaying: false,
  isRandom: false,
  randomMediaList: [],
  randomPlayedIndices: [],
  currentRandomIndex: -1,
  currentMediaIndex: 0,
  showControls: true,
  showInfo: true,
  showProgress: true,
  showThumbnails: true,
  thumbnailSize: 100,
  thumbnailQuality: 80,
  thumbnailCount: 20,
  transitionEffect: "fade",
  transitionDuration: 0.5,
  backgroundColor: "#000000",
  textColor: "#ffffff",
  fontSize: 14,
  fontFamily: "Arial, sans-serif",
  volume: 1,
  muted: false,
  loop: true,
  preload: true,
  autoplay: false,
  controls: true,
  fullscreen: false,
  pictureInPicture: false,
  keyboardShortcuts: true,
  mouseWheel: true,
  touchGestures: true,
  debugMode: false,
  logLevel: "info",
  lastUpdate: Date.now(),
};

/**
 * 获取设置
 */
export const get = (key = null) => {
  const settings = JSON.parse(localStorage.getItem("st_image_player_settings") || "{}");
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  
  // 确保数组属性存在
  if (!merged.randomMediaList) merged.randomMediaList = [];
  if (!merged.randomPlayedIndices) merged.randomPlayedIndices = [];
  
  return key ? merged[key] : merged;
};

/**
 * 更新设置
 */
export const update = (updates) => {
  const current = get();
  const newSettings = { ...current, ...updates, lastUpdate: Date.now() };
  
  // 确保数组属性存在
  if (!newSettings.randomMediaList) newSettings.randomMediaList = [];
  if (!newSettings.randomPlayedIndices) newSettings.randomPlayedIndices = [];
  
  localStorage.setItem("st_image_player_settings", JSON.stringify(newSettings));
  
  // 通知设置变更
  deps.EventBus.emit("settingsUpdated", newSettings);
  
  return newSettings;
};

/**
 * 保存设置
 */
export const save = (settings = null) => {
  if (settings) {
    localStorage.setItem("st_image_player_settings", JSON.stringify(settings));
    deps.EventBus.emit("settingsUpdated", settings);
    return settings;
  }
  
  const current = get();
  localStorage.setItem("st_image_player_settings", JSON.stringify(current));
  deps.EventBus.emit("settingsUpdated", current);
  return current;
};

/**
 * 重置设置为默认值
 */
export const reset = () => {
  localStorage.removeItem("st_image_player_settings");
  const defaultSettings = { ...DEFAULT_SETTINGS };
  localStorage.setItem("st_image_player_settings", JSON.stringify(defaultSettings));
  deps.EventBus.emit("settingsUpdated", defaultSettings);
  return defaultSettings;
};

/**
 * 检查设置是否已初始化
 */
export const isInitialized = () => {
  return localStorage.getItem("st_image_player_settings") !== null;
};

export default {
  init,
  cleanup,
  DEFAULT_SETTINGS,
  get,
  update,
  save,
  reset,
  isInitialized
};