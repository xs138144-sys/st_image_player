import { deps } from "../core/deps.js";

// 移除这行，因为 jQuery 可能还未加载
// const { jQuery: $ } = deps;

/**
 * 初始化工具函数
 */
export const init = () => {
  console.log(`[utils] 工具模块初始化完成`);
};

/**
 * 清理工具模块
 */
export const cleanup = () => {
  console.log(`[utils] 工具模块无资源需清理`);
};

/**
 * 安全获取toastr
 */
export const getSafeToastr = () => {
  return (
    window.toastr || {
      success: (msg) => console.log(`SUCCESS: ${msg}`),
      info: (msg) => console.info(`INFO: ${msg}`),
      warning: (msg) => console.warn(`WARNING: ${msg}`),
      error: (msg) => console.error(`ERROR: ${msg}`),
    }
  );
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
 * 调整视频控制栏布局
 */
// modules/utils.js 补充调整逻辑
export const adjustVideoControlsLayout = (win) => {
  const settings = deps.settings.get();
  const $ = deps.jQuery;
  if (!$) return;

  const $controls = win ? win.find(".video-controls") : $(`#st-image-player-window .video-controls`);

  if (!settings.showVideoControls) {
    $controls.hide();
    return;
  }

  $controls.show();

  // 根据自定义设置调整控制元素
  $controls.find(".volume-btn").toggle(settings.customVideoControls.showVolume);
  $controls.find(".time-display").toggle(settings.customVideoControls.showTime);
  $controls.find(".progress-container").toggle(settings.customVideoControls.showProgress);
  $controls.find(".loop-btn").toggle(settings.customVideoControls.showLoop);

  // 调整容器高度
  if (win && win.find) {
    const controlsHeight = $controls.outerHeight() || 40;
    win.find(".image-container").css("height", `calc(100% - ${controlsHeight}px)`);
  }
};

/**
 * 应用图片过渡效果
 */
export const applyTransitionEffect = (imgElement, effect) => {
  if (!imgElement) return;
  imgElement.classList.remove(
    "fade-transition",
    "slide-transition",
    "zoom-transition"
  );
  if (effect !== "none") {
    imgElement.classList.add(`${effect}-transition`);
  }
};

/**
 * 安全获取全局变量
 */
export const getSafeGlobal = (name, defaultValue) => {
  return window[name] === undefined ? defaultValue : window[name];
};

/**
 * 检查目录是否有效
 */
// 改进后的Electron环境检测
const isElectron = !!window.require?.('electron');

// 更新目录有效性检查
export const isDirectoryValid = (path) => {
  if (!path) return false;
  
  try {
    if (!isElectron) {
      deps.toastr.error('目录检查仅支持Electron桌面版');
      return false;
    }
    
    const fs = window.require('fs');
    return fs.existsSync(path) 
      && fs.statSync(path).isDirectory()
      && fs.accessSync(path, fs.constants.R_OK);
  } catch (e) {
    console.error('目录检查失败:', e);
    deps.toastr.error(`目录检查错误: ${e.message}`);
    return false;
  }
}

/**
 * 安全等待jQuery就绪
 */
export const safeJQuery = (callback) => {
  if (typeof window.jQuery !== "undefined") {
    callback();
    return;
  }

  let retry = 0;
  const interval = setInterval(() => {
    if (typeof window.jQuery !== "undefined" || retry > 20) {
      clearInterval(interval);
      if (typeof window.jQuery !== "undefined") callback();
      else console.error("jQuery 20秒内未就绪，扩展无法运行");
    }
    retry++;
  }, 500);
};
// 在 utils.js 文件末尾添加以下函数

/**
 * 注册模块清理函数
 */
export const registerModuleCleanup = (moduleId, cleanupFn) => {
  if (typeof cleanupFn !== "function") {
    console.error(`[utils] 无效的清理函数: ${moduleId}`);
    return;
  }

  // 确保全局清理监听器数组存在
  window.moduleCleanupListeners = window.moduleCleanupListeners || [];

  // 创建清理函数
  const cleanupWrapper = () => {
    try {
      console.log(`[utils] 执行清理: ${moduleId}`);
      cleanupFn();
    } catch (e) {
      console.error(`[utils] 清理函数执行失败 (${moduleId}):`, e);
    }
  };

  // 监听扩展禁用事件
  const removeListener = deps.EventBus.on("extensionDisable", cleanupWrapper);

  // 保存取消监听函数
  window.moduleCleanupListeners.push(removeListener);

  console.log(`[utils] 已注册清理函数: ${moduleId}`);
};
// 默认导出所有工具函数
export default {
  init,
  cleanup,
  getSafeToastr,
  formatTime,
  adjustVideoControlsLayout,
  applyTransitionEffect,
  getSafeGlobal,
  isDirectoryValid,
  safeJQuery,
  registerModuleCleanup
};

export const safeDebounce = (fn, delay) => {
  let timer;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};