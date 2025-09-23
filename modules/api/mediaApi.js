import { deps } from "../../core/deps.js";

const MEDIA_REQUEST_THROTTLE = 3000;
let lastMediaRequestTime = 0;

/**
 * 媒体API模块 - 负责媒体列表和媒体文件相关操作
 */
export const init = () => {
  console.log(`[mediaApi] 媒体API模块初始化完成`);
  // 注意：不要在init中立即访问deps.settings，因为settings模块可能还在加载中
  // 所有对deps.settings的访问都延迟到具体方法调用时
};

export const cleanup = () => {
  console.log(`[mediaApi] 媒体API模块无资源需清理`);
};

/**
 * 获取媒体列表
 */
export const fetchMediaList = async (filterType = "all") => {
  const settings = deps.settings.get();
  if (!settings.serviceUrl) {
    console.warn(`[mediaApi] 服务地址未配置，无法获取媒体列表`);
    return [];
  }

  try {
    const res = await fetch(`${settings.serviceUrl}/media?type=${filterType}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.media || [];
  } catch (e) {
    console.error(`[mediaApi] 获取媒体列表失败:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error("获取媒体列表失败，请检查服务连接");
    }
    return [];
  }
};

/**
 * 刷新媒体列表
 */
export const refreshMediaList = async (filterType) => {
  const settings = deps.settings.get();
  const now = Date.now();
  const targetFilter = filterType || settings.mediaFilter;

  // 节流控制
  if (now - lastMediaRequestTime < MEDIA_REQUEST_THROTTLE) {
    console.log(`[mediaApi] 媒体列表请求节流，返回缓存`);
    return window.mediaList || [];
  }

  lastMediaRequestTime = now;
  // 拉取最新列表
  window.mediaList = await fetchMediaList(targetFilter);

  // 确保设置对象中的属性存在
  if (!settings.randomMediaList) settings.randomMediaList = [];
  if (!settings.randomPlayedIndices) settings.randomPlayedIndices = [];

  settings.randomMediaList = [...window.mediaList];
  const oldLength = window.oldMediaListLength || 0;

  // 列表状态处理
  if (window.mediaList.length === 0) {
    window.currentMediaIndex = 0;
    if (settings.randomPlayedIndices) settings.randomPlayedIndices = [];
    if (settings.currentRandomIndex !== undefined) settings.currentRandomIndex = -1;
    if (deps.toastr && typeof deps.toastr.warning === "function") {
      deps.toastr.warning(`当前筛选无可用${targetFilter}媒体，请检查目录或筛选条件`);
    }
  } else if (window.mediaList.length !== oldLength) {
    window.currentMediaIndex = 0;
    if (settings.randomPlayedIndices) settings.randomPlayedIndices = [];
    if (settings.currentRandomIndex !== undefined) settings.currentRandomIndex = -1;
  }

  window.oldMediaListLength = window.mediaList.length;
  deps.settings.save();

  // 通知播放模块恢复播放
  if (settings.isPlaying && settings.autoSwitchMode === "timer") {
    deps.EventBus.emit("requestResumePlayback");
  }

  console.log(`[mediaApi] 媒体列表刷新完成，共${window.mediaList.length}个媒体`);
  return window.mediaList;
};

/**
 * 清理无效媒体
 */
export const cleanupInvalidMedia = async () => {
  const settings = deps.settings.get();

  if (!settings.serviceUrl) {
    console.warn(`[mediaApi] 服务地址未配置，无法清理无效媒体`);
    return null;
  }

  try {
    const res = await fetch(`${settings.serviceUrl}/cleanup`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("清理请求失败");

    const data = await res.json();
    if (deps.toastr && typeof deps.toastr.success === "function") {
      deps.toastr.success(
        `清理完成: 移除${data.removed}个无效文件，剩余${data.remaining_total}个`
      );
    }

    // 刷新媒体列表
    await refreshMediaList();
    return data;
  } catch (e) {
    console.error(`[mediaApi] 清理媒体失败:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`清理失败: ${e.message}`);
    }
    return null;
  }
};

export default {
  init,
  cleanup,
  fetchMediaList,
  refreshMediaList,
  cleanupInvalidMedia
};