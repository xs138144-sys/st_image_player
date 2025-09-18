const $ = window.jQuery || window.$;

import { getSettings, saveSafeSettings } from "./settings.js";
import { initUI } from "./ui.js";
import { initMediaPlayer } from "./mediaPlayer.js";
import { initWebSocket } from "./websocket.js";
import { registerAIEventListeners } from "./aiEvents.js";
import { getSafeToastr, safeJQuery } from "./utils.js";

async function initExtension() {
  const toastr = getSafeToastr();
  const settings = getSettings();

  console.log("[MediaPlayer] 扩展初始化开始");

  try {
    // 确保jQuery可用后再初始化UI
    safeJQuery(async () => {
      await initMediaPlayer();
      await initUI();

      if (settings.masterEnabled) {
        initWebSocket();
      }

      if (settings.masterEnabled && !settings.aiEventRegistered) {
        registerAIEventListeners();
      }

      console.log("[MediaPlayer] 扩展初始化完成");
      toastr.success("媒体播放器扩展已加载");
    });
  } catch (e) {
    console.error("[MediaPlayer] 扩展初始化失败:", e);
    toastr.error(`媒体播放器加载失败: ${e.message}`);
  }
}

// 安全启动
if (typeof $ !== "undefined") {
  initExtension();
} else {
  console.warn("[MediaPlayer] jQuery not defined, waiting...");
  let jQueryRetry = 0;
  const waitForjQuery = setInterval(() => {
    if (typeof $ !== "undefined" || jQueryRetry > 10) {
      clearInterval(waitForjQuery);
      if (typeof $ !== "undefined") {
        initExtension();
      } else {
        console.error("[MediaPlayer] jQuery not available after 10s");
      }
    }
    jQueryRetry++;
  }, 500);
}

// 全局错误处理
window.addEventListener("error", (e) => {
  console.error("[MediaPlayer] 全局错误:", e.error);
  getSafeToastr().error(`媒体播放器错误: ${e.error.message}`);
});
