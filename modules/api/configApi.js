import { deps } from "../../core/deps.js";

/**
 * 配置API模块 - 负责媒体大小限制和配置更新
 */
export const init = () => {
  console.log(`[configApi] 配置API模块初始化完成`);
  
  // 使用更健壮的初始化方式，避免依赖问题
  try {
    // 延迟检查settings模块，避免初始化时的依赖问题
    setTimeout(() => {
      // 安全检查：确保settings模块已完全初始化
      if (!deps.settings || typeof deps.settings.get !== 'function') {
        console.warn(`[configApi] settings模块未完全初始化，部分功能可能受限`);
      } else {
        console.log(`[configApi] settings模块已正常初始化`);
      }
    }, 500); // 减少延迟时间，快速检查
  } catch (error) {
    console.warn(`[configApi] 初始化过程中出现非致命错误:`, error);
    // 不抛出错误，让模块继续加载
  }
};

export const cleanup = () => {
  console.log(`[configApi] 配置API模块无资源需清理`);
};

/**
 * 更新媒体大小限制
 */
export const updateMediaSizeLimit = async (newLimit) => {
  const settings = deps.settings.get();

  if (!settings.serviceUrl) {
    console.warn(`[configApi] 服务地址未配置，无法更新大小限制`);
    return false;
  }

  try {
    const res = await fetch(`${settings.serviceUrl}/config/size-limit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size_limit: newLimit }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP ${res.status}`);
    }

    const result = await res.json();
    settings.mediaSizeLimit = newLimit;
    deps.settings.save(settings);

    if (deps.toastr && typeof deps.toastr.success === "function") {
      deps.toastr.success(`大小限制已更新: ${newLimit}MB`);
    }

    return true;
  } catch (e) {
    console.error(`[configApi] 更新大小限制失败:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`更新失败: ${e.message}`);
    }
    return false;
  }
};

/**
 * 启动服务状态轮询
 */
export const startServicePolling = () => {
  const settings = deps.settings.get();
  
  if (!settings.serviceUrl) {
    console.warn(`[configApi] 服务地址未配置，无法启动轮询`);
    return;
  }

  // 清除现有轮询
  if (window.servicePollingInterval) {
    clearInterval(window.servicePollingInterval);
  }

  // 启动新轮询
  window.servicePollingInterval = setInterval(async () => {
    try {
      // 直接实现服务状态检查，避免循环依赖
      const settings = deps.settings.get();
      if (!settings.serviceUrl) return;
      
      const res = await fetch(`${settings.serviceUrl}/status`);
      if (res.ok) {
        const status = await res.json();
        deps.EventBus.emit("serviceStatusUpdate", {
          active: status.active,
          observerActive: status.observer_active || false,
          totalCount: status.total_count || 0,
          imageCount: status.image_count || 0,
          videoCount: status.video_count || 0,
          directory: status.directory || "",
          mediaConfig: status.media_config || {},
          error: null,
        });
      }
    } catch (e) {
      console.error(`[configApi] 服务状态轮询失败:`, e);
    }
  }, 30000); // 30秒轮询一次

  console.log(`[configApi] 服务状态轮询已启动`);
};

/**
 * 停止服务状态轮询
 */
export const stopServicePolling = () => {
  if (window.servicePollingInterval) {
    clearInterval(window.servicePollingInterval);
    window.servicePollingInterval = null;
    console.log(`[configApi] 服务状态轮询已停止`);
  }
};

export default {
  init,
  cleanup,
  updateMediaSizeLimit,
  startServicePolling,
  stopServicePolling
};