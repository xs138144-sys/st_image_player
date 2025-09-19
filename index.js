// 完全复用参考脚本的路径规则（向上跳转3级/4级，与参考脚本保持一致）
import {
  extension_settings,
  eventSource,
  event_types,
} from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { registerModuleCleanup } from "../../../../utils.js";

const EXT_ID = "st_image_player";

// 验证路径是否与参考脚本一致（打印实际请求的URL）
const logResolvedPath = (relativePath) => {
  const resolvedUrl = new URL(relativePath, window.location.href).href;
  console.log(`[${EXT_ID}] 实际请求路径: ${resolvedUrl}`);
  return resolvedUrl;
};

// 初始化前验证所有核心文件路径
const verifyCorePaths = () => {
  // 与参考脚本的../../../extensions.js保持一致
  logResolvedPath("../../../extensions.js");
  // 与参考脚本的../../../../script.js保持一致
  logResolvedPath("../../../../script.js");
  logResolvedPath("../../../../utils.js");
};

const safeInit = (fn) => {
  try {
    console.log(`[${EXT_ID}] 开始初始化（路径与参考脚本一致）`);
    fn();
  } catch (error) {
    console.error(`[${EXT_ID}] 初始化失败:`, error);
    eventSource.emit(event_types.EXTENSION_ERROR, {
      id: EXT_ID,
      error: error.message,
      stack: error.stack,
    });
  }
};

const initPlayerExtension = () => {
  if (!extension_settings[EXT_ID]) {
    extension_settings[EXT_ID] = {
      enabled: true,
      lastPlayed: null,
      volume: 0.8,
    };
    saveSettingsDebounced();
  }

  registerModuleCleanup(EXT_ID, () => {
    console.log(`[${EXT_ID}] 执行清理`);
    import("./modules/ui.js")
      .then((m) => m.cleanup?.())
      .catch((err) => console.error(`[${EXT_ID}] ui模块清理失败:`, err));
    import("./modules/mediaPlayer.js")
      .then((m) => m.cleanup?.())
      .catch((err) => console.error(`[${EXT_ID}] 播放器模块清理失败:`, err));
  });

  import("./modules/ui.js")
    .then((ui) => ui.init?.(EXT_ID))
    .catch((err) => console.error(`[${EXT_ID}] 加载ui模块失败:`, err));
  import("./modules/mediaPlayer.js")
    .then((player) => player.init?.(EXT_ID))
    .catch((err) => console.error(`[${EXT_ID}] 加载播放器模块失败:`, err));
};

const waitForST = () => {
  verifyCorePaths(); // 验证路径是否与参考脚本的实际请求一致

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
      console.error(`[${EXT_ID}] 等待ST就绪超时`);
      safeInit(initPlayerExtension);
    }
  }, 15000);
};

waitForST();
