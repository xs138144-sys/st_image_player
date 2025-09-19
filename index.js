// 修正核心依赖的路径（关键修复：根据ST扩展目录结构调整相对路径）
import {
  extension_settings,
  eventSource,
  event_types,
} from "../../extensions.js";
import { saveSettingsDebounced } from "../../script.js";
import { registerModuleCleanup } from "../../utils.js"; // 修复utils.js的路径

const EXT_ID = "st_image_player"; // 与控制台检测到的扩展ID完全一致

// 增强错误日志，明确记录路径问题
const safeInit = (fn) => {
  try {
    console.log(`[${EXT_ID}] 开始初始化，依赖路径已修正`);
    fn();
  } catch (error) {
    console.error(`[${EXT_ID}] 初始化失败:`, error);
    // 区分路径错误和其他错误
    if (error.message.includes("Failed to fetch dynamically imported module")) {
      console.error(
        `[${EXT_ID}] 可能是模块路径错误，请检查ui.js和mediaPlayer.js的位置`
      );
    }
    eventSource.emit(event_types.EXTENSION_ERROR, {
      id: EXT_ID,
      error: error.message,
      stack: error.stack,
    });
  }
};

const initPlayerExtension = () => {
  // 初始化默认设置
  if (!extension_settings[EXT_ID]) {
    extension_settings[EXT_ID] = {
      enabled: true,
      lastPlayed: null,
      volume: 0.8,
    };
    saveSettingsDebounced();
    console.log(`[${EXT_ID}] 默认设置初始化完成`);
  }

  // 注册清理函数（确保utils.js已正确加载）
  registerModuleCleanup(EXT_ID, () => {
    console.log(`[${EXT_ID}] 执行清理`);
    import("./modules/ui.js")
      .then((m) => m.cleanup?.())
      .catch((err) => console.error(`[${EXT_ID}] 加载ui.js失败:`, err));
    import("./modules/mediaPlayer.js")
      .then((m) => m.cleanup?.())
      .catch((err) =>
        console.error(`[${EXT_ID}] 加载mediaPlayer.js失败:`, err)
      );
  });

  // 加载核心模块（确保路径正确）
  import("./modules/ui.js")
    .then((ui) => {
      if (ui.init) ui.init(EXT_ID);
      else console.error(`[${EXT_ID}] ui.js缺少init方法`);
    })
    .catch((err) => console.error(`[${EXT_ID}] ui.js路径错误:`, err));

  import("./modules/mediaPlayer.js")
    .then((player) => {
      if (player.init) player.init(EXT_ID);
      else console.error(`[${EXT_ID}] mediaPlayer.js缺少init方法`);
    })
    .catch((err) => console.error(`[${EXT_ID}] mediaPlayer.js路径错误:`, err));
};

// 等待ST就绪（简化逻辑，确保兼容性）
const waitForST = () => {
  if (window.appReady) {
    safeInit(initPlayerExtension);
    return;
  }

  const readyHandler = () => {
    eventSource.removeListener(event_types.APP_READY, readyHandler);
    safeInit(initPlayerExtension);
  };

  eventSource.on(event_types.APP_READY, readyHandler);
  setTimeout(() => {
    if (!window.appReady) {
      console.error(`[${EXT_ID}] 等待ST超时，尝试强制初始化`);
      safeInit(initPlayerExtension);
    }
  }, 15000);
};

waitForST();
