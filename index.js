import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { registerModuleCleanup } from "./modules/utils.js";
const eventSource = deps.utils.getSafeGlobal("eventSource", null);
const event_types = deps.utils.getSafeGlobal("event_types", {});

const EXT_ID = "st_image_player";

// 打印所有核心文件的实际请求路径，重点验证utils.js是否指向子文件夹
const logResolvedPath = (relativePath) => {
  const resolvedUrl = new URL(relativePath, window.location.href).href;
  console.log(`[${EXT_ID}] 验证路径: ${resolvedUrl}`);
  return resolvedUrl;
};

// 初始化前强制检查所有路径
const verifyPaths = () => {
  console.log(`[${EXT_ID}] 开始验证子文件夹路径`);
  logResolvedPath("../../../extensions.js"); // 参考脚本的extensions.js路径
  logResolvedPath("../../../../script.js"); // 参考脚本的script.js路径
  logResolvedPath("./modules/utils.js"); // 验证扩展内部的utils.js路径
};

// 模拟参考脚本的路径逻辑（如果参考脚本的utils.js也在子文件夹）

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
  verifyPaths(); // 验证utils.js是否指向正确的子文件夹

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
