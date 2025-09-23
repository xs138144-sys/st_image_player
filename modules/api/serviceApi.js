import { deps } from "../../core/deps.js";

/**
 * 服务API模块 - 负责服务状态检查和目录验证
 */
export const init = () => {
  console.log(`[serviceApi] 服务API模块初始化完成`);
};

export const cleanup = () => {
  console.log(`[serviceApi] 服务API模块无资源需清理`);
};

/**
 * 检查服务状态
 */
export const checkServiceStatus = async () => {
  const settings = deps.settings.get();
  if (!settings.serviceUrl) {
    console.warn(`[serviceApi] 服务地址未配置，无法检查状态`);
    return { active: false, error: "服务地址未配置" };
  }

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
    console.error(`[serviceApi] 服务检查失败:`, e);
    return { active: false, error: e.message };
  }
};

/**
 * 验证目录有效性
 */
export const validateDirectory = async (directoryPath) => {
  const settings = deps.settings.get();

  if (!settings.serviceUrl) {
    console.warn(`[serviceApi] 服务地址未配置，无法验证目录`);
    return { valid: false, error: "服务未配置" };
  }

  try {
    const res = await fetch(`${settings.serviceUrl}/validate-directory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: directoryPath }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (e) {
    console.error(`[serviceApi] 目录验证失败:`, e);
    return { valid: false, error: e.message };
  }
};

/**
 * 更新扫描目录
 */
export const updateScanDirectory = async (newPath) => {
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

  if (!settings.serviceUrl) {
    console.warn(`[serviceApi] 服务地址未配置，无法更新目录`);
    return false;
  }

  try {
    const res = await fetch(`${settings.serviceUrl}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: newPath }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || errorData.error || `HTTP ${res.status}`);
    }

    const result = await res.json();

    settings.serviceDirectory = newPath;
    deps.settings.save(settings);

    if (deps.toastr && typeof deps.toastr.success === "function") {
      deps.toastr.success(`目录已更新: ${newPath}`);
    }

    return true;
  } catch (e) {
    console.error(`[serviceApi] 更新目录失败:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`更新失败: ${e.message}`);
    }
    return false;
  }
};

export default {
  init,
  cleanup,
  checkServiceStatus,
  validateDirectory,
  updateScanDirectory
};