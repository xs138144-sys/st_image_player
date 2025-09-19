// 正确路径：参考所有正常工作的扩展，核心文件在ST根目录的scripts/下
// 无论扩展在data/default-user/extensions还是third-party/，路径完全相同
import {
  extension_settings,
  eventSource,
  event_types,
} from "../../scripts/extensions.js";
import { saveSettingsDebounced } from "../../scripts/script.js";
import { registerModuleCleanup } from "../../scripts/utils.js";

const EXT_ID = "st_image_player";

// 验证ST实际解析的路径（关键调试）
const logResolvedPath = (relativePath) => {
  const resolvedUrl = new URL(relativePath, window.location.href).href;
  console.log(`[${EXT_ID}] 实际请求路径: ${resolvedUrl}`);
  return resolvedUrl;
};

// 初始化前强制验证核心文件路径
const verifyCorePaths = () => {
  logResolvedPath("../../scripts/extensions.js");
  logResolvedPath("../../scripts/script.js");
  logResolvedPath("../../scripts/utils.js");

  // 额外验证ST根目录下的可能路径（备用）
  logResolvedPath("../../extensions.js");
  logResolvedPath("../../script.js");
  logResolvedPath("../../utils.js");
};

const safeInit = (fn) => {
  try {
    console.log(`[${EXT_ID}] 开始初始化`);
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
  verifyCorePaths(); // 先打印实际请求路径，供你验证

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
