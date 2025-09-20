export class EventBus {
  constructor() {
    this.events = new Map(); // 存储事件与回调的映射
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
   * @param  {...any} args 传递给回调的参数
   */
  emit(eventName, ...args) {
    if (this.events.has(eventName)) {
      // 复制一份回调集合防止执行中修改
      const callbacks = new Set(this.events.get(eventName));
      callbacks.forEach(callback => {
        try {
          callback(...args);
        } catch (e) {
          console.error(`[EventBus] 执行${eventName}回调失败:`, e);
        }
      });
    }
  }

  /**
   * 移除特定事件的所有监听
   * @param {string} eventName 事件名称
   */
  offAll(eventName) {
    if (this.events.has(eventName)) {
      this.events.delete(eventName);
    }
  }
}