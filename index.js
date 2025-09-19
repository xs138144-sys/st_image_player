import {
  extension_settings,
  eventSource,
  event_types,
} from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { registerModuleCleanup } from "../../../../utils.js";

const EXT_ID = "st_image_player"; // 与manifest.json的id完全一致（关键修复）

// 增强版错误捕获（添加更详细的日志）
const safeInit = (fn) => {
  try {
    console.log(`[${EXT_ID}] 开始初始化扩展`);
    fn();
  } catch (error) {
    console.error(`[${EXT_ID}] 初始化失败（详细错误）:`, error);
    // 向ST系统报告错误（包含更完整信息）
    eventSource.emit(event_types.EXTENSION_ERROR, {
      id: EXT_ID,
      error: error.message,
      stack: error.stack,
      phase: "初始化阶段",
    });
  }
};

// 核心初始化逻辑
const initPlayerExtension = () => {
  console.log(`[${EXT_ID}] 进入核心初始化逻辑`);

  // 初始化默认设置（兼容旧配置）
  if (!extension_settings[EXT_ID]) {
    // 如果存在旧ID的配置，迁移过来（避免用户设置丢失）
    if (extension_settings["st_media_player"]) {
      extension_settings[EXT_ID] = { ...extension_settings["st_media_player"] };
      delete extension_settings["st_media_player"];
    } else {
      extension_settings[EXT_ID] = {
        enabled: true,
        lastPlayed: null,
        volume: 0.8,
      };
    }
    saveSettingsDebounced();
    console.log(`[${EXT_ID}] 初始化默认设置完成`);
  }

  // 注册清理函数（ST扩展必需）
  registerModuleCleanup(EXT_ID, () => {
    console.log(`[${EXT_ID}] 执行清理逻辑`);
    import("./modules/ui.js")
      .then((m) => {
        if (m.cleanup) m.cleanup();
        else console.warn(`[${EXT_ID}] ui模块缺少cleanup方法`);
      })
      .catch((err) => console.error(`[${EXT_ID}] 清理ui模块失败:`, err));

    import("./modules/mediaPlayer.js")
      .then((m) => {
        if (m.cleanup) m.cleanup();
        else console.warn(`[${EXT_ID}] player模块缺少cleanup方法`);
      })
      .catch((err) => console.error(`[${EXT_ID}] 清理player模块失败:`, err));
  });

  // 加载核心模块（添加加载失败捕获）
  import("./modules/ui.js")
    .then((ui) => {
      if (ui.init) {
        ui.init(EXT_ID);
        console.log(`[${EXT_ID}] ui模块初始化完成`);
      } else {
        console.error(`[${EXT_ID}] ui模块缺少init方法`);
      }
    })
    .catch((err) => console.error(`[${EXT_ID}] 加载ui模块失败:`, err));

  import("./modules/mediaPlayer.js")
    .then((player) => {
      if (player.init) {
        player.init(EXT_ID);
        console.log(`[${EXT_ID}] player模块初始化完成`);
      } else {
        console.error(`[${EXT_ID}] player模块缺少init方法`);
      }
    })
    .catch((err) => console.error(`[${EXT_ID}] 加载player模块失败:`, err));

  console.log(`[${EXT_ID}] 扩展初始化流程完成`);
};

// 等待ST环境完全就绪（增强版）
const waitForST = () => {
  console.log(`[${EXT_ID}] 开始等待ST就绪`);

  if (window.appReady) {
    console.log(`[${EXT_ID}] 检测到ST已就绪，立即初始化`);
    safeInit(initPlayerExtension);
    return;
  }

  const readyHandler = () => {
    console.log(`[${EXT_ID}] 接收到ST的APP_READY事件`);
    eventSource.removeListener(event_types.APP_READY, readyHandler);
    safeInit(initPlayerExtension);
  };

  eventSource.on(event_types.APP_READY, readyHandler);
  console.log(`[${EXT_ID}] 已注册APP_READY事件监听`);

  // 超时保护（延长至15秒，适配较慢的环境）
  setTimeout(() => {
    if (!window.appReady) {
      console.error(`[${EXT_ID}] 等待ST就绪超时（15秒）`);
      eventSource.removeListener(event_types.APP_READY, readyHandler);
      // 尝试强制初始化（最后手段）
      safeInit(initPlayerExtension);
    }
  }, 15000);
};

// 启动初始化流程
waitForST();
