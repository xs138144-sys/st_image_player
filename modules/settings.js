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
      if (settings.mediaConfig.image_extensions) {
        // 修复可能的拼写错误（老版本可能误写为image_extensionsions）
        const targetExtList = settings.mediaConfig.image_extensionsions || settings.mediaConfig.image_extensions;
        ["webp", "apng"].forEach(ext => {
          const extWithDot = `.${ext}`;
          if (!targetExtList.includes(extWithDot)) {
            targetExtList.push(extWithDot);
          }
        });
        // 修正拼写错误
        if (settings.mediaConfig.image_extensionsions) {
          settings.mediaConfig.image_extensions = targetExtList;
          delete settings.mediaConfig.image_extensionsions;
        }
      }
      if (settings.mediaConfig.video_extensions) {
        [".mov", ".avi", ".mkv"].forEach(ext => {
          if (!settings.mediaConfig.video_extensions.includes(ext)) {
            settings.mediaConfig.video_extensions.push(ext);
          }
        });
      }
      settings.config_version = CONFIG_VERSION;
    }

    // 保存迁移后的配置
    save();
    toastr.info(`媒体播放器配置已更新到最新版本`);
  }
};

const cleanup = () => {
  try {
    const settings = getExtensionSettings();
    // 重置临时状态
    settings.isMediaLoading = false;
    settings.retryCount = 0;
    save();
    console.log(`[settings] 资源清理完成`);
  } catch (e) {
    toastr.error(`[settings] 清理失败: ${e.message}`);
  }
};

/**
 * 安全保存设置（兼容SillyTavern核心函数）
 */
export const save = () => {
  const settings = getExtensionSettings();
  const saveFn = window.saveSettingsDebounced || null;

  // 更新全局配置
  window.extension_settings[EXTENSION_ID] = settings;

  // 1. 优先使用SillyTavern核心保存函数
  if (saveFn && typeof saveFn === "function") {
    try {
      saveFn();
      console.log(`[settings] 核心函数保存成功`);
      return;
    } catch (e) {
      console.error(`[settings] 核心保存失败:`, e);
    }
  }

  // 2. localStorage备用
  try {
    localStorage.setItem(
      "extension_settings",
      JSON.stringify(window.extension_settings)
    );
    console.log(`[settings] localStorage保存成功`);
  } catch (e) {
    toastr.error("设置保存失败，请请检查存储权限");
    console.error(`[settings] localStorage保存失败:`, e);
  }
};

// 导出必要的函数
export { migrateSettings, cleanup, save };