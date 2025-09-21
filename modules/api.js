import { deps } from "../core/deps.js";

const MEDIA_REQUEST_THROTTLE = 3000;
let lastMediaRequestTime = 0;
let pollingTimer = null;

// 模块内部状态
let mediaList = [];
let currentMediaIndex = 0;
let oldMediaListLength = 0;

/**
 * 验证目录有效性
 */
const validateDirectory = async (directoryPath) => {
  const settings = deps.settings.get();

  if (!settings.serviceUrl) {
    console.warn(`[api] 服务地址未配置，无法验证目录`);
    return { valid: false, error: "服务未配置" };
  }

  try {
    const response = await fetch(`${settings.serviceUrl}/validate-directory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: directoryPath }),
      signal: AbortSignal.timeout(10000) // 10秒超时
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[api] 目录验证失败:`, error);
    return {
      valid: false,
      error: error.name === 'AbortError' ? '请求超时' : error.message
    };
  }
};

/**
 * 检查服务状态
 */
const checkServiceStatus = async () => {
  const settings = deps.settings.get();
  if (!settings.serviceUrl) {
    console.warn(`[api] 服务地址未配置，无法检查状态`);
    return { active: false, error: "服务地址未配置" };
  }

  try {
    const response = await fetch(`${settings.serviceUrl}/status`, {
      signal: AbortSignal.timeout(8000) // 8秒超时
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
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
  } catch (error) {
    console.error(`[api] 服务检查失败:`, error);
    return {
      active: false,
      error: error.name === 'AbortError' ? '请求超时' : error.message
    };
  }
};

/**
 * 获取媒体列表
 */
const fetchMediaList = async (filterType = "all") => {
  const settings = deps.settings.get();
  if (!settings.serviceUrl) {
    console.warn(`[api] 服务地址未配置，无法获取媒体列表`);
    return [];
  }

  try {
    const response = await fetch(`${settings.serviceUrl}/media?type=${filterType}`, {
      signal: AbortSignal.timeout(15000) // 15秒超时
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.media || [];
  } catch (error) {
    console.error(`[api] 获取媒体列表失败:`, error);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error("获取媒体列表失败，请检查服务连接");
    }
    return [];
  }
};

/**
 * 更新扫描目录
 */
const updateScanDirectory = async (newPath) => {
  const settings = deps.settings.get();

  if (!newPath) {
    if (deps.toastr && typeof deps.toastr.warning === "function") {
      deps.toastr.warning("请输入目录路径");
    }
    return false;
  }

  // 使用后端验证目录
  const validation = await validateDirectory(newPath);
  if (!validation.valid) {
    if (deps.toastr && typeof deps.toastr.warning === "function") {
      deps.toastr.warning(validation.error || "目录无效");
    }
    return false;
  }

  try {
    const response = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: newPath }),
      signal: AbortSignal.timeout(30000) // 30秒超时
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();

    // 更新设置
    deps.settings.update({ serviceDirectory: newPath });

    if (deps.toastr && typeof deps.toastr.success === "function") {
      deps.toastr.success(`目录已更新: ${newPath}`);
    }

    // 刷新媒体列表
    await refreshMediaList();
    return true;
  } catch (error) {
    console.error(`[api] 更新目录失败:`, error);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`更新失败: ${error.name === 'AbortError' ? '请求超时' : error.message}`);
    }
    return false;
  }
};

/**
 * 更新媒体大小限制
 */
const updateMediaSizeLimit = async (imageMaxMb, videoMaxMb) => {
  const settings = deps.settings.get();

  if (imageMaxMb < 1 || imageMaxMb > 50) {
    if (deps.toastr && typeof deps.toastr.warning === "function") {
      deps.toastr.warning("图片大小限制需在 1-50MB 之间");
    }
    return false;
  }

  if (videoMaxMb < 10 || videoMaxMb > 500) {
    if (deps.toastr && typeof deps.toastr.warning === "function") {
      deps.toastr.warning("视频大小限制需在 10-500MB 之间");
    }
    return false;
  }

  try {
    const status = await checkServiceStatus();
    const response = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: settings.serviceDirectory || status.directory,
        image_max_mb: imageMaxMb,
        video_max_mb: videoMaxMb,
      }),
      signal: AbortSignal.timeout(30000) // 30秒超时
    });

    if (!response.ok) {
      throw new Error((await response.json()).message || "更新限制失败");
    }

    // 更新设置
    deps.settings.update({
      mediaConfig: {
        ...settings.mediaConfig,
        image_max_size_mb: imageMaxMb,
        video_max_size_mb: videoMaxMb,
      }
    });

    if (deps.toastr && typeof deps.toastr.success === "function") {
      deps.toastr.success(`大小限制更新: 图片${imageMaxMb}MB | 视频${videoMaxMb}MB`);
    }

    // 刷新媒体列表
    await refreshMediaList();
    return true;
  } catch (error) {
    console.error(`[api] 更新限制失败:`, error);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`更新失败: ${error.name === 'AbortError' ? '请求超时' : error.message}`);
    }
    return false;
  }
};

/**
 * 清理无效媒体
 */
const cleanupInvalidMedia = async () => {
  const settings = deps.settings.get();

  if (!settings.serviceUrl) {
    console.warn(`[api] 服务地址未配置，无法清理无效媒体`);
    return null;
  }

  try {
    const response = await fetch(`${settings.serviceUrl}/cleanup`, {
      method: "POST",
      signal: AbortSignal.timeout(30000) // 30秒超时
    });

    if (!response.ok) {
      throw new Error("清理请求失败");
    }

    const data = await response.json();
    if (deps.toastr && typeof deps.toastr.success === "function") {
      deps.toastr.success(
        `清理完成: 移除${data.removed}个无效文件，剩余${data.remaining_total}个`
      );
    }

    // 刷新媒体列表
    await refreshMediaList();
    return data;
  } catch (error) {
    console.error(`[api] 清理媒体失败:`, error);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`清理失败: ${error.name === 'AbortError' ? '请求超时' : error.message}`);
    }
    return null;
  }
};

/**
 * 刷新媒体列表
 */
const refreshMediaList = async (filterType) => {
  const settings = deps.settings.get();
  const now = Date.now();
  const targetFilter = filterType || settings.mediaFilter;

  // 节流控制
  if (now - lastMediaRequestTime < MEDIA_REQUEST_THROTTLE) {
    console.log(`[api] 媒体列表请求节流，返回缓存`);
    return mediaList;
  }

  lastMediaRequestTime = now;

  try {
    // 拉取最新列表
    mediaList = await fetchMediaList(targetFilter);

    // 确保设置对象中的属性存在
    const updatedSettings = { ...settings };
    if (!updatedSettings.randomMediaList) updatedSettings.randomMediaList = [];
    if (!updatedSettings.randomPlayedIndices) updatedSettings.randomPlayedIndices = [];

    updatedSettings.randomMediaList = [...mediaList];

    // 列表状态处理
    if (mediaList.length === 0) {
      currentMediaIndex = 0;
      updatedSettings.randomPlayedIndices = [];
      updatedSettings.currentRandomIndex = -1;

      if (deps.toastr && typeof deps.toastr.warning === "function") {
        deps.toastr.warning(`当前筛选无可用${targetFilter}媒体，请检查目录或筛选条件`);
      }
    } else if (mediaList.length !== oldMediaListLength) {
      currentMediaIndex = 0;
      updatedSettings.randomPlayedIndices = [];
      updatedSettings.currentRandomIndex = -1;
    }

    oldMediaListLength = mediaList.length;

    // 保存设置
    deps.settings.update(updatedSettings);

    // 通知播放模块恢复播放
    if (settings.isPlaying && settings.autoSwitchMode === "timer") {
      deps.EventBus.emit("requestResumePlayback");
    }

    console.log(`[api] 媒体列表刷新完成，共${mediaList.length}个媒体`);
    return mediaList;
  } catch (error) {
    console.error(`[api] 刷新媒体列表失败:`, error);
    return mediaList; // 返回之前的列表
  }
};

/**
 * 启动服务状态轮询
 */
const startServicePolling = () => {
  const settings = deps.settings.get();

  // 清除旧定时器
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }

  // 启动新轮询
  pollingTimer = setInterval(() => {
    if (settings.masterEnabled) {
      checkServiceStatus().then((status) => {
        deps.EventBus.emit("serviceStatusPolled", status);
      });
    }
  }, settings.pollingInterval || 30000);
};

/**
 * 初始化API模块
 */
const init = () => {
  try {
    console.log(`[api] 模块初始化开始`);

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

    // 启动服务轮询
    startServicePolling();

    // 保存取消监听方法
    window.apiEventListeners = [
      removeRefreshListener,
      removeCleanupListener,
      removeUpdateDirListener,
      removeUpdateSizeListener,
      removeStatusListener,
    ];

    console.log(`[api] 初始化完成，已注册事件监听`);
  } catch (e) {
    console.error(`[api] 初始化错误:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[api] 初始化失败: ${e.message}`);
    }
  }
};

/**
 * 清理API模块
 */
const cleanup = () => {
  try {
    console.log(`[api] 开始清理资源`);

    // 清除轮询定时器
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }

    // 取消事件监听
    if (window.apiEventListeners) {
      window.apiEventListeners.forEach((removeListener) => {
        if (typeof removeListener === "function") {
          removeListener();
        }
      });
      window.apiEventListeners = null;
    }

    // 重置模块状态
    mediaList = [];
    currentMediaIndex = 0;
    oldMediaListLength = 0;
    lastMediaRequestTime = 0;

    console.log(`[api] 资源清理完成`);
  } catch (e) {
    console.error(`[api] 清理错误:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[api] 清理失败: ${e.message}`);
    }
  }
};

// 创建API模块对象
const apiModule = {
  init,
  cleanup,
  checkServiceStatus,
  fetchMediaList,
  updateScanDirectory,
  updateMediaSizeLimit,
  cleanupInvalidMedia,
  refreshMediaList,
  validateDirectory
};

// 明确导出所有方法
export default apiModule;
export {
  init,
  cleanup,
  checkServiceStatus,
  fetchMediaList,
  updateScanDirectory,
  updateMediaSizeLimit,
  cleanupInvalidMedia,
  refreshMediaList,
  validateDirectory
};