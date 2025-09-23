import { deps } from "../../core/deps.js";

const { EventBus } = deps;

// 媒体状态管理
let mediaState = {
  currentMedia: null,
  mediaList: [],
  currentIndex: -1,
  isPlaying: false,
  isPaused: false,
  volume: 0.8,
  videoVolume: 0.8,
  playMode: 'random',
  autoSwitchMode: 'detect',
  videoLoop: false,
  lastPlayedTime: 0,
  mediaType: null,
  duration: 0,
  currentTime: 0,
  buffered: 0
};

/**
 * 加载保存的状态
 */
export const loadSavedState = () => {
  const settings = deps.settings.get();
  
  mediaState.volume = settings.volume || 0.8;
  mediaState.videoVolume = settings.videoVolume || 0.8;
  mediaState.playMode = settings.playMode || 'random';
  mediaState.autoSwitchMode = settings.autoSwitchMode || 'detect';
  mediaState.videoLoop = settings.videoLoop || false;
  mediaState.isPlaying = settings.isPlaying || false;
  
  console.log('[mediaStateManager] 已加载保存的状态');
};

/**
 * 保存当前状态
 */
export const saveCurrentState = () => {
  const settings = deps.settings.get();
  
  settings.volume = mediaState.volume;
  settings.videoVolume = mediaState.videoVolume;
  settings.playMode = mediaState.playMode;
  settings.autoSwitchMode = mediaState.autoSwitchMode;
  settings.videoLoop = mediaState.videoLoop;
  settings.isPlaying = mediaState.isPlaying;
  
  deps.settings.save();
  console.log('[mediaStateManager] 已保存当前状态');
};

/**
 * 设置媒体列表
 */
export const setMediaList = (list) => {
  mediaState.mediaList = list;
  mediaState.currentIndex = -1;
  mediaState.currentMedia = null;
  
  console.log(`[mediaStateManager] 媒体列表已设置，共 ${list.length} 个项目`);
  EventBus.emit('mediaListUpdated', { count: list.length });
};

/**
 * 获取媒体列表
 */
export const getMediaList = () => {
  return [...mediaState.mediaList];
};

/**
 * 获取当前媒体
 */
export const getCurrentMedia = () => {
  return mediaState.currentMedia;
};

/**
 * 获取当前索引
 */
export const getCurrentIndex = () => {
  return mediaState.currentIndex;
};

/**
 * 获取播放状态
 */
export const getPlaybackStatus = () => {
  return {
    isPlaying: mediaState.isPlaying,
    isPaused: mediaState.isPaused,
    volume: mediaState.volume,
    videoVolume: mediaState.videoVolume,
    playMode: mediaState.playMode,
    autoSwitchMode: mediaState.autoSwitchMode,
    videoLoop: mediaState.videoLoop
  };
};

/**
 * 设置播放模式
 */
export const setPlayMode = (mode) => {
  if (['random', 'sequential'].includes(mode)) {
    mediaState.playMode = mode;
    console.log(`[mediaStateManager] 播放模式设置为: ${mode}`);
    EventBus.emit('playModeChanged', { mode });
    return true;
  }
  return false;
};

/**
 * 设置自动切换模式
 */
export const setAutoSwitchMode = (mode) => {
  if (['none', 'timer', 'detect'].includes(mode)) {
    mediaState.autoSwitchMode = mode;
    console.log(`[mediaStateManager] 自动切换模式设置为: ${mode}`);
    EventBus.emit('autoSwitchModeChanged', { mode });
    return true;
  }
  return false;
};

/**
 * 设置音量
 */
export const setVolume = (volume) => {
  const newVolume = Math.max(0, Math.min(1, volume));
  mediaState.volume = newVolume;
  
  console.log(`[mediaStateManager] 音量设置为: ${newVolume}`);
  EventBus.emit('volumeChanged', { volume: newVolume });
  
  return newVolume;
};

/**
 * 设置视频音量
 */
export const setVideoVolume = (volume) => {
  const newVolume = Math.max(0, Math.min(1, volume));
  mediaState.videoVolume = newVolume;
  
  console.log(`[mediaStateManager] 视频音量设置为: ${newVolume}`);
  EventBus.emit('videoVolumeChanged', { volume: newVolume });
  
  return newVolume;
};

/**
 * 设置视频循环
 */
export const setVideoLoop = (loop) => {
  mediaState.videoLoop = loop;
  
  console.log(`[mediaStateManager] 视频循环设置为: ${loop}`);
  EventBus.emit('videoLoopChanged', { loop });
  
  return loop;
};

/**
 * 更新播放状态
 */
export const updatePlaybackStatus = (currentTime, duration, buffered) => {
  mediaState.currentTime = currentTime;
  mediaState.duration = duration;
  mediaState.buffered = buffered;
  
  // 发布状态更新事件
  EventBus.emit('mediaStatusUpdate', {
    currentTime,
    duration,
    buffered,
    isPlaying: mediaState.isPlaying,
    isPaused: mediaState.isPaused,
    volume: mediaState.volume,
    videoVolume: mediaState.videoVolume
  });
};

/**
 * 设置播放状态
 */
export const setPlaybackState = (isPlaying, isPaused) => {
  mediaState.isPlaying = isPlaying;
  mediaState.isPaused = isPaused;
  mediaState.lastPlayedTime = isPlaying ? Date.now() : mediaState.lastPlayedTime;
  
  EventBus.emit('playbackStateChanged', { isPlaying, isPaused });
};

/**
 * 设置当前媒体
 */
export const setCurrentMedia = (media, index) => {
  mediaState.currentMedia = media;
  mediaState.currentIndex = index;
  mediaState.mediaType = media?.type || null;
};

export default mediaState;