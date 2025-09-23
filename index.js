import { deps } from "./core/deps.js";
import { ModuleLoader } from "./core/moduleLoader.js";

const EXT_ID = "st_image_player";

// 创建模块加载器实例
const moduleLoader = new ModuleLoader(deps);

// 需加载的模块列表（按依赖顺序排列）
const MODULES = [
  // 基础工具模块 - 先加载这些，因为它们被其他模块依赖
  "modules/timeUtils",
  "modules/domUtils",
  "modules/utils",
  
  // 设置相关模块 - 在API之前加载
  "modules/settings/settingsManager",
  "modules/settings/settingsMigrator",
  
  // API相关模块
  "modules/api/serviceApi",
  "modules/api/mediaApi",
  "modules/api/configApi",
  
  // 其他模块
  "modules/websocket",
  "media/mediaPlayer",
  "modules/aiEvents",
  "ui/ui",
  
  // 迁移模块（提供向后兼容性）- 最后加载，确保所有基础模块都已加载
  "modules/migration/legacyModuleAdapter",
];

/**
 * 批量加载所有模块
 */
const initExtension = async () => {
  console.log(`[index] 媒体播放器扩展开始初始化（共${MODULES.length}个模块）`);

  // 使用安全的toastr调用
  if (deps.toastr && typeof deps.toastr.info === "function") {
    deps.toastr.info("媒体播放器扩展正在加载...");
  }

  try {
    // 使用模块加载器加载所有模块
    const loadResults = await moduleLoader.loadAllModules(MODULES);

    // 检查关键模块加载状态
    const criticalModules = [
      "modules/settings/settingsManager", 
      "modules/api/serviceApi", 
      "modules/domUtils"
    ];
    const failedCritical = criticalModules.filter(m => !loadResults[m]);

    if (failedCritical.length > 0) {
      throw new Error(`关键模块加载失败: ${failedCritical.join(", ")}`);
    }

    // 初始化完成通知
    console.log(`[index] 所有模块加载完成`);
    
    // 添加详细的模块加载成功提示
    const successfulModules = Object.keys(loadResults).filter(m => loadResults[m]);
    const failedModules = Object.keys(loadResults).filter(m => !loadResults[m]);
    
    console.log(`✅ 媒体播放器扩展初始化成功！`);
    console.log(`📦 已成功加载 ${successfulModules.length}/${MODULES.length} 个模块`);
    console.log(`🎯 关键模块状态: ${failedCritical.length === 0 ? '全部正常' : '部分失败'}`);
    
    if (successfulModules.length > 0) {
      console.log(`✅ 成功加载的模块: ${successfulModules.join(', ')}`);
    }
    
    if (failedModules.length > 0) {
      console.log(`⚠️  加载失败的模块: ${failedModules.join(', ')}`);
    }
    
    console.log(`🚀 媒体播放器扩展已完全就绪，可以正常使用！`);
    
    if (deps.toastr && typeof deps.toastr.success === "function") {
      deps.toastr.success("媒体播放器扩展已加载就绪");
    }
    deps.EventBus.emit("extensionInitialized");

    // 注意：不再触发requestCreateSettingsPanel事件，因为UI模块初始化时已经根据设置状态创建了相应的面板
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
      config_version: "1.4.2"
    };
  } else {
    // 配置迁移
    const settings = deps.extension_settings[EXT_ID];
    if (!settings.config_version || settings.config_version !== "1.4.2") {
      console.log(`[${EXT_ID}] 迁移配置从 ${settings.config_version || '未知'} 到 1.4.2`);

      // 添加缺失的配置项
      if (!settings.serviceUrl) settings.serviceUrl = "http://127.0.0.1:9000";
      if (!settings.websocket_timeout) settings.websocket_timeout = 10000;
      if (!settings.randomPlayedIndices) settings.randomPlayedIndices = [];

      settings.config_version = "1.4.2";
      deps.saveSettingsDebounced();
    }
  }

  // 检查ST是否已经就绪（使用更可靠的方法）
  if (typeof window.jQuery !== 'undefined' && window.jQuery.fn) {
    return safeInit(initExtension);
  }

  // 设置超时，防止永远等待
  setTimeout(() => {
    safeInit(initExtension);
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
});