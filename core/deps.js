export const deps = {
  // 模块存储容器
  modules: {},

  // 注册模块到依赖管理器
  registerModule(name, module) {
    if (typeof name !== 'string' || !name) {
      console.error('[deps] 模块名必须是有效的字符串');
      return;
    }
    if (this.modules[name]) {
      console.warn(`[deps] 模块 ${name} 已存在，将被覆盖`);
    }
    this.modules[name] = module;
    console.log(`[deps] 模块 ${name} 已注册`);
  },

  // 安全获取jQuery（优先全局，再取模块内）
  get jQuery() {
    return window.jQuery || window.$ || this.modules.jquery;
  },

  // 安全获取toastr通知组件
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

  // 获取工具模块
  get utils() {
    return this.modules.utils;
  },

  // 获取配置模块
  get settings() {
    return this.modules.settings;
  },

  // 获取事件总线
  get EventBus() {
    return this.modules.eventBus;
  },

  // 获取API模块
  get api() {
    return this.modules.api;
  },

  // 获取WebSocket模块
  get websocket() {
    return this.modules.websocket;
  },

  // 检查模块是否已注册
  hasModule(name) {
    return !!this.modules[name];
  },

  // 安全获取模块（带默认值）
  getModule(name, defaultValue = null) {
    return this.modules[name] ?? defaultValue;
  }
};

// 初始化事件总线
class EventBus {
  constructor() {
    this.events = new Map();
  }

  // 注册事件监听
  on(eventName, callback) {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, []);
    }
    this.events.get(eventName).push(callback);

    // 返回取消监听函数
    return () => this.off(eventName, callback);
  }

  // 移除事件监听
  off(eventName, callback) {
    if (!this.events.has(eventName)) return;
    const callbacks = this.events.get(eventName);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  // 触发事件
  emit(eventName, data) {
    if (!this.events.has(eventName)) return;
    // 复制回调一份回调列表防止执行中修改
    const callbacks = [...this.events.get(eventName)];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error(`[EventBus] 事件 ${eventName} 执行失败:`, e);
      }
    });
  }

  // 移除所有事件监听
  clear() {
    this.events.clear();
  }
}

// 自动注册事件总线
deps.registerModule('eventBus', new EventBus());