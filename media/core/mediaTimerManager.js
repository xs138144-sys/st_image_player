import { deps } from "../../core/deps.js";

const { EventBus } = deps;

// 定时器引用
let mediaTimers = {
  switchTimer: null,
  progressTimer: null,
  statusCheckTimer: null
};

/**
 * 启动状态检查定时器
 */
export const startStatusCheckTimer = () => {
  mediaTimers.statusCheckTimer = setInterval(() => {
    EventBus.emit('checkMediaStatus');
  }, 1000); // 每秒检查一次
  
  console.log('[mediaTimerManager] 状态检查定时器已启动');
};

/**
 * 启动进度更新定时器
 */
export const startProgressTimer = () => {
  mediaTimers.progressTimer = setInterval(() => {
    EventBus.emit('updateProgress');
  }, 500); // 每500毫秒更新一次进度
  
  console.log('[mediaTimerManager] 进度更新定时器已启动');
};

/**
 * 启动自动切换定时器
 */
export const startAutoSwitchTimer = (interval) => {
  if (mediaTimers.switchTimer) {
    clearInterval(mediaTimers.switchTimer);
  }
  
  mediaTimers.switchTimer = setInterval(() => {
    EventBus.emit('autoSwitchCheck');
  }, interval);
  
  console.log(`[mediaTimerManager] 自动切换定时器已启动，间隔: ${interval}ms`);
};

/**
 * 停止自动切换定时器
 */
export const stopAutoSwitchTimer = () => {
  if (mediaTimers.switchTimer) {
    clearInterval(mediaTimers.switchTimer);
    mediaTimers.switchTimer = null;
    console.log('[mediaTimerManager] 自动切换定时器已停止');
  }
};

/**
 * 停止进度更新定时器
 */
export const stopProgressTimer = () => {
  if (mediaTimers.progressTimer) {
    clearInterval(mediaTimers.progressTimer);
    mediaTimers.progressTimer = null;
    console.log('[mediaTimerManager] 进度更新定时器已停止');
  }
};

/**
 * 停止状态检查定时器
 */
export const stopStatusCheckTimer = () => {
  if (mediaTimers.statusCheckTimer) {
    clearInterval(mediaTimers.statusCheckTimer);
    mediaTimers.statusCheckTimer = null;
    console.log('[mediaTimerManager] 状态检查定时器已停止');
  }
};

/**
 * 清理所有定时器
 */
export const clearAllTimers = () => {
  Object.values(mediaTimers).forEach(timer => {
    if (timer) clearInterval(timer);
  });
  
  mediaTimers = { 
    switchTimer: null, 
    progressTimer: null, 
    statusCheckTimer: null 
  };
  
  console.log('[mediaTimerManager] 所有定时器已清理');
};

/**
 * 获取定时器状态
 */
export const getTimerStatus = () => {
  return {
    switchTimer: !!mediaTimers.switchTimer,
    progressTimer: !!mediaTimers.progressTimer,
    statusCheckTimer: !!mediaTimers.statusCheckTimer
  };
};

/**
 * 检查定时器是否运行
 */
export const isTimerRunning = (timerName) => {
  return !!mediaTimers[timerName];
};