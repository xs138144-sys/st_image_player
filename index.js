import {
  extension_settings,
  eventSource,
  event_types,
} from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { registerModuleCleanup } from "../../../../utils.js";

const EXT_ID = "st_media_player"; // 必须与manifest.json的id完全一致

// 错误捕获包装函数
const safeInit = (fn) => {
  try {
    fn();
  } catch (error) {
    console.error(`[${EXT_ID}] 初始化失败:`, error);
    // 向ST系统报告错误
    eventSource.emit(event_types.EXTENSION_ERROR, {
      id: EXT_ID,
      error: error.message,
      stack: error.stack,
    });
  }
};

// 核心初始化逻辑
const initPlayerExtension = () => {
  // 初始化默认设置
  if (!extension_settings[EXT_ID]) {
    extension_settings[EXT_ID] = {
      enabled: true,
      lastPlayed: null,
      volume: 0.8,
    };
    saveSettingsDebounced();
  }

  // 注册清理函数（ST扩展必需）
  registerModuleCleanup(EXT_ID, () => {
    console.log(`[${EXT_ID}] 清理扩展资源`);
    // 调用UI和播放器的清理方法
    import("./modules/ui.js").then((m) => m.cleanup?.());
    import("./modules/mediaPlayer.js").then((m) => m.cleanup?.());
  });

  // 加载核心模块
  import("./modules/ui.js").then((ui) => ui.init(EXT_ID));
  import("./modules/mediaPlayer.js").then((player) => player.init(EXT_ID));
  console.log(`[${EXT_ID}] 扩展初始化完成`);
};

// 等待ST环境完全就绪
const waitForST = () => {
  if (window.appReady) {
    // 已就绪，直接初始化
    safeInit(initPlayerExtension);
    return;
  }

  // 未就绪，监听ST的就绪事件
  const readyHandler = () => {
    eventSource.removeListener(event_types.APP_READY, readyHandler);
    safeInit(initPlayerExtension);
  };

  // 绑定事件监听（添加超时保护）
  eventSource.on(event_types.APP_READY, readyHandler);
  setTimeout(() => {
    if (!window.appReady) {
      console.error(`[${EXT_ID}] 等待ST就绪超时`);
      eventSource.removeListener(event_types.APP_READY, readyHandler);
    }
  }, 10000); // 10秒超时保护
};

// 启动初始化流程
waitForST();
