import { deps } from "../../core/deps.js";

const { EventBus } = deps;

// 事件处理器引用
let eventHandlers = {};

/**
 * 注册媒体事件
 */
export const registerMediaEvents = (mediaElements) => {
  if (!mediaElements) {
    console.warn('[mediaEventManager] 媒体元素为空，无法注册事件');
    return;
  }

  // 视频事件处理器
  if (mediaElements.video) {
    eventHandlers.video = {
      loadedmetadata: handleVideoMetadata,
      timeupdate: handleVideoTimeUpdate,
      ended: handleVideoEnded,
      error: handleVideoError,
      canplay: handleVideoCanPlay,
      waiting: handleVideoWaiting,
      playing: handleVideoPlaying,
      pause: handleVideoPause
    };

    Object.entries(eventHandlers.video).forEach(([event, handler]) => {
      mediaElements.video.addEventListener(event, handler);
    });
  }

  // 音频事件处理器
  if (mediaElements.audio) {
    eventHandlers.audio = {
      ended: handleAudioEnded,
      error: handleAudioError
    };

    Object.entries(eventHandlers.audio).forEach(([event, handler]) => {
      mediaElements.audio.addEventListener(event, handler);
    });
  }

  // 图片事件处理器
  if (mediaElements.image) {
    eventHandlers.image = {
      load: handleImageLoad,
      error: handleImageError
    };

    Object.entries(eventHandlers.image).forEach(([event, handler]) => {
      mediaElements.image.addEventListener(event, handler);
    });
  }

  console.log('[mediaEventManager] 媒体事件监听器已注册');
};

/**
 * 取消媒体事件监听
 */
export const unregisterMediaEvents = (mediaElements) => {
  if (!mediaElements) {
    console.warn('[mediaEventManager] 媒体元素为空，无法取消事件');
    return;
  }

  // 取消视频事件
  if (mediaElements.video && eventHandlers.video) {
    Object.entries(eventHandlers.video).forEach(([event, handler]) => {
      mediaElements.video.removeEventListener(event, handler);
    });
  }

  // 取消音频事件
  if (mediaElements.audio && eventHandlers.audio) {
    Object.entries(eventHandlers.audio).forEach(([event, handler]) => {
      mediaElements.audio.removeEventListener(event, handler);
    });
  }

  // 取消图片事件
  if (mediaElements.image && eventHandlers.image) {
    Object.entries(eventHandlers.image).forEach(([event, handler]) => {
      mediaElements.image.removeEventListener(event, handler);
    });
  }

  eventHandlers = {};
  console.log('[mediaEventManager] 媒体事件监听器已取消');
};

// ==================== 视频事件处理器 ====================

const handleVideoMetadata = (event) => {
  EventBus.emit('videoMetadataLoaded', { 
    duration: event.target.duration * 1000 
  });
};

const handleVideoTimeUpdate = (event) => {
  EventBus.emit('videoTimeUpdate', { 
    currentTime: event.target.currentTime * 1000,
    duration: event.target.duration * 1000
  });
};

const handleVideoEnded = (event) => {
  EventBus.emit('videoEnded');
};

const handleVideoError = (event) => {
  EventBus.emit('videoError', { 
    error: event.target.error,
    src: event.target.src 
  });
};

const handleVideoCanPlay = (event) => {
  EventBus.emit('videoCanPlay');
};

const handleVideoWaiting = (event) => {
  EventBus.emit('videoWaiting');
};

const handleVideoPlaying = (event) => {
  EventBus.emit('videoPlaying');
};

const handleVideoPause = (event) => {
  EventBus.emit('videoPaused');
};

// ==================== 音频事件处理器 ====================

const handleAudioEnded = (event) => {
  EventBus.emit('audioEnded');
};

const handleAudioError = (event) => {
  EventBus.emit('audioError', { 
    error: event.target.error,
    src: event.target.src 
  });
};

// ==================== 图片事件处理器 ====================

const handleImageLoad = (event) => {
  EventBus.emit('imageLoaded', { 
    width: event.target.naturalWidth,
    height: event.target.naturalHeight,
    src: event.target.src 
  });
};

const handleImageError = (event) => {
  EventBus.emit('imageError', { 
    src: event.target.src 
  });
};

/**
 * 获取事件处理器
 */
export const getEventHandlers = () => {
  return { ...eventHandlers };
};