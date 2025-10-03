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
   * 安全获取deps对象（避免循环依赖）
   */
  _getDeps() {
    // 尝试从全局获取deps
    if (window.deps && typeof window.deps.registerModule === 'function') {
      return window.deps;
    }
    
    // 如果全局deps不存在，创建一个简单的回退版本
    console.warn('[moduleLoader] deps对象未找到，使用回退版本');
    return {
      registerModule: (name, module) => {
        console.log(`[moduleLoader] 回退注册模块: ${name}`);
        if (!window.deps) window.deps = { modules: {} };
        if (!window.deps.modules) window.deps.modules = {};
        window.deps.modules[name] = module;
      },
      getModule: (name) => {
        return window.deps?.modules?.[name] || null;
      }
    };
  }

  /**
   * 获取扩展的基础URL（在SillyTavern环境中）
   */
  _getExtensionBaseUrl() {
    // 检测当前环境：SillyTavern还是独立测试
    // 更智能的环境检测：检查是否在测试页面中运行
    // 检测SillyTavern环境
    const isSillyTavern = typeof window !== 'undefined' && 
        (!!window.SillyTavern || 
         window.location?.pathname?.includes('/scripts/extensions/') ||
         window.location?.pathname?.includes('/extensions/'));
         
    // 检测测试环境
    const isTestEnvironment = typeof window !== 'undefined' && window.location && 
        (window.location.pathname.includes('/test_module_loading.html') || 
         window.location.pathname.includes('test_module_loading.html') ||
         (typeof window.runTest === 'function'));
    
    console.log(`[moduleLoader] 环境检测 - ST: ${isSillyTavern}, 测试: ${isTestEnvironment}, 路径: ${window.location?.pathname}`);
    
    if (isSillyTavern) {
      // SillyTavern环境 - 使用相对路径（修复路径问题）
      const extensionRoot = '../';
      console.log(`[moduleLoader] SillyTavern环境，使用相对路径: ${extensionRoot}`);
      return extensionRoot;
    } else if (isTestEnvironment) {
      // 测试环境 - 使用相对路径
      const extensionRoot = '../';
      console.log(`[moduleLoader] 测试环境，使用相对路径: ${extensionRoot}`);
      return extensionRoot;
    } else {
      // 默认环境（可能是其他环境）- 使用相对路径
      const extensionRoot = '../';
      console.log(`[moduleLoader] 默认环境，使用相对路径: ${extensionRoot}`);
      return extensionRoot;
    }
  }

  /**
   * 动态加载单个模块（简化版本，避免复杂导入逻辑）
   */
  async loadModule(moduleName, retries = 3) {
    try {
      console.log(`[moduleLoader] 加载模块: ${moduleName}`);
      
      // 简化路径构建：直接使用相对路径
      let modulePath;
      
      // 根据模块类型构建正确的相对路径
      if (moduleName.startsWith('modules/')) {
        modulePath = `../${moduleName}.js`;
      } else if (moduleName.startsWith('api/')) {
        modulePath = `../modules/${moduleName}.js`;
      } else if (moduleName.startsWith('settings/')) {
        modulePath = `../modules/${moduleName}.js`;
      } else if (moduleName.startsWith('ui/')) {
        modulePath = `../${moduleName}.js`;
      } else if (moduleName.startsWith('media/')) {
        modulePath = `../${moduleName}.js`;
      } else {
        modulePath = `../modules/${moduleName}.js`;
      }
      
      console.log(`[moduleLoader] 使用简化路径: ${modulePath}`);
      
      // 简化导入逻辑：直接使用import，不添加复杂超时机制
      console.log(`[moduleLoader] 开始导入模块: ${modulePath}`);
      let module;
      
      try {
        // 直接使用import，避免复杂超时机制
        module = await import(/* webpackIgnore: true */ modulePath);
        console.log(`[moduleLoader] 模块导入成功: ${moduleName}`);
      } catch (importError) {
        console.error(`[moduleLoader] 模块导入失败: ${moduleName}`, importError);
        
        // 如果是路径错误，尝试备用路径
        if (importError.message.includes('Failed to fetch') || importError.message.includes('Loading chunk')) {
          console.warn(`[moduleLoader] 尝试备用路径...`);
          
          // 备用路径：尝试不同的相对路径
          let fallbackPath;
          if (modulePath.startsWith('../modules/')) {
            fallbackPath = modulePath.replace('../modules/', '../');
          } else if (modulePath.startsWith('../')) {
            fallbackPath = modulePath.replace('../', '');
          }
          
          if (fallbackPath) {
            try {
              console.log(`[moduleLoader] 尝试备用路径: ${fallbackPath}`);
              module = await import(/* webpackIgnore: true */ fallbackPath);
              console.log(`[moduleLoader] 备用路径导入成功: ${moduleName}`);
            } catch (fallbackError) {
              console.error(`[moduleLoader] 备用路径也失败:`, fallbackError);
            }
          }
        }
        
        if (!module) {
          throw new Error(`模块导入失败: ${moduleName} - ${importError.message}`);
        }
      }

      // 简化模块验证：只检查基本结构
      if (!module || typeof module !== 'object') {
        console.error(`[moduleLoader] 模块无效: ${moduleName}`, module);
        throw new Error(`模块无效: ${moduleName}`);
      }

      // 获取模块对象（支持默认导出和命名导出）
      const moduleObj = module.default || module;

      // 简化接口验证：确保有init方法，没有则提供默认实现
      if (typeof moduleObj.init !== 'function') {
        console.warn(`[moduleLoader] 模块 ${moduleName} 没有init方法，提供默认实现`);
        moduleObj.init = async () => {
          console.log(`[moduleLoader] 默认init方法执行: ${moduleName}`);
          return true;
        };
      }

      // 简化cleanup方法检查
      if (typeof moduleObj.cleanup !== 'function') {
        moduleObj.cleanup = async () => {
          console.log(`[moduleLoader] 默认cleanup方法执行: ${moduleName}`);
          return true;
        };
      }

      // 简化初始化逻辑：基本错误处理
      try {
        await moduleObj.init();
        console.log(`[moduleLoader] 模块初始化成功: ${moduleName}`);
      } catch (initError) {
        console.error(`[moduleLoader] 模块初始化失败: ${moduleName}`, initError);
        // 即使初始化失败也继续，标记错误状态
        moduleObj._initError = initError;
      }

      // 简化websocket特殊处理
      if (moduleName === 'modules/websocket' && typeof moduleObj.waitForConnection === 'function') {
        try {
          await moduleObj.waitForConnection();
          console.log(`[moduleLoader] websocket连接建立成功`);
        } catch (wsError) {
          console.error(`[moduleLoader] websocket连接失败:`, wsError);
        }
      }

      // 简化模块注册
      const registeredName = this._getRegisteredModuleName(moduleName);
      const deps = this._getDeps();
      deps.registerModule(registeredName, moduleObj);
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
    const deps = this._getDeps();
    
    // 安全地注册清理事件（如果EventBus可用）
    if (deps.EventBus && typeof deps.EventBus.on === 'function') {
      const removeCleanupListener = deps.EventBus.on(
        "extensionCleanup",
        () => {
          console.log(`[moduleLoader] 清理模块: ${moduleName}`);
          if (typeof moduleObj.cleanup === "function") {
            moduleObj.cleanup();
          }
        }
      );
      
      this.cleanupListeners.push(removeCleanupListener);
    } else {
      console.warn(`[moduleLoader] EventBus不可用，无法为模块${moduleName}注册清理事件`);
    }
  }

  /**
   * 显示模块加载错误
   */
  _showModuleLoadError(moduleName, error) {
    const deps = this._getDeps();
    
    // 安全地显示错误信息
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`模块${moduleName}加载失败: ${error.message}`);
    } else {
      console.error(`[moduleLoader] 模块${moduleName}加载失败:`, error);
    }
  }

  /**
   * 获取模块注册名称（统一名称格式）
   */
  _getRegisteredModuleName(moduleName) {
    console.log(`[moduleLoader] 原始模块名称: ${moduleName}`);
    
    // 统一模块名称格式
    let registeredName = moduleName;
    
    // 移除多余的 modules/ 前缀
    if (moduleName.startsWith('modules/')) {
      registeredName = moduleName.replace('modules/', '');
    }
    
    console.log(`[moduleLoader] 注册模块名称: ${registeredName}`);
    return registeredName;
  }
}

// 默认导出单例实例
export const moduleLoader = new ModuleLoader();
export default moduleLoader;