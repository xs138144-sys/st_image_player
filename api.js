import { getSettings, saveSafeSettings } from "./settings.js";
import { getSafeToastr } from "./utils.js";

const toastr = getSafeToastr();
let lastMediaRequestTime = 0;
const MEDIA_REQUEST_THROTTLE = 5000; // 5秒节流

/**
 * 检查服务状态
 * @returns {Promise<object>} 服务状态（active: boolean, ...）
 */
export const checkServiceStatus = async () => {
  const settings = getSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      active: data.active,
      observerActive: data.observer_active || false,
      totalCount: data.total_count || 0,
      imageCount: data.image_count || 0,
      videoCount: data.video_count || 0,
      directory: data.directory || "",
      mediaConfig: data.media_config || {},
    };
  } catch (e) {
    console.error(`[API] 服务检查失败:`, e);
    return { active: false, error: e.message };
  }
};

/**
 * 获取媒体列表（支持筛选）
 * @param {string} filterType - 筛选类型（all/image/video）
 * @returns {Promise<Array>} 媒体列表
 */
export const fetchMediaList = async (filterType = "all") => {
  const settings = getSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/media?type=${filterType}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.media || [];
  } catch (e) {
    console.error(`[API] 获取媒体列表失败:`, e);
    toastr.error("获取媒体列表失败，请检查服务连接");
    return [];
  }
};

/**
 * 更新扫描目录
 * @param {string} newPath - 新目录路径
 * @returns {Promise<boolean>} 是否成功
 */
export const updateScanDirectory = async (newPath) => {
  const settings = getSettings();
  if (!newPath || !window.require) {
    toastr.warning("请输入有效目录路径");
    return false;
  }

  const fs = window.require("fs");
  if (!fs.existsSync(newPath) || !fs.statSync(newPath).isDirectory()) {
    toastr.error("目录不存在或不是有效目录");
    return false;
  }

  try {
    const res = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: newPath }),
    });

    if (!res.ok) throw new Error((await res.json()).message || "更新目录失败");
    settings.serviceDirectory = newPath;
    saveSafeSettings();
    toastr.success(`目录已更新: ${newPath}`);
    await refreshMediaList();
    return true;
  } catch (e) {
    console.error(`[API] 更新目录失败:`, e);
    toastr.error(`更新失败: ${e.message}`);
    return false;
  }
};

/**
 * 更新媒体大小限制
 * @param {number} imageMaxMb - 图片最大尺寸(MB)
 * @param {number} videoMaxMb - 视频最大尺寸(MB)
 * @returns {Promise<boolean>} 是否成功
 */
export const updateMediaSizeLimit = async (imageMaxMb, videoMaxMb) => {
  const settings = getSettings();
  if (imageMaxMb < 1 || imageMaxMb > 50) {
    toastr.warning("图片大小限制需在 1-50MB 之间");
    return false;
  }
  if (videoMaxMb < 10 || videoMaxMb > 500) {
    toastr.warning("视频大小限制需在 10-500MB 之间");
    return false;
  }

  try {
    const res = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path:
          settings.serviceDirectory || (await checkServiceStatus()).directory,
        image_max_mb: imageMaxMb,
        video_max_mb: videoMaxMb,
      }),
    });

    if (!res.ok) throw new Error((await res.json()).message || "更新限制失败");
    settings.mediaConfig = {
      image_max_size_mb: imageMaxMb,
      video_max_size_mb: videoMaxMb,
    };
    saveSafeSettings();
    toastr.success(`大小限制更新: 图片${imageMaxMb}MB | 视频${videoMaxMb}MB`);
    await refreshMediaList();
    return true;
  } catch (e) {
    console.error(`[API] 更新限制失败:`, e);
    toastr.error(`更新失败: ${e.message}`);
    return false;
  }
};

/**
 * 清理无效媒体（不存在/超限制）
 * @returns {Promise<object|null>} 清理结果（removed: 数量, ...）
 */
export const cleanupInvalidMedia = async () => {
  const settings = getSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/cleanup`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("清理请求失败");
    const data = await res.json();
    toastr.success(
      `清理完成: 移除${data.removed}个无效文件，剩余${data.remaining_total}个`
    );
    await refreshMediaList();
    return data;
  } catch (e) {
    console.error(`[API] 清理媒体失败:`, e);
    toastr.error(`清理失败: ${e.message}`);
    return null;
  }
};

/**
 * 刷新媒体列表（带节流）
 * @returns {Promise<Array>} 刷新后的媒体列表
 */
export const refreshMediaList = async () => {
  const settings = getSettings();
  const now = Date.now();

  // 节流：5秒内不重复请求
  if (now - lastMediaRequestTime < MEDIA_REQUEST_THROTTLE) {
    console.log(`[API] 媒体列表请求节流，返回缓存`);
    return window.mediaList || [];
  }
  lastMediaRequestTime = now;

  // 拉取最新列表
  window.mediaList = await fetchMediaList(settings.mediaFilter);
  settings.randomMediaList = [...window.mediaList];

  // 列表状态处理
  if (window.mediaList.length === 0) {
    window.currentMediaIndex = 0;
    settings.randomPlayedIndices = [];
    settings.currentRandomIndex = -1;
    toastr.warning("当前筛选无可用媒体，请检查目录或筛选条件");
  } else if (window.mediaList.length !== (window.oldMediaListLength || 0)) {
    window.currentMediaIndex = 0;
    settings.randomPlayedIndices = [];
    settings.currentRandomIndex = -1;
  }
  window.oldMediaListLength = window.mediaList.length;

  // 播放状态恢复
  if (settings.isPlaying && settings.autoSwitchMode === "timer") {
    await import("./mediaPlayer.js").then(({ startPlayback }) =>
      startPlayback()
    );
  }

  return window.mediaList;
};
