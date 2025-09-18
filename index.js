import { getSettings, saveSafeSettings } from "./settings.js";
import { initUI } from "./ui.js";
import { initMediaPlayer } from "./mediaPlayer.js";
import { initWebSocket } from "./websocket.js";
import { registerAIEventListeners } from "./aiEvents.js";
import { getSafeToastr } from "./utils.js";

// 扩展初始化函数
async function initExtension() {
  const toastr = getSafeToastr();
  const settings = getSettings();

  console.log("[MediaPlayer] 扩展初始化开始");

  try {
    // 初始化媒体播放器
    await initMediaPlayer();

    // 初始化UI
    await initUI();

    // 初始化WebSocket
    if (settings.masterEnabled) {
      initWebSocket();
    }

    // 注册AI事件监听
    if (settings.masterEnabled && !settings.aiEventRegistered) {
      registerAIEventListeners();
    }

    console.log("[MediaPlayer] 扩展初始化完成");
    toastr.success("媒体播放器扩展已加载");
  } catch (e) {
    console.error("[MediaPlayer] 扩展初始化失败:", e);
    toastr.error(`媒体播放器加载失败: ${e.message}`);
  }
}

// SillyTavern扩展注册
if (window.extensions) {
  // 兼容SillyTavern的扩展注册方式
  window.extensions.register({
    name: "st_image_player",
    display_name: "媒体播放器",
    author: "DeepSeek和豆包和反死",
    version: "1.4.1",
    onLoad: initExtension,
    onUnload: () => {
      import("./settings.js").then(({ disableExtension }) =>
        disableExtension()
      );
      console.log("[MediaPlayer] 扩展已卸载");
    },
  });
} else {
  // 兼容旧版本或其他环境
  document.addEventListener("DOMContentLoaded", initExtension);
}

// 全局错误处理
window.addEventListener("error", (e) => {
  console.error("[MediaPlayer] 全局错误:", e.error);
  getSafeToastr().error(`媒体播放器错误: ${e.error.message}`);
});
