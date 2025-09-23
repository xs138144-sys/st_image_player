import { deps } from "../../core/deps.js";

/**
 * 旧模块适配器 - 提供向后兼容性支持
 */
export const init = () => {
  console.log(`[legacyModuleAdapter] 旧模块适配器初始化完成`);
  
  // 注册旧模块名称到新模块的映射
  registerLegacyModules();
};

export const cleanup = () => {
  console.log(`[legacyModuleAdapter] 旧模块适配器清理完成`);
};

/**
 * 注册旧模块到新模块的映射
 */
const registerLegacyModules = () => {
  // 注册旧utils模块
  if (!deps.getModule('utils')) {
    const legacyUtils = createLegacyUtilsAdapter();
    deps.registerModule('utils', legacyUtils);
    console.log(`[legacyModuleAdapter] 已注册旧utils模块适配器`);
  }
  
  // 注册旧settings模块
  if (!deps.getModule('settings')) {
    const legacySettings = createLegacySettingsAdapter();
    deps.registerModule('settings', legacySettings);
    console.log(`[legacyModuleAdapter] 已注册旧settings模块适配器`);
  }
  
  // 注册旧api模块
  if (!deps.getModule('api')) {
    const legacyApi = createLegacyApiAdapter();
    deps.registerModule('api', legacyApi);
    console.log(`[legacyModuleAdapter] 已注册旧api模块适配器`);
  }
};

/**
 * 创建旧utils模块适配器
 */
const createLegacyUtilsAdapter = () => {
  return {
    init: () => console.log(`[legacyUtils] 旧utils模块适配器初始化`),
    cleanup: () => console.log(`[legacyUtils] 旧utils模块适配器清理`),
    
    // 时间相关函数
    formatTime: (seconds) => deps.timeUtils.formatTime(seconds),
    formatDuration: (seconds) => deps.timeUtils.formatDuration(seconds),
    createThrottle: (func, wait) => deps.timeUtils.createThrottle(func, wait),
    createDebounce: (func, wait) => deps.timeUtils.createDebounce(func, wait),
    sleep: (ms) => deps.timeUtils.sleep(ms),
    timeSince: (date) => deps.timeUtils.timeSince(date),
    
    // DOM相关函数
    safeJQuery: (callback) => deps.domUtils.safeJQuery(callback),
    getSafeGlobal: (name, defaultValue) => deps.domUtils.getSafeGlobal(name, defaultValue),
    elementExists: (selector) => deps.domUtils.elementExists(selector),
    createElement: (tagName, attributes, innerHTML) => deps.domUtils.createElement(tagName, attributes, innerHTML),
    addStyles: (css, id) => deps.domUtils.addStyles(css, id),
    removeStyles: (id) => deps.domUtils.removeStyles(id),
    toggleElement: (selector, show) => deps.domUtils.toggleElement(selector, show),
    toggleClass: (selector, className, add) => deps.domUtils.toggleClass(selector, className, add),
    
    // 其他函数
    adjustVideoControlsLayout: () => {
      console.warn(`[legacyUtils] adjustVideoControlsLayout 函数需要从原utils.js迁移`);
    },
    applyTransitionEffect: () => {
      console.warn(`[legacyUtils] applyTransitionEffect 函数需要从原utils.js迁移`);
    },
    isDirectoryValid: () => {
      console.warn(`[legacyUtils] isDirectoryValid 函数需要从原utils.js迁移`);
    }
  };
};

/**
 * 创建旧settings模块适配器
 */
const createLegacySettingsAdapter = () => {
  return {
    init: () => console.log(`[legacySettings] 旧settings模块适配器初始化`),
    cleanup: () => console.log(`[legacySettings] 旧settings模块适配器清理`),
    
    get: (key) => {
      // 避免循环依赖，直接访问底层设置存储
      const settingsModule = deps.getModule('modules/settings/settingsManager') || deps.getModule('settings');
      if (settingsModule && typeof settingsModule.get === 'function') {
        return settingsModule.get(key);
      }
      console.warn('[legacySettings] 无法获取设置，使用回退方案');
      return {};
    },
    update: (updates) => {
      const settingsModule = deps.getModule('modules/settings/settingsManager') || deps.getModule('settings');
      if (settingsModule && typeof settingsModule.update === 'function') {
        return settingsModule.update(updates);
      }
      console.warn('[legacySettings] 无法更新设置');
    },
    save: (settings) => {
      const settingsModule = deps.getModule('modules/settings/settingsManager') || deps.getModule('settings');
      if (settingsModule && typeof settingsModule.save === 'function') {
        return settingsModule.save(settings);
      }
      console.warn('[legacySettings] 无法保存设置');
    },
    reset: () => {
      const settingsModule = deps.getModule('modules/settings/settingsManager') || deps.getModule('settings');
      if (settingsModule && typeof settingsModule.reset === 'function') {
        return settingsModule.reset();
      }
      console.warn('[legacySettings] 无法重置设置');
    },
    isInitialized: () => {
      const settingsModule = deps.getModule('modules/settings/settingsManager') || deps.getModule('settings');
      if (settingsModule && typeof settingsModule.isInitialized === 'function') {
        return settingsModule.isInitialized();
      }
      return false;
    },
    
    migrateSettings: () => {
      console.warn(`[legacySettings] migrateSettings 函数需要从原settings.js迁移`);
      return deps.settings.get();
    },
    cleanup: () => {
      console.warn(`[legacySettings] cleanup 函数需要从原settings.js迁移`);
    }
  };
};

/**
 * 创建旧api模块适配器
 */
const createLegacyApiAdapter = () => {
  return {
    init: () => console.log(`[legacyApi] 旧api模块适配器初始化`),
    cleanup: () => console.log(`[legacyApi] 旧api模块适配器清理`),
    
    checkServiceStatus: () => deps.serviceApi.checkServiceStatus(),
    validateDirectory: (directoryPath) => deps.serviceApi.validateDirectory(directoryPath),
    updateScanDirectory: (newPath) => deps.serviceApi.updateScanDirectory(newPath),
    fetchMediaList: (filterType) => deps.mediaApi.fetchMediaList(filterType),
    refreshMediaList: (filterType) => deps.mediaApi.refreshMediaList(filterType),
    cleanupInvalidMedia: () => deps.mediaApi.cleanupInvalidMedia(),
    updateMediaSizeLimit: (newLimit) => {
      if (deps.configApi && typeof deps.configApi.updateMediaSizeLimit === 'function') {
        return deps.configApi.updateMediaSizeLimit(newLimit);
      }
      console.warn('[legacyApi] configApi未就绪，无法更新大小限制');
      return false;
    },
    startServicePolling: () => {
      if (deps.configApi && typeof deps.configApi.startServicePolling === 'function') {
        return deps.configApi.startServicePolling();
      }
      console.warn('[legacyApi] configApi未就绪，无法启动轮询');
    },
    stopServicePolling: () => {
      if (deps.configApi && typeof deps.configApi.stopServicePolling === 'function') {
        return deps.configApi.stopServicePolling();
      }
      console.warn('[legacyApi] configApi未就绪，无法停止轮询');
    },
    
    // 其他函数
    init: () => {
      console.warn(`[legacyApi] init 函数需要从原api.js迁移`);
    },
    cleanup: () => {
      console.warn(`[legacyApi] cleanup 函数需要从原api.js迁移`);
    }
  };
};

export default {
  init,
  cleanup
};