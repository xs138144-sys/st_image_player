// deps.js

// 立即创建基础对象，避免导入时的循环依赖
const deps = {
  modules: {},

  /**
   * 注册模块到依赖管理器
   */
  registerModule: function (name, module) {
    if (!name || typeof name !== 'string') {
      console.error('[deps] 模块名称无效', name);
      return;
    }

    // 确保模块有必要的函数
    if (typeof module.init !== 'function') {
      console.warn(`[deps] 模块 ${name} 缺少init方法`);
    }

    if (typeof module.cleanup !== 'function') {
      console.warn(`[deps] 模块 ${name} 缺少cleanup方法`);
      module.cleanup = () => console.log(`[${name}] 默认清理完成`);
    }

    this.modules[name] = module;
    console.log(`[deps] 模块已注册: ${name}`);
  },

  /**
   * 获取已注册的模块
   */
  getModule: function (name) {
    if (!name || typeof name !== 'string') {
      console.error('[deps] 模块名称无效', name);
      return null;
    }
    const module = this.modules[name];
    if (!module) {
      console.warn(`[deps] 模块未找到: ${name}`);
    }
    return module || null;
  },

  /**
   * 安全获取toastr（兼容缺失场景）
   */
  get toastr() {
    try {
      // 首先尝试获取全局toastr
      if (window.toastr && typeof window.toastr.success === 'function') {
        return window.toastr;
      }

      // 然后尝试通过utils模块获取
      const safeToastr = this.utils?.getSafeToastr ? this.utils.getSafeToastr() : null;
      if (safeToastr) return safeToastr;
    } catch (e) {
      console.error('[deps] 获取toastr失败', e);
    }

    // 降级处理
    return {
      success: (msg) => console.log(`SUCCESS: ${msg}`),
      info: (msg) => console.info(`INFO: ${msg}`),
      warning: (msg) => console.warn(`WARNING: ${msg}`),
      error: (msg) => console.error(`ERROR: ${msg}`),
    };
  },

  /**
   * 快捷访问常用模块
   */
  get utils() {
    return this.getModule('utils') || this.getModule('modules/utils') || this.getModule('modules/timeUtils') || this.getModule('modules/domUtils') || {
      // 安全的回退实现
      formatTime: (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      },
      getSafeToastr: () => this.toastr,
      getSafeGlobal: (key, defaultValue) => window[key] !== undefined ? window[key] : defaultValue,
      safeJQuery: (selector) => this.jQuery ? this.jQuery(selector) : null,
      debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
          const later = () => {
            clearTimeout(timeout);
            func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
        };
      }
    };
  },

  // 修复设置获取方法
  get settings() {
    // 尝试多种可能的模块名称（按优先级排序）
    const settingsModule = this.getModule('settings/settingsManager') || 
                          this.getModule('modules/settings/settingsManager') || 
                          this.getModule('settingsManager');
    
    if (!settingsModule || typeof settingsModule.get !== 'function') {
      console.warn('[deps] settings模块未正确加载，使用回退方案');
      return {
        get: () => ({
          serviceUrl: "http://localhost:8000",
          serviceDirectory: "",
          mediaSizeLimit: 10,
          pollingInterval: 30000
        }), // 返回默认设置的回退函数
        save: () => console.warn('settings.save不可用'),
        migrateSettings: () => console.warn('settings.migrateSettings不可用'),
        update: (updates) => ({ ...updates })
      };
    }
    
    // 确保使用我们自己的保存机制，而不是ST的saveSettingsDebounced
    if (settingsModule.save && typeof settingsModule.save === 'function') {
      const originalSave = settingsModule.save;
      settingsModule.save = function() {
        return originalSave.apply(this, arguments);
      };
    }
    
    return settingsModule;
  },

  // 修复API获取方法 - 支持新的API模块结构（延迟加载避免循环依赖）
  get api() {
    // 延迟获取API模块，避免循环依赖
    const getServiceApi = () => this.getModule('api/serviceApi') || this.getModule('modules/api/serviceApi') || {};
    const getMediaApi = () => this.getModule('api/mediaApi') || this.getModule('modules/api/mediaApi') || {};
    const getConfigApi = () => this.getModule('api/configApi') || this.getModule('modules/api/configApi') || {};
    
    // 合并所有API功能（使用函数调用延迟加载）
    return {
      // 延迟加载的API方法
      checkServiceStatus: () => {
        const serviceApi = getServiceApi();
        return serviceApi.checkServiceStatus ? serviceApi.checkServiceStatus() : Promise.resolve({ active: false, error: 'API模块未加载' });
      },
      fetchMediaList: () => {
        const mediaApi = getMediaApi();
        return mediaApi.fetchMediaList ? mediaApi.fetchMediaList() : Promise.resolve([]);
      },
      refreshMediaList: () => {
        const mediaApi = getMediaApi();
        return mediaApi.refreshMediaList ? mediaApi.refreshMediaList() : Promise.resolve([]);
      },
      updateMediaSizeLimit: (newLimit) => {
        const configApi = getConfigApi();
        return configApi.updateMediaSizeLimit ? configApi.updateMediaSizeLimit(newLimit) : Promise.resolve(false);
      },
      startServicePolling: () => {
        const configApi = getConfigApi();
        return configApi.startServicePolling ? configApi.startServicePolling() : null;
      },
      stopServicePolling: () => {
        const configApi = getConfigApi();
        return configApi.stopServicePolling ? configApi.stopServicePolling() : null;
      }
    };
  },

  // 新增：服务API快捷访问（延迟加载避免循环依赖）
  get serviceApi() {
    // 延迟加载，避免循环依赖
    const getModule = () => this.getModule('api/serviceApi') || this.getModule('modules/api/serviceApi');
    
    // 返回代理对象，延迟调用实际方法
    return {
      checkServiceStatus: () => {
        const module = getModule();
        return module && module.checkServiceStatus ? module.checkServiceStatus() : Promise.resolve({ active: false, error: 'serviceApi模块未加载' });
      },
      validateDirectory: () => {
        const module = getModule();
        return module && module.validateDirectory ? module.validateDirectory() : Promise.resolve({ valid: false, error: 'serviceApi模块未加载' });
      },
      updateScanDirectory: () => {
        const module = getModule();
        return module && module.updateScanDirectory ? module.updateScanDirectory() : Promise.resolve(false);
      }
    };
  },

  // 新增：媒体API快捷访问（延迟加载避免循环依赖）
  get mediaApi() {
    // 延迟加载，避免循环依赖
    const getModule = () => this.getModule('api/mediaApi') || this.getModule('modules/api/mediaApi');
    
    // 返回代理对象，延迟调用实际方法
    return {
      fetchMediaList: () => {
        const module = getModule();
        return module && module.fetchMediaList ? module.fetchMediaList() : Promise.resolve([]);
      },
      refreshMediaList: () => {
        const module = getModule();
        return module && module.refreshMediaList ? module.refreshMediaList() : Promise.resolve([]);
      },
      getMediaUrl: () => {
        const module = getModule();
        return module && module.getMediaUrl ? module.getMediaUrl() : Promise.resolve('');
      },
      deleteMedia: () => {
        const module = getModule();
        return module && module.deleteMedia ? module.deleteMedia() : Promise.resolve(false);
      }
    };
  },

  // 新增：配置API快捷访问（延迟加载避免循环依赖）
  get configApi() {
    // 延迟加载，避免循环依赖
    const getModule = () => this.getModule('api/configApi') || this.getModule('modules/api/configApi');
    
    // 返回代理对象，延迟调用实际方法
    return {
      updateMediaSizeLimit: (newLimit) => {
        const module = getModule();
        return module && module.updateMediaSizeLimit ? module.updateMediaSizeLimit(newLimit) : Promise.resolve(false);
      },
      startServicePolling: () => {
        const module = getModule();
        return module && module.startServicePolling ? module.startServicePolling() : null;
      },
      stopServicePolling: () => {
        const module = getModule();
        return module && module.stopServicePolling ? module.stopServicePolling() : null;
      }
    };
  },

  // 新增：时间工具快捷访问
  get timeUtils() {
    return this.getModule('timeUtils') || this.getModule('modules/timeUtils') || this.utils;
  },

  // 新增：DOM工具快捷访问
  get domUtils() {
    return this.getModule('domUtils') || this.getModule('modules/domUtils') || this.utils;
  },

  get EventBus() {
    // 延迟获取EventBus实例
    if (this._eventBusInstance) {
      return this._eventBusInstance;
    }
    
    // 如果EventBus还未初始化，提供回退实现
    return {
      on: (event, callback) => {
        console.warn('EventBus还未初始化，事件监听被忽略:', event);
        // 存储监听器，等EventBus初始化后重新注册
        if (!this._pendingEventListeners) this._pendingEventListeners = [];
        this._pendingEventListeners.push({ event, callback });
      },
      emit: (event, data) => {
        console.warn('EventBus还未初始化，事件发送被忽略:', event, data);
      },
      off: (event, callback) => {
        console.warn('EventBus还未初始化，事件取消监听被忽略:', event);
      }
    };
  },

  get jQuery() {
    return window.jQuery || null;
  },

  /**
   * 获取SillyTavern的扩展设置
   */
  get extension_settings() {
    return window.extension_settings || {};
  },

  /**
   * 获取SillyTavern的设置保存函数
   */
  get saveSettingsDebounced() {
    return window.saveSettingsDebounced || (() => {
      console.warn('saveSettingsDebounced 不可用，使用默认实现');
      return () => {
        try {
          localStorage.setItem('extension_settings', JSON.stringify(window.extension_settings || {}));
        } catch (e) {
          console.error('无法保存设置到本地存储', e);
        }
      };
    });
  }
};

// 延迟初始化函数，避免导入时的循环依赖
function initializeDeps() {
  // 导入EventBus（延迟导入避免循环依赖）
  import('./eventBus.js').then(({ EventBus }) => {
    // 创建 EventBus 实例
    const eventBusInstance = new EventBus();
    
    // 确保全局对象存在并提供后备方案
    window.extension_settings = window.extension_settings || {};
    if (!window.saveSettingsDebounced) {
      console.warn('saveSettingsDebounced 不可用，使用默认实现');
      window.saveSettingsDebounced = (() => {
        let timeout = null;
        return () => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => {
            try {
              localStorage.setItem('extension_settings', JSON.stringify(window.extension_settings || {}));
              console.log('设置已保存到本地存储');
            } catch (e) {
              console.error('无法保存设置到本地存储', e);
            }
          }, 1000);
        };
      })();
    }
    
    // 设置EventBus实例（使用defineProperty避免getter冲突）
  Object.defineProperty(deps, 'EventBus', {
    value: eventBusInstance,
    writable: true,
    configurable: true
  });
  
  console.log('[deps] 延迟初始化完成');
  }).catch(error => {
    console.error('[deps] EventBus导入失败', error);
    // 提供回退的EventBus实现
    deps.EventBus = {
      on: () => console.warn('EventBus不可用'),
      emit: () => console.warn('EventBus不可用'),
      off: () => console.warn('EventBus不可用')
    };
  });
}

// 全局导出，兼容SillyTavern环境
window.deps = deps;

// ES6模块导出（用于模块化环境）
export default deps;

// 延迟初始化（在模块加载完成后执行）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDeps);
} else {
  setTimeout(initializeDeps, 0);
}