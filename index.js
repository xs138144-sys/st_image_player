import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { deps } from "./core/deps.js";
import * as utils from "./modules/utils.js";
import { EventBus } from "./core/eventBus.js";

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
  try {
    const resolvedUrl = new URL(relativePath, window.location.href).href;
    console.log(`[${EXT_ID}] 验证路径: ${resolvedUrl}`);
    return resolvedUrl;
  } catch (e) {
    console.error(`[${EXT_ID}] 路径验证失败: ${relativePath}`, e);
    return relativePath;
  }
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
/**
 * 动态加载单个模块
 */
const loadModule = async (moduleName) => {
  try {
    // 确保模块路径正确
    const modulePath = `./modules/${moduleName}.js`;
    const module = await import(modulePath);

    // 检查模块是否有效
    if (!module || typeof module !== 'object') {
      throw new Error(`模块加载失败: ${moduleName}`);
    }

    // 每个模块必须实现init和cleanup方法
    if (typeof module.init !== "function") {
      throw new Error(`缺少init()方法`);
    }
    if (typeof module.cleanup !== "function") {
      console.warn(`[index] 模块 ${moduleName} 缺少cleanup()方法，将使用默认清理函数`);
      module.cleanup = () => { }; // 提供默认清理函数
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
    // 只有在toastr可用时才显示错误
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`模块${moduleName}加载失败: ${e.message}`);
    }
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
    return fn();
  } catch (error) {
    console.error(`[${EXT_ID}] 初始化失败:`, error);
    if (eventSource && event_types && event_types.EXTENSION_ERROR) {
      eventSource.emit(event_types.EXTENSION_ERROR, {
        id: EXT_ID,
        error: error.message,
        stack: error.stack,
      });
    }
    // 确保错误不会阻止后续代码执行
    return null;
  }
};

/**
 * 安全启动扩展（等待SillyTavern环境就绪）
 */
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

    // 确保 mediaConfig 对象存在
    if (!settings.mediaConfig) {
      settings.mediaConfig = {
        image_max_size_mb: 5,
        video_max_size_mb: 100,
        preload_strategy: {
          image: true,
          video: false
        }
      };
    } else if (settings.mediaConfig.preload_strategy === undefined) {
      // 如果 mediaConfig 存在但没有 preload_strategy，则添加
      settings.mediaConfig.preload_strategy = {
        image: true,
        video: false
      };
    }
    saveSettingsDebounced();
  }

  // 检查ST是否已经就绪
  if (window.appReady) {
    return safeInit(initExtension);
  }

  // 定义备选事件名（根据SillyTavern实际事件类型调整）
  const appReadyEvent = event_types?.APP_READY || "appReady";

  // 检查事件源是否可用
  if (!eventSource) {
    console.warn(`[${EXT_ID}] 事件源不可用，直接初始化`);
    return safeInit(initExtension);
  }

  const readyHandler = () => {
    eventSource.removeListener(appReadyEvent, readyHandler);
    safeInit(initExtension);
  };

  // 添加事件监听器
  if (typeof eventSource.on === "function") {
    eventSource.on(appReadyEvent, readyHandler);
  } else {
    console.warn(`[${EXT_ID}] 事件源不支持on方法，直接初始化`);
    safeInit(initExtension);
  }

  // 设置超时，防止永远等待
  setTimeout(() => {
    if (!window.appReady) {
      console.warn(`[${EXT_ID}] 等待ST就绪超时，尝试直接初始化`);
      safeInit(initExtension);
    }
  }, 15000);
};

// 启动扩展
waitForSTAndInit();

// 全局错误处理
// 全局错误处理
window.addEventListener("error", (e) => {
  console.error("[index] 全局错误:", e.error);
  // 只有在toastr可用时才显示错误
  if (deps.toastr && typeof deps.toastr.error === "function") {
    deps.toastr.error(`媒体播放器错误: ${e.error?.message || "未知错误"}`);
  }
});

// 扩展卸载时清理资源
window.addEventListener("beforeunload", () => {
  EventBus.emit("extensionDisable");
  if (window.moduleCleanupListeners) {
    window.moduleCleanupListeners.forEach((removeListener) => {
      if (typeof removeListener === "function") {
        removeListener();
      }
    });
  }
  console.log(`[index] 扩展资源已清理`);
});

// 注册清理函数
utils.registerModuleCleanup(EXT_ID, () => {
  console.log(`[${EXT_ID}] 执行全局清理`);
  EventBus.emit("extensionDisable");
  if (window.moduleCleanupListeners) {
    window.moduleCleanupListeners.forEach((removeListener) => {
      if (typeof removeListener === "function") {
        removeListener();
      }
    });
  }
});