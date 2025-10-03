// startup.js - 媒体播放器扩展启动脚本
// 确保正确的模块加载顺序，避免循环依赖

const EXT_ID = "st_image_player";

/**
 * 初始化基础依赖管理器
 */
function initializeDeps() {
  // 创建基础deps对象
  const deps = {
    modules: {},
    
    registerModule: function(name, module) {
      if (!name || typeof name !== 'string') {
        console.error('[deps] 模块名称无效', name);
        return;
      }
      this.modules[name] = module;
      console.log(`[deps] 模块已注册: ${name}`);
    },
    
    getModule: function(name) {
      return this.modules[name] || null;
    },
    
    // 基础toastr实现
    get toastr() {
      if (window.toastr && typeof window.toastr.success === 'function') {
        return window.toastr;
      }
      return {
        success: (msg) => console.log(`SUCCESS: ${msg}`),
        info: (msg) => console.info(`INFO: ${msg}`),
        warning: (msg) => console.warn(`WARNING: ${msg}`),
        error: (msg) => console.error(`ERROR: ${msg}`),
      };
    },
    
    // 基础EventBus实现
    get EventBus() {
      if (window.EventBus && typeof window.EventBus.on === 'function') {
        return window.EventBus;
      }
      return {
        on: (event, callback) => {
          console.log(`[EventBus] 注册事件: ${event}`);
          if (!window._eventBusListeners) window._eventBusListeners = {};
          if (!window._eventBusListeners[event]) window._eventBusListeners[event] = [];
          window._eventBusListeners[event].push(callback);
        },
        emit: (event, data) => {
          console.log(`[EventBus] 触发事件: ${event}`, data);
          if (window._eventBusListeners && window._eventBusListeners[event]) {
            window._eventBusListeners[event].forEach(callback => {
              try {
                callback(data);
              } catch (e) {
                console.error(`[EventBus] 事件处理错误: ${event}`, e);
              }
            });
          }
        },
        off: (event, callback) => {
          if (window._eventBusListeners && window._eventBusListeners[event]) {
            const index = window._eventBusListeners[event].indexOf(callback);
            if (index > -1) {
              window._eventBusListeners[event].splice(index, 1);
            }
          }
        }
      };
    },
    
    // 基础扩展设置
    get extension_settings() {
      if (!window.extension_settings) {
        window.extension_settings = {};
      }
      if (!window.extension_settings[EXT_ID]) {
        window.extension_settings[EXT_ID] = {
          enabled: true,
          lastPlayed: null,
          volume: 0.8,
          masterEnabled: true,
          isWindowVisible: true,
          playMode: "random",
          autoSwitchMode: "detect",
          showVideoControls: true,
          customVideoControls: {
            showProgress: true,
            showVolume: true,
            showLoop: true,
            showTime: true
          },
          videoVolume: 0.8,
          videoLoop: false,
          hideBorder: false,
          showInfo: true,
          isLocked: false,
          mediaFilter: "all",
          isPlaying: false,
          serviceDirectory: "",
          serviceUrl: "http://127.0.0.1:9000",
          mediaConfig: {
            image_max_size_mb: 5,
            video_max_size_mb: 100,
            preload_strategy: {
              image: true,
              video: false
            }
          },
          pollingInterval: 30000,
          websocket_timeout: 10000,
          transitionEffect: "fade",
          randomPlayedIndices: [],
          config_version: "1.4.2"
        };
      }
      return window.extension_settings;
    },
    
    // 基础保存设置方法
    saveSettingsDebounced: function() {
      console.log('[deps] 保存设置（基础实现）');
      // 基础实现，后续会被完整版本替换
    }
  };
  
  // 设置全局deps对象
  window.deps = deps;
  console.log('[startup] 基础deps对象初始化完成');
  return deps;
}

/**
 * 加载模块加载器
 */
function loadModuleLoader() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './core/moduleLoader.js';
    script.type = 'module';
    
    script.onload = () => {
      console.log('[startup] 模块加载器加载完成');
      if (window.moduleLoader) {
        resolve(window.moduleLoader);
      } else {
        reject(new Error('模块加载器未正确导出'));
      }
    };
    
    script.onerror = (error) => {
      reject(new Error(`模块加载器加载失败: ${error}`));
    };
    
    document.head.appendChild(script);
  });
}

/**
 * 加载deps.js模块
 */
function loadDepsModule(moduleLoader) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './core/deps.js';
    script.type = 'module';
    
    script.onload = () => {
      console.log('[startup] deps.js模块加载完成');
      // deps.js应该已经通过ES6模块导出了完整的deps对象
      if (window.deps && window.deps.registerModule) {
        resolve(window.deps);
      } else {
        reject(new Error('deps.js模块未正确导出'));
      }
    };
    
    script.onerror = (error) => {
      reject(new Error(`deps.js模块加载失败: ${error}`));
    };
    
    document.head.appendChild(script);
  });
}

/**
 * 主启动函数
 */
async function startExtension() {
  console.log('[startup] 开始启动媒体播放器扩展');
  
  try {
    // 1. 初始化基础deps对象
    const baseDeps = initializeDeps();
    
    // 2. 加载模块加载器
    const moduleLoader = await loadModuleLoader();
    
    // 3. 加载完整的deps.js模块
    const fullDeps = await loadDepsModule(moduleLoader);
    
    // 4. 合并基础deps和完整deps
    Object.assign(baseDeps, fullDeps);
    
    console.log('[startup] 所有基础模块加载完成，开始加载业务模块');
    
    // 5. 加载主入口文件
    const mainScript = document.createElement('script');
    mainScript.src = './index.js';
    mainScript.type = 'module';
    
    mainScript.onload = () => {
      console.log('[startup] 主入口文件加载完成');
    };
    
    mainScript.onerror = (error) => {
      console.error('[startup] 主入口文件加载失败:', error);
    };
    
    document.head.appendChild(mainScript);
    
  } catch (error) {
    console.error('[startup] 扩展启动失败:', error);
    
    // 显示错误信息
    if (window.deps && window.deps.toastr) {
      window.deps.toastr.error(`扩展启动失败: ${error.message}`);
    }
  }
}

// 等待DOM加载完成后启动扩展
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startExtension);
} else {
  startExtension();
}