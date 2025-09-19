import { deps } from "../core/deps.js";

const { jQuery: $, EventBus } = deps;

/**
 * 安全地执行jQuery操作，确保DOM已加载
 * @param {Function} callback - 要执行的操作
 */
export const safeJQuery = (callback) => {
  if (typeof $ === 'undefined') {
    console.warn('jQuery尚未加载，推迟执行操作');
    // 尝试再次检查
    setTimeout(() => safeJQuery(callback), 100);
    return;
  }

  if (document.readyState === 'complete') {
    callback();
  } else {
    $(document).ready(callback);
  }
};

/**
 * 格式化时间（秒 -> MM:SS格式）
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
export const formatTime = (seconds) => {
  if (isNaN(seconds)) return "0:00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

/**
 * 调整视频控制条布局
 */
export const adjustVideoControlsLayout = () => {
  const { get } = deps.settings;
  const settings = get();

  safeJQuery(() => {
    const $ = deps.jQuery;
    const $controls = $(`#st-image-player-window .video-progress-controls`);

    if (settings.showVideoControls) {
      $controls.show();
    } else {
      $controls.hide();
    }

    // 根据自定义设置调整控制条元素显示
    if (settings.customVideoControls.showVolume) {
      $controls.find(".volume-control").show();
    } else {
      $controls.find(".volume-control").hide();
    }

    if (settings.customVideoControls.showTime) {
      $controls.find(".time-display").show();
    } else {
      $controls.find(".time-display").hide();
    }
  });
};

/**
 * 应用过渡效果
 * @param {HTMLElement} element - 要应用效果的元素
 * @param {string} effect - 效果类型：fade, slide, zoom
 * @param {number} duration - 持续时间(毫秒)
 */
export const applyTransitionEffect = (element, effect = 'fade', duration = 300) => {
  if (!element) return;

  const $element = $(element);
  $element.css('transition', 'none');

  switch (effect) {
    case 'fade':
      $element.css('opacity', '0');
      setTimeout(() => {
        $element.css({
          transition: `opacity ${duration}ms ease-in-out`,
          opacity: '1'
        });
      }, 50);
      break;

    case 'slide':
      $element.css({
        transform: 'translateY(20px)',
        opacity: '0'
      });
      setTimeout(() => {
        $element.css({
          transition: `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`,
          transform: 'translateY(0)',
          opacity: '1'
        });
      }, 50);
      break;

    case 'zoom':
      $element.css({
        transform: 'scale(0.95)',
        opacity: '0'
      });
      setTimeout(() => {
        $element.css({
          transition: `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`,
          transform: 'scale(1)',
          opacity: '1'
        });
      }, 50);
      break;

    default:
      // 无过渡效果
      break;
  }

  // 清理过渡样式
  setTimeout(() => {
    $element.css('transition', '');
    $element.css('transform', '');
    $element.css('opacity', '');
  }, duration + 50);
};

/**
 * 获取安全的全局变量
 * @param {string} varName - 变量名
 * @param {any} defaultValue - 默认值
 * @returns {any} 全局变量值或默认值
 */
export const getSafeGlobal = (varName, defaultValue = null) => {
  try {
    return typeof window !== 'undefined' && window[varName] !== undefined
      ? window[varName]
      : defaultValue;
  } catch (e) {
    console.warn(`获取全局变量${varName}失败:`, e);
    return defaultValue;
  }
};

/**
 * 注册模块清理函数
 * @param {string} moduleId - 模块ID
 * @param {Function} cleanupFn - 清理函数
 */
export const registerModuleCleanup = (moduleId, cleanupFn) => {
  if (typeof cleanupFn !== 'function') return;

  window.stModuleCleanup = window.stModuleCleanup || {};
  window.stModuleCleanup[moduleId] = cleanupFn;

  // 注册全局清理事件
  const removeListener = EventBus.on('extensionCleanup', () => {
    try {
      cleanupFn();
    } catch (e) {
      console.error(`模块${moduleId}清理失败:`, e);
    }
  });

  // 保存监听器以便后续移除
  window.cleanupListeners = window.cleanupListeners || [];
  window.cleanupListeners.push(removeListener);
};

/**
 * 检查文件类型是否为图片
 * @param {string} filename - 文件名
 * @returns {boolean} 是否为图片
 */
export const isImageFile = (filename) => {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.apng'];
  const ext = filename.toLowerCase().split('.').pop();
  return imageExtensions.some(e => e.includes(ext));
};

/**
 * 检查文件类型是否为视频
 * @param {string} filename - 文件名
 * @returns {boolean} 是否为视频
 */
export const isVideoFile = (filename) => {
  const videoExtensions = ['.webm', '.mp4', '.ogv', '.mov', '.avi', '.mkv', '.flv', '.wmv'];
  const ext = filename.toLowerCase().split('.').pop();
  return videoExtensions.some(e => e.includes(ext));
};

/**
 * 防抖函数
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间(毫秒)
 * @returns {Function} 防抖后的函数
 */
export const debounce = (func, wait) => {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
};

/**
 * 节流函数
 * @param {Function} func - 要执行的函数
 * @param {number} limit - 限制时间(毫秒)
 * @returns {Function} 节流后的函数
 */
export const throttle = (func, limit) => {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      return func.apply(this, args);
    }
  };
};
