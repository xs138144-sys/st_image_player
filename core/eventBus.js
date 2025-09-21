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
    if (typeof callback !== 'function') {
      console.error('[EventBus] 回调必须是函数', eventName, callback);
      return () => { };
    }

    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }
    const callbacks = this.events.get(eventName);
    callbacks.add(callback);

    // 返回取消监听函数
    return () => {
      this.off(eventName, callback);
    };
  }

  /**
   * 移除特定事件的特定监听
   * @param {string} eventName 事件名称
   * @param {Function} callback 回调函数
   */
  off(eventName, callback) {
    if (this.events.has(eventName)) {
      const callbacks = this.events.get(eventName);
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.events.delete(eventName);
      }
    }
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
          if (typeof callback === 'function') {
            callback(...args);
          }
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

  /**
   * 检查事件是否有监听器
   * @param {string} eventName 事件名称
   * @returns {boolean}
   */
  hasListeners(eventName) {
    return this.events.has(eventName) && this.events.get(eventName).size > 0;
  }
}