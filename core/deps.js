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

  get settings() {
    return this.getModule('settings') || {};
  },

  get EventBus() {
    return eventBusInstance; // 返回实例而不是类
  },

  get jQuery() {
    return window.jQuery || null;
  }
};

export { deps };