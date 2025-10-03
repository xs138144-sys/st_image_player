// moduleLoader.js - 兼容SillyTavern环境的模块加载器

/**
 * 模块加载器 - 使用传统脚本标签加载方式，兼容SillyTavern环境
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
      let modulePath = this._buildModulePath(moduleName);
      console.log(`[moduleLoader] 开始加载模块: ${moduleName} (路径: ${modulePath})`);

      // 使用传统脚本标签加载方式
      const moduleObj = await this._loadScript(modulePath, moduleName);
      
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
   * 使用脚本标签加载模块
   */
  _loadScript(modulePath, moduleName) {
    return new Promise((resolve, reject) => {
      // 特殊处理deps.js模块
      if (moduleName === 'deps') {
        console.log(`[moduleLoader] 加载deps.js模块`);
        
        // 检查是否已经存在全局deps对象
        if (window.deps && window.deps.registerModule) {
          console.log('[moduleLoader] deps.js已存在，直接返回');
          resolve(window.deps);
          return;
        }
        
        // 构建deps.js路径
        const depsPath = './deps.js';
        
        // 加载deps.js
        this._loadScript(depsPath, moduleName)
          .then(() => {
            // 等待deps对象初始化
            const checkDeps = () => {
              if (window.deps && window.deps.registerModule) {
                console.log('[moduleLoader] deps.js加载成功');
                resolve(window.deps);
              } else {
                setTimeout(checkDeps, 100);
              }
            };
            checkDeps();
          })
          .catch(reject);
        return;
      }

      // 检查是否已经通过其他方式加载了模块
      const globalModule = this._checkGlobalModule(moduleName);
      if (globalModule) {
        console.log(`[moduleLoader] 模块已全局存在: ${moduleName}`);
        resolve(globalModule);
        return;
      }

      // 创建脚本标签
      const script = document.createElement('script');
      script.src = modulePath;
      script.type = 'module'; // 使用module类型支持ES6导入
      
      // 设置超时
      const timeoutId = setTimeout(() => {
        reject(new Error(`模块加载超时: ${moduleName}`));
        script.remove();
      }, 10000); // 10秒超时

      script.onload = () => {
        clearTimeout(timeoutId);
        
        // 检查模块是否已导出到全局对象
        const moduleObj = this._checkGlobalModule(moduleName);
        if (moduleObj) {
          resolve(moduleObj);
        } else {
          reject(new Error(`模块未正确导出: ${moduleName}`));
        }
      };

      script.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`脚本加载失败: ${moduleName} - ${error}`));
      };

      // 添加到文档
      document.head.appendChild(script);
    });
  }

  /**
   * 检查全局模块
   */
  _checkGlobalModule(moduleName) {
    // 根据模块名称检查不同的全局对象
    const moduleKey = this._getModuleGlobalKey(moduleName);
    
    // 检查window对象
    if (window[moduleKey]) {
      return window[moduleKey];
    }
    
    // 检查deps对象
    const deps = this._getDeps();
    if (deps && deps.getModule) {
      const module = deps.getModule(moduleName);
      if (module) return module;
    }
    
    return null;
  }

  /**
   * 获取模块的全局键名
   */
  _getModuleGlobalKey(moduleName) {
    // 将路径转换为有效的变量名
    return moduleName.replace(/[\/\-]/g, '_');
  }

  /**
   * 构建模块路径
   */
  _buildModulePath(moduleName) {
    // 根据模块类型构建路径
    if (moduleName.startsWith('modules/')) {
      return `./${moduleName}.js`;
    } else if (moduleName.startsWith('media/')) {
      return `./${moduleName}.js`;
    } else if (moduleName.startsWith('ui/')) {
      return `./${moduleName}.js`;
    } else {
      return `./modules/${moduleName}.js`;
    }
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
      moduleObj.cleanup = async () => {
        console.log(`[moduleLoader] 默认cleanup方法执行: ${moduleName}`);
        return true;
      };
    }
  }

  /**
   * 初始化模块
   */
  async _initializeModule(moduleObj, moduleName) {
    try {
      await moduleObj.init();
      console.log(`[moduleLoader] 模块初始化成功: ${moduleName}`);
    } catch (initError) {
      console.error(`[moduleLoader] 模块初始化失败: ${moduleName}`, initError);
      // 即使初始化失败也继续，标记错误状态
      moduleObj._initError = initError;
    }

    // websocket特殊处理
    if (moduleName === 'modules/websocket' && typeof moduleObj.waitForConnection === 'function') {
      try {
        await moduleObj.waitForConnection();
        console.log(`[moduleLoader] websocket连接建立成功`);
      } catch (wsError) {
        console.error(`[moduleLoader] websocket连接失败:`, wsError);
      }
    }
  }

  /**
   * 注册模块
   */
  _registerModule(moduleName, moduleObj) {
    const registeredName = this._getRegisteredModuleName(moduleName);
    const deps = this._getDeps();
    
    if (deps && deps.registerModule) {
      deps.registerModule(registeredName, moduleObj);
    }
    
    this.loadedModules.set(moduleName, moduleObj);
    this._registerModuleCleanup(moduleName, moduleObj);
  }

  /**
   * 获取注册的模块名称
   */
  _getRegisteredModuleName(moduleName) {
    // 移除路径前缀，保留模块标识
    return moduleName.replace(/^(modules|media|ui)\//, '');
  }

  /**
   * 获取deps对象
   */
  _getDeps() {
    return window.deps || null;
  }

  /**
   * 注册模块清理监听器
   */
  _registerModuleCleanup(moduleName, moduleObj) {
    if (typeof moduleObj.cleanup === 'function') {
      this.cleanupListeners.push(() => {
        try {
          moduleObj.cleanup();
        } catch (e) {
          console.error(`[moduleLoader] 模块清理失败: ${moduleName}`, e);
        }
      });
    }
  }

  /**
   * 批量加载所有模块
   */
  async loadAllModules(moduleList) {
    console.log(`[moduleLoader] 开始加载所有模块（共${moduleList.length}个）`);
    
    const loadResults = {};

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

  /**
   * 显示模块加载错误
   */
  _showModuleLoadError(moduleName, error) {
    console.error(`[moduleLoader] 模块加载错误: ${moduleName}`, error);
    
    // 在控制台显示详细错误信息
    if (window.deps && window.deps.toastr) {
      window.deps.toastr.error(`模块加载失败: ${moduleName}`);
    }
  }
}

// 创建全局实例
const moduleLoader = new ModuleLoader();

// 全局导出
window.moduleLoader = moduleLoader;

// ES6模块导出
export { moduleLoader };