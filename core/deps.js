/**
 * 依赖管理核心模块
 * 集中管理扩展所需的外部依赖和内部模块
 */
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
   * 获取jQuery
   */
  get jQuery() {
    return window.jQuery || window.$ || null;
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