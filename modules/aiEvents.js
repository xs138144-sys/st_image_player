// aiEvents.js 修复版本
import { deps } from "../core/deps.js";

const { EventBus, utils } = deps;
const { safeDebounce, getSafeGlobal } = utils;

let eventListeners = [];
let aiEventRegistered = false;

/**
 * 初始化AI事件监听
 */
export const init = () => {
  try {
    console.log(`[aiEvents] 模块初始化开始`);

    // 重置注册状态
    aiEventRegistered = false;

    // 注册AI事件监听器
    registerAIEventListeners();

    console.log(`[aiEvents] 模块初始化完成`);
  } catch (e) {
    console.error(`[aiEvents] 初始化错误:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[aiEvents] 初始化失败: ${e.message}`);
    }
  }
};

/**
 * 清理AI事件模块资源
 */
export const cleanup = () => {
  try {
    console.log(`[aiEvents] 开始清理资源`);

    // 清理本地事件监听器
    eventListeners.forEach(removeListener => {
      try {
        if (typeof removeListener === "function") {
          removeListener();
        }
      } catch (e) {
        console.error('[aiEvents] 移除监听器异常:', e);
      }
    });
    eventListeners = [];

    // 清理全局事件监听器
    if (window.aiEventListeners && Array.isArray(window.aiEventListeners)) {
      window.aiEventListeners.forEach(removeListener => {
        try {
          if (typeof removeListener === "function") {
            removeListener();
          }
        } catch (e) {
          console.error('[aiEvents] 移除全局监听器异常:', e);
        }
      });
      window.aiEventListeners = [];
    }

    // 重置注册状态
    aiEventRegistered = false;

    console.log(`[aiEvents] 资源清理完成`);
  } catch (e) {
    console.error(`[aiEvents] 清理错误:`, e);
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[aiEvents] 清理失败: ${e.message}`);
    }
  }
};

/**
 * 检查是否应该跳过切换
 */
const shouldSkipSwitch = () => {
  const settings = deps.settings.get();

  // 检查基本条件
  if (!settings.masterEnabled ||
    !settings.isWindowVisible ||
    settings.autoSwitchMode !== "detect") {
    return true;
  }

  // 检查媒体状态
  const mediaState = deps.mediaPlayer?.getMediaState?.();
  if (!mediaState) return true;

  // 加载中跳过
  if (mediaState.isLoading) return true;

  // 视频未结束跳过
  if (mediaState.type === "video" &&
    mediaState.currentTime < mediaState.duration - 1) {
    console.log(`[aiEvents] 视频未播放完毕，跳过切换`);
    return true;
  }

  // 视频循环中跳过
  if (mediaState.type === "video" && mediaState.isLooping) {
    console.log(`[aiEvents] 视频循环中，跳过切换`);
    return true;
  }

  return false;
};

/**
 * AI回复处理函数
 */
const onAIResponse = safeDebounce(() => {
  const settings = deps.settings.get();

  if (!settings.aiDetectEnabled || shouldSkipSwitch()) {
    return;
  }

  // 冷却时间检查
  const now = Date.now();
  if (now - (settings.lastAISwitchTime || 0) < (settings.aiResponseCooldown || 3000)) {
    return;
  }

  // 触发切换
  deps.settings.update({ lastAISwitchTime: now });
  deps.EventBus.emit("requestMediaPlay", { direction: "next" });
  console.log(`[aiEvents] AI回复触发媒体切换`);
}, 100);

/**
 * 玩家消息处理函数
 */
const onPlayerMessage = safeDebounce(() => {
  const settings = deps.settings.get();

  if (!settings.playerDetectEnabled || shouldSkipSwitch()) {
    return;
  }

  // 冷却时间检查
  const now = Date.now();
  if (now - (settings.lastAISwitchTime || 0) < (settings.aiResponseCooldown || 3000)) {
    return;
  }

  // 触发切换
  deps.settings.update({ lastAISwitchTime: now });
  deps.EventBus.emit("requestMediaPlay", { direction: "next" });
  console.log(`[aiEvents] 玩家消息触发媒体切换`);
}, 100);

/**
 * 检查AI事件依赖是否就绪
 */
const checkDependencies = () => {
  try {
    // 检查SillyTavern事件系统
    const eventSource = getSafeGlobal("eventSource", null);
    const event_types = getSafeGlobal("event_types", {});

    // 检查聊天区域DOM元素
    const $ = deps.jQuery;
    const hasChatElements = $ && (
      $("#send_but").length > 0 ||
      $("#chat").length > 0 ||
      $(".mes").length > 0
    );

    const hasEventSource = !!eventSource;
    const hasEventTypes = Object.keys(event_types).length > 0;

    console.log(
      `[aiEvents] 依赖检查: eventSource=${hasEventSource}, event_types=${hasEventTypes}, chatElements=${hasChatElements}`
    );

    return hasEventSource && hasEventTypes && hasChatElements;
  } catch (e) {
    console.error(`[aiEvents] 依赖检查失败:`, e);
    return false;
  }
};

/**
 * 绑定AI事件（兼容多种绑定方式）
 */
const bindAIEvents = () => {
  try {
    const eventSource = getSafeGlobal("eventSource", null);
    const event_types = getSafeGlobal("event_types", {});
    const $ = deps.jQuery;

    if (!eventSource || !$) {
      console.error(`[aiEvents] 事件源或jQuery不可用`);
      return false;
    }

    // 获取事件类型
    const aiEvent = event_types.MESSAGE_RECEIVED || "messageReceived";
    const playerEvent = event_types.MESSAGE_SENT || "messageSent";

    console.log(`[aiEvents] 使用事件: AI=${aiEvent}, Player=${playerEvent}`);

    // 绑定AI回复事件
    const aiListener = () => onAIResponse();
    if (typeof eventSource.addEventListener === "function") {
      eventSource.addEventListener(aiEvent, aiListener);
      eventListeners.push(() => eventSource.removeEventListener(aiEvent, aiListener));
    } else if (typeof eventSource.on === "function") {
      eventSource.on(aiEvent, aiListener);
      eventListeners.push(() => eventSource.off(aiEvent, aiListener));
    }

    // 绑定玩家消息事件
    const playerListener = () => onPlayerMessage();
    if (typeof eventSource.addEventListener === "function") {
      eventSource.addEventListener(playerEvent, playerListener);
      eventListeners.push(() => eventSource.removeEventListener(playerEvent, playerListener));
    } else if (typeof eventSource.on === "function") {
      eventSource.on(playerEvent, playerListener);
      eventListeners.push(() => eventSource.off(playerEvent, playerListener));
    }

    // 额外监听SillyTavern的DOM事件（备用方案）
    try {
      // 监听发送按钮点击
      $("#send_but").on("click", playerListener);
      eventListeners.push(() => $("#send_but").off("click", playerListener));

      // 监听输入框回车键
      $("#send_textarea").on("keypress", function (e) {
        if (e.which === 13 && !e.shiftKey) {
          playerListener();
        }
      });
      eventListeners.push(() => $("#send_textarea").off("keypress"));
    } catch (domError) {
      console.warn(`[aiEvents] DOM事件绑定失败:`, domError);
    }

    return true;
  } catch (e) {
    console.error(`[aiEvents] 事件绑定失败:`, e);
    return false;
  }
};

/**
 * 注册AI事件监听器（带重试机制）
 */
const registerAIEventListeners = () => {
  if (aiEventRegistered) {
    console.log(`[aiEvents] 已注册，跳过重复执行`);
    return;
  }

  const MAX_RETRIES = 10;
  const RETRY_DELAY = 2000;
  let retryCount = 0;

  const tryRegister = () => {
    console.log(`[aiEvents] 尝试注册（第${retryCount + 1}/${MAX_RETRIES}次）`);

    // 检查依赖
    if (!checkDependencies()) {
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(tryRegister, RETRY_DELAY);
        return;
      }

      console.error(`[aiEvents] 依赖未就绪，注册失败`);
      if (deps.toastr && typeof deps.toastr.error === "function") {
        deps.toastr.error("AI事件依赖缺失，请刷新页面重试");
      }
      return;
    }

    // 尝试绑定事件
    if (bindAIEvents()) {
      aiEventRegistered = true;
      console.log(`[aiEvents] 注册成功`);

      if (deps.toastr && typeof deps.toastr.success === "function") {
        deps.toastr.success("AI检测功能已就绪");
      }
    } else if (retryCount < MAX_RETRIES) {
      retryCount++;
      setTimeout(tryRegister, RETRY_DELAY);
    } else {
      console.error(`[aiEvents] 达到最大重试次数，注册失败`);
      if (deps.toastr && typeof deps.toastr.error === "function") {
        deps.toastr.error("AI事件注册失败，请手动刷新页面");
      }
    }
  };

  // 初始延迟3秒（给SillyTavern初始化时间）
  setTimeout(tryRegister, 3000);
};