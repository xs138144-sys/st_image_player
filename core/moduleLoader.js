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
   * 获取扩展的基础URL（在SillyTavern环境中）
   */
  _getExtensionBaseUrl() {
    // 支持两种安装方式的路径检测
    // 1. 本地安装: /scripts/extensions/third-party/st_image_player/
    // 2. GitHub安装: /data/default-user/extensions/st_image_player/
    
    // 尝试检测当前脚本的实际路径
    const scripts = document.querySelectorAll('script[src*="st_image_player"]');
    
    if (scripts.length > 0) {
      const scriptUrl = scripts[0].src;
      console.log(`[moduleLoader] 检测到脚本URL: ${scriptUrl}`);
      
      // 检查GitHub安装路径（确保不是开发服务器）
      if (scriptUrl.includes('/data/default-user/extensions/') && 
          !scriptUrl.includes('localhost:8000') && 
          !scriptUrl.includes('127.0.0.1:8000')) {
        const extensionRoot = '/data/default-user/extensions/st_image_player/';
        console.log(`[moduleLoader] 检测到GitHub安装路径: ${extensionRoot}`);
        return extensionRoot;
      }
      
      // 检查本地安装路径（确保不是开发服务器）
      if (scriptUrl.includes('/scripts/extensions/third-party/') && 
          !scriptUrl.includes('localhost:8000') && 
          !scriptUrl.includes('127.0.0.1:8000')) {
        const extensionRoot = '/scripts/extensions/third-party/st_image_player/';
        console.log(`[moduleLoader] 检测到本地安装路径: ${extensionRoot}`);
        return extensionRoot;
      }
      
      // 检查本地安装但通过Python HTTP服务器访问的情况
      if (scriptUrl.includes('/scripts/extensions/third-party/') && 
          (scriptUrl.includes('localhost:8000') || scriptUrl.includes('127.0.0.1:8000'))) {
        const extensionRoot = '/scripts/extensions/third-party/st_image_player/';
        console.log(`[moduleLoader] 检测到本地安装（通过HTTP服务器）: ${extensionRoot}`);
        return extensionRoot;
      }
      
      // 检查开发环境（Python HTTP服务器）
      if (scriptUrl.includes('localhost:8000') || scriptUrl.includes('127.0.0.1:8000')) {
        // 在开发环境中，使用相对路径，让浏览器自动处理
        console.log(`[moduleLoader] 检测到开发环境，使用相对路径`);
        return '';
      }
      
      // 如果无法确定具体路径，尝试从脚本URL推断扩展根目录
      try {
        // 提取脚本目录路径（移除文件名部分）
        const scriptDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/') + 1);
        
        // 检查是否在core目录中，如果是则向上移动一级
        if (scriptDir.includes('/core/')) {
          const extensionRoot = scriptDir.replace('/core/', '/');
          console.log(`[moduleLoader] 推断扩展根目录: ${extensionRoot}`);
          return extensionRoot;
        }
        
        // 直接使用脚本所在目录
        console.log(`[moduleLoader] 使用脚本所在目录: ${scriptDir}`);
        return scriptDir;
      } catch (e) {
        console.warn(`[moduleLoader] 路径推断失败，使用相对路径`);
        return '';
      }
    }
    
    // 如果没有找到脚本，使用相对路径
    console.warn(`[moduleLoader] 未找到扩展脚本，使用相对路径`);
    return '';
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
      // 注意：moduleName已经包含了完整的相对路径（如'modules/timeUtils'）
      // 直接添加.js扩展名即可，不需要额外添加目录前缀
      modulePath = `${moduleName}.js`;
      
      console.log(`[moduleLoader] 相对路径: ${modulePath}`);
      
      // 在SillyTavern中，需要基于扩展根目录构建完整URL
      const baseUrl = this._getExtensionBaseUrl();
      let fullUrl;
      if (baseUrl) {
        fullUrl = new URL(modulePath, baseUrl).href;
      } else {
        // 如果baseUrl是空字符串（开发环境），需要从当前脚本URL推断完整路径
        const scripts = document.querySelectorAll('script[src*="st_image_player"]');
        if (scripts.length > 0) {
          const scriptUrl = scripts[0].src;
          const scriptDir = scriptUrl.substring(0, scriptUrl.lastIndexOf('/') + 1);
          fullUrl = new URL(modulePath, scriptDir).href;
          console.log(`[moduleLoader] 开发环境推断路径: ${fullUrl}`);
        } else {
          // 如果无法推断，使用相对路径
          fullUrl = modulePath;
          console.warn(`[moduleLoader] 无法推断开发环境路径，使用相对路径: ${fullUrl}`);
        }
      }
      console.log(`[moduleLoader] 完整URL: ${fullUrl}`);
      
      // 使用完整的URL进行导入（带超时机制）
      console.log(`[moduleLoader] 开始导入模块: ${fullUrl}`);
      let module;
      try {
        // 添加超时机制，防止import卡住
        const importPromise = import(/* webpackIgnore: true */ fullUrl);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`模块导入超时: ${moduleName}`)), 5000)
        );
        
        module = await Promise.race([importPromise, timeoutPromise]);
        console.log(`[moduleLoader] 模块导入成功: ${moduleName}`);
      } catch (importError) {
        console.error(`[moduleLoader] 模块导入失败: ${moduleName}`, importError);
        throw new Error(`模块导入失败: ${moduleName} - ${importError.message}`);
      }

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

    // 按顺序加载模块，但使用更健壮的错误处理
    for (const moduleName of moduleList) {
      try {
        const success = await this.loadModule(moduleName);
        loadResults[moduleName] = success;

        if (!success) {
          console.warn(`[moduleLoader] 模块${moduleName}加载失败，继续加载其他模块`);
        }
      } catch (e) {
        console.error(`[moduleLoader] 模块${moduleName}加载过程中发生未捕获错误:`, e);
        loadResults[moduleName] = false;
        // 继续加载其他模块，不中断流程
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
      cleanupFunction = async () => { console.log(`[${moduleName}] 默认清理完成`); };
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