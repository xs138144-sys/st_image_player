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
  registerModuleCleanup, // 新增：导入utils中缺失的清理注册方法
  safeJQuery // 新增：导入安全获取jQuery的方法
} from "../modules/utils.js";
import {
  getSettings,
  saveSafeSettings,
  disableExtension,
  DEFAULT_SETTINGS,
  migrateSettings, // 新增：导入配置迁移方法
  cleanup as cleanupSettings // 新增：导入设置模块清理方法
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
    // 修复：直接使用utils模块的getSafeToastr方法，避免循环依赖
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
   * 获取事件总线（确保为实例化对象）
   */
  get EventBus() {
    return this.getModule('EventBus');
  },

  /**
   * 获取设置模块（统一接口命名）
   */
  get settings() {
    const settingsModule = this.getModule('settings');
    // 标准化接口，避免调用方出错
    return {
      ...settingsModule,
      get: settingsModule.get || getSettings,
      save: settingsModule.save || saveSafeSettings,
      migrate: settingsModule.migrate || migrateSettings,
      cleanup: settingsModule.cleanup || cleanupSettings
    };
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
  registerModuleCleanup, // 补充注册缺失的工具方法
  safeJQuery // 补充注册安全jQuery方法
});

deps.registerModule('settings', {
  get: getSettings,
  save: saveSafeSettings,
  disable: disableExtension,
  DEFAULT: DEFAULT_SETTINGS,
  migrate: migrateSettings, // 补充注册配置迁移方法
  cleanup: cleanupSettings // 补充注册清理方法
});

// 注册EventBus实例（确保全局唯一实例，避免重复实例化）
const eventBusInstance = new EventBus();
deps.registerModule('EventBus', eventBusInstance);

// 防止外部重复实例化EventBus
Object.freeze(eventBusInstance);