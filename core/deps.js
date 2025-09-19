export const deps = {
  // 模块存储
  modules: {},

  // 注册模块
  registerModule(name, module) {
    this.modules[name] = module;
  },

  // 安全获取jQuery（优先全局，再取模块内）
  get jQuery() {
    return window.jQuery || window.$ || this.modules.jquery;
  },

  // 安全获取toastr
  get toastr() {
    return (
      this.utils?.getSafeToastr?.() || {
        success: (msg) => console.log(`SUCCESS: ${msg}`),
        info: (msg) => console.info(`INFO: ${msg}`),
        warning: (msg) => console.warn(`WARNING: ${msg}`),
        error: (msg) => console.error(`ERROR: ${msg}`),
      }
    );
  },

  // 其他依赖动态挂载（如settings、EventBus等）
};
