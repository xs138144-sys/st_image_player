const deps = {
  modules: {},

  /**
   * 注册模块到依赖管理器
   */
  registerModule: function (name, module) {
    this.modules[name] = module;
  },

  /**
   * 获取已注册的模块
   */
  getModule: function (name) {
    return this.modules[name];
  },

  /**
   * 安全获取toastr（兼容缺失场景）
   */
  get toastr() {
    const safeToastr = this.utils?.getSafeToastr ? this.utils.getSafeToastr() : null;
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
   * 快捷访问常用模块
   */
  get utils() {
    return this.getModule('utils');
  },

  get settings() {
    return this.getModule('settings');
  },

  get EventBus() {
    return this.getModule('EventBus');
  },

  get jQuery() {
    return window.jQuery || null;
  }
};

export { deps };