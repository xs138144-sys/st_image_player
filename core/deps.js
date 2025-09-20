// deps.js
import { EventBus } from './eventBus.js';

// 创建 EventBus 实例
const eventBusInstance = new EventBus();

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
    this.modules[name] = module;
  },

  /**
   * 获取已注册的模块
   */
  getModule: function (name) {
    if (!name || typeof name !== 'string') {
      console.error('[deps] 模块名称无效', name);
      return null;
    }
    return this.modules[name] || null;
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
    return this.getModule('utils') || {};
  },

  // deps.js - 修复设置获取方法
  get settings() {
    const settingsModule = this.getModule('settings');
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

  get EventBus() {
    return eventBusInstance; // 返回实例而不是类
  },

  get jQuery() {
    return window.jQuery || null;
  }
};

export { deps };