import { deps } from "../core/deps.js";

/**
 * 初始化工具模块
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
export const adjustVideoControlsLayout = (win) => {
  if (!win || !win.find) return;
  const controlsHeight = win.find(".video-controls").outerHeight() || 40;
  win
    .find(".image-container")
    .css("height", `calc(100% - ${controlsHeight}px)`);
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
export const isDirectoryValid = (path) => {
  if (!path) return false;

  // 检查是否为Electron环境
  if (!window.require || !window.require("fs")) {
    deps.toastr.error(
      "目录检查功能仅支持Electron版SillyTavern，网页版无法使用"
    );
    console.error("[utils] 非Electron环境，不支持目录检查");
    return false;
  }

  const fs = window.require("fs");
  try {
    return (
      fs.existsSync(path) &&
      fs.statSync(path).isDirectory() &&
      fs.accessSync(path, fs.constants.R_OK)
    );
  } catch (e) {
    console.error(`[utils] 目录检查失败:`, e);
    deps.toastr.error(`目录检查失败: ${e.message}`);
    return false;
  }
};
