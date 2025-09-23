// aiEvents.js 修复版本
import { deps } from "../core/deps.js";

const { EventBus } = deps;
let eventListeners = [];

/**
 * 初始化AI事件监听
 */
export const init = () => {
  try {
    console.log(`[aiEvents] 模块初始化开始`);

    // 注册AI事件监听器
    registerAIEventListeners();

    console.log(`[aiEvents] 模块初始化完成`);
  } catch (e) {
    console.error(`[aiEvents] 初始化错误:`, e);
    // 使用安全的toastr调用
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
    // 清理全局事件监听器
    if (window.aiEventListeners) {
      window.aiEventListeners.forEach(removeListener => {
        if (typeof removeListener === "function") {
          removeListener();
        }
      });
      window.aiEventListeners = null;
    }

    // 清理本地事件监听器
    eventListeners.forEach((removeListener) => {
      try {
        if (typeof removeListener === "function") {
          removeListener();
        }
      } catch (cleanupErr) {
        console.error(`[aiEvents] 清理监听器失败:`, cleanupErr);
      }
    });
    eventListeners = [];

    console.log(`[aiEvents] 资源清理完成`);
  } catch (e) {
    console.error(`[aiEvents] 清理错误:`, e);
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[aiEvents] 清理失败: ${e.message}`);
    }
  }
};

/**
 * AI回复处理函数
 */
const onAIResponse = () => {
  const settings = deps.settings.get();
  const $ = deps.jQuery;
  if (!$) return;

  // 使用window.media状态判断（替代直接读settings）
  if (!window.media) return;

  // 前置检查：加载中/视频循环/非图片状态 → 跳过
  if (window.media.state && window.media.state.isLoading) return;
  if (window.media.meta && window.media.meta.type === "video" && window.media.state && window.media.state.isLooping) {
    console.log(`[aiEvents] 视频循环中，跳过切换`);
    return;
  }

  if (
    settings.autoSwitchMode !== "detect" ||
    !settings.aiDetectEnabled ||
    !settings.isWindowVisible
  ) {
    return;
  }

  // 冷却时间检查 - 修复：使用Date.now()而不是performance.now()
  const now = Date.now();
  if (now - (settings.lastAISwitchTime || 0) < (settings.aiResponseCooldown || 3000)) return;

  // 触发切换（通过事件总线，使用正确的消息格式）
  deps.settings.update({ lastAISwitchTime: now });
  deps.EventBus.emit("autoSwitchMedia", { direction: "next" });
  console.log(`[aiEvents] AI回复触发媒体切换`);
};

/**
 * 玩家消息处理函数
 */
const onPlayerMessage = () => {
  const settings = deps.settings.get();
  const $ = deps.jQuery;
  if (!$) return;

  if (!window.media) return;

  if (window.media.state && window.media.state.isLoading) return;
  if (window.media.meta && window.media.meta.type === "video" && window.media.state && window.media.state.isLooping) {
    console.log(`[aiEvents] 视频循环中，跳过切换`);
    return;
  }
  if (
    settings.autoSwitchMode !== "detect" ||
    !settings.playerDetectEnabled ||
    !settings.isWindowVisible
  ) {
    return;
  }

  // 冷却时间检查 - 修复：使用Date.now()而不是performance.now()
  const now = Date.now();
  if (now - (settings.lastAISwitchTime || 0) < (settings.aiResponseCooldown || 3000)) return;

  // 触发切换（通过事件总线，使用正确的消息格式）
  deps.settings.update({ lastAISwitchTime: now });
  deps.EventBus.emit("autoSwitchMedia", { direction: "next" });
  console.log(`[aiEvents] 玩家消息触发媒体切换`);
};

/**
 * 检查AI事件依赖是否就绪
 */
const checkDependencies = () => {
  const eventSource = deps.utils.getSafeGlobal("eventSource", null);
  const event_types = deps.utils.getSafeGlobal("event_types", {});

  const hasEventSource = !!eventSource;
  const hasEventTypes = Object.keys(event_types).length > 0;
  const hasSillyTavern = !!window.SillyTavern;
  
  console.log(
    `[aiEvents] 依赖检查: eventSource=${hasEventSource}, event_types=${hasEventTypes}, SillyTavern=${hasSillyTavern}`
  );
  
  // 如果SillyTavern不存在，说明可能不在SillyTavern环境中
  if (!hasSillyTavern) {
    console.warn('[aiEvents] 不在SillyTavern环境中，AI事件功能将禁用');
    return false;
  }
  
  return hasEventSource && hasEventTypes;
};

/**
 * 绑定AI事件（兼容多种绑定方式）
 */
const bindEvent = (eventName, callback) => {
  try {
    const eventSource = deps.utils.getSafeGlobal("eventSource", null);
    const event_types = deps.utils.getSafeGlobal("event_types", {});

    if (!eventSource) {
      console.error(`[aiEvents] eventSource不可用，无法绑定事件: ${eventName}`);
      return null;
    }

    // 方式1: 标准addEventListener（推荐）
    if (typeof eventSource.addEventListener === "function") {
      eventSource.addEventListener(eventName, callback);
      console.log(`[aiEvents] 用addEventListener绑定: ${eventName}`);
      return () => eventSource.removeEventListener(eventName, callback);
    }
    // 方式2: 旧版本on/off方法兼容
    else if (typeof eventSource.on === "function") {
      eventSource.on(eventName, callback);
      console.log(`[aiEvents] 用on方法绑定: ${eventName}`);
      return () => eventSource.off(eventName, callback);
    }
    // 方式3: 兼容event_types映射的事件名
    else if (event_types[eventName]) {
      const actualEvent = event_types[eventName];
      eventSource.addEventListener(actualEvent, callback);
      console.log(`[aiEvents] 用event_types绑定: ${eventName}→${actualEvent}`);
      return () => eventSource.removeEventListener(actualEvent, callback);
    }
    // 方式4: 直接字符串绑定（兜底方案）
    else {
      eventSource.addEventListener(eventName, callback);
      console.log(`[aiEvents] 直接绑定: ${eventName}`);
      return () => eventSource.removeEventListener(eventName, callback);
    }
  } catch (e) {
    console.error(`[aiEvents] 绑定事件${eventName}失败:`, e);
    return null;
  }
};

/**
 * 注册AI事件监听器（带重试机制）
 */
const registerAIEventListeners = () => {
  // 修正：使用settings模块统一的get()方法
  const settings = deps.settings.get();
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
      
      // 提供更详细的错误信息
      const eventSource = deps.utils.getSafeGlobal("eventSource", null);
      const event_types = deps.utils.getSafeGlobal("event_types", {});
      const hasSillyTavern = !!window.SillyTavern;
      
      let errorMsg = "AI事件依赖缺失";
      if (!hasSillyTavern) {
        errorMsg = "不在SillyTavern环境中，AI事件功能已禁用";
      } else if (!eventSource) {
        errorMsg = "eventSource未找到，请确保SillyTavern已完全加载";
      } else if (Object.keys(event_types).length === 0) {
        errorMsg = "event_types未初始化，请刷新页面重试";
      }
      
      // 使用安全的toastr调用
      if (deps.toastr && typeof deps.toastr.error === "function") {
        deps.toastr.error(errorMsg);
      }
      return;
    }

    try {
      const event_types = deps.utils.getSafeGlobal("event_types", {});

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

      if (!removeAiListener || !removePlayerListener) {
        throw new Error("事件绑定未成功");
      }

      // 保存取消监听方法
      eventListeners.push(removeAiListener, removePlayerListener);

      // 4. 注册成功
      deps.settings.save({ aiEventRegistered: true });
      console.log(`[aiEvents] 注册成功`);
      // 使用安全的toastr调用
      if (deps.toastr && typeof deps.toastr.success === "function") {
        deps.toastr.success("AI检测功能已就绪");
      }
    } catch (e) {
      console.error(`[aiEvents] 注册失败:`, e);
      if (retryCount < maxRetries) {
        setTimeout(() => tryRegister(retryCount + 1), retryDelay);
      } else {
        console.error(`[aiEvents] 达到最大重试次数，注册失败`);
        // 使用安全的toastr调用
        if (deps.toastr && typeof deps.toastr.error === "function") {
          deps.toastr.error("AI事件注册失败，请手动刷新页面");
        }
      }
    }
  };

  // 初始延迟5秒（给SillyTavern初始化时间）
  setTimeout(() => tryRegister(0), 5000);
};