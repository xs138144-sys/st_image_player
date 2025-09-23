import { deps } from "../../core/deps.js";

const { EventBus } = deps;

/**
 * 检查媒体状态
 */
export const checkMediaStatus = (mediaElements, currentMedia) => {
  if (!mediaElements) return;

  try {
    // 检查视频状态
    if (mediaElements.video && mediaElements.video.style.display !== 'none') {
      checkVideoStatus(mediaElements.video, currentMedia);
    }

    // 检查音频状态
    if (mediaElements.audio && mediaElements.audio.style.display !== 'none') {
      checkAudioStatus(mediaElements.audio, currentMedia);
    }

    // 检查图片状态
    if (mediaElements.image && mediaElements.image.style.display !== 'none') {
      checkImageStatus(mediaElements.image, currentMedia);
    }
  } catch (error) {
    console.error('[mediaStatusChecker] 检查媒体状态失败:', error);
  }
};

/**
 * 检查视频状态
 */
const checkVideoStatus = (videoElement, currentMedia) => {
  if (!videoElement) return;

  // 检查错误状态
  if (videoElement.error) {
    console.error('[mediaStatusChecker] 视频播放错误:', videoElement.error);
    EventBus.emit('videoError', { 
      error: videoElement.error, 
      src: videoElement.src,
      media: currentMedia 
    });
    return;
  }

  // 检查网络状态
  if (videoElement.networkState === videoElement.NETWORK_NO_SOURCE) {
    console.warn('[mediaStatusChecker] 视频无源');
    EventBus.emit('videoNoSource', { src: videoElement.src, media: currentMedia });
    return;
  }

  // 检查就绪状态
  if (videoElement.readyState >= videoElement.HAVE_ENOUGH_DATA) {
    // 视频已准备好播放
    EventBus.emit('videoReady', { 
      duration: videoElement.duration,
      src: videoElement.src,
      media: currentMedia 
    });
  }

  // 检查播放状态
  if (!videoElement.paused) {
    EventBus.emit('videoPlaying', {
      currentTime: videoElement.currentTime,
      duration: videoElement.duration,
      src: videoElement.src,
      media: currentMedia
    });
  }
};

/**
 * 检查音频状态
 */
const checkAudioStatus = (audioElement, currentMedia) => {
  if (!audioElement) return;

  // 检查错误状态
  if (audioElement.error) {
    console.error('[mediaStatusChecker] 音频播放错误:', audioElement.error);
    EventBus.emit('audioError', { 
      error: audioElement.error, 
      src: audioElement.src,
      media: currentMedia 
    });
    return;
  }

  // 检查网络状态
  if (audioElement.networkState === audioElement.NETWORK_NO_SOURCE) {
    console.warn('[mediaStatusChecker] 音频无源');
    EventBus.emit('audioNoSource', { src: audioElement.src, media: currentMedia });
    return;
  }

  // 检查就绪状态
  if (audioElement.readyState >= audioElement.HAVE_ENOUGH_DATA) {
    // 音频已准备好播放
    EventBus.emit('audioReady', { 
      duration: audioElement.duration,
      src: audioElement.src,
      media: currentMedia 
    });
  }

  // 检查播放状态
  if (!audioElement.paused) {
    EventBus.emit('audioPlaying', {
      currentTime: audioElement.currentTime,
      duration: audioElement.duration,
      src: audioElement.src,
      media: currentMedia
    });
  }
};

/**
 * 检查图片状态
 */
const checkImageStatus = (imageElement, currentMedia) => {
  if (!imageElement) return;

  // 检查图片加载状态
  if (imageElement.complete) {
    if (imageElement.naturalWidth === 0) {
      // 图片加载失败
      console.error('[mediaStatusChecker] 图片加载失败');
      EventBus.emit('imageLoadError', { 
        src: imageElement.src,
        media: currentMedia 
      });
    } else {
      // 图片加载成功
      EventBus.emit('imageLoaded', {
        width: imageElement.naturalWidth,
        height: imageElement.naturalHeight,
        src: imageElement.src,
        media: currentMedia
      });
    }
  }
};

/**
 * 检查自动切换条件
 */
export const checkAutoSwitch = (mediaElements, currentMedia, mediaList, playMode, autoSwitchMode) => {
  if (!mediaElements || !currentMedia || !mediaList || mediaList.length === 0) {
    return false;
  }

  // 根据播放模式决定是否自动切换
  if (playMode === 'single' && autoSwitchMode === 'manual') {
    return false; // 单曲播放且手动切换模式
  }

  // 检查当前媒体是否播放完毕
  const isMediaFinished = checkMediaFinished(mediaElements, currentMedia);
  
  if (isMediaFinished) {
    console.log('[mediaStatusChecker] 媒体播放完毕，准备自动切换');
    EventBus.emit('mediaFinished', { media: currentMedia });
    return true;
  }

  return false;
};

/**
 * 检查媒体是否播放完毕
 */
const checkMediaFinished = (mediaElements, currentMedia) => {
  if (!mediaElements || !currentMedia) return false;

  switch (currentMedia.type) {
    case 'video':
      if (mediaElements.video) {
        return mediaElements.video.ended;
      }
      break;
    case 'audio':
      if (mediaElements.audio) {
        return mediaElements.audio.ended;
      }
      break;
    case 'image':
      // 图片没有播放完毕的概念，永远返回false
      return false;
    default:
      return false;
  }

  return false;
};

/**
 * 获取当前播放时间
 */
export const getCurrentTime = (mediaElements, currentMedia) => {
  if (!mediaElements || !currentMedia) return 0;

  switch (currentMedia.type) {
    case 'video':
      return mediaElements.video ? mediaElements.video.currentTime : 0;
    case 'audio':
      return mediaElements.audio ? mediaElements.audio.currentTime : 0;
    case 'image':
      return 0; // 图片没有时间概念
    default:
      return 0;
  }
};

/**
 * 获取媒体总时长
 */
export const getDuration = (mediaElements, currentMedia) => {
  if (!mediaElements || !currentMedia) return 0;

  switch (currentMedia.type) {
    case 'video':
      return mediaElements.video ? mediaElements.video.duration : 0;
    case 'audio':
      return mediaElements.audio ? mediaElements.audio.duration : 0;
    case 'image':
      return 0; // 图片没有时长概念
    default:
      return 0;
  }
};

/**
 * 获取缓冲信息
 */
export const getBufferedInfo = (mediaElements, currentMedia) => {
  if (!mediaElements || !currentMedia) return { buffered: 0, percentage: 0 };

  let buffered = 0;
  let percentage = 0;

  switch (currentMedia.type) {
    case 'video':
      if (mediaElements.video && mediaElements.video.buffered.length > 0) {
        buffered = mediaElements.video.buffered.end(0);
        percentage = (buffered / mediaElements.video.duration) * 100;
      }
      break;
    case 'audio':
      if (mediaElements.audio && mediaElements.audio.buffered.length > 0) {
        buffered = mediaElements.audio.buffered.end(0);
        percentage = (buffered / mediaElements.audio.duration) * 100;
      }
      break;
    default:
      // 图片和未知类型没有缓冲信息
      break;
  }

  return { buffered, percentage };
};