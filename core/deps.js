/**
 * 依赖管理中心 - 集中管理模块间共享依赖
 */
export const deps = {
  // 延迟加载的模块引用
  modules: {},

  // 注册模块引用
  registerModule(name, module) {
    this.modules[name] = module;
  },

  // 获取工具类
  get utils() {
    return this.modules.utils;
  },

  // 获取配置类
  get settings() {
    return this.modules.settings;
  },

  // 获取API模块
  get api() {
    return this.modules.api;
  },

  // 安全获取jQuery
  get jQuery() {
    const $ = window.jQuery || window.$;
    if (!$) console.warn("[deps] jQuery暂未就绪");
    return $;
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
};
