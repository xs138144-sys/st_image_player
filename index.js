import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { deps } from "./core/deps.js";
import * as utils from "./modules/utils.js";
import { EventBus } from "./core/eventBus.js";
import { registerModuleCleanup } from "./modules/utils.js";

// 注册utils到deps
deps.registerModule('utils', utils);
deps.registerModule('EventBus', EventBus);

const eventSource = deps.utils.getSafeGlobal("eventSource", null);
const event_types = deps.utils.getSafeGlobal("event_types", {});

const EXT_ID = "st_image_player";

// 需加载的模块列表（按依赖顺序排列）
const MODULES = [
  "utils", // 工具模块提前，供settings依赖
  "settings", // 配置模块（依赖utils）
  "api", // API模块（依赖settings/utils）
  "websocket", // WebSocket模块（依赖settings/api）
  "mediaPlayer", // 播放模块（依赖所有基础模块）
  "aiEvents", // AI事件模块（依赖settings/utils）
  "ui", // UI模块（最后加载）
];

// 打印所有核心文件的实际请求路径
const logResolvedPath = (relativePath) => {
  const resolvedUrl = new URL(relativePath, window.location.href).href;
  console.log(`[${EXT_ID}] 验证路径: ${resolvedUrl}`);
  return resolvedUrl;
};

// 初始化前强制检查所有路径
const verifyPaths = () => {
  console.log(`[${EXT_ID}] 开始验证子文件夹路径`);
  logResolvedPath("../../../extensions.js");
  logResolvedPath("../../../../script.js");
  logResolvedPath("./modules/utils.js");
};

/**
 * 动态加载单个模块
 */
const loadModule = async (moduleName) => {
  try {
    const module = await import(`./modules/${moduleName}.js`);
    // 每个模块必须实现init和cleanup方法
    if (typeof module.init !== "function") {
      throw new Error(`缺少init()方法`);
    }
    if (typeof module.cleanup !== "function") {
      throw new Error(`缺少cleanup()方法`);
    }

    // 初始化模块
    await module.init();
    console.log(`[index] 模块加载完成: ${moduleName}`);

    // 注册模块到依赖管理器
    deps.registerModule(moduleName, module);

    // 注册模块清理事件（扩展禁用时触发）
    const removeCleanupListener = EventBus.on(
      "extensionDisable",
      module.cleanup
    );
    window.moduleCleanupListeners = window.moduleCleanupListeners || [];
    window.moduleCleanupListeners.push(removeCleanupListener);

    return true;
  } catch (e) {
    console.error(`[index] 模块加载失败: ${moduleName}`, e);
    deps.toastr.error(`模块${moduleName}加载失败: ${e.message}`);
    return false;
  }
};

/**
 * 批量加载所有模块
 */
const initExtension = async () => {
  console.log(`[index] 媒体播放器播放器扩展开始初始化（共${MODULES.length}个模块）`);
  deps.toastr.info("媒体播放器扩展正在加载...");

  try {
    // 按顺序加载模块
    for (const moduleName of MODULES) {
      const success = await loadModule(moduleName);
      if (!success) {
        console.warn(`[index] 模块${moduleName}加载失败，继续加载其他模块`);
      }
    }

    // 初始化完成通知
    console.log(`[index] 所有模块加载完成`);
    deps.toastr.success("媒体播放器扩展已加载就绪");
    EventBus.emit("extensionInitialized");
  } catch (e) {
    console.error(`[index] 扩展初始化全局错误:`, e);
    deps.toastr.error(`扩展加载失败: ${e.message}`);
  }
};

const safeInit = (fn) => {
  try {
    console.log(`[${EXT_ID}] 开始初始化`);
    fn();
  } catch (error) {
    console.error(`[${EXT_ID}] 初始化失败:`, error);
    eventSource?.emit(event_types.EXTENSION_ERROR, {
      id: EXT_ID,
      error: error.message,
      stack: error.stack,
    });
  }
};

/**
 * 安全启动扩展（等待SillyTavern环境就绪）
 */
const waitForSTAndInit = () => {
  verifyPaths();

  // 确保扩展配置存在
  if (!extension_settings[EXT_ID]) {
    extension_settings[EXT_ID] = {
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
      transitionEffect: "fade", // 新增：过渡效果设置
      randomPlayedIndices: [] // 新增：随机播放历史记录
    };
    saveSettingsDebounced();
  } else {
    // 配置迁移：添加新版本所需的配置项
    const settings = extension_settings[EXT_ID];
    if (settings.transitionEffect === undefined) {
      settings.transitionEffect = "fade";
    }
    if (settings.randomPlayedIndices === undefined) {
      settings.randomPlayedIndices = [];
    }
    if (settings.mediaConfig.preload_strategy === undefined) {
      settings.mediaConfig.preload_strategy = {
        image: true,
        video: false
      };
    }
    saveSettingsDebounced();
  }

  if (window.appReady) {
    safeInit(initExtension);
    return;
  }

  // 定义备选事件名（根据SillyTavern实际事件类型调整）
  const appReadyEvent = event_types.APP_READY || "appReady" || "APP_READY";

  // 检查事件名是否有效
  if (!appReadyEvent) {
    console.warn(`[${EXT_ID}] 未找到有效的APP_READY事件类型，直接初始化`);
    safeInit(initExtension);
    return;
  }

  const readyHandler = () => {
    eventSource.removeListener(appReadyEvent, readyHandler);
    safeInit(initExtension);
  };

  eventSource.on(appReadyEvent, readyHandler);
  setTimeout(() => {
    if (!window.appReady) {
      console.error(`[${EXT_ID}] 等待ST就绪超时`);
      safeInit(initExtension);
    }
  }, 15000);
};

// 启动扩展
waitForSTAndInit();

// 全局错误处理
window.addEventListener("error", (e) => {
  console.error("[index] 全局错误:", e.error);
  deps.toastr.error(`媒体播放器错误: ${e.error.message}`);
});

// 扩展卸载时清理资源
window.addEventListener("beforeunload", () => {
  EventBus.emit("extensionDisable");
  if (window.moduleCleanupListeners) {
    window.moduleCleanupListeners.forEach((removeListener) => removeListener());
  }
  console.log(`[index] 扩展资源已清理`);
});

// 注册清理函数
registerModuleCleanup(EXT_ID, () => {
  console.log(`[${EXT_ID}] 执行全局清理`);
  EventBus.emit("extensionDisable");
  if (window.moduleCleanupListeners) {
    window.moduleCleanupListeners.forEach((removeListener) => removeListener());
  }
});
