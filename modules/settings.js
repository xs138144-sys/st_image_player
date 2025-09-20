const extension_settings = window.extension_settings || {};
const saveSettingsDebounced = window.saveSettingsDebounced || (() => { });

// 如果全局变量不存在，尝试从常见路径导入
if (!window.extension_settings) {
  try {
    // 尝试从 GitHub 仓库安装路径导入
    const extModule = await import('../../../../../extensions.js');
    extension_settings = extModule.extension_settings || {};
  } catch (e) {
    console.warn('无法从 GitHub 路径导入 extensions.js，尝试本地路径');
    try {
      // 尝试从本地安装路径导入
      const extModule = await import('../../../../extensions.js');
      extension_settings = extModule.extension_settings || {};
    } catch (e2) {
      console.error('无法导入 extensions.js，使用空对象作为后备');
      extension_settings = {};
    }
  }
}

if (!window.saveSettingsDebounced) {
  try {
    // 尝试从 GitHub 仓库安装路径导入
    const scriptModule = await import('../../../../../../script.js');
    saveSettingsDebounced = scriptModule.saveSettingsDebounced || (() => { });
  } catch (e) {
    console.warn('无法从 GitHub 路径导入 script.js，尝试本地路径');
    try {
      // 尝试从本地安装路径导入
      const scriptModule = await import('../../../../../script.js');
      saveSettingsDebounced = scriptModule.saveSettingsDebounced || (() => { });
    } catch (e2) {
      console.error('无法导入 script.js，使用空函数作为后备');
      saveSettingsDebounced = () => { };
    }
  }
}

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
    serviceUrl: "http://127.0.0.1:9000",
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

// 配置迁移函数
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
  if (deps.toastr && typeof deps.toastr.info === "function") {
    deps.toastr.info(`媒体播放器配置已更新到最新版本`);
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

// 保存设置函数
const save = () => {
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
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error("设置保存失败，请检查存储权限");
    }
  }
};

// 初始化函数
const init = () => {
  migrateSettings();
  console.log(`[settings] 设置模块初始化完成`);
};

// 单一导出语句
export default {
  init,
  cleanup,
  migrateSettings,
  save,
  get
};
