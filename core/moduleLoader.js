import { deps } from "./deps.js";

const EXT_ID = "st_image_player";

/**
 * 模块加载器 - 负责动态加载和管理模块
 */
export class ModuleLoader {
  constructor() {
    this.loadedModules = new Map();
    this.cleanupListeners = [];
  }

  /**
   * 获取SillyTavern环境中的扩展根目录URL
   */
  _getExtensionBaseUrl() {
    // 在SillyTavern中，扩展脚本运行在特定的路径下
    // 尝试从当前脚本的URL推断扩展根目录
    const scripts = document.querySelectorAll('script[src*="st_image_player"]');
    if (scripts.length > 0) {
      const scriptSrc = scripts[0].src;
      // 移除core/目录部分，获取扩展根目录
      const extensionPath = scriptSrc.substring(0, scriptSrc.indexOf('/core/')) + '/';
      console.log(`[moduleLoader] 检测到扩展根目录: ${extensionPath}`);
      return extensionPath;
    }
    
    // 如果无法检测，使用默认的SillyTavern扩展路径
    const defaultPath = window.location.origin + '/scripts/extensions/third-party/st_image_player/';
    console.log(`[moduleLoader] 使用默认扩展路径: ${defaultPath}`);
    return defaultPath;
  }

  /**
   * 动态加载单个模块（带重试机制）
   */
  async loadModule(moduleName, retries = 3) {
    try {
      console.log(`[moduleLoader] 加载模块: ${moduleName}`);
      
      // 在SillyTavern环境中，模块路径需要相对于扩展根目录
      let modulePath;
      
      // 处理模块路径逻辑
      if (moduleName.startsWith('modules/') || moduleName.startsWith('media/') || moduleName.startsWith('ui/')) {
        // 如果模块名已经包含目录前缀，直接使用
        modulePath = `./${moduleName}.js`;
      } else if (moduleName.includes('/')) {
        // 对于子目录模块，确保路径正确
        modulePath = `./${moduleName}.js`;
      } else {
        // 对于根目录模块，默认放在modules目录
        modulePath = `./modules/${moduleName}.js`;
      }
      
      console.log(`[moduleLoader] 相对路径: ${modulePath}`);
      
      // 在SillyTavern中，需要基于扩展根目录构建完整URL
      const baseUrl = this._getExtensionBaseUrl();
      const fullUrl = new URL(modulePath, baseUrl).href;
      console.log(`[moduleLoader] 完整URL: ${fullUrl}`);
      
      // 使用完整的URL进行导入
      const module = await import(/* webpackIgnore: true */ fullUrl);

      // 检查模块是否有效
      if (!module || typeof module !== 'object') {
        throw new Error(`模块加载失败: ${moduleName}`);
      }

      // 获取模块对象（支持默认导出和命名导出）
      const moduleObj = module.default || module;

      // 确保模块有必要的接口方法
      this._validateModuleInterface(moduleObj, moduleName);

      // 初始化模块
      await moduleObj.init();
      console.log(`[moduleLoader] 模块加载完成: ${moduleName}`);

      // 注册模块到依赖管理器
      deps.registerModule(moduleName, moduleObj);

      // 注册模块清理事件
      this._registerModuleCleanup(moduleName, moduleObj);

      this.loadedModules.set(moduleName, moduleObj);
      return true;
    } catch (e) {
      if (retries > 0) {
        console.warn(`[moduleLoader] 模块 ${moduleName} 加载失败，正在重试（${retries}次剩余）:`, e.message);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.loadModule(moduleName, retries - 1);
      }

      console.error(`[moduleLoader] 模块加载失败: ${moduleName}`, e);
      this._showModuleLoadError(moduleName, e);
      return false;
    }
  }

  /**
   * 批量加载所有模块
   */
  async loadAllModules(moduleList) {
    console.log(`[moduleLoader] 开始加载所有模块（共${moduleList.length}个）`);
    
    const loadResults = {};

    // 按顺序加载模块
    for (const moduleName of moduleList) {
      const success = await this.loadModule(moduleName);
      loadResults[moduleName] = success;

      if (!success) {
        console.warn(`[moduleLoader] 模块${moduleName}加载失败，继续加载其他模块`);
      }
    }

    return loadResults;
  }

  /**
   * 检查关键模块加载状态
   */
  checkCriticalModules(loadResults, criticalModules) {
    const failedCritical = criticalModules.filter(m => !loadResults[m]);
    if (failedCritical.length > 0) {
      throw new Error(`关键模块加载失败: ${failedCritical.join(", ")}`);
    }
    return true;
  }

  /**
   * 清理所有已加载模块
   */
  async cleanupAllModules() {
    console.log(`[moduleLoader] 清理所有模块`);
    
    // 执行所有清理监听器
    for (const removeListener of this.cleanupListeners) {
      if (typeof removeListener === "function") {
        removeListener();
      }
    }
    
    // 清理模块实例
    for (const [moduleName, moduleObj] of this.loadedModules) {
      try {
        if (typeof moduleObj.cleanup === "function") {
          await moduleObj.cleanup();
        }
      } catch (e) {
        console.error(`[moduleLoader] 模块清理失败: ${moduleName}`, e);
      }
    }

    this.loadedModules.clear();
    this.cleanupListeners = [];
    console.log(`[moduleLoader] 所有模块清理完成`);
  }

  /**
   * 获取已加载模块
   */
  getModule(moduleName) {
    return this.loadedModules.get(moduleName);
  }

  /**
   * 获取所有已加载模块
   */
  getAllModules() {
    return Array.from(this.loadedModules.entries());
  }

  // 私有方法
  _validateModuleInterface(moduleObj, moduleName) {
    // 检查模块是否有init方法
    let initFunction = moduleObj.init || moduleObj.default?.init;
    if (typeof initFunction !== "function") {
      throw new Error(`缺少init()方法`);
    }

    // 提供默认清理函数（如果模块没有提供）
    let cleanupFunction = moduleObj.cleanup || moduleObj.default?.cleanup;
    if (typeof cleanupFunction !== "function") {
      console.warn(`[moduleLoader] 模块 ${moduleName} 缺少cleanup()方法，将使用默认清理函数`);
      cleanupFunction = () => { console.log(`[${moduleName}] 默认清理完成`) };
    }

    // 确保模块对象有正确的方法
    if (typeof moduleObj.init !== "function") {
      moduleObj.init = initFunction;
    }
    if (typeof moduleObj.cleanup !== "function") {
      moduleObj.cleanup = cleanupFunction;
    }
  }

  _registerModuleCleanup(moduleName, moduleObj) {
    const removeCleanupListener = deps.EventBus.on(
      "extensionDisable",
      moduleObj.cleanup
    );
    this.cleanupListeners.push(removeCleanupListener);
  }

  _showModuleLoadError(moduleName, error) {
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`模块${moduleName}加载失败: ${error.message}`);
    }
  }
}

// 默认导出单例实例
export const moduleLoader = new ModuleLoader();
export default moduleLoader;