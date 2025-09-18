/**
 * 安全获取toastr（兼容SillyTavern环境）
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
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间
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
 * @param {JQuery<HTMLElement>} win - 播放器窗口JQuery对象
 */
export const adjustVideoControlsLayout = (win) => {
  const controlsHeight = win.find(".video-controls").outerHeight() || 40;
  win
    .find(".image-container")
    .css("height", `calc(100% - ${controlsHeight}px)`);
};

/**
 * 应用图片过渡效果
 * @param {HTMLElement} imgElement - 图片元素
 * @param {string} effect - 过渡效果（fade/slide/zoom/none）
 */
export const applyTransitionEffect = (imgElement, effect) => {
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
 * 安全获取全局变量（避免未定义错误）
 * @param {string} name - 全局变量名
 * @param {any} defaultValue - 默认值
 * @returns {any} 全局变量值或默认值
 */
export const getSafeGlobal = (name, defaultValue) => {
  return window[name] === undefined ? defaultValue : window[name];
};

/**
 * 检查目录是否有效（存在且有读权限）
 * @param {string} path - 目录路径
 * @returns {boolean} 是否有效
 */
export const isDirectoryValid = (path) => {
  if (!path || !window.require) return false; // 兼容浏览器环境
  const fs = window.require("fs");
  return (
    fs.existsSync(path) &&
    fs.statSync(path).isDirectory() &&
    fs.accessSync(path, fs.constants.R_OK)
  );
};
