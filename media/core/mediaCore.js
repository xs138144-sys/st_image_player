import { deps } from "../../core/deps.js";
import { initMediaElements, removeMediaElements, getMediaElements } from "./mediaElementManager.js";
import { registerMediaEvents, unregisterMediaEvents } from "./mediaEventManager.js";
import { loadSavedState, saveCurrentState, setMediaList, getMediaList, setPlayMode, setAutoSwitchMode, setVolume, setVideoVolume } from "./mediaStateManager.js";
import { playMedia, pauseMedia, resumeMedia, stopAllMedia } from "./mediaPlaybackManager.js";
import { startStatusCheckTimer, clearAllTimers } from "./mediaTimerManager.js";
import { checkMediaStatus, checkAutoSwitch, getCurrentTime, getDuration, getBufferedInfo } from "./mediaStatusChecker.js";

const { EventBus, utils } = deps;

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

// 媒体元素引用
let mediaElements = {
  image: null,
  video: null,
  audio: null
};

/**
 * 初始化媒体核心模块
 */
export const initMediaCore = () => {
  console.log('[mediaCore] 初始化媒体核心模块');
  
  // 加载保存的状态
  loadSavedState();
  
  // 初始化媒体元素
  mediaElements = initMediaElements();
  
  // 注册媒体事件
  registerMediaEvents(mediaElements);
  
  // 启动状态检查定时器
  startStatusCheckTimer();
  
  console.log('[mediaCore] 媒体核心模块初始化完成');
};

/**
 * 清理媒体核心模块
 */
export const cleanupMediaCore = () => {
  console.log('[mediaCore] 清理媒体核心模块');
  
  // 停止所有媒体
  stopAllMedia(mediaElements);
  
  // 清理定时器
  clearAllTimers();
  
  // 移除媒体元素
  removeMediaElements(mediaElements);
  
  // 取消事件监听
  unregisterMediaEvents(mediaElements);
  
  // 保存当前状态
  saveCurrentState();
  
  console.log('[mediaCore] 媒体核心模块清理完成');
};

/**
 * 设置媒体列表
 */
export const setMediaList = (list) => {
  mediaState.mediaList = list;
  mediaState.currentIndex = -1;
  console.log(`[mediaCore] 设置媒体列表，共 ${list.length} 个项目`);
};

/**
 * 获取媒体列表
 */
export const getMediaList = () => {
  return [...mediaState.mediaList];
};

/**
 * 设置播放模式
 */
export const setPlayMode = (mode) => {
  mediaState.playMode = mode;
  console.log(`[mediaCore] 播放模式设置为: ${mode}`);
};

/**
 * 设置自动切换模式
 */
export const setAutoSwitchMode = (mode) => {
  mediaState.autoSwitchMode = mode;
  console.log(`[mediaCore] 自动切换模式设置为: ${mode}`);
};

/**
 * 设置音量
 */
export const setVolume = (volume) => {
  mediaState.volume = volume;
  if (mediaElements.audio) {
    mediaElements.audio.volume = volume;
  }
  console.log(`[mediaCore] 音量设置为: ${volume}`);
};

/**
 * 设置视频音量
 */
export const setVideoVolume = (volume) => {
  mediaState.videoVolume = volume;
  if (mediaElements.video) {
    mediaElements.video.volume = volume;
  }
  console.log(`[mediaCore] 视频音量设置为: ${volume}`);
};

/**
 * 播放媒体
 */
export const playMedia = (media) => {
  const success = playMedia(media, mediaElements);
  if (success) {
    mediaState.currentMedia = media;
    mediaState.isPlaying = true;
    mediaState.isPaused = false;
  }
  return success;
};

/**
 * 暂停媒体
 */
export const pauseMedia = () => {
  if (mediaState.currentMedia) {
    const success = pauseMedia(mediaState.currentMedia.type, mediaElements);
    if (success) {
      mediaState.isPlaying = false;
      mediaState.isPaused = true;
    }
    return success;
  }
  return false;
};

/**
 * 恢复播放
 */
export const resumeMedia = () => {
  if (mediaState.currentMedia) {
    const success = resumeMedia(mediaState.currentMedia.type, mediaElements);
    if (success) {
      mediaState.isPlaying = true;
      mediaState.isPaused = false;
    }
    return success;
  }
  return false;
};

/**
 * 停止所有媒体
 */
export const stopAllMedia = () => {
  stopAllMedia(mediaElements);
  mediaState.isPlaying = false;
  mediaState.isPaused = false;
  mediaState.currentMedia = null;
};

/**
 * 检查媒体状态
 */
export const checkMediaStatus = () => {
  return checkMediaStatus(mediaElements, mediaState.currentMedia);
};

/**
 * 检查自动切换
 */
export const checkAutoSwitch = () => {
  return checkAutoSwitch(mediaElements, mediaState.currentMedia, mediaState.mediaList, mediaState.playMode, mediaState.autoSwitchMode);
};

/**
 * 获取当前时间
 */
export const getCurrentTime = () => {
  return getCurrentTime(mediaElements, mediaState.currentMedia);
};

/**
 * 获取总时长
 */
export const getDuration = () => {
  return getDuration(mediaElements, mediaState.currentMedia);
};

/**
 * 获取缓冲信息
 */
export const getBufferedInfo = () => {
  return getBufferedInfo(mediaElements, mediaState.currentMedia);
};

/**
 * 获取当前媒体状态
 */
export const getMediaState = () => {
  return { ...mediaState };
};

/**
 * 获取媒体元素
 */
export const getMediaElements = () => {
  return { ...mediaElements };
};