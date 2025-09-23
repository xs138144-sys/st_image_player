import { deps } from "../core/deps.js";

/**
 * 时间工具模块
 */
export const init = () => {
  console.log(`[timeUtils] 时间工具模块初始化完成`);
};

export const cleanup = () => {
  console.log(`[timeUtils] 时间工具模块无资源需清理`);
};

/**
 * 格式化秒数为 MM:SS
 */
export const formatTime = (seconds) => {
  if (isNaN(seconds)) return "00:00";
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
};

/**
 * 格式化时间为更友好的显示
 */
export const formatDuration = (milliseconds) => {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`;
  if (milliseconds < 3600000) return `${(milliseconds / 60000).toFixed(1)}m`;
  return `${(milliseconds / 3600000).toFixed(1)}h`;
};

/**
 * 创建节流函数
 */
export const createThrottle = (func, delay) => {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func(...args);
    }
  };
};

/**
 * 创建防抖函数
 */
export const createDebounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
};

/**
 * 等待指定时间
 */
export const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * 计算时间间隔
 */
export const timeSince = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
};

export default {
  init,
  cleanup,
  formatTime,
  formatDuration,
  createThrottle,
  createDebounce,
  sleep,
  timeSince
};