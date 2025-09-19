import { EventBus } from "./core/eventBus.js";
import { deps } from "./core/deps.js";

// 初始化事件总线并添加到依赖
deps.EventBus = new EventBus();

// 需加载的模块列表（按依赖顺序排列）
const MODULES = [
  "settings", // 配置模块（最先加载）
  "utils", // 工具模块（基础依赖）
  "api", // API模块（依赖settings/utils）
  "websocket", // WebSocket模块（依赖settings/api）
  "mediaPlayer", // 播放模块（依赖所有基础模块）
  "aiEvents", // AI事件模块（依赖settings/utils）
  "ui", // UI模块（最后加载，依赖所有模块）
];

// 存储所有模块的清理函数
const moduleCleanupFns = new Map();

/**
 * 动态加载单个模块
 */
const loadModule = async (moduleName) => {
  try {
    // 动态导入模块
    const module = await import(`./modules/${moduleName}.js`);

    // 验证模块接口
    if (typeof module.init !== "function") {
      throw new Error(`模块${moduleName}缺少init()方法`);
    }
    if (typeof module.cleanup !== "function") {
      throw new Error(`模块${moduleName}缺少cleanup()方法`);
    }

    // 注册模块到依赖
    deps.registerModule(moduleName, module);

    // 初始化模块
    await module.init();
    console.log(`[index] 模块加载完成: ${moduleName}`);

    // 保存清理函数
    moduleCleanupFns.set(moduleName, module.cleanup);

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
  console.log(`[index] 媒体播放器扩展开始初始化（共${MODULES.length}个模块）`);
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
    deps.EventBus.emit("extensionInitialized");
  } catch (e) {
    console.error(`[index] 扩展初始化全局错误:`, e);
    deps.toastr.error(`扩展加载失败: ${e.message}`);
  }
};

/**
 * 安全启动扩展（等待SillyTavern环境就绪）
 */
const safeInit = () => {
  // 检查SillyTavern全局配置容器
  if (!window.extension_settings) {
    console.warn(`[index] SillyTavern环境未就绪，1秒后重试`);
    setTimeout(safeInit, 1000);
    return;
  }

  // 确保jQuery就绪后启动（强化检测逻辑）
  const checkJQuery = () => {
    // 优先从window获取jQuery，兼容全局挂载情况
    const globalJQuery = window.jQuery || window.$;
    if (globalJQuery) {
      deps.jQuery = globalJQuery; // 注入到依赖中
      initExtension();
      return;
    }

    // 若依赖中已有jQuery直接使用
    if (deps.jQuery) {
      initExtension();
      return;
    }

    // 重试逻辑（最多20秒）
    let retryCount = 0;
    const interval = setInterval(() => {
      const globalJQuery = window.jQuery || window.$;
      if (globalJQuery || deps.jQuery || retryCount > 40) {
        clearInterval(interval);
        deps.jQuery = globalJQuery || deps.jQuery; // 确保依赖被赋值
        if (deps.jQuery) {
          initExtension();
        } else {
          console.error("[index] jQuery长时间未就绪，扩展无法启动");
          deps.toastr.error("jQuery未就绪，扩展无法运行");
        }
      }
      retryCount++;
    }, 500);
  };

  checkJQuery();
};

// 启动扩展
safeInit();

// 全局错误处理
window.addEventListener("error", (e) => {
  console.error("[index] 全局错误:", e.error);
  deps.toastr.error(`媒体播放器错误: ${e.error.message}`);
});

// 扩展卸载时清理资源
window.addEventListener("beforeunload", () => {
  console.log(`[index] 开始清理扩展资源`);
  deps.EventBus.emit("extensionDisable");

  // 执行所有模块的清理函数
  moduleCleanupFns.forEach((cleanup, moduleName) => {
    try {
      cleanup();
      console.log(`[index] 模块${moduleName}已清理`);
    } catch (e) {
      console.error(`[index] 模块${moduleName}清理失败:`, e);
    }
  });

  // 清理事件总线
  deps.EventBus.clear();
  console.log(`[index] 扩展资源已完全清理`);
});
