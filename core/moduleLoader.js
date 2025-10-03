// moduleLoader.js - 简化的模块加载器，使用ES6动态import()

/**
 * 简化的模块加载器 - 使用ES6动态import()
 */
class ModuleLoader {
  constructor() {
    this.loadedModules = new Map();
    this.cleanupListeners = [];
    console.log('[moduleLoader] 模块加载器初始化完成');
  }

  /**
   * 加载单个模块
   */
  async loadModule(moduleName, retries = 2) {
    try {
      // 检查模块是否已加载
      if (this.loadedModules.has(moduleName)) {
        console.log(`[moduleLoader] 模块已加载: ${moduleName}`);
        return true;
      }

      // 构建模块路径
      const modulePath = this._buildModulePath(moduleName);
      console.log(`[moduleLoader] 开始加载模块: ${moduleName} (路径: ${modulePath})`);

      // 使用ES6动态import()加载模块
      const moduleObj = await this._importModule(modulePath, moduleName);
      
      if (!moduleObj) {
        throw new Error(`模块加载失败: ${moduleName}`);
      }

      // 验证模块接口
      this._validateModuleInterface(moduleObj, moduleName);

      // 初始化模块
      await this._initializeModule(moduleObj, moduleName);

      // 注册模块到依赖管理器
      this._registerModule(moduleName, moduleObj);

      console.log(`[moduleLoader] 模块加载成功: ${moduleName}`);
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
   * 使用ES6动态import()加载模块
   */
  async _importModule(modulePath, moduleName) {
    try {
      // 使用动态import()加载模块
      const module = await import(modulePath);
      
      // 检查模块是否包含默认导出
      if (module && module.default) {
        return module.default;
      }
      
      // 如果没有默认导出，返回整个模块对象
      return module;
    } catch (error) {
      console.error(`[moduleLoader] 动态导入失败: ${modulePath}`, error);
      
      // 尝试备用路径
      const fallbackPath = this._buildFallbackPath(modulePath);
      if (fallbackPath !== modulePath) {
        console.log(`[moduleLoader] 尝试备用路径: ${fallbackPath}`);
        try {
          const module = await import(fallbackPath);
          if (module && module.default) {
            return module.default;
          }
          return module;
        } catch (fallbackError) {
          console.error(`[moduleLoader] 备用路径也失败: ${fallbackPath}`, fallbackError);
        }
      }
      
      throw error;
    }
  }

  /**
   * 构建模块路径
   */
  _buildModulePath(moduleName) {
    // 直接返回模块路径，不需要添加.js后缀（模块名已经包含路径）
    return `./${moduleName}.js`;
  }

  /**
   * 构建备用路径
   */
  _buildFallbackPath(modulePath) {
    // 尝试移除../前缀
    if (modulePath.startsWith('../')) {
      return modulePath.substring(3);
    }
    
    // 尝试添加../前缀
    if (!modulePath.startsWith('../')) {
      return `../${modulePath}`;
    }
    
    return modulePath;
  }

  /**
   * 验证模块接口
   */
  _validateModuleInterface(moduleObj, moduleName) {
    if (!moduleObj || typeof moduleObj !== 'object') {
      throw new Error(`模块无效: ${moduleName}`);
    }

    // 确保有init方法
    if (typeof moduleObj.init !== 'function') {
      console.warn(`[moduleLoader] 模块 ${moduleName} 没有init方法，提供默认实现`);
      moduleObj.init = async () => {
        console.log(`[moduleLoader] 默认init方法执行: ${moduleName}`);
        return true;
      };
    }

    // 确保有cleanup方法
    if (typeof moduleObj.cleanup !== 'function') {
      console.warn(`[moduleLoader] 模块 ${moduleName} 没有cleanup方法，提供默认实现`);
      moduleObj.cleanup = () => {
        console.log(`[moduleLoader] 默认cleanup方法执行: ${moduleName}`);
      };
    }
  }

  /**
   * 初始化模块
   */
  async _initializeModule(moduleObj, moduleName) {
    try {
      // 特殊处理websocket模块
      if (moduleName === 'modules/websocket') {
        console.log(`[moduleLoader] 初始化websocket模块`);
        // websocket模块需要等待连接
        if (moduleObj.waitForConnection && typeof moduleObj.waitForConnection === 'function') {
          await moduleObj.waitForConnection();
        }
      }

      // 调用模块的init方法
      const initResult = await moduleObj.init();
      
      if (initResult === false) {
        throw new Error(`模块初始化失败: ${moduleName}`);
      }

      console.log(`[moduleLoader] 模块初始化成功: ${moduleName}`);
    } catch (error) {
      console.error(`[moduleLoader] 模块初始化失败: ${moduleName}`, error);
      throw error;
    }
  }

  /**
   * 注册模块到依赖管理器
   */
  _registerModule(moduleName, moduleObj) {
    // 标记模块为已加载
    this.loadedModules.set(moduleName, moduleObj);

    // 注册到全局deps对象
    if (window.deps && typeof window.deps.registerModule === 'function') {
      window.deps.registerModule(moduleName, moduleObj);
    } else {
      console.warn(`[moduleLoader] deps对象不可用，无法注册模块: ${moduleName}`);
    }
  }

  /**
   * 显示模块加载错误
   */
  _showModuleLoadError(moduleName, error) {
    console.error(`[moduleLoader] 模块 ${moduleName} 加载失败:`, error);
    
    // 显示错误提示
    if (window.deps && window.deps.toastr && typeof window.deps.toastr.error === 'function') {
      window.deps.toastr.error(`模块加载失败: ${moduleName}`);
    }
  }

  /**
   * 批量加载所有模块
   */
  async loadAllModules(moduleNames) {
    console.log(`[moduleLoader] 开始批量加载 ${moduleNames.length} 个模块`);
    
    const results = {};
    
    for (const moduleName of moduleNames) {
      try {
        const success = await this.loadModule(moduleName);
        results[moduleName] = success;
      } catch (error) {
        results[moduleName] = false;
        console.error(`[moduleLoader] 模块加载失败: ${moduleName}`, error);
      }
    }
    
    console.log(`[moduleLoader] 批量加载完成，成功: ${Object.values(results).filter(Boolean).length}/${moduleNames.length}`);
    return results;
  }

  /**
   * 清理所有模块
   */
  cleanup() {
    console.log('[moduleLoader] 开始清理所有模块');
    
    // 调用所有模块的cleanup方法
    for (const [moduleName, moduleObj] of this.loadedModules) {
      try {
        if (typeof moduleObj.cleanup === 'function') {
          moduleObj.cleanup();
        }
      } catch (error) {
        console.error(`[moduleLoader] 模块清理失败: ${moduleName}`, error);
      }
    }
    
    // 清理监听器
    this.cleanupListeners.forEach(removeListener => {
      if (typeof removeListener === 'function') {
        removeListener();
      }
    });
    
    this.cleanupListeners = [];
    this.loadedModules.clear();
    
    console.log('[moduleLoader] 所有模块清理完成');
  }

  /**
   * 添加清理监听器
   */
  addCleanupListener(removeListener) {
    if (typeof removeListener === 'function') {
      this.cleanupListeners.push(removeListener);
    }
  }
}

// 导出默认实例
export default new ModuleLoader();

// 导出到全局window对象，供SillyTavern环境使用
window.moduleLoader = new ModuleLoader();