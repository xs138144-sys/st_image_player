import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { deps } from "../core/deps.js";

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
    config_version: CONFIG_VERSION
  };
}

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

      settings.config_version = CONFIG_VERSION;
    }

    settings.config_version = CONFIG_VERSION;
  }

  // 保存迁移后的配置
  save();
  // 使用安全的toastr调用
  if (deps.toastr && typeof deps.toastr.info === "function") {
    deps.toastr.info(`媒体播放器配置已更新到最新版本`);
  }
};

const cleanup = () => {
  try {
    const settings = get();
    // 重置临时状态
    settings.isMediaLoading = false;
    settings.retryCount = 0;
    save();
    console.log(`[settings] 资源清理完成`);
  } catch (e) {
    console.error(`[settings] 清理失败:`, e);
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[settings] 清理失败: ${e.message}`);
    }
  }
};

// 新增get方法定义（之前缺失）
export const get = () => {
  return extension_settings[EXTENSION_ID] || {};
};

export const save = () => {
  const settings = get();
  const saveFn = window.saveSettingsDebounced || saveSettingsDebounced;

  window.extension_settings[EXTENSION_ID] = settings;

  if (saveFn && typeof saveFn === "function") {
    try {
      saveFn();
      console.log(`[settings] 核心函数保存成功`);
      return;
    } catch (e) {
      console.error(`[settings] 核心保存失败:`, e);
    }
  }

  // localStorage备用方案
  try {
    localStorage.setItem("extension_settings", JSON.stringify(window.extension_settings));
    console.log(`[settings] localStorage保存成功`);
  } catch (e) {
    console.error(`[settings] localStorage保存失败:`, e);
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error("设置保存失败，请检查存储权限");
    }
  }
};

/**
 * 初始化设置模块
 */
export const init = () => {
  // 执行配置迁移
  migrateSettings();
  console.log(`[settings] 设置模块初始化完成`);
};

// 导出必要的函数
export { migrateSettings, cleanup, save, get, init };