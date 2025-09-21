// deps.js - 依赖管理模块
import { EventBus } from './eventBus.js';

// 创建 EventBus 实例
const eventBusInstance = new EventBus();

// 确保全局对象存在并提供后备方案
window.extension_settings = window.extension_settings || {};
window.saveSettingsDebounced = window.saveSettingsDebounced || (() => {
  console.warn('saveSettingsDebounced 不可用，使用默认实现');
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
});

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
      return this.createFallbackModule(name);
    }
    return module;
  },

  /**
   * 创建模块回退方案
   */
  createFallbackModule: function (name) {
    console.warn(`[deps] 为模块 ${name} 创建回退方案`);

    const fallbacks = {
      utils: {
        init: () => console.log(`[${name}] 使用回退初始化`),
        cleanup: () => console.log(`[${name}] 使用回退清理`),
        getSafeToastr: () => ({
          success: (msg) => console.log(`SUCCESS: ${msg}`),
          info: (msg) => console.info(`INFO: ${msg}`),
          warning: (msg) => console.warn(`WARNING: ${msg}`),
          error: (msg) => console.error(`ERROR: ${msg}`),
        })
      },
      settings: {
        init: () => console.log(`[${name}] 使用回退初始化`),
        cleanup: () => console.log(`[${name}] 使用回退清理`),
        get: () => (window.extension_settings?.st_image_player || {}),
        save: () => console.warn('settings.save不可用'),
        migrateSettings: () => console.warn('settings.migrateSettings不可用')
      },
      api: {
        init: () => console.log(`[${name}] 使用回退初始化`),
        cleanup: () => console.log(`[${name}] 使用回退清理`),
        checkServiceStatus: () => Promise.resolve({ active: false, error: 'API模块未加载' }),
        fetchMediaList: () => Promise.resolve([]),
        refreshMediaList: () => Promise.resolve([])
      }
    };

    return fallbacks[name] || {
      init: () => console.log(`[${name}] 使用默认回退初始化`),
      cleanup: () => console.log(`[${name}] 使用默认回退清理`)
    };
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
      const utilsModule = this.getModule('utils');
      const safeToastr = utilsModule?.getSafeToastr ? utilsModule.getSafeToastr() : null;
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
    return this.getModule('utils');
  },

  // 修复设置获取方法
  get settings() {
    const settingsModule = this.getModule('settings');
    return settingsModule;
  },

  // 修复API获取方法
  get api() {
    const apiModule = this.getModule('api');
    return apiModule;
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
    return window.saveSettingsDebounced;
  }
};

export { deps };