import { deps } from "../core/deps.js";

// 模块私有变量
let lastMediaRequestTime = 0;
const MEDIA_REQUEST_THROTTLE = 5000; // 5秒节流
let pollingTimer = null; // 轮询定时器
let eventListeners = []; // 事件监听器集合

/**
 * 初始化API模块
 */
export const init = () => {
  try {
    // 注册事件监听
    const removeRefreshListener = deps.EventBus.on(
      "requestRefreshMediaList",
      (data) => {
        refreshMediaList(data?.filterType).then((list) => {
          deps.EventBus.emit("mediaListRefreshed", {
            list,
            filterType: data?.filterType,
          });
        });
      }
    );

    const removeCleanupListener = deps.EventBus.on(
      "requestCleanupInvalidMedia",
      () => {
        cleanupInvalidMedia().then((result) => {
          deps.EventBus.emit("mediaCleanupCompleted", result);
        });
      }
    );

    const removeUpdateDirListener = deps.EventBus.on(
      "requestUpdateScanDirectory",
      (data) => {
        updateScanDirectory(data.newPath).then((success) => {
          deps.EventBus.emit("scanDirectoryUpdated", {
            success,
            path: data.newPath,
          });
        });
      }
    );

    const removeUpdateSizeListener = deps.EventBus.on(
      "requestUpdateMediaSizeLimit",
      (data) => {
        updateMediaSizeLimit(data.imageMaxMb, data.videoMaxMb).then(
          (success) => {
            deps.EventBus.emit("mediaSizeLimitUpdated", { success, ...data });
          }
        );
      }
    );

    const removeStatusListener = deps.EventBus.on(
      "requestCheckServiceStatus",
      () => {
        checkServiceStatus().then((status) => {
          deps.EventBus.emit("serviceStatusChecked", status);
        });
      }
    );

    // 保存事件监听器
    eventListeners = [
      removeRefreshListener,
      removeCleanupListener,
      removeUpdateDirListener,
      removeUpdateSizeListener,
      removeStatusListener,
    ];

    // 启动服务轮询
    startServicePolling();

    console.log(`[api] API模块初始化完成`);
  } catch (e) {
    deps.toastr.error(`[api] 初始化失败: ${e.message}`);
    console.error(`[api] 初始化错误:`, e);
  }
};

/**
 * 清理API模块
 */
export const cleanup = () => {
  try {
    // 清除轮询定时器
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }

    // 取消所有事件监听
    eventListeners.forEach((removeListener) => removeListener());
    eventListeners = [];

    console.log(`[api] API模块已清理`);
  } catch (e) {
    deps.toastr.error(`[api] 清理失败: ${e.message}`);
    console.error(`[api] 清理错误:`, e);
  }
};

/**
 * 启动服务状态轮询
 */
const startServicePolling = () => {
  const settings = deps.settings.getSettings();

  // 清除旧定时器
  if (pollingTimer) clearInterval(pollingTimer);

  // 启动新轮询
  pollingTimer = setInterval(() => {
    if (settings.masterEnabled) {
      checkServiceStatus().then((status) => {
        deps.EventBus.emit("serviceStatusPolled", status);
      });
    }
  }, settings.pollingInterval);
};

/**
 * 检查服务状态
 */
export const checkServiceStatus = async () => {
  const settings = deps.settings.getSettings();
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
  const settings = deps.settings.getSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/media?type=${filterType}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    return data.media || [];
  } catch (e) {
    console.error(`[api] 获取媒体列表失败:`, e);
    deps.toastr.error("获取媒体列表失败，请检查服务连接");
    return [];
  }
};

/**
 * 更新扫描目录
 */
export const updateScanDirectory = async (newPath) => {
  const settings = deps.settings.getSettings();
  const { isDirectoryValid } = deps.utils;

  if (!newPath || !isDirectoryValid(newPath)) {
    deps.toastr.warning("请输入有效且有读权限的目录路径");
    return false;
  }

  try {
    const res = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: newPath }),
    });

    if (!res.ok) throw new Error((await res.json()).message || "更新目录失败");

    deps.settings.saveSettings({ serviceDirectory: newPath });
    deps.toastr.success(`目录已更新: ${newPath}`);

    // 刷新媒体列表
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
  const settings = deps.settings.getSettings();

  if (imageMaxMb < 1 || imageMaxMb > 50) {
    deps.toastr.warning("图片大小限制需在 1-50MB 之间");
    return false;
  }

  if (videoMaxMb < 10 || videoMaxMb > 500) {
    deps.toastr.warning("视频大小限制需在 10-500MB 之间");
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

    deps.settings.saveSettings({
      mediaConfig: {
        image_max_size_mb: imageMaxMb,
        video_max_size_mb: videoMaxMb,
      },
    });
    deps.toastr.success(
      `大小限制更新: 图片${imageMaxMb}MB | 视频${videoMaxMb}MB`
    );

    // 刷新媒体列表
    await refreshMediaList();
    return true;
  } catch (e) {
    console.error(`[api] 更新限制失败:`, e);
    deps.toastr.error(`更新失败: ${e.message}`);
    return false;
  }
};

/**
 * 清理无效媒体
 */
export const cleanupInvalidMedia = async () => {
  const settings = deps.settings.getSettings();
  try {
    const res = await fetch(`${settings.serviceUrl}/cleanup`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("清理请求失败");

    const data = await res.json();
    deps.toastr.success(
      `清理完成: 移除${data.removed}个无效文件，剩余${data.remaining_total}个`
    );

    // 刷新媒体列表
    await refreshMediaList();
    return data;
  } catch (e) {
    console.error(`[api] 清理媒体失败:`, e);
    deps.toastr.error(`清理失败: ${e.message}`);
    return null;
  }
};

/**
 * 刷新媒体列表（带节流）
 */
export const refreshMediaList = async (filterType) => {
  const settings = deps.settings.getSettings();
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
  deps.settings.saveSettings({
    randomMediaList: [...window.mediaList],
    randomPlayedIndices: [],
    currentRandomIndex: -1,
  });

  const oldLength = window.oldMediaListLength || 0;

  // 列表状态处理
  if (window.mediaList.length === 0) {
    window.currentMediaIndex = 0;
    deps.toastr.warning(
      `当前筛选无可用${targetFilter}媒体，请检查目录或筛选条件`
    );
  } else if (window.mediaList.length !== oldLength) {
    window.currentMediaIndex = 0;
  }

  window.oldMediaListLength = window.mediaList.length;

  // 通知播放模块恢复播放
  if (settings.isPlaying && settings.autoSwitchMode === "timer") {
    deps.EventBus.emit("requestResumePlayback");
  }

  console.log(`[api] 媒体列表刷新完成，共${window.mediaList.length}个媒体`);
  return window.mediaList;
};
