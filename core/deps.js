/**
 * 依赖管理核心模块
 * 集中管理扩展所需的外部依赖和内部模块，自动集成核心模块
 */
// 导入核心模块（保持与旧版本一致的基础依赖）
import {
  getSafeToastr,
  formatTime,
  adjustVideoControlsLayout,
  applyTransitionEffect,
  getSafeGlobal,
  isDirectoryValid,
} from "../modules/utils.js";
import {
  getSettings,
  saveSafeSettings,
  disableExtension,
  DEFAULT_SETTINGS,
} from "../modules/settings.js";
import { EventBus } from "./eventBus.js";

export const deps = {
  // 模块存储
  modules: {},

  /**
   * 注册模块
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

  /**
   * 安全获取toastr（兼容缺失场景）
   */
  get toastr() {
    return this.utils.getSafeToastr ? this.utils.getSafeToastr() : {
      success: (msg) => console.log(`SUCCESS: ${msg}`),
      info: (msg) => console.info(`INFO: ${msg}`),
      warning: (msg) => console.warn(`WARNING: ${msg}`),
      error: (msg) => console.error(`ERROR: ${msg}`),
    };
  },

  /**
   * 获取jQuery（兼容SillyTavern环境，保留旧版本的警告提示）
   */
  get jQuery() {
    const $ = window.jQuery || window.$ || null;
    if (!$) console.warn("[deps] jQuery暂未就绪");
    return $;
  },

  /**
   * 获取工具模块
   */
  get utils() {
    return this.getModule('utils');
  },

  /**
   * 获取事件总线
   */
  get EventBus() {
    return this.getModule('EventBus');
  },

  /**
   * 获取设置模块
   */
  get settings() {
    return this.getModule('settings');
  }
};

// 自动注册核心模块（融合旧版本的默认依赖，无需手动注册）
deps.registerModule('utils', {
  getSafeToastr,
  formatTime,
  adjustVideoControlsLayout,
  applyTransitionEffect,
  getSafeGlobal,
  isDirectoryValid,
});

deps.registerModule('settings', {
  get: getSettings,
  save: saveSafeSettings,
  disableExtension,
  DEFAULT: DEFAULT_SETTINGS,
});

// 注册EventBus实例（新版本EventBus为类，需实例化）
deps.registerModule('EventBus', new EventBus());