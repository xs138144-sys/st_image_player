// deps.js
import { EventBus } from './eventBus.js';

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
    return this.getModule('utils') || this.getModule('modules/timeUtils') || this.getModule('modules/domUtils') || {};
  },

  // 修复设置获取方法
  get settings() {
    const settingsModule = this.getModule('settings') || this.getModule('modules/settings/settingsManager');
    if (!settingsModule || typeof settingsModule.get !== 'function') {
      console.warn('[deps] settings模块未正确加载，使用回退方案');
      return {
        get: () => ({}), // 返回空对象的回退函数
        save: () => console.warn('settings.save不可用'),
        migrateSettings: () => console.warn('settings.migrateSettings不可用')
      };
    }
    return settingsModule;
  },

  // 修复API获取方法 - 支持新的API模块结构
  get api() {
    const apiModule = this.getModule('api') || {};
    const serviceApi = this.getModule('modules/api/serviceApi') || {};
    const mediaApi = this.getModule('modules/api/mediaApi') || {};
    const configApi = this.getModule('modules/api/configApi') || {};
    
    // 合并所有API功能
    return {
      ...apiModule,
      ...serviceApi,
      ...mediaApi,
      ...configApi,
      // 回退方案
      checkServiceStatus: () => Promise.resolve({ active: false, error: 'API模块未加载' }),
      fetchMediaList: () => Promise.resolve([]),
      refreshMediaList: () => Promise.resolve([])
    };
  },

  // 新增：服务API快捷访问
  get serviceApi() {
    return this.getModule('modules/api/serviceApi') || this.api;
  },

  // 新增：媒体API快捷访问
  get mediaApi() {
    return this.getModule('modules/api/mediaApi') || this.api;
  },

  // 新增：配置API快捷访问
  get configApi() {
    return this.getModule('modules/api/configApi') || this.api;
  },

  // 新增：时间工具快捷访问
  get timeUtils() {
    return this.getModule('modules/timeUtils') || this.utils;
  },

  // 新增：DOM工具快捷访问
  get domUtils() {
    return this.getModule('modules/domUtils') || this.utils;
  },

  get EventBus() {
    return eventBusInstance; // 返回实例而不是类
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

export { deps };