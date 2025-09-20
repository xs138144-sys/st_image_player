import { get, save } from "./settings.js";
import { deps } from "../core/deps.js";

const {
  EventBus,
  toastr,
  settings: { get, save },
} = deps;
let lastMediaRequestTime = 0;
const MEDIA_REQUEST_THROTTLE = 5000; // 5秒节流
let pollingTimer = null; // 轮询定时器

/**
 * 初始化API模块（注册事件监听）
 */
export const init = () => {
  try {
    // 注册事件监听（接收其他模块的API调用请求）
    const removeRefreshListener = EventBus.on(
      "requestRefreshMediaList",
      (data) => {
        refreshMediaList(data?.filterType).then((list) => {
          EventBus.emit("mediaListRefreshed", {
            list,
            filterType: data?.filterType,
          });
        });
      }
    );

    const removeCleanupListener = EventBus.on(
      "requestCleanupInvalidMedia",
      () => {
        cleanupInvalidMedia().then((result) => {
          EventBus.emit("mediaCleanupCompleted", result);
        });
      }
    );

    const removeUpdateDirListener = EventBus.on(
      "requestUpdateScanDirectory",
      (data) => {
        updateScanDirectory(data.newPath).then((success) => {
          EventBus.emit("scanDirectoryUpdated", {
            success,
            path: data.newPath,
          });
        });
      }
    );

    const removeUpdateSizeListener = EventBus.on(
      "requestUpdateMediaSizeLimit",
      (data) => {
        updateMediaSizeLimit(data.imageMaxMb, data.videoMaxMb).then(
          (success) => {
            EventBus.emit("mediaSizeLimitUpdated", { success, ...data });
          }
        );
      }
    );

    const removeStatusListener = EventBus.on(
      "requestCheckServiceStatus",
      () => {
        checkServiceStatus().then((status) => {
          EventBus.emit("serviceStatusChecked", status);
        });
      }
    );

    // 启动服务轮询（默认30秒）
    startServicePolling();

    // 保存取消监听方法，供cleanup使用
    window.apiEventListeners = [
      removeRefreshListener,
      removeCleanupListener,
      removeUpdateDirListener,
      removeUpdateSizeListener,
      removeStatusListener,
    ];

    console.log(`[api] 初始化完成，已注册事件监听`);
  } catch (e) {
    toastr.error(`[api] 初始化失败: ${e.message}`);
    console.error(`[api] 初始化错误:`, e);
  }
};

/**
 * 清理API模块资源（定时器、事件监听）
 */
export const cleanup = () => {
  try {
    // 清除轮询定时器
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }

    // 取消事件监听
    if (window.apiEventListeners) {
      window.apiEventListeners.forEach((removeListener) => removeListener());
      window.apiEventListeners = null;
    }

    console.log(`[api] 资源清理完成`);
  } catch (e) {
    toastr.error(`[api] 清理失败: ${e.message}`);
    console.error(`[api] 清理错误:`, e);
  }
};

/**
 * 启动服务状态轮询
 */
const startServicePolling = () => {
  const settings = get();
  // 清除旧定时器
  if (pollingTimer) clearInterval(pollingTimer);
  // 启动新轮询
  pollingTimer = setInterval(() => {
    if (settings.masterEnabled) {
      checkServiceStatus().then((status) => {
        EventBus.emit("serviceStatusPolled", status);
      });
    }
  }, settings.pollingInterval || 30000); // 默认30秒
};

/**
 * 检查服务状态
 */
export const checkServiceStatus = async () => {
  const settings = get();
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
      error: null,
    };
  } catch (e) {
    console.error(`[api] 服务检查失败:`, e);
    return { active: false, error: e.message };
  }
};

/**
 * 获取媒体列表（支持筛选）
 */
export const fetchMediaList = async (filterType = "all") => {
  const settings = get();
  try {
    const res = await fetch(`${settings.serviceUrl}/media?type=${filterType}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.media || [];
  } catch (e) {
    console.error(`[api] 获取媒体列表失败:`, e);
    toastr.error("获取媒体列表失败，请检查服务连接");
    return [];
  }
};



// 修复：更新扫描目录函数
export const updateScanDirectory = async (newPath) => {
  const settings = get();
  const { isDirectoryValid } = deps.utils;

  if (!newPath || !isDirectoryValid(newPath)) {
    deps.toastr.warning("请 输入有效且有读权限的目录路径"); // 修正：使用deps.toastr
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
    save();
    deps.toastr.success(`目录已更新: ${newPath}`); // 修正：使用deps.toastr

    // 刷新媒体列表（调用补全的函数）
    await refreshMediaList();
    return true;
  } catch (e) {
    console.error(`[api] 更新目录失败:`, e);
    deps.toastr.error(`更新失败: ${e.message}`);
    return false;
  }
};

/**
 * 更新媒体大小限制
 */
export const updateMediaSizeLimit = async (imageMaxMb, videoMaxMb) => {
  const settings = get();

  if (imageMaxMb < 1 || imageMaxMb > 50) {
    toastr.warning("图片大小限制需在 1-50MB 之间");
    return false;
  }

  if (videoMaxMb < 10 || videoMaxMb > 500) {
    toastr.warning("视频大小限制需在 10-500MB 之间");
    return false;
  }

  try {
    const status = await checkServiceStatus();
    const res = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: settings.serviceDirectory || status.directory,
        image_max_mb: imageMaxMb,
        video_max_mb: videoMaxMb,
      }),
    });

    if (!res.ok) throw new Error((await res.json()).message || "更新限制失败");

    settings.mediaConfig = {
      ...settings.mediaConfig,
      image_max_size_mb: imageMaxMb,
      video_max_size_mb: videoMaxMb,
    };
    save();
    toastr.success(`大小限制更新: 图片${imageMaxMb}MB | 视频${videoMaxMb}MB`);

    // 刷新媒体列表
    await refreshMediaList();
    return true;
  } catch (e) {
    console.error(`[api] 更新限制失败:`, e);
    toastr.error(`更新失败: ${e.message}`);
    return false;
  }
};

/**
 * 清理无效媒体
 */
export const cleanupInvalidMedia = async () => {
  const settings = get();
  try {
    const res = await fetch(`${settings.serviceUrl}/cleanup`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("清理请求失败");

    const data = await res.json();
    toastr.success(
      `清理完成: 移除${data.removed}个无效文件，剩余${data.remaining_total}个`
    );

    // 刷新媒体列表
    await refreshMediaList();
    return data;
  } catch (e) {
    console.error(`[api] 清理媒体失败:`, e);
    toastr.error(`清理失败: ${e.message}`);
    return null;
  }
};

/**
 * 刷新媒体列表（带节流）
 */
export const refreshMediaList = async (filterType) => {
  const settings = get();
  const now = Date.now();
  const targetFilter = filterType || settings.mediaFilter;

  // 节流控制
  if (now - lastMediaRequestTime < MEDIA_REQUEST_THROTTLE) {
    console.log(`[api] 媒体列表请求节流，返回缓存`);
    return window.mediaList || [];
  }

  lastMediaRequestTime = now;
  // 拉取最新列表
  window.mediaList = await fetchMediaList(targetFilter);
  settings.randomMediaList = [...window.mediaList];
  const oldLength = window.oldMediaListLength || 0;

  // 列表状态处理
  if (window.mediaList.length === 0) {
    window.currentMediaIndex = 0;
    settings.randomPlayedIndices = [];
    settings.currentRandomIndex = -1;
    toastr.warning(`当前筛选无可用${targetFilter}媒体，请检查目录或筛选条件`);
  } else if (window.mediaList.length !== oldLength) {
    window.currentMediaIndex = 0;
    settings.randomPlayedIndices = [];
    settings.currentRandomIndex = -1;
  }

  window.oldMediaListLength = window.mediaList.length;
  save();

  // 通知播放模块恢复播放
  if (settings.isPlaying && settings.autoSwitchMode === "timer") {
    EventBus.emit("requestResumePlayback");
  }

  console.log(`[api] 媒体列表刷新完成，共${window.mediaList.length}个媒体`);
  return window.mediaList;
};