// settings.js 修复版本
import { deps } from "../core/deps.js";

// 使用deps提供的核心功能
const { extension_settings, saveSettingsDebounced } = deps;

const EXTENSION_ID = "st_image_player";
const CONFIG_VERSION = "1.4.2";

// 确保扩展设置存在
if (!extension_settings[EXTENSION_ID]) {
  extension_settings[EXTENSION_ID] = {
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
    config_version: CONFIG_VERSION,
    aiDetectEnabled: true,
    playerDetectEnabled: true,
    preloadImages: true,
    preloadVideos: false,
    aiResponseCooldown: 3000,
    switchInterval: 5000,
    lastSwitchTime: 0,
    switchTriggers: {
      aiResponse: true,
      userMessage: true
    }
  };
}

// 配置迁移函数
const migrateSettings = () => {
  const settings = get();

  // 如果是旧版本，执行迁移
  if (!settings.config_version || settings.config_version !== CONFIG_VERSION) {
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

    if (settings.config_version === "1.4.0" || settings.config_version === "1.4.1") {
      // 1.4.0 -> 1.4.2 迁移：确保所有支持的格式被添加
      const imageExts = settings.mediaConfig.image_extensions || [];
      const requiredImageExts = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".apng"];
      requiredImageExts.forEach(ext => {
        if (!imageExts.includes(ext)) imageExts.push(ext);
      });
      settings.mediaConfig.image_extensions = imageExts;

      const videoExts = settings.mediaConfig.video_extensions || [];
      const requiredVideoExts = [".webm", ".mp4", ".ogv", ".mov", ".avi", ".mkv"];
      requiredVideoExts.forEach(ext => {
        if (!videoExts.includes(ext)) videoExts.push(ext);
      });
      settings.mediaConfig.video_extensions = videoExts;

      // 确保自动切换相关配置存在
      if (settings.autoSwitchMode === undefined) {
        settings.autoSwitchMode = "detect";
      }
      if (settings.switchTriggers === undefined) {
        settings.switchTriggers = {
          aiResponse: true,
          userMessage: true
        };
      }
      // 补充窗口锁定状态配置
      if (settings.isLocked === undefined) {
        settings.isLocked = false;
      }

      // 补充AI检测相关配置
      if (settings.aiDetectEnabled === undefined) settings.aiDetectEnabled = true;
      if (settings.playerDetectEnabled === undefined) settings.playerDetectEnabled = true;
      if (settings.preloadImages === undefined) settings.preloadImages = true;
      if (settings.preloadVideos === undefined) settings.preloadVideos = false;
      if (settings.aiResponseCooldown === undefined) settings.aiResponseCooldown = 3000;
      if (settings.switchInterval === undefined) settings.switchInterval = 5000;
      if (settings.lastSwitchTime === undefined) settings.lastSwitchTime = 0;

      settings.config_version = CONFIG_VERSION;
    }

    // 保存迁移后的配置
    save();
    if (deps.toastr && typeof deps.toastr.info === "function") {
      deps.toastr.info(`媒体播放器配置已更新到最新版本`);
    }
  }
};

// 清理函数
const cleanup = () => {
  try {
    const settings = get();
    settings.isMediaLoading = false;
    settings.retryCount = 0;
    save();
    console.log(`[settings] 资源清理完成`);
  } catch (e) {
    console.error(`[settings] 清理失败:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[settings] 清理失败: ${e.message}`);
    }
  }
};

// 获取设置函数
const get = () => {
  return extension_settings[EXTENSION_ID] || {};
};

// 更新设置函数
const update = (key, value) => {
  const settings = get();

  if (typeof key === 'object') {
    Object.assign(settings, key);
  } else {
    settings[key] = value;
  }

  extension_settings[EXTENSION_ID] = settings;

  // 触发设置更新事件
  EventBus.emit("settingsUpdated", settings);

  return save();
};

// 保存设置函数
const save = () => {
  const settings = get();
  const saveFn = window.saveSettingsDebounced || saveSettingsDebounced;

  deps.extension_settings[EXTENSION_ID] = settings;

  if (saveFn && typeof saveFn === "function") {
    try {
      saveFn();
      console.log(`[settings] 核心函数保存成功`);
      return true;
    } catch (e) {
      console.error(`[settings] 核心保存失败:`, e);
      // 失败时尝试使用localStorage
    }
  }

  // localStorage备用方案
  try {
    // 确保只保存当前扩展的设置
    const allSettings = JSON.parse(localStorage.getItem("extension_settings") || "{}");
    allSettings[EXTENSION_ID] = settings;
    localStorage.setItem("extension_settings", JSON.stringify(allSettings));
    console.log(`[settings] localStorage保存成功`);
    return true;
  } catch (e) {
    console.error(`[settings] localStorage保存失败:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error("设置保存失败，请检查存储权限");
    }
    return false;
  }
};

// 初始化函数
const init = () => {
  migrateSettings();
  console.log(`[settings] 设置模块初始化完成`);
};

// 确保导出对象包含所有必要的方法
const settingsModule = {
  init,
  cleanup,
  migrateSettings,
  save,
  get,
  update // 添加update方法
};

// 明确导出所有方法
export default settingsModule;
export {
  init,
  cleanup,
  migrateSettings,
  save,
  get,
  update // 添加update方法
};