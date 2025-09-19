import {
  extension_settings,
  eventSource,
  event_types,
} from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { registerModuleCleanup, getModule } from "../../../../utils.js";

// 扩展唯一标识，与manifest.json保持一致
const EXT_ID = "st_media_player";
const EXT_DISPLAY_NAME = "媒体播放器";

// 全局依赖管理
window.stMediaPlayer = window.stMediaPlayer || {
  deps: {},
  modules: {},
  isInitialized: false,
};
const stMediaPlayer = window.stMediaPlayer;

// 初始化扩展设置
function initSettings() {
  if (!extension_settings[EXT_ID]) {
    extension_settings[EXT_ID] = {
      enabled: true,
      rememberLastPosition: true,
      defaultVolume: 80,
      autoPlay: false,
    };
    saveSettingsDebounced();
  }
  return extension_settings[EXT_ID];
}

// 注册扩展到ST系统
function registerExtension() {
  // 注册扩展元数据
  eventSource.emit(event_types.REGISTER_EXTENSION, {
    id: EXT_ID,
    name: EXT_DISPLAY_NAME,
    description: "带窗口控制、AI检测、视频播放的全媒体播放器扩展",
    version: "1.4.2",
  });

  // 注册设置面板
  eventSource.emit(event_types.ADD_SETTING_PANEL, {
    id: `${EXT_ID}-settings`,
    name: EXT_DISPLAY_NAME,
    render: () =>
      import("./modules/settings.js").then((m) => m.renderSettings()),
  });
}

// 初始化扩展核心功能
async function initExtension() {
  if (stMediaPlayer.isInitialized) return;

  try {
    const settings = initSettings();

    // 只有在启用状态下才初始化
    if (!settings.enabled) {
      console.log(`[${EXT_ID}] 扩展已禁用`);
      return;
    }

    // 加载核心模块
    const mediaPlayer = await import("./modules/mediaPlayer.js");
    const ui = await import("./modules/ui.js");

    // 初始化模块
    await mediaPlayer.init(settings);
    await ui.init(settings);

    // 存储模块引用
    stMediaPlayer.modules.mediaPlayer = mediaPlayer;
    stMediaPlayer.modules.ui = ui;

    stMediaPlayer.isInitialized = true;
    console.log(`[${EXT_ID}] 扩展初始化完成`);

    // 触发扩展就绪事件
    eventSource.emit(`${EXT_ID}:ready`);
  } catch (error) {
    console.error(`[${EXT_ID}] 初始化失败:`, error);
    // 向ST系统报告错误
    eventSource.emit(event_types.EXTENSION_ERROR, {
      id: EXT_ID,
      error: error.message,
    });
  }
}

// 清理扩展资源
function cleanupExtension() {
  if (!stMediaPlayer.isInitialized) return;

  // 调用各模块的清理函数
  if (stMediaPlayer.modules.ui && stMediaPlayer.modules.ui.cleanup) {
    stMediaPlayer.modules.ui.cleanup();
  }

  if (
    stMediaPlayer.modules.mediaPlayer &&
    stMediaPlayer.modules.mediaPlayer.cleanup
  ) {
    stMediaPlayer.modules.mediaPlayer.cleanup();
  }

  // 移除事件监听器
  eventSource.removeAllListeners(`${EXT_ID}:`);

  stMediaPlayer.isInitialized = false;
  console.log(`[${EXT_ID}] 扩展已清理`);
}

// 处理扩展启用/禁用状态变化
function handleExtensionStateChange() {
  const settings = extension_settings[EXT_ID];
  if (settings.enabled && !stMediaPlayer.isInitialized) {
    initExtension();
  } else if (!settings.enabled && stMediaPlayer.isInitialized) {
    cleanupExtension();
  }
}

// 等待ST环境就绪
function waitForSTEnvironment() {
  // 检查是否已加载jQuery
  const checkDependencies = () => {
    const $ = window.jQuery || window.$;
    if ($) {
      stMediaPlayer.deps.jQuery = $;
      return true;
    }
    return false;
  };

  // 立即检查一次
  if (checkDependencies()) {
    return Promise.resolve();
  }

  // 定时检查依赖
  return new Promise((resolve) => {
    let checkCount = 0;
    const checkInterval = setInterval(() => {
      if (checkDependencies() || checkCount >= 40) {
        // 最多检查20秒
        clearInterval(checkInterval);
        resolve();
      }
      checkCount++;
    }, 500);
  });
}

// 主初始化流程
async function main() {
  // 等待ST应用就绪
  if (!window.appReady) {
    await new Promise((resolve) => {
      const readyHandler = () => {
        eventSource.removeListener(event_types.APP_READY, readyHandler);
        resolve();
      };
      eventSource.on(event_types.APP_READY, readyHandler);
    });
  }

  // 等待依赖加载
  await waitForSTEnvironment();

  // 注册扩展
  registerExtension();

  // 注册清理函数
  registerModuleCleanup(EXT_ID, cleanupExtension);

  // 监听设置变化
  eventSource.on(event_types.SETTINGS_UPDATED, handleExtensionStateChange);

  // 初始化扩展
  initExtension();
}

// 启动主流程
main();
