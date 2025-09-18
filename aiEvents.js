const $ = window.jQuery || window.$;
import { getSettings, saveSafeSettings } from "./settings.js";
import { getSafeToastr, getSafeGlobal } from "./utils.js";

const toastr = getSafeToastr();
const eventSource = getSafeGlobal("eventSource", null);
const event_types = getSafeGlobal("event_types", {});

/**
 * AI回复触发媒体切换
 */
export const onAIResponse = () => {
  const settings = getSettings();
  const win = $("#st-image-player-window");
  const video = win.find(".image-player-video")[0];

  // 前置检查（禁用/加载中/视频循环 → 跳过）
  if (!settings.enabled || settings.isMediaLoading) return;
  if (video && video.style.display !== "none" && settings.videoLoop) {
    console.log(`[AIEvent] 视频循环中，跳过切换`);
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

  // 触发切换
  settings.lastAISwitchTime = now;
  saveSafeSettings();
  import("./mediaPlayer.js").then(({ showMedia }) => showMedia("next"));
  console.log(`[AIEvent] AI回复触发切换`);
};

/**
 * 玩家消息触发媒体切换
 */
export const onPlayerMessage = () => {
  const settings = getSettings();
  const win = $("#st-image-player-window");
  const video = win.find(".image-player-video")[0];

  // 前置检查（同AI回复）
  if (!settings.enabled || settings.isMediaLoading) return;
  if (video && video.style.display !== "none" && settings.videoLoop) {
    console.log(`[AIEvent] 视频循环中，跳过切换`);
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

  // 触发切换
  settings.lastAISwitchTime = now;
  saveSafeSettings();
  import("./mediaPlayer.js").then(({ showMedia }) => showMedia("next"));
  console.log(`[AIEvent] 玩家消息触发切换`);
};

/**
 * 检查AI事件依赖是否就绪
 * @returns {boolean} 是否就绪
 */
const checkDependencies = () => {
  const hasEventSource = !!eventSource;
  const hasEventTypes = Object.keys(event_types).length > 0;
  console.log(
    `[AIEvent] 依赖检查: eventSource=${hasEventSource}, event_types=${hasEventTypes}`
  );
  return hasEventSource && hasEventTypes;
};

/**
 * 绑定AI事件（兼容多种绑定方式）
 * @param {string} eventName - 事件名
 * @param {Function} callback - 回调函数
 * @returns {boolean} 是否绑定成功
 */
const bindEvent = (eventName, callback) => {
  try {
    // 方式1: addEventListener（推荐）
    if (typeof eventSource.addEventListener === "function") {
      eventSource.addEventListener(eventName, callback);
      console.log(`[AIEvent] 用addEventListener绑定: ${eventName}`);
      return true;
    }
    // 方式2: on方法（旧版本兼容）
    else if (typeof eventSource.on === "function") {
      eventSource.on(eventName, callback);
      console.log(`[AIEvent] 用on方法绑定: ${eventName}`);
      return true;
    }
    // 方式3: 直接绑定到event_types（兼容极端情况）
    else if (event_types[eventName]) {
      eventSource.addEventListener(event_types[eventName], callback);
      console.log(
        `[AIEvent] 用event_types绑定: ${eventName}→${event_types[eventName]}`
      );
      return true;
    }
    // 方式4: 直接字符串绑定
    else {
      eventSource.addEventListener(eventName, callback);
      console.log(`[AIEvent] 直接绑定: ${eventName}`);
      return true;
    }
  } catch (e) {
    console.error(`[AIEvent] 绑定失败: ${eventName}`, e);
    return false;
  }
};

/**
 * 注册AI事件监听器（带重试）
 */
export const registerAIEventListeners = () => {
  const settings = getSettings();
  if (settings.aiEventRegistered) {
    console.log(`[AIEvent] 已注册，跳过重复执行`);
    return;
  }

  const maxRetries = 15; // 最多重试15次
  const retryDelay = 2000; // 2秒重试间隔

  /**
   * 尝试注册（递归重试）
   * @param {number} retryCount - 当前重试次数
   */
  const tryRegister = (retryCount = 0) => {
    console.log(`[AIEvent] 尝试注册（第${retryCount + 1}/${maxRetries}次）`);

    // 1. 依赖未就绪 → 重试
    if (!checkDependencies()) {
      if (retryCount < maxRetries) {
        setTimeout(() => tryRegister(retryCount + 1), retryDelay);
        return;
      }
      console.error(`[AIEvent] 依赖未就绪，注册失败`);
      toastr.error("AI事件依赖缺失，请刷新页面重试");
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
      console.log(`[AIEvent] 检测到事件: AI=${aiEvent}, Player=${playerEvent}`);

      // 3. 绑定事件
      const aiBound = bindEvent(aiEvent, onAIResponse);
      const playerBound = bindEvent(playerEvent, onPlayerMessage);

      // 4. 注册成功
      if (aiBound && playerBound) {
        settings.aiEventRegistered = true;
        saveSafeSettings();
        console.log(`[AIEvent] 注册成功`);
        toastr.success("AI检测功能已就绪");
      } else {
        throw new Error("事件绑定未成功");
      }
    } catch (e) {
      console.error(`[AIEvent] 注册失败:`, e);
      if (retryCount < maxRetries) {
        setTimeout(() => tryRegister(retryCount + 1), retryDelay);
      } else {
        console.error(`[AIEvent] 达到最大重试次数，注册失败`);
        toastr.error("AI事件注册失败，请手动刷新页面");
      }
    }
  };

  // 初始延迟5秒（给SillyTavern初始化时间）
  setTimeout(() => tryRegister(0), 5000);
};
