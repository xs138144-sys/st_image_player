import { deps } from "../../core/deps.js";

const { EventBus, jQuery: $, utils } = deps;
const { safeJQuery } = utils;

/**
 * 初始化UI事件处理器
 */
export const initUIEvents = () => {
  console.log('[uiEvents] 初始化UI事件处理器');
  
  // 注册扩展菜单按钮点击事件
  registerExtensionMenuEvents();
  
  // 注册全局键盘事件
  registerKeyboardEvents();
  
  // 注册窗口事件
  registerWindowEvents();
  
  // 注册设置相关事件
  registerSettingsEvents();
  
  // 注册媒体控制事件
  registerMediaControlEvents();
};

/**
 * 清理UI事件处理器
 */
export const cleanupUIEvents = () => {
  console.log('[uiEvents] 清理UI事件处理器');
  
  // 移除所有事件监听器
  EventBus.off('extensionMenuClicked');
  EventBus.off('keyboardShortcut');
  EventBus.off('windowResized');
  EventBus.off('settingsChanged');
  EventBus.off('mediaControl');
  
  // 移除全局键盘事件
  $(document).off('keydown.uiEvents');
};

/**
 * 注册扩展菜单按钮事件
 */
const registerExtensionMenuEvents = () => {
  EventBus.on('extensionMenuClicked', (data) => {
    if (data.extensionId === 'st_image_player') {
      handleExtensionMenuClick(data);
    }
  });
};

/**
 * 处理扩展菜单点击
 */
const handleExtensionMenuClick = (data) => {
  const { action } = data;
  
  switch (action) {
    case 'toggle_player':
      EventBus.emit('requestTogglePlayerWindow');
      break;
    case 'show_settings':
      EventBus.emit('requestShowSettingsPanel');
      break;
    case 'refresh_media':
      EventBus.emit('requestRefreshMediaList');
      break;
    case 'play_pause':
      EventBus.emit('requestTogglePlayPause');
      break;
    case 'next_media':
      EventBus.emit('requestNextMedia');
      break;
    case 'prev_media':
      EventBus.emit('requestPreviousMedia');
      break;
    case 'toggle_lock':
      EventBus.emit('requestToggleLockState');
      break;
    case 'toggle_info':
      EventBus.emit('requestToggleInfoDisplay');
      break;
    default:
      console.log(`[uiEvents] 未知的菜单操作: ${action}`);
  }
};

/**
 * 注册键盘事件
 */
const registerKeyboardEvents = () => {
  // 全局键盘快捷键
  $(document).on('keydown.uiEvents', (e) => {
    handleKeyboardShortcut(e);
  });
  
  // 键盘快捷键事件总线
  EventBus.on('keyboardShortcut', (data) => {
    handleKeyboardEvent(data);
  });
};

/**
 * 处理键盘快捷键
 */
const handleKeyboardShortcut = (e) => {
  // 忽略输入框中的按键
  if ($(e.target).is('input, textarea, select')) {
    return;
  }
  
  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  
  // 播放器控制快捷键
  if (ctrl && shift) {
    switch (key) {
      case 'p': // Ctrl+Shift+P: 播放/暂停
        e.preventDefault();
        EventBus.emit('requestTogglePlayPause');
        break;
      case 'n': // Ctrl+Shift+N: 下一个媒体
        e.preventDefault();
        EventBus.emit('requestNextMedia');
        break;
      case 'b': // Ctrl+Shift+B: 上一个媒体
        e.preventDefault();
        EventBus.emit('requestPreviousMedia');
        break;
      case 'l': // Ctrl+Shift+L: 锁定/解锁
        e.preventDefault();
        EventBus.emit('requestToggleLockState');
        break;
      case 's': // Ctrl+Shift+S: 显示/隐藏设置
        e.preventDefault();
        EventBus.emit('requestToggleSettingsPanel');
        break;
      case 'i': // Ctrl+Shift+I: 显示/隐藏信息
        e.preventDefault();
        EventBus.emit('requestToggleInfoDisplay');
        break;
      case 'r': // Ctrl+Shift+R: 刷新媒体列表
        e.preventDefault();
        EventBus.emit('requestRefreshMediaList');
        break;
      case 't': // Ctrl+Shift+T: 显示/隐藏播放器
        e.preventDefault();
        EventBus.emit('requestTogglePlayerWindow');
        break;
    }
  }
  
  // 媒体控制快捷键（无修饰键）
  if (!ctrl && !shift && !alt) {
    switch (key) {
      case ' ': // 空格: 播放/暂停
        e.preventDefault();
        EventBus.emit('requestTogglePlayPause');
        break;
      case 'arrowright': // 右箭头: 下一个媒体
        e.preventDefault();
        EventBus.emit('requestNextMedia');
        break;
      case 'arrowleft': // 左箭头: 上一个媒体
        e.preventDefault();
        EventBus.emit('requestPreviousMedia');
        break;
      case 'escape': // ESC: 隐藏设置面板
        e.preventDefault();
        EventBus.emit('requestHideSettingsPanel');
        break;
    }
  }
};

/**
 * 处理键盘事件总线事件
 */
const handleKeyboardEvent = (data) => {
  const { key, ctrl, shift, alt } = data;
  
  // 模拟键盘事件
  const event = new KeyboardEvent('keydown', {
    key: key,
    ctrlKey: ctrl || false,
    shiftKey: shift || false,
    altKey: alt || false
  });
  
  handleKeyboardShortcut(event);
};

/**
 * 注册窗口事件
 */
const registerWindowEvents = () => {
  // 窗口大小变化事件
  EventBus.on('windowResized', (data) => {
    handleWindowResize(data);
  });
  
  // 窗口位置变化事件
  EventBus.on('windowMoved', (data) => {
    handleWindowMove(data);
  });
  
  // 窗口显示/隐藏事件
  EventBus.on('windowVisibilityChanged', (data) => {
    handleWindowVisibilityChange(data);
  });
};

/**
 * 处理窗口大小变化
 */
const handleWindowResize = (data) => {
  const { width, height } = data;
  console.log(`[uiEvents] 窗口大小变化: ${width}x${height}`);
  
  // 更新设置中的窗口大小
  const settings = deps.settings.get();
  settings.windowWidth = width;
  settings.windowHeight = height;
  deps.settings.save();
  
  // 通知其他组件窗口大小变化
  EventBus.emit('playerWindowResized', { width, height });
};

/**
 * 处理窗口移动
 */
const handleWindowMove = (data) => {
  const { x, y } = data;
  console.log(`[uiEvents] 窗口位置变化: ${x},${y}`);
  
  // 更新设置中的窗口位置
  const settings = deps.settings.get();
  settings.windowX = x;
  settings.windowY = y;
  deps.settings.save();
  
  // 通知其他组件窗口位置变化
  EventBus.emit('playerWindowMoved', { x, y });
};

/**
 * 处理窗口显示/隐藏
 */
const handleWindowVisibilityChange = (data) => {
  const { visible } = data;
  console.log(`[uiEvents] 窗口可见性变化: ${visible}`);
  
  // 更新设置中的窗口可见性
  const settings = deps.settings.get();
  settings.isWindowVisible = visible;
  deps.settings.save();
  
  // 通知其他组件窗口可见性变化
  EventBus.emit('playerWindowVisibilityChanged', { visible });
};

/**
 * 注册设置相关事件
 */
const registerSettingsEvents = () => {
  // 设置变化事件
  EventBus.on('settingsChanged', (data) => {
    handleSettingsChange(data);
  });
  
  // 显示设置面板请求
  EventBus.on('requestShowSettingsPanel', () => {
    EventBus.emit('showSettingsPanel');
  });
  
  // 隐藏设置面板请求
  EventBus.on('requestHideSettingsPanel', () => {
    EventBus.emit('hideSettingsPanel');
  });
  
  // 切换设置面板请求
  EventBus.on('requestToggleSettingsPanel', () => {
    EventBus.emit('toggleSettingsPanel');
  });
};

/**
 * 处理设置变化
 */
const handleSettingsChange = (data) => {
  const { key, value } = data;
  console.log(`[uiEvents] 设置变化: ${key} = ${value}`);
  
  // 根据设置变化更新UI
  switch (key) {
    case 'isLocked':
      EventBus.emit('updatePlayerLockState', { locked: value });
      break;
    case 'showInfo':
      EventBus.emit('updateInfoDisplay', { show: value });
      break;
    case 'volume':
      EventBus.emit('updateVolume', { volume: value });
      break;
    case 'videoVolume':
      EventBus.emit('updateVideoVolume', { volume: value });
      break;
    case 'videoLoop':
      EventBus.emit('updateVideoLoop', { loop: value });
      break;
    case 'playMode':
      EventBus.emit('changePlayMode', value);
      break;
    case 'autoSwitchMode':
      EventBus.emit('changeAutoSwitchMode', value);
      break;
  }
};

/**
 * 注册媒体控制事件
 */
const registerMediaControlEvents = () => {
  // 媒体控制请求
  EventBus.on('mediaControl', (data) => {
    handleMediaControl(data);
  });
  
  // 播放/暂停请求
  EventBus.on('requestTogglePlayPause', () => {
    EventBus.emit('togglePlayPause');
  });
  
  // 下一个媒体请求
  EventBus.on('requestNextMedia', () => {
    EventBus.emit('nextMedia');
  });
  
  // 上一个媒体请求
  EventBus.on('requestPreviousMedia', () => {
    EventBus.emit('previousMedia');
  });
  
  // 刷新媒体列表请求
  EventBus.on('requestRefreshMediaList', () => {
    EventBus.emit('refreshMediaList');
  });
  
  // 切换播放器窗口请求
  EventBus.on('requestTogglePlayerWindow', () => {
    EventBus.emit('togglePlayerWindow');
  });
  
  // 显示播放器窗口请求
  EventBus.on('requestCreatePlayerWindow', () => {
    EventBus.emit('createPlayerWindow');
  });
  
  // 隐藏播放器窗口请求
  EventBus.on('requestHidePlayerWindow', () => {
    EventBus.emit('hidePlayerWindow');
  });
  
  // 切换锁定状态请求
  EventBus.on('requestToggleLockState', () => {
    EventBus.emit('toggleLockState');
  });
  
  // 切换信息显示请求
  EventBus.on('requestToggleInfoDisplay', () => {
    EventBus.emit('toggleInfoDisplay');
  });
};

/**
 * 处理媒体控制
 */
const handleMediaControl = (data) => {
  const { action, ...params } = data;
  
  switch (action) {
    case 'play':
      EventBus.emit('playMedia', params);
      break;
    case 'pause':
      EventBus.emit('pauseMedia');
      break;
    case 'stop':
      EventBus.emit('stopMedia');
      break;
    case 'seek':
      EventBus.emit('seekMedia', params);
      break;
    case 'volume':
      EventBus.emit('setVolume', params);
      break;
    case 'mute':
      EventBus.emit('muteMedia', params);
      break;
    case 'loop':
      EventBus.emit('setLoop', params);
      break;
    default:
      console.log(`[uiEvents] 未知的媒体控制操作: ${action}`);
  }
};

/**
 * 发送通知消息
 */
export const showNotification = (message, type = 'info') => {
  EventBus.emit('showNotification', { message, type });
};

/**
 * 显示错误消息
 */
export const showError = (message) => {
  showNotification(message, 'error');
};

/**
 * 显示成功消息
 */
export const showSuccess = (message) => {
  showNotification(message, 'success');
};

/**
 * 显示警告消息
 */
export const showWarning = (message) => {
  showNotification(message, 'warning');
};