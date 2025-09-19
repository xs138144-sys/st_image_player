// 修正核心依赖路径（关键修复：匹配ST实际目录结构）
// 假设核心文件位于ST根目录（与third-party目录同级）
import {
  extension_settings,
  eventSource,
  event_types,
} from "../../extensions.js";
import { saveSettingsDebounced } from "../../script.js";
import { registerModuleCleanup } from "../../utils.js";

// 如果核心文件实际在ST根目录的"scripts/"子目录中（根据错误路径推测的备选方案）
// import { extension_settings, eventSource, event_types } from "../../scripts/extensions.js";
// import { saveSettingsDebounced } from "../../scripts/script.js";
// import { registerModuleCleanup } from "../../scripts/utils.js";

const EXT_ID = "st_image_player"; // 与扩展目录名一致

// 增强路径错误诊断
const checkFileExists = async (path) => {
  try {
    await fetch(path);
    return true;
  } catch {
    return false;
  }
};

// 初始化前先检查核心文件是否存在
const preInitCheck = async () => {
  const coreFiles = [
    "../../extensions.js",
    "../../script.js",
    "../../utils.js",
  ];

  for (const file of coreFiles) {
    const exists = await checkFileExists(file);
    if (!exists) {
      console.error(`[${EXT_ID}] 核心文件缺失: ${file}，请检查路径是否正确`);
      // 尝试提示可能的正确路径
      const alternative = file.replace("../../", "../../scripts/");
      console.warn(`[${EXT_ID}] 尝试备选路径: ${alternative}`);
    }
  }
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

const waitForST = async () => {
  // 先执行文件存在性检查
  await preInitCheck();

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
