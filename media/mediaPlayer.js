import { deps } from "../core/deps.js";
import { initMediaCore, cleanupMediaCore } from "./core/mediaCore.js";
import { initMediaControls, cleanupMediaControls, updateControlButtons } from "./controls/mediaControls.js";

const { EventBus, jQuery: $, utils } = deps;
const { safeJQuery } = utils;

/**
 * 媒体播放器状态
 */
let isInitialized = false;

/**
 * 初始化媒体播放器
 */
export const init = () => {
  if (isInitialized) {
    console.warn('[mediaPlayer] 媒体播放器已经初始化');
    return;
  }
  
  console.log('[mediaPlayer] 初始化媒体播放器');
  
  try {
    // 初始化媒体核心模块
    initMediaCore();
    
    // 初始化媒体控制模块
    initMediaControls();
    
    // 注册媒体播放器事件
    registerMediaPlayerEvents();
    
    isInitialized = true;
    console.log('[mediaPlayer] 媒体播放器初始化完成');
    
    // 通知UI模块媒体播放器已就绪
    EventBus.emit('mediaPlayerReady');
    
  } catch (error) {
    console.error('[mediaPlayer] 初始化失败:', error);
    EventBus.emit('mediaPlayerError', { 
      error: '初始化失败', 
      details: error.message 
    });
  }
};

/**
 * 清理媒体播放器
 */
export const cleanup = () => {
  if (!isInitialized) {
    console.warn('[mediaPlayer] 媒体播放器未初始化，无需清理');
    return;
  }
  
  console.log('[mediaPlayer] 清理媒体播放器');
  
  try {
    // 取消事件监听
    unregisterMediaPlayerEvents();
    
    // 清理媒体控制模块
    cleanupMediaControls();
    
    // 清理媒体核心模块
    cleanupMediaCore();
    
    isInitialized = false;
    console.log('[mediaPlayer] 媒体播放器清理完成');
    
  } catch (error) {
    console.error('[mediaPlayer] 清理失败:', error);
  }
};

/**
 * 注册媒体播放器事件
 */
const registerMediaPlayerEvents = () => {
  // 媒体列表更新事件
  EventBus.on('mediaListUpdated', () => {
    console.log('[mediaPlayer] 媒体列表已更新');
    updateControlButtons();
  });
  
  // 播放状态变化事件
  EventBus.on('playbackStatusChanged', () => {
    updateControlButtons();
  });
  
  // 播放模式变化事件
  EventBus.on('playModeChanged', () => {
    updateControlButtons();
  });
  
  // 自动切换模式变化事件
  EventBus.on('autoSwitchModeChanged', () => {
    updateControlButtons();
  });
  
  // 音量变化事件
  EventBus.on('volumeChanged', () => {
    updateControlButtons();
  });
  
  // 视频音量变化事件
  EventBus.on('videoVolumeChanged', () => {
    updateControlButtons();
  });
  
  // 视频循环设置变化事件
  EventBus.on('videoLoopChanged', () => {
    updateControlButtons();
  });
  
  // 媒体播放完成事件
  EventBus.on('mediaPlaybackCompleted', () => {
    console.log('[mediaPlayer] 媒体播放完成');
    updateControlButtons();
  });
  
  // 媒体播放错误事件
  EventBus.on('mediaError', (data) => {
    console.error('[mediaPlayer] 媒体播放错误:', data.error);
    updateControlButtons();
  });
  
  // 播放模式变化失败事件
  EventBus.on('playModeChangeFailed', (data) => {
    console.warn('[mediaPlayer] 播放模式变化失败:', data.error);
  });
  
  // 自动切换模式变化失败事件
  EventBus.on('autoSwitchModeChangeFailed', (data) => {
    console.warn('[mediaPlayer] 自动切换模式变化失败:', data.error);
  });
  
  // 静音前音量保存事件
  EventBus.on('volumeBeforeMute', (data) => {
    console.log('[mediaPlayer] 静音前音量:', data.volume);
  });
  
  // 取消静音后音量恢复事件
  EventBus.on('volumeAfterUnmute', (data) => {
    console.log('[mediaPlayer] 取消静音后音量:', data.volume);
  });
  
  // 控制按钮更新事件
  EventBus.on('controlButtonsUpdate', (data) => {
    // 转发给UI模块
    EventBus.emit('updateControlButtonsUI', data);
  });
  
  // 请求显示媒体信息
  EventBus.on('requestMediaInfo', () => {
    import('./controls/mediaControls.js').then(module => {
      module.showMediaInfo();
    });
  });
  
  // 请求检查播放状态
  EventBus.on('requestPlaybackStatus', () => {
    import('./core/mediaCore.js').then(module => {
      const status = module.getPlaybackStatus();
      EventBus.emit('playbackStatusResponse', status);
    });
  });
  
  // 请求检查媒体列表
  EventBus.on('requestMediaList', () => {
    import('./core/mediaCore.js').then(module => {
      const mediaList = module.getMediaList();
      EventBus.emit('mediaListResponse', mediaList);
    });
  });
  
  // 请求检查当前媒体
  EventBus.on('requestCurrentMedia', () => {
    import('./core/mediaCore.js').then(module => {
      const currentMedia = module.getCurrentMedia();
      EventBus.emit('currentMediaResponse', currentMedia);
    });
  });
  
  // 添加扩展菜单点击事件处理
  EventBus.on('extensionMenuClicked', (data) => {
    if (data.extensionId === 'st_image_player') {
      handleMenuAction(data.action);
    }
  });
  
  // 处理菜单操作
  const handleMenuAction = (action) => {
    switch (action) {
      case 'play_pause':
        togglePlayPause();
        break;
      case 'next_media':
        nextMedia();
        break;
      case 'prev_media':
        prevMedia();
        break;
      case 'refresh_media':
        refreshMediaList();
        break;
      default:
        console.warn(`[mediaPlayer] 未处理的菜单操作: ${action}`);
    }
  };
  
  // 添加播放/暂停功能
  const togglePlayPause = () => {
    import('./core/mediaCore.js').then(module => {
      const status = module.getPlaybackStatus();
      if (status.isPlaying) {
        module.pausePlayback();
      } else {
        module.startPlayback();
      }
    });
  };
  
  // 添加上下媒体切换功能
  const nextMedia = () => {
    import('./core/mediaCore.js').then(module => {
      module.nextMedia();
    });
  };
  
  const prevMedia = () => {
    import('./core/mediaCore.js').then(module => {
      module.prevMedia();
    });
  };
  
  // 添加媒体列表刷新功能
  const refreshMediaList = () => {
    import('./core/mediaCore.js').then(module => {
      module.refreshMediaList();
    });
  };
};

/**
 * 取消媒体播放器事件监听
 */
const unregisterMediaPlayerEvents = () => {
  EventBus.off('mediaListUpdated');
  EventBus.off('playbackStatusChanged');
  EventBus.off('playModeChanged');
  EventBus.off('autoSwitchModeChanged');
  EventBus.off('volumeChanged');
  EventBus.off('videoVolumeChanged');
  EventBus.off('videoLoopChanged');
  EventBus.off('mediaPlaybackCompleted');
  EventBus.off('mediaError');
  EventBus.off('playModeChangeFailed');
  EventBus.off('autoSwitchModeChangeFailed');
  EventBus.off('volumeBeforeMute');
  EventBus.off('volumeAfterUnmute');
  EventBus.off('controlButtonsUpdate');
  EventBus.off('requestMediaInfo');
  EventBus.off('requestPlaybackStatus');
  EventBus.off('requestMediaList');
  EventBus.off('requestCurrentMedia');
};

/**
 * 检查媒体播放器是否已初始化
 */
export const isMediaPlayerInitialized = () => {
  return isInitialized;
};

/**
 * 重新初始化媒体播放器
 */
export const reinitialize = () => {
  console.log('[mediaPlayer] 重新初始化媒体播放器');
  
  // 先清理
  cleanup();
  
  // 再初始化
  init();
  
  console.log('[mediaPlayer] 媒体播放器重新初始化完成');
};

/**
 * 获取媒体播放器状态
 */
export const getMediaPlayerStatus = () => {
  return {
    initialized: isInitialized,
    timestamp: new Date().toISOString()
  };
};

/**
 * 重置媒体播放器
 */
export const reset = () => {
  console.log('[mediaPlayer] 重置媒体播放器');
  
  // 清理
  cleanup();
  
  // 延迟重新初始化，确保清理完成
  setTimeout(() => {
    init();
  }, 100);
  
  console.log('[mediaPlayer] 媒体播放器重置完成');
};

/**
 * 暂停所有媒体播放
 */
export const pauseAllMedia = () => {
  import('./controls/mediaControls.js').then(module => {
    if (module.canPauseMedia()) {
      module.handlePauseMedia();
    }
  });
};

/**
 * 恢复所有媒体播放
 */
export const resumeAllMedia = () => {
  import('./controls/mediaControls.js').then(module => {
    if (module.canResumeMedia()) {
      module.handleResumeMedia();
    }
  });
};

/**
 * 停止所有媒体播放
 */
export const stopAllMedia = () => {
  import('./controls/mediaControls.js').then(module => {
    if (module.canStopMedia()) {
      module.handleStopMedia();
    }
  });
};

/**
 * 播放下一个媒体
 */
export const playNext = () => {
  import('./controls/mediaControls.js').then(module => {
    if (module.canPlayNextMedia()) {
      module.handleNextMedia();
    }
  });
};

/**
 * 播放上一个媒体
 */
export const playPrevious = () => {
  import('./controls/mediaControls.js').then(module => {
    if (module.canPlayPreviousMedia()) {
      module.handlePreviousMedia();
    }
  });
};

/**
 * 设置音量
 */
export const setVolume = (volume) => {
  import('./controls/mediaControls.js').then(module => {
    module.handleSetVolume({ volume });
  });
};

/**
 * 设置视频音量
 */
export const setVideoVolume = (volume) => {
  import('./controls/mediaControls.js').then(module => {
    module.handleSetVideoVolume({ volume });
  });
};

/**
 * 设置静音
 */
export const setMute = (muted) => {
  import('./controls/mediaControls.js').then(module => {
    module.handleSetMute({ muted });
  });
};

/**
 * 设置播放模式
 */
export const setPlayMode = (mode) => {
  import('./controls/mediaControls.js').then(module => {
    module.handleChangePlayMode({ mode });
  });
};

/**
 * 设置自动切换模式
 */
export const setAutoSwitchMode = (mode) => {
  import('./controls/mediaControls.js').then(module => {
    module.handleChangeAutoSwitchMode({ mode });
  });
};

/**
 * 设置视频循环
 */
export const setVideoLoop = (loop) => {
  import('./controls/mediaControls.js').then(module => {
    module.handleSetVideoLoop({ loop });
  });
};

/**
 * 显示媒体信息
 */
export const showMediaInfo = () => {
  import('./controls/mediaControls.js').then(module => {
    module.showMediaInfo();
  });
};

/**
 * 更新控制按钮状态
 */
export const updateControls = () => {
  updateControlButtons();
};

/**
 * 获取媒体信息
 */
export const getMediaInfo = () => {
  return import('./controls/mediaControls.js').then(module => {
    return module.getMediaInfo();
  });
};

/**
 * 检查播放状态
 */
export const checkPlaybackStatus = () => {
  return import('./core/mediaCore.js').then(module => {
    return module.getPlaybackStatus();
  });
};

/**
 * 检查媒体列表
 */
export const checkMediaList = () => {
  return import('./core/mediaCore.js').then(module => {
    return module.getMediaList();
  });
};

/**
 * 检查当前媒体
 */
export const checkCurrentMedia = () => {
  return import('./core/mediaCore.js').then(module => {
    return module.getCurrentMedia();
  });
};

/**
 * 检查是否可以播放
 */
export const canPlay = () => {
  return import('./controls/mediaControls.js').then(module => {
    return module.canPlayMedia();
  });
};

/**
 * 检查是否可以暂停
 */
export const canPause = () => {
  return import('./controls/mediaControls.js').then(module => {
    return module.canPauseMedia();
  });
};

/**
 * 检查是否可以恢复
 */
export const canResume = () => {
  return import('./controls/mediaControls.js').then(module => {
    return module.canResumeMedia();
  });
};

/**
 * 检查是否可以停止
 */
export const canStop = () => {
  return import('./controls/mediaControls.js').then(module => {
    return module.canStopMedia();
  });
};

/**
 * 检查是否可以跳转
 */
export const canSeek = () => {
  return import('./controls/mediaControls.js').then(module => {
    return module.canSeekMedia();
  });
};

/**
 * 检查是否可以播放下一个
 */
export const canNext = () => {
  return import('./controls/mediaControls.js').then(module => {
    return module.canPlayNextMedia();
  });
};

/**
 * 检查是否可以播放上一个
 */
export const canPrev = () => {
  return import('./controls/mediaControls.js').then(module => {
    return module.canPlayPreviousMedia();
  });
};

/**
 * 媒体播放器模块导出
 */
export default {
  init,
  cleanup,
  reinitialize,
  reset,
  isMediaPlayerInitialized,
  getMediaPlayerStatus,
  pauseAllMedia,
  resumeAllMedia,
  stopAllMedia,
  playNext,
  playPrevious,
  setVolume,
  setVideoVolume,
  setMute,
  setPlayMode,
  setAutoSwitchMode,
  setVideoLoop,
  showMediaInfo,
  updateControls,
  getMediaInfo,
  checkPlaybackStatus,
  checkMediaList,
  checkCurrentMedia,
  canPlay,
  canPause,
  canResume,
  canStop,
  canSeek,
  canNext,
  canPrev
};