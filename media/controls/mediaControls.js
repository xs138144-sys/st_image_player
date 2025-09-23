import { deps } from "../../core/deps.js";
import { 
  playMedia, pauseMedia, resumeMedia, stopAllMedia, seekMedia,
  playNextMedia, playPreviousMedia, setVolume, setVideoVolume, setVideoLoop,
  setPlayMode, setAutoSwitchMode, getPlaybackStatus, getCurrentMedia,
  getMediaList, getCurrentIndex
} from "../core/mediaCore.js";

const { EventBus, jQuery: $, utils } = deps;
const { safeJQuery } = utils;

/**
 * 初始化媒体控制模块
 */
export const initMediaControls = () => {
  console.log('[mediaControls] 初始化媒体控制模块');
  
  // 注册媒体控制事件
  registerMediaControlEvents();
  
  // 注册播放模式事件
  registerPlayModeEvents();
  
  // 注册音量控制事件
  registerVolumeControlEvents();
  
  // 注册播放控制事件
  registerPlaybackControlEvents();
  
  console.log('[mediaControls] 媒体控制模块初始化完成');
};

/**
 * 清理媒体控制模块
 */
export const cleanupMediaControls = () => {
  console.log('[mediaControls] 清理媒体控制模块');
  
  // 取消事件监听
  unregisterMediaControlEvents();
  
  console.log('[mediaControls] 媒体控制模块清理完成');
};

/**
 * 注册媒体控制事件
 */
const registerMediaControlEvents = () => {
  // 播放媒体请求
  EventBus.on('playMedia', (data) => {
    handlePlayMedia(data);
  });
  
  // 暂停媒体请求
  EventBus.on('pauseMedia', () => {
    handlePauseMedia();
  });
  
  // 恢复媒体请求
  EventBus.on('resumeMedia', () => {
    handleResumeMedia();
  });
  
  // 停止媒体请求
  EventBus.on('stopMedia', () => {
    handleStopMedia();
  });
  
  // 跳转媒体请求
  EventBus.on('seekMedia', (data) => {
    handleSeekMedia(data);
  });
  
  // 下一个媒体请求
  EventBus.on('nextMedia', () => {
    handleNextMedia();
  });
  
  // 上一个媒体请求
  EventBus.on('previousMedia', () => {
    handlePreviousMedia();
  });
  
  // 自动切换媒体
  EventBus.on('autoSwitchMedia', () => {
    handleAutoSwitchMedia();
  });
};

/**
 * 取消媒体控制事件监听
 */
const unregisterMediaControlEvents = () => {
  EventBus.off('playMedia');
  EventBus.off('pauseMedia');
  EventBus.off('resumeMedia');
  EventBus.off('stopMedia');
  EventBus.off('seekMedia');
  EventBus.off('nextMedia');
  EventBus.off('previousMedia');
  EventBus.off('autoSwitchMedia');
};

/**
 * 注册播放模式事件
 */
const registerPlayModeEvents = () => {
  // 播放模式变化
  EventBus.on('changePlayMode', (data) => {
    handleChangePlayMode(data);
  });
  
  // 自动切换模式变化
  EventBus.on('changeAutoSwitchMode', (data) => {
    handleChangeAutoSwitchMode(data);
  });
  
  // 视频循环设置变化
  EventBus.on('setVideoLoop', (data) => {
    handleSetVideoLoop(data);
  });
};

/**
 * 注册音量控制事件
 */
const registerVolumeControlEvents = () => {
  // 音量设置
  EventBus.on('setVolume', (data) => {
    handleSetVolume(data);
  });
  
  // 视频音量设置
  EventBus.on('setVideoVolume', (data) => {
    handleSetVideoVolume(data);
  });
  
  // 静音设置
  EventBus.on('setMute', (data) => {
    handleSetMute(data);
  });
};

/**
 * 注册播放控制事件
 */
const registerPlaybackControlEvents = () => {
  // 切换播放/暂停
  EventBus.on('togglePlayPause', () => {
    handleTogglePlayPause();
  });
  
  // 刷新媒体列表
  EventBus.on('refreshMediaList', () => {
    handleRefreshMediaList();
  });
};

/**
 * 处理播放媒体请求
 */
const handlePlayMedia = (data) => {
  const { media } = data;
  
  if (!media) {
    console.warn('[mediaControls] 播放媒体失败: 媒体对象为空');
    EventBus.emit('mediaError', { error: '媒体对象为空' });
    return;
  }
  
  const success = playMedia(media);
  
  if (!success) {
    console.error('[mediaControls] 播放媒体失败');
    EventBus.emit('mediaError', { 
      error: '播放失败', 
      media: media 
    });
  }
};

/**
 * 处理暂停媒体请求
 */
const handlePauseMedia = () => {
  const success = pauseMedia();
  
  if (!success) {
    console.warn('[mediaControls] 暂停媒体失败: 媒体未播放或无法暂停');
  }
};

/**
 * 处理恢复媒体请求
 */
const handleResumeMedia = () => {
  const success = resumeMedia();
  
  if (!success) {
    console.warn('[mediaControls] 恢复媒体失败: 媒体未暂停或无法恢复');
  }
};

/**
 * 处理停止媒体请求
 */
const handleStopMedia = () => {
  const success = stopAllMedia();
  
  if (!success) {
    console.warn('[mediaControls] 停止媒体失败: 没有媒体在播放');
  }
};

/**
 * 处理跳转媒体请求
 */
const handleSeekMedia = (data) => {
  const { time } = data;
  
  if (typeof time !== 'number' || time < 0) {
    console.warn('[mediaControls] 跳转失败: 无效的时间值');
    return;
  }
  
  const success = seekMedia(time);
  
  if (!success) {
    console.warn('[mediaControls] 跳转失败: 媒体未播放或无法跳转');
  }
};

/**
 * 处理下一个媒体请求
 */
const handleNextMedia = () => {
  const success = playNextMedia();
  
  if (!success) {
    console.warn('[mediaControls] 播放下一个媒体失败: 没有可用的媒体');
    EventBus.emit('mediaError', { error: '没有可用的媒体' });
  }
};

/**
 * 处理上一个媒体请求
 */
const handlePreviousMedia = () => {
  const success = playPreviousMedia();
  
  if (!success) {
    console.warn('[mediaControls] 播放上一个媒体失败: 没有可用的媒体');
    EventBus.emit('mediaError', { error: '没有可用的媒体' });
  }
};

/**
 * 处理自动切换媒体
 */
const handleAutoSwitchMedia = () => {
  const playbackStatus = getPlaybackStatus();
  
  if (playbackStatus.autoSwitchMode === 'none') {
    console.log('[mediaControls] 自动切换已禁用，跳过切换');
    return;
  }
  
  const success = playNextMedia();
  
  if (!success) {
    console.warn('[mediaControls] 自动切换失败: 没有可用的媒体');
  }
};

/**
 * 处理播放模式变化
 */
const handleChangePlayMode = (data) => {
  const { mode } = data;
  
  const success = setPlayMode(mode);
  
  if (!success) {
    console.warn('[mediaControls] 设置播放模式失败: 无效的模式');
    EventBus.emit('playModeChangeFailed', { 
      mode: mode, 
      error: '无效的播放模式' 
    });
  }
};

/**
 * 处理自动切换模式变化
 */
const handleChangeAutoSwitchMode = (data) => {
  const { mode } = data;
  
  const success = setAutoSwitchMode(mode);
  
  if (!success) {
    console.warn('[mediaControls] 设置自动切换模式失败: 无效的模式');
    EventBus.emit('autoSwitchModeChangeFailed', { 
      mode: mode, 
      error: '无效的自动切换模式' 
    });
  }
};

/**
 * 处理视频循环设置
 */
const handleSetVideoLoop = (data) => {
  const { loop } = data;
  
  if (typeof loop !== 'boolean') {
    console.warn('[mediaControls] 设置视频循环失败: 无效的参数');
    return;
  }
  
  setVideoLoop(loop);
};

/**
 * 处理音量设置
 */
const handleSetVolume = (data) => {
  const { volume } = data;
  
  if (typeof volume !== 'number' || volume < 0 || volume > 1) {
    console.warn('[mediaControls] 设置音量失败: 无效的音量值');
    return;
  }
  
  setVolume(volume);
};

/**
 * 处理视频音量设置
 */
const handleSetVideoVolume = (data) => {
  const { volume } = data;
  
  if (typeof volume !== 'number' || volume < 0 || volume > 1) {
    console.warn('[mediaControls] 设置视频音量失败: 无效的音量值');
    return;
  }
  
  setVideoVolume(volume);
};

/**
 * 处理静音设置
 */
const handleSetMute = (data) => {
  const { muted } = data;
  
  if (typeof muted !== 'boolean') {
    console.warn('[mediaControls] 设置静音失败: 无效的参数');
    return;
  }
  
  const playbackStatus = getPlaybackStatus();
  
  if (muted) {
    // 静音：保存当前音量并设置为0
    EventBus.emit('volumeBeforeMute', { volume: playbackStatus.volume });
    setVolume(0);
    setVideoVolume(0);
  } else {
    // 取消静音：恢复之前的音量
    EventBus.emit('volumeAfterUnmute', { volume: playbackStatus.volume });
    // 这里需要从事件中获取之前的音量，或者使用默认值
    setVolume(0.8);
    setVideoVolume(0.8);
  }
};

/**
 * 处理切换播放/暂停
 */
const handleTogglePlayPause = () => {
  const playbackStatus = getPlaybackStatus();
  
  if (playbackStatus.isPlaying) {
    handlePauseMedia();
  } else if (playbackStatus.isPaused) {
    handleResumeMedia();
  } else {
    // 如果没有媒体在播放，尝试播放当前媒体或第一个媒体
    const currentMedia = getCurrentMedia();
    if (currentMedia) {
      handlePlayMedia({ media: currentMedia });
    } else {
      const mediaList = getMediaList();
      if (mediaList.length > 0) {
        handlePlayMedia({ media: mediaList[0] });
      }
    }
  }
};

/**
 * 处理刷新媒体列表
 */
const handleRefreshMediaList = () => {
  console.log('[mediaControls] 刷新媒体列表请求');
  
  // 触发API模块重新获取媒体列表
  EventBus.emit('requestMediaListRefresh');
  
  // 显示刷新状态
  EventBus.emit('showNotification', { 
    message: '正在刷新媒体列表...', 
    type: 'info' 
  });
};

/**
 * 获取媒体信息
 */
export const getMediaInfo = () => {
  const currentMedia = getCurrentMedia();
  const mediaList = getMediaList();
  const currentIndex = getCurrentIndex();
  const playbackStatus = getPlaybackStatus();
  
  return {
    currentMedia,
    mediaListCount: mediaList.length,
    currentIndex,
    playbackStatus,
    hasMedia: mediaList.length > 0,
    isFirstMedia: currentIndex === 0,
    isLastMedia: currentIndex === mediaList.length - 1
  };
};

/**
 * 检查是否可以播放
 */
export const canPlayMedia = () => {
  const mediaList = getMediaList();
  return mediaList.length > 0;
};

/**
 * 检查是否可以暂停
 */
export const canPauseMedia = () => {
  const playbackStatus = getPlaybackStatus();
  return playbackStatus.isPlaying;
};

/**
 * 检查是否可以恢复
 */
export const canResumeMedia = () => {
  const playbackStatus = getPlaybackStatus();
  return playbackStatus.isPaused;
};

/**
 * 检查是否可以停止
 */
export const canStopMedia = () => {
  const playbackStatus = getPlaybackStatus();
  return playbackStatus.isPlaying || playbackStatus.isPaused;
};

/**
 * 检查是否可以跳转
 */
export const canSeekMedia = () => {
  const playbackStatus = getPlaybackStatus();
  return playbackStatus.isPlaying && 
         (playbackStatus.mediaType === 'video' || playbackStatus.mediaType === 'audio');
};

/**
 * 检查是否可以播放下一个
 */
export const canPlayNextMedia = () => {
  const mediaList = getMediaList();
  return mediaList.length > 1;
};

/**
 * 检查是否可以播放上一个
 */
export const canPlayPreviousMedia = () => {
  const mediaList = getMediaList();
  return mediaList.length > 1;
};

/**
 * 更新控制按钮状态
 */
export const updateControlButtons = () => {
  const canPlay = canPlayMedia();
  const canPause = canPauseMedia();
  const canResume = canResumeMedia();
  const canStop = canStopMedia();
  const canSeek = canSeekMedia();
  const canNext = canPlayNextMedia();
  const canPrev = canPlayPreviousMedia();
  
  EventBus.emit('controlButtonsUpdate', {
    canPlay,
    canPause,
    canResume,
    canStop,
    canSeek,
    canNext,
    canPrev
  });
};

/**
 * 显示媒体信息
 */
export const showMediaInfo = () => {
  const mediaInfo = getMediaInfo();
  
  let infoText = '';
  
  if (mediaInfo.currentMedia) {
    infoText += `当前媒体: ${mediaInfo.currentMedia.name}\n`;
    infoText += `类型: ${mediaInfo.currentMedia.type}\n`;
    infoText += `索引: ${mediaInfo.currentIndex + 1}/${mediaInfo.mediaListCount}\n`;
  } else {
    infoText += '没有媒体在播放\n';
  }
  
  infoText += `播放模式: ${mediaInfo.playbackStatus.playMode}\n`;
  infoText += `自动切换: ${mediaInfo.playbackStatus.autoSwitchMode}\n`;
  infoText += `音量: ${Math.round(mediaInfo.playbackStatus.volume * 100)}%\n`;
  infoText += `视频音量: ${Math.round(mediaInfo.playbackStatus.videoVolume * 100)}%\n`;
  infoText += `视频循环: ${mediaInfo.playbackStatus.videoLoop ? '开启' : '关闭'}\n`;
  infoText += `状态: ${mediaInfo.playbackStatus.isPlaying ? '播放中' : mediaInfo.playbackStatus.isPaused ? '暂停' : '停止'}`;
  
  EventBus.emit('showNotification', {
    message: infoText,
    type: 'info',
    duration: 5000
  });
};