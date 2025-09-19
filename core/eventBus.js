/**
 * 事件总线 - 模块间通信核心
 */
export class EventBus {
  constructor() {
    this.events = new Map();
  }

  /**
   * 注册事件监听
   * @param {string} eventName 事件名称
   * @param {Function} callback 回调函数
   * @returns {Function} 取消监听的函数
   */
  on(eventName, callback) {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }
    const callbacks = this.events.get(eventName);
    callbacks.add(callback);

    // 返回取消监听函数
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.events.delete(eventName);
      }
    };
  }

  /**
   * 触发事件
   * @param {string} eventName 事件名称
   * @param {any} data 传递的数据
   */
  emit(eventName, data) {
    if (this.events.has(eventName)) {
      // 创建回调副本，防止执行中修改原集合
      const callbacks = new Set(this.events.get(eventName));
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[EventBus] 事件${eventName}执行错误:`, error);
        }
      });
    }
  }

  /**
   * 清除所有事件监听
   */
  clear() {
    this.events.clear();
  }
}
