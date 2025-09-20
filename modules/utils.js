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
  return `${mins}:${secs}`; // 修复笔误 minsmins → mins
};

/**
 * 调整视频控制栏布局
 */
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
  $controls.find(".volume-control").toggle(settings.customVideoControls.showVolume);
  $controls.find(".time-display").toggle(settings.customVideoControls.showTime);
  $controls.find(".progress-container").toggle(settings.customVideoControls.showProgress);
  $controls.find(".loop-control").toggle(settings.customVideoControls.showLoop);

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