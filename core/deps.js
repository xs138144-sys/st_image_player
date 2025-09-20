import {
  getSafeToastr,
  formatTime,
  adjustVideoControlsLayout,
  applyTransitionEffect,
  getSafeGlobal,
  isDirectoryValid,
  registerModuleCleanup,
  safeJQuery
} from "../modules/utils.js";
import {
  migrateSettings,
  cleanup as cleanupSettings,
  save as saveSettings // 与settings.js导出保持一致
} from "../modules/settings.js";
import { EventBus } from "./eventBus.js";

export const deps = {
  // 模块存储
  modules: {},

  /**
   * 注册模块（保留唯一实现）
   * @param {string} name - 模块名称
   * @param {object} module - 模块对象
   */
  registerModule(name, module) {
    if (!this.modules[name]) {
      this.modules[name] = module;
      console.log(`[deps] 模块已注册: ${name}`);
    } else {
      console.warn(`[deps] 模块已存在，跳过注册: ${name}`);
    }
  },

  /**
   * 获取已注册的模块
   * @param {string} name - 模块名称
   * @returns {object} 模块对象或空对象
   */
  getModule(name) {
    return this.modules[name] || {};
  },

  get utils() {
    return this.modules.utils;
  },

  /**
   * 安全获取toastr（兼容缺失场景）
   */
  get toastr() {
    const safeToastr = this.utils.getSafeToastr ? this.utils.getSafeToastr() : null;
    if (safeToastr) return safeToastr;

    // 降级处理
    return {
      success: (msg) => console.log(`SUCCESS: ${msg}`),
      info: (msg) => console.info(`INFO: ${msg}`),
      warning: (msg) => console.warn(`WARNING: ${msg}`),
      error: (msg) => console.error(`ERROR: ${msg}`),
    };
  },

  /**
   * 获取jQuery（兼容SillyTavern环境）
   */
  get jQuery() {
    const $ = window.jQuery || window.$ || null;
    if (!$) console.warn("[deps] jQuery暂未就绪");
    return $;
  },

  /**
   * 获取事件总线
   */
  get EventBus() {
    return this.getModule('EventBus');
  },

  /**
   * 获取设置模块（与settings.js导出对齐）
   */
  get settings() {
    const settingsModule = this.getModule('settings');
    return {
      ...settingsModule,
      save: settingsModule.save || saveSettings,
      migrate: settingsModule.migrate || migrateSettings,
      cleanup: settingsModule.cleanup || cleanupSettings
    };
  }
};

// 自动注册核心模块
deps.registerModule('utils', {
  getSafeToastr,
  formatTime,
  adjustVideoControlsLayout,
  applyTransitionEffect,
  getSafeGlobal,
  isDirectoryValid,
  registerModuleCleanup,
  safeJQuery
});

deps.registerModule('settings', {
  save: saveSettings,
  migrate: migrateSettings,
  cleanup: cleanupSettings
});

// 注册EventBus实例
const eventBusInstance = new EventBus();
deps.registerModule('EventBus', eventBusInstance);
Object.freeze(eventBusInstance);