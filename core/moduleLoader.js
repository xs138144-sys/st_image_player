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
   * 动态加载单个模块（带重试机制）
   */
  async loadModule(moduleName, retries = 3) {
    try {
      console.log(`[moduleLoader] 加载模块: ${moduleName}`);
      
      // 构建模块完整路径
      const baseUrl = this._getExtensionBaseUrl();
      
      let fullUrl;
      if (baseUrl === '../') {
        // 测试环境：模块路径处理
        if (moduleName.startsWith('ui/')) {
          fullUrl = `${baseUrl}${moduleName}.js`;
        } else if (moduleName.startsWith('media/')) {
          fullUrl = `${baseUrl}${moduleName}.js`;
        } else if (moduleName.startsWith('settings/')) {
          const actualPath = moduleName.replace('settings/', 'modules/settings/');
          fullUrl = `${baseUrl}${actualPath}.js`;
        } else if (moduleName.startsWith('api/')) {
          const actualPath = moduleName.replace('api/', 'modules/api/');
          fullUrl = `${baseUrl}${actualPath}.js`;
        } else if (moduleName.includes('/')) {
          fullUrl = `${baseUrl}${moduleName}.js`;
        } else {
          fullUrl = `${baseUrl}modules/${moduleName}.js`;
        }
      } else {
        // SillyTavern环境：模块位于扩展根目录下
        // 修复：确保路径构建正确，处理模块名称中的前缀
        console.log(`[moduleLoader] SillyTavern环境路径构建: ${moduleName}`);
        
        if (moduleName.startsWith('modules/')) {
          // 如果模块名称已经包含modules/前缀，直接使用
          fullUrl = `${baseUrl}${moduleName}.js`;
          console.log(`[moduleLoader] 使用直接路径: ${fullUrl}`);
        } else if (moduleName.startsWith('api/')) {
          // api模块需要映射到modules/api/路径
          fullUrl = `${baseUrl}modules/${moduleName}.js`;
          console.log(`[moduleLoader] API模块映射: ${fullUrl}`);
        } else if (moduleName.startsWith('settings/')) {
          // settings模块需要映射到modules/settings/路径
          fullUrl = `${baseUrl}modules/${moduleName}.js`;
          console.log(`[moduleLoader] Settings模块映射: ${fullUrl}`);
        } else {
          // 其他模块直接使用
          fullUrl = `${baseUrl}${moduleName}.js`;
          console.log(`[moduleLoader] 其他模块路径: ${fullUrl}`);
        }
      }
      
      console.log(`[moduleLoader] 模块路径: ${moduleName}`);
      console.log(`[moduleLoader] 基础URL: ${baseUrl}`);
      console.log(`[moduleLoader] 完整URL: ${fullUrl}`);
      
      // 使用完整的URL进行导入（带超时机制）
      console.log(`[moduleLoader] 开始导入模块: ${fullUrl}`);
      let module;
      try {
        // 添加超时机制，防止import卡住（增加超时时间到15秒）
        const importPromise = import(/* webpackIgnore: true */ fullUrl);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`模块导入超时: ${moduleName}`)), 15000)
        );
        
        console.log(`[moduleLoader] 等待模块导入完成...`);
        
        // 添加导入状态监控
        const importStartTime = Date.now();
        const checkImportStatus = setInterval(() => {
          const elapsed = Date.now() - importStartTime;
          console.log(`[moduleLoader] 导入已进行 ${elapsed}ms`);
        }, 1000);
        
        try {
          module = await Promise.race([importPromise, timeoutPromise]);
          clearInterval(checkImportStatus);
          console.log(`[moduleLoader] 模块导入成功: ${moduleName}`);
        } catch (raceError) {
          clearInterval(checkImportStatus);
          throw raceError;
        }
      } catch (importError) {
        console.error(`[moduleLoader] 模块导入失败: ${moduleName}`, importError);
        
        // 提供更详细的错误信息
        if (importError.message.includes('Failed to fetch') || importError.message.includes('Loading chunk')) {
          console.error(`[moduleLoader] 模块文件不存在或路径错误: ${fullUrl}`);
          console.error(`[moduleLoader] 请检查文件是否存在: ${moduleName}.js`);
        } else if (importError.message.includes('Unexpected token')) {
          console.error(`[moduleLoader] 模块语法错误: ${moduleName}`);
          console.error(`[moduleLoader] 请检查模块文件是否有语法错误`);
        } else if (importError.message.includes('Cannot find module')) {
          console.error(`[moduleLoader] 模块依赖错误: ${moduleName}`);
          console.error(`[moduleLoader] 请检查模块的导入依赖是否正确`);
        } else if (importError.message.includes('import')) {
          console.error(`[moduleLoader] 模块导入语句错误: ${moduleName}`);
          console.error(`[moduleLoader] 请检查模块的import语句是否正确`);
        } else if (importError.message.includes('超时')) {
          console.error(`[moduleLoader] 模块导入超时: ${moduleName}`);
          console.error(`[moduleLoader] 可能原因：循环依赖、模块语法错误、网络问题`);
          console.error(`[moduleLoader] 详细诊断：检查 ${moduleName}.js 及其依赖模块的导入语句`);
          
          // 尝试使用备用导入方式
          console.warn(`[moduleLoader] 尝试使用备用导入方式...`);
          try {
            // 使用更简单的导入方式 - 直接使用相对路径
            let fallbackUrl = fullUrl;
            
            // 在SillyTavern环境下，尝试使用相对路径导入
            if (baseUrl.startsWith('/')) {
              // 如果是绝对路径，尝试转换为相对路径
              const relativePath = moduleName.includes('/') ? moduleName : `modules/${moduleName}`;
              fallbackUrl = `../${relativePath}.js`;
              console.log(`[moduleLoader] 尝试使用相对路径: ${fallbackUrl}`);
            }
            
            const script = document.createElement('script');
            script.type = 'module';
            script.src = fallbackUrl;
            
            const loadPromise = new Promise((resolve, reject) => {
              script.onload = () => {
                console.log(`[moduleLoader] 备用导入方式成功: ${moduleName}`);
                // 这里需要手动获取模块对象，但比较复杂
                // 暂时返回一个空对象，让模块加载继续
                resolve({});
              };
              script.onerror = reject;
            });
            
            document.head.appendChild(script);
            module = await loadPromise;
          } catch (fallbackError) {
            console.error(`[moduleLoader] 备用导入方式也失败:`, fallbackError);
          }
        }
        
        // 如果备用方式也失败，继续抛出错误
        if (!module) {
          throw new Error(`模块导入失败: ${moduleName} - ${importError.message}`);
        }
      }

      // 检查模块是否有效
      if (!module || typeof module !== 'object') {
        throw new Error(`模块加载失败: ${moduleName}`);
      }

      // 获取模块对象（支持默认导出和命名导出）
      const moduleObj = module.default || module;

      // 确保模块有必要的接口方法
      this._validateModuleInterface(moduleObj, moduleName);

      // 初始化模块（添加错误处理）
      try {
        await moduleObj.init();
        console.log(`[moduleLoader] 模块加载完成: ${moduleName}`);
      } catch (initError) {
        console.error(`[moduleLoader] 模块初始化失败: ${moduleName}`, initError);
        throw new Error(`模块初始化失败: ${moduleName} - ${initError.message}`);
      }

      // 特殊处理websocket模块：调用initializeModule方法
      if (moduleName === 'modules/websocket' && typeof moduleObj.initializeModule === 'function') {
        console.log(`[moduleLoader] 调用websocket模块的initializeModule方法`);
        try {
          moduleObj.initializeModule();
          console.log(`[moduleLoader] websocket模块延迟初始化完成`);
        } catch (e) {
          console.error(`[moduleLoader] websocket模块延迟初始化失败:`, e);
        }
      }

      // 注册模块到依赖管理器
      const registeredName = this._getRegisteredModuleName(moduleName);
      const deps = this._getDeps();
      deps.registerModule(registeredName, moduleObj);

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