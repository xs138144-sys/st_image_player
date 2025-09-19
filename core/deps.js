// 扩展依赖管理
export const deps = {
  // 模块容器（用于动态注册模块）
  modules: {},

  // 安全获取 jQuery（关联到全局 window.jQuery 或 $）
  get jQuery() {
    return window.jQuery || window.$ || null;
  },

  // 安全获取 toastr（保持原逻辑）
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

  // 注册模块到依赖容器
  registerModule(moduleName, module) {
    this.modules[moduleName] = module;
    // 为常用模块创建快捷访问（如 settings、utils 等）
    if (["settings", "utils", "api"].includes(moduleName)) {
      this[moduleName] = module;
    }
  },

  // 其他依赖（动态初始化）
  EventBus: null,
  settings: null,
  utils: null,
  api: null,
};
