import { deps } from "../../core/deps.js";

/**
 * 设置迁移器模块 - 负责设置版本的迁移和兼容性处理
 */
export const init = () => {
  console.log(`[settingsMigrator] 设置迁移器初始化完成`);
};

export const cleanup = () => {
  console.log(`[settingsMigrator] 设置迁移器无资源需清理`);
};

/**
 * 迁移设置到最新版本
 */
export const migrateSettings = () => {
  const settings = deps.settingsManager.get();
  const currentVersion = settings.version || 0;
  
  console.log(`[settingsMigrator] 当前设置版本: ${currentVersion}`);
  
  // 版本迁移逻辑
  if (currentVersion < 1) {
    console.log(`[settingsMigrator] 从版本 ${currentVersion} 迁移到版本 1`);
    migrateToVersion1(settings);
  }
  
  // 确保设置包含所有必需字段
  ensureRequiredSettings(settings);
  
  // 更新到最新版本
  settings.version = 1;
  deps.settingsManager.save(settings);
  
  console.log(`[settingsMigrator] 设置迁移完成，当前版本: 1`);
  return settings;
};

/**
 * 迁移到版本1
 */
const migrateToVersion1 = (settings) => {
  // 确保数组属性存在
  if (!settings.randomMediaList) settings.randomMediaList = [];
  if (!settings.randomPlayedIndices) settings.randomPlayedIndices = [];
  
  // 确保数值属性存在
  if (settings.currentRandomIndex === undefined) settings.currentRandomIndex = -1;
  if (settings.currentMediaIndex === undefined) settings.currentMediaIndex = 0;
  
  // 确保布尔属性存在
  if (settings.isPlaying === undefined) settings.isPlaying = false;
  if (settings.isRandom === undefined) settings.isRandom = false;
  if (settings.showControls === undefined) settings.showControls = true;
  if (settings.showInfo === undefined) settings.showInfo = true;
  if (settings.showProgress === undefined) settings.showProgress = true;
  if (settings.showThumbnails === undefined) settings.showThumbnails = true;
  if (settings.muted === undefined) settings.muted = false;
  if (settings.loop === undefined) settings.loop = true;
  if (settings.preload === undefined) settings.preload = true;
  if (settings.autoplay === undefined) settings.autoplay = false;
  if (settings.controls === undefined) settings.controls = true;
  if (settings.fullscreen === undefined) settings.fullscreen = false;
  if (settings.pictureInPicture === undefined) settings.pictureInPicture = false;
  if (settings.keyboardShortcuts === undefined) settings.keyboardShortcuts = true;
  if (settings.mouseWheel === undefined) settings.mouseWheel = true;
  if (settings.touchGestures === undefined) settings.touchGestures = true;
  if (settings.debugMode === undefined) settings.debugMode = false;
  
  // 确保字符串属性存在
  if (!settings.serviceUrl) settings.serviceUrl = "http://localhost:8000";
  if (!settings.serviceDirectory) settings.serviceDirectory = "";
  if (!settings.mediaFilter) settings.mediaFilter = "all";
  if (!settings.autoSwitchMode) settings.autoSwitchMode = "timer";
  if (!settings.transitionEffect) settings.transitionEffect = "fade";
  if (!settings.backgroundColor) settings.backgroundColor = "#000000";
  if (!settings.textColor) settings.textColor = "#ffffff";
  if (!settings.fontFamily) settings.fontFamily = "Arial, sans-serif";
  if (!settings.logLevel) settings.logLevel = "info";
  
  // 确保数值属性存在
  if (settings.mediaSizeLimit === undefined) settings.mediaSizeLimit = 10;
  if (settings.autoSwitchInterval === undefined) settings.autoSwitchInterval = 5;
  if (settings.thumbnailSize === undefined) settings.thumbnailSize = 100;
  if (settings.thumbnailQuality === undefined) settings.thumbnailQuality = 80;
  if (settings.thumbnailCount === undefined) settings.thumbnailCount = 20;
  if (settings.transitionDuration === undefined) settings.transitionDuration = 0.5;
  if (settings.fontSize === undefined) settings.fontSize = 14;
  if (settings.volume === undefined) settings.volume = 1;
  
  // 添加时间戳
  settings.lastUpdate = Date.now();
};

/**
 * 确保设置包含所有必需字段
 */
const ensureRequiredSettings = (settings) => {
  const defaultSettings = deps.settingsManager.DEFAULT_SETTINGS;
  
  Object.keys(defaultSettings).forEach(key => {
    if (settings[key] === undefined) {
      settings[key] = defaultSettings[key];
    }
  });
};

/**
 * 清理设置
 */
export const cleanupSettings = () => {
  console.log(`[settingsMigrator] 清理设置数据`);
  
  // 清理过期的设置键
  const validKeys = Object.keys(deps.settingsManager.DEFAULT_SETTINGS);
  const currentSettings = deps.settingsManager.get();
  
  Object.keys(currentSettings).forEach(key => {
    if (!validKeys.includes(key) && key !== 'version' && key !== 'lastUpdate') {
      delete currentSettings[key];
      console.log(`[settingsMigrator] 移除过期设置键: ${key}`);
    }
  });
  
  deps.settingsManager.save(currentSettings);
  return currentSettings;
};

/**
 * 导出设置
 */
export const exportSettings = () => {
  const settings = deps.settingsManager.get();
  const dataStr = JSON.stringify(settings, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  
  return {
    data: dataStr,
    uri: dataUri,
    filename: `st_image_player_settings_${new Date().toISOString().slice(0,10)}.json`
  };
};

/**
 * 导入设置
 */
export const importSettings = (jsonData) => {
  try {
    const importedSettings = JSON.parse(jsonData);
    
    // 验证基本结构
    if (typeof importedSettings !== 'object') {
      throw new Error('无效的设置数据格式');
    }
    
    // 合并设置，保留版本信息
    const currentSettings = deps.settingsManager.get();
    const mergedSettings = { 
      ...currentSettings, 
      ...importedSettings,
      version: currentSettings.version, // 保持当前版本
      lastUpdate: Date.now()
    };
    
    deps.settingsManager.save(mergedSettings);
    
    console.log(`[settingsMigrator] 设置导入成功`);
    return mergedSettings;
  } catch (error) {
    console.error(`[settingsMigrator] 设置导入失败:`, error);
    throw new Error(`导入失败: ${error.message}`);
  }
};

export default {
  init,
  cleanup,
  migrateSettings,
  cleanupSettings,
  exportSettings,
  importSettings
};