import { deps } from "../core/deps.js";

// 模块私有变量
const eventSource = deps.utils.getSafeGlobal("eventSource", null);
const event_types = deps.utils.getSafeGlobal("event_types", {});
let eventListeners = []; // 事件监听器集合
const winSelector = "#st-image-player-window"; // 补充定义选择器

/**
 * 初始化AI事件模块
 */
export const init = () => {
  try {
    const settings = deps.settings.getSettings();

    // 已注册或未启用则跳过
    if (
      settings.aiEventRegistered ||
      !settings.masterEnabled ||
      !settings.enabled
    ) {
      console.log(`[aiEvents] 无需初始化（已注册/未启用）`);
      return;
    }

    // 注册扩展禁用事件（清理监听）
    const removeDisableListener = deps.EventBus.on(
      "extensionDisable",
      cleanupEventListeners
    );
    eventListeners.push(removeDisableListener);

    // 启动注册流程（带重试）
    registerAIEventListeners();

    console.log(`[aiEvents] AI事件模块初始化完成`);
  } catch (e) {
    deps.toastr.error(`[aiEvents] 初始化失败: ${e.message}`);
    console.error(`[aiEvents] 初始化错误:`, e);
  }
};

/**
 * 清理AI事件模块
 */
export const cleanup = () => {
  try {
    cleanupEventListeners();
    console.log(`[aiEvents] AI事件模块已清理`);
  } catch (e) {
    deps.toastr.error(`[aiEvents] 清理失败: ${e.message}`);
    console.error(`[aiEvents] 清理错误:`, e);
  }
};

/**
 * 清理所有事件监听
 */
const cleanupEventListeners = () => {
  eventListeners.forEach((removeListener) => removeListener());
  eventListeners = [];
  console.log(`[aiEvents] 事件监听已清理`);
};

/**
 * 检查AI事件依赖是否就绪
 */
const checkDependencies = () => {
  const hasEventSource = !!eventSource;
  const hasEventTypes = Object.keys(event_types).length > 0;
  console.log(
    `[aiEvents] 依赖检查: eventSource=${hasEventSource}, event_types=${hasEventTypes}`
  );
  return hasEventSource && hasEventTypes;
};

/**
 * 绑定AI事件（兼容多种绑定方式）
 */
const bindEvent = (eventName, callback) => {
  try {
    // 方式1: addEventListener（推荐）
    if (typeof eventSource.addEventListener === "function") {
      eventSource.addEventListener(eventName, callback);
      console.log(`[aiEvents] 用addEventListener绑定: ${eventName}`);
      return () => eventSource.removeEventListener(eventName, callback);
    }
    // 方式2: on方法（旧版本兼容）
    else if (typeof eventSource.on === "function") {
      eventSource.on(eventName, callback);
      console.log(`[aiEvents] 用on方法绑定: ${eventName}`);
      return () => eventSource.off(eventName, callback);
    }
    // 方式3: 直接绑定到event_types（兼容极端情况）
    else if (event_types[eventName]) {
      const actualEvent = event_types[eventName];
      eventSource.addEventListener(actualEvent, callback);
      console.log(`[aiEvents] 用event_types绑定: ${eventName}→${actualEvent}`);
      return () => eventSource.removeEventListener(actualEvent, callback);
    }
    // 方式4: 直接字符串绑定
    else {
      eventSource.addEventListener(eventName, callback);
      console.log(`[aiEvents] 直接绑定: ${eventName}`);
      return () => eventSource.removeEventListener(eventName, callback);
    }
  } catch (e) {
    console.error(`[aiEvents] 绑定失败: ${eventName}`, e);
    return null;
  }
};

/**
 * AI回复触发媒体切换
 */
const onAIResponse = () => {
  const settings = deps.settings.getSettings();
  const $ = deps.jQuery;
  if (!$) return;

  const win = $(winSelector);
  const video = win.find(".image-player-video")[0];

  // 前置检查（禁用/加载中/视频循环 → 跳过）
  if (!settings.enabled || settings.isMediaLoading) return;
  if (video && video.style.display !== "none" && settings.videoLoop) {
    console.log(`[aiEvents] 视频循环中，跳过切换`);
    return;
  }
  if (
    settings.autoSwitchMode !== "detect" ||
    !settings.aiDetectEnabled ||
    !settings.isWindowVisible
  )
    return;

  // 冷却时间检查
  const now = performance.now();
  if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) return;

  // 触发切换（通过事件总线）
  deps.settings.saveSettings({ lastAISwitchTime: now });
  deps.EventBus.emit("requestMediaPlay", { direction: "next" });
  console.log(`[aiEvents] AI回复触发切换`);
};

/**
 * 玩家消息触发媒体切换
 */
const onPlayerMessage = () => {
  const settings = deps.settings.getSettings();
  const $ = deps.jQuery;
  if (!$) return;

  const win = $(winSelector);
  const video = win.find(".image-player-video")[0];

  // 前置检查（同AI回复）
  if (!settings.enabled || settings.isMediaLoading) return;
  if (video && video.style.display !== "none" && settings.videoLoop) {
    console.log(`[aiEvents] 视频循环中，跳过切换`);
    return;
  }
  if (
    settings.autoSwitchMode !== "detect" ||
    !settings.playerDetectEnabled ||
    !settings.isWindowVisible
  )
    return;

  // 冷却时间检查
  const now = performance.now();
  if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) return;

  // 触发切换（通过事件总线）
  deps.settings.saveSettings({ lastAISwitchTime: now });
  deps.EventBus.emit("requestMediaPlay", { direction: "next" });
  console.log(`[aiEvents] 玩家消息触发切换`);
};

/**
 * 注册AI事件监听器（带重试）
 */
const registerAIEventListeners = () => {
  const settings = deps.settings.getSettings();
  if (settings.aiEventRegistered) {
    console.log(`[aiEvents] 已注册，跳过重复执行`);
    return;
  }

  const maxRetries = 15; // 最多重试15次
  const retryDelay = 2000; // 2秒重试间隔

  /**
   * 尝试注册（递归重试）
   */
  const tryRegister = (retryCount = 0) => {
    console.log(`[aiEvents] 尝试注册（第${retryCount + 1}/${maxRetries}次）`);

    // 1. 依赖未就绪 → 重试
    if (!checkDependencies()) {
      if (retryCount < maxRetries) {
        setTimeout(() => tryRegister(retryCount + 1), retryDelay);
        return;
      }
      console.error(`[aiEvents] 依赖未就绪，注册失败`);
      deps.toastr.error("AI事件依赖缺失，请刷新页面重试");
      return;
    }

    try {
      // 2. 获取事件类型（兼容多种命名）
      const aiEvent =
        event_types.MESSAGE_RECEIVED ||
        event_types.AI_MESSAGE_RECEIVED ||
        "messageReceived";
      const playerEvent =
        event_types.MESSAGE_SENT ||
        event_types.PLAYER_MESSAGE_SENT ||
        "messageSent";
      console.log(
        `[aiEvents] 检测到事件: AI=${aiEvent}, Player=${playerEvent}`
      );

      // 3. 绑定事件
      const removeAiListener = bindEvent(aiEvent, onAIResponse);
      const removePlayerListener = bindEvent(playerEvent, onPlayerMessage);

      if (!removeAiListener || !removePlayerListener)
        throw new Error("事件绑定未成功");

      // 保存取消监听方法
      eventListeners.push(removeAiListener, removePlayerListener);

      // 4. 注册成功
      deps.settings.saveSettings({ aiEventRegistered: true });
      console.log(`[aiEvents] 注册成功`);
      deps.toastr.success("AI检测功能已就绪");
    } catch (e) {
      console.error(`[aiEvents] 注册失败:`, e);
      if (retryCount < maxRetries) {
        setTimeout(() => tryRegister(retryCount + 1), retryDelay);
      } else {
        console.error(`[aiEvents] 达到最大重试次数，注册失败`);
        deps.toastr.error("AI事件注册失败，请手动刷新页面");
      }
    }
  };

  // 初始延迟5秒（给SillyTavern初始化时间）
  setTimeout(() => tryRegister(0), 5000);
};