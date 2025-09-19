import { deps } from "../core/deps.js";
import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const { EventBus, toastr } = deps;
const EXT_ID = "st_image_player";

// 当前配置版本
const CONFIG_VERSION = "1.4.2";

/**
 * 初始化设置模块
 */
export const init = () => {
  try {
    // 确保配置存在并迁移到最新版本
    ensureSettingsExist();
    migrateSettings();

    // 注册配置更新事件
    EventBus.on("settingsUpdated", () => {
      saveSettingsDebounced();
    });

    console.log(`[settings] 初始化完成，配置版本: ${CONFIG_VERSION}`);
  } catch (e) {
    toastr.error(`[settings] 初始化失败: ${e.message}`);
    console.error(`[settings] 初始化错误:`, e);
  }
};

/**
 * 清理设置模块
 */
export const cleanup = () => {
  console.log(`[settings] 配置模块已清理`);
};

/**
 * 确保设置对象存在
 */
const ensureSettingsExist = () => {
  if (!extension_settings[EXT_ID]) {
    extension_settings[EXT_ID] = getDefaultSettings();
    saveSettingsDebounced();
  }
};

/**
 * 获取默认设置
 * @returns {Object} 默认设置对象
 */
export const getDefaultSettings = () => {
  return {
    config_version: CONFIG_VERSION,
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
    serviceUrl: "",
    mediaConfig: {
      image_max_size_mb: 5,
      video_max_size_mb: 100,
      image_extensions: [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".apng"],
      video_extensions: [".webm", ".mp4", ".ogv", ".mov", ".avi", ".mkv"],
      preload_strategy: {
        image: true,
        video: false
      }
    },
    pollingInterval: 30000,
    websocket_timeout: 10000,
    transitionEffect: "fade",
    randomPlayedIndices: []
  };
};

/**
 * 获取当前设置
 * @returns {Object} 当前设置
 */
export const get = () => {
  ensureSettingsExist();
  return extension_settings[EXT_ID];
};

/**
 * 保存设置
 */
export const save = () => {
  ensureSettingsExist();
  // 添加配置版本信息
  extension_settings[EXT_ID].config_version = CONFIG_VERSION;
  saveSettingsDebounced();
  EventBus.emit("settingsUpdated", extension_settings[EXT_ID]);
};

/**
 * 迁移配置到最新版本
 */
const migrateSettings = () => {
  const settings = get();

  // 如果是旧版本，执行迁移
  if (settings.config_version !== CONFIG_VERSION) {
    console.log(`[settings] 迁移配置从 ${settings.config_version || '未知版本'} 到 ${CONFIG_VERSION}`);

    // 版本迁移逻辑
    if (!settings.config_version) {
      // 从无版本号迁移
      settings.config_version = "1.0.0";
    }

    if (settings.config_version === "1.0.0") {
      // 1.0.0 -> 1.1.0 迁移
      if (!settings.mediaConfig) {
        settings.mediaConfig = {
          image_max_size_mb: 5,
          video_max_size_mb: 100,
          image_extensions: [".png", ".jpg", ".jpeg", ".gif", ".bmp"],
          video_extensions: [".webm", ".mp4", ".ogv"]
        };
      }
      settings.config_version = "1.1.0";
    }

    if (settings.config_version === "1.1.0") {
      // 1.1.0 -> 1.2.0 迁移
      if (!settings.customVideoControls) {
        settings.customVideoControls = {
          showProgress: true,
          showVolume: true,
          showLoop: true,
          showTime: true
        };
      }
      settings.config_version = "1.2.0";
    }

    if (settings.config_version === "1.2.0") {
      // 1.2.0 -> 1.3.0 迁移
      settings.transitionEffect = "fade";
      if (!settings.mediaConfig.preload_strategy) {
        settings.mediaConfig.preload_strategy = {
          image: true,
          video: false
        };
      }
      settings.config_version = "1.3.0";
    }

    if (settings.config_version === "1.3.0") {
      // 1.3.0 -> 1.4.0 迁移
      settings.randomPlayedIndices = [];
      settings.websocket_timeout = 10000;
      settings.config_version = "1.4.0";
    }

    if (settings.config_version === "1.4.0") {
      // 1.4.0 -> 1.4.2 迁移
      settings.mediaConfig.image_extensions.push(".webp", ".apng");
      settings.mediaConfig.video_extensions.push(".mov", ".avi", ".mkv");
      settings.config_version = CONFIG_VERSION;
    }

    // 保存迁移后的配置
    save();
    toastr.info(`媒体播放器配置已更新到最新版本`);
  }
};

/**
 * 禁用扩展
 */
export const disableExtension = () => {
  const settings = get();
  settings.masterEnabled = false;
  save();
  EventBus.emit("extensionDisabled");
};

/**
 * 重置为默认设置
 */
export const resetToDefaults = () => {
  if (confirm("确定要将媒体播放器设置重置为默认值吗？")) {
    extension_settings[EXT_ID] = getDefaultSettings();
    save();
    toastr.success("设置已重置为默认值");
    EventBus.emit("settingsReset");
    return true;
  }
  return false;
};
