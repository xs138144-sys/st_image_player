import { deps } from "./core/deps.js";

const EXT_ID = "st_image_player";

// 需加载的模块列表（按依赖顺序排列）
const MODULES = [
  "utils",
  "settings",
  "api",
  "websocket",
  "mediaPlayer",
  "aiEvents",
  "ui",
];

// 动态加载单个模块（添加重试机制）
const loadModule = async (moduleName, options = {}) => {
  const { maxRetries = 5, baseDelay = 1000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[index] 加载模块: ${moduleName}`);
      const module = await import(`./modules/${moduleName}.js`);

      // 检查模块是否有效
      if (!module || typeof module !== 'object') {
        throw new Error(`模块加载失败: ${moduleName}`);
      }

      // 检查模块是否有init方法（支持默认导出和命名导出）
      let initFunction = module.init || module.default?.init;
      if (typeof initFunction !== "function") {
        throw new Error(`缺少init()方法`);
      }

      // 提供默认清理函数（如果模块没有提供）
      let cleanupFunction = module.cleanup || module.default?.cleanup;
      if (typeof cleanupFunction !== "function") {
        console.warn(`[index] 模块 ${moduleName} 缺少cleanup()方法，将使用默认清理函数`);
        cleanupFunction = () => { console.log(`[${moduleName}] 默认清理完成`) };
      }

      // 创建模块对象
      const moduleObj = module.default || module;
      if (typeof moduleObj.init !== "function") {
        moduleObj.init = initFunction;
      }
      if (typeof moduleObj.cleanup !== "function") {
        moduleObj.cleanup = cleanupFunction;
      }

      // 初始化模块
      await moduleObj.init();
      console.log(`[index] 模块加载完成: ${moduleName}`);

      // 注册模块到依赖管理器
      deps.registerModule(moduleName, moduleObj);

      // 注册模块清理事件
      const removeCleanupListener = deps.EventBus.on(
        "extensionDisable",
        moduleObj.cleanup
      );
      window.moduleCleanupListeners = window.moduleCleanupListeners || [];
      window.moduleCleanupListeners.push(removeCleanupListener);

      return true;
    } catch (e) {
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[index] ${moduleName}加载失败，${delay}ms后重试 (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`[index] ${moduleName}加载失败，已达最大重试次数`, e);
        return false;
      }
    }
  }
};

// UI模块特殊加载函数
async function loadUIModule() {
  if (document.readyState === 'loading') {
    // DOM 未完全加载，等待
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
  }
  
  // 确保所需的 DOM 元素存在
  const maxRetries = 10;
  let retries = 0;
  
  while (retries < maxRetries) {
    if (document.querySelector('#extensionsMenu') && 
        document.querySelector('#extensionsSettings')) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    retries++;
  }
  
  // 现在加载 UI 模块
  return await loadModule('ui');
}

// 更新初始化调用
const initExtension = async () => {
  console.log(`[index] 媒体播放器扩展开始初始化（共${MODULES.length}个模块）`);

  // 使用安全的toastr调用
  if (deps.toastr && typeof deps.toastr.info === "function") {
    deps.toastr.info("媒体播放器扩展正在加载...");
  }

  try {
    const loadResults = {};

    // 按顺序加载模块，UI模块使用特殊加载方式
    for (const moduleName of MODULES) {
      let success;
      if (moduleName === 'ui') {
        success = await loadUIModule();
      } else {
        success = await loadModule(moduleName, {
          maxRetries: 5,
          baseDelay: 1000
        });
      }
      loadResults[moduleName] = success;

      if (!success) {
        console.warn(`[index] 模块${moduleName}加载失败，继续加载其他模块`);
      }
    }

    // 检查关键模块加载状态
    const criticalModules = ["settings", "api", "utils"];
    const failedCritical = criticalModules.filter(m => !loadResults[m]);

    if (failedCritical.length > 0) {
      throw new Error(`关键模块加载失败: ${failedCritical.join(", ")}`);
    }

    // 初始化完成通知
    console.log(`[index] 所有模块加载完成`);
    if (deps.toastr && typeof deps.toastr.success === "function") {
      deps.toastr.success("媒体播放器扩展已加载就绪");
    }
    deps.EventBus.emit("extensionInitialized");
  } catch (e) {
    console.error(`[index] 扩展初始化全局错误:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`扩展加载失败: ${e.message}`);
    }
  }
};

const safeInit = (fn) => {
  try {
    console.log(`[${EXT_ID}] 开始初始化`);
    return fn();
  } catch (error) {
    console.error(`[${EXT_ID}] 初始化失败:`, error);
    // 确保错误不会阻止后续代码执行
    return null;
  }
};

const waitForSTAndInit = () => {
  // 确保扩展配置存在
  if (!deps.extension_settings[EXT_ID]) {
    deps.extension_settings[EXT_ID] = {
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
      serviceUrl: "http://127.0.0.1:9001",
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
      config_version: "1.4.2"
    };
  } else {
    // 配置迁移
    const settings = deps.extension_settings[EXT_ID];
    if (!settings.config_version || settings.config_version !== "1.4.2") {
      console.log(`[${EXT_ID}] 迁移配置从 ${settings.config_version || '未知'} 到 1.4.2`);

      // 添加缺失的配置项
      if (!settings.serviceUrl) settings.serviceUrl = "http://127.0.0.1:9001";
      if (!settings.websocket_timeout) settings.websocket_timeout = 10000;
      if (!settings.randomPlayedIndices) settings.randomPlayedIndices = [];

      settings.config_version = "1.4.2";
      deps.saveSettingsDebounced();
    }
  }

  // 防止重复初始化
  if (window[EXT_ID + '_initialized']) {
    console.log(`[${EXT_ID}] 扩展已经初始化，跳过重复初始化`);
    return;
  }

  // 检查ST是否已经就绪（使用更可靠的方法）
  if (typeof window.jQuery !== 'undefined' && window.jQuery.fn) {
    window[EXT_ID + '_initialized'] = true;
    return safeInit(initExtension);
  }

  // 设置超时，防止永远等待
  setTimeout(() => {
    if (!window[EXT_ID + '_initialized']) {
      window[EXT_ID + '_initialized'] = true;
      safeInit(initExtension);
    }
  }, 15000);
};

// 启动扩展
waitForSTAndInit();

// 全局错误处理
window.addEventListener("error", (e) => {
  console.error("[index] 全局错误:", e.error);
  // 只有在toastr可用时才显示错误
  if (deps.toastr && typeof deps.toastr.error === "function") {
    deps.toastr.error(`媒体播放器错误: ${e.error?.message || "未知错误"}`);
  }
});

window.addEventListener("beforeunload", () => {
  deps.EventBus.emit("extensionDisable");
  if (window.moduleCleanupListeners) {
    window.moduleCleanupListeners.forEach((removeListener) => {
      if (typeof removeListener === "function") {
        removeListener();
      }
    });
  }
  console.log(`[index] 扩展资源已清理`);
  window[EXT_ID + '_initialized'] = false;
});