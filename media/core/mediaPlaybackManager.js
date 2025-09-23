import { deps } from "../../core/deps.js";

const { EventBus, utils } = deps;

/**
 * 播放媒体
 */
export const playMedia = (media, mediaElements) => {
  if (!media) {
    console.warn('[mediaPlaybackManager] 无法播放: 媒体对象为空');
    return false;
  }

  if (!mediaElements) {
    console.warn('[mediaPlaybackManager] 媒体元素未初始化');
    return false;
  }

  // 根据媒体类型播放
  let success = false;

  switch (media.type) {
    case 'image':
      success = playImage(media, mediaElements);
      break;
    case 'video':
      success = playVideo(media, mediaElements);
      break;
    case 'audio':
      success = playAudio(media, mediaElements);
      break;
    default:
      console.warn(`[mediaPlaybackManager] 未知的媒体类型: ${media.type}`);
      return false;
  }

  if (success) {
    console.log(`[mediaPlaybackManager] 开始播放: ${media.name} (${media.type})`);
    EventBus.emit('mediaStarted', { media, type: media.type });
  }

  return success;
};

/**
 * 播放图片
 */
const playImage = (media, mediaElements) => {
  if (!mediaElements.image) {
    console.warn('[mediaPlaybackManager] 图片元素未初始化');
    return false;
  }

  try {
    mediaElements.image.src = media.url;
    mediaElements.image.style.display = 'block';
    
    // 隐藏其他媒体元素
    hideOtherMediaElements('image', mediaElements);
    
    return true;
  } catch (error) {
    console.error('[mediaPlaybackManager] 播放图片失败:', error);
    return false;
  }
};

/**
 * 播放视频
 */
const playVideo = (media, mediaElements) => {
  if (!mediaElements.video) {
    console.warn('[mediaPlaybackManager] 视频元素未初始化');
    return false;
  }

  try {
    mediaElements.video.src = media.url;
    mediaElements.video.style.display = 'block';
    mediaElements.video.volume = 1; // 默认最大音量，实际音量由状态管理控制
    
    // 隐藏其他媒体元素
    hideOtherMediaElements('video', mediaElements);
    
    // 开始播放
    const playPromise = mediaElements.video.play();
    
    if (playPromise !== undefined) {
      playPromise.catch(error => {
        console.error('[mediaPlaybackManager] 视频播放失败:', error);
        EventBus.emit('videoPlayError', { error, src: media.url });
      });
    }
    
    return true;
  } catch (error) {
    console.error('[mediaPlaybackManager] 播放视频失败:', error);
    return false;
  }
};

/**
 * 播放音频
 */
const playAudio = (media, mediaElements) => {
  if (!mediaElements.audio) {
    console.warn('[mediaPlaybackManager] 音频元素未初始化');
    return false;
  }

  try {
    mediaElements.audio.src = media.url;
    mediaElements.audio.style.display = 'block';
    mediaElements.audio.volume = 1; // 默认最大音量
    
    // 隐藏其他媒体元素
    hideOtherMediaElements('audio', mediaElements);
    
    // 开始播放
    const playPromise = mediaElements.audio.play();
    
    if (playPromise !== undefined) {
      playPromise.catch(error => {
        console.error('[mediaPlaybackManager] 音频播放失败:', error);
        EventBus.emit('audioPlayError', { error, src: media.url });
      });
    }
    
    return true;
  } catch (error) {
    console.error('[mediaPlaybackManager] 播放音频失败:', error);
    return false;
  }
};

/**
 * 暂停媒体播放
 */
export const pauseMedia = (mediaType, mediaElements) => {
  if (!mediaElements) return false;

  try {
    switch (mediaType) {
      case 'video':
        if (mediaElements.video && !mediaElements.video.paused) {
          mediaElements.video.pause();
          return true;
        }
        break;
      case 'audio':
        if (mediaElements.audio && !mediaElements.audio.paused) {
          mediaElements.audio.pause();
          return true;
        }
        break;
      default:
        // 图片无法暂停
        return false;
    }
  } catch (error) {
    console.error('[mediaPlaybackManager] 暂停媒体失败:', error);
  }

  return false;
};

/**
 * 恢复媒体播放
 */
export const resumeMedia = (mediaType, mediaElements) => {
  if (!mediaElements) return false;

  try {
    switch (mediaType) {
      case 'video':
        if (mediaElements.video && mediaElements.video.paused) {
          return mediaElements.video.play().then(() => true).catch(() => false);
        }
        break;
      case 'audio':
        if (mediaElements.audio && mediaElements.audio.paused) {
          return mediaElements.audio.play().then(() => true).catch(() => false);
        }
        break;
      default:
        // 图片无法恢复播放
        return false;
    }
  } catch (error) {
    console.error('[mediaPlaybackManager] 恢复媒体播放失败:', error);
  }

  return false;
};

/**
 * 停止所有媒体
 */
export const stopAllMedia = (mediaElements) => {
  if (!mediaElements) return;

  try {
    // 停止视频
    if (mediaElements.video) {
      mediaElements.video.pause();
      mediaElements.video.currentTime = 0;
      mediaElements.video.style.display = 'none';
    }

    // 停止音频
    if (mediaElements.audio) {
      mediaElements.audio.pause();
      mediaElements.audio.currentTime = 0;
      mediaElements.audio.style.display = 'none';
    }

    // 隐藏图片
    if (mediaElements.image) {
      mediaElements.image.style.display = 'none';
    }

    console.log('[mediaPlaybackManager] 所有媒体已停止');
  } catch (error) {
    console.error('[mediaPlaybackManager] 停止媒体失败:', error);
  }
};

/**
 * 隐藏其他媒体元素
 */
const hideOtherMediaElements = (currentType, mediaElements) => {
  Object.keys(mediaElements).forEach(type => {
    if (type !== currentType && mediaElements[type]) {
      mediaElements[type].style.display = 'none';
    }
  });
};

/**
 * 跳转到指定时间
 */
export const seekToTime = (mediaType, timeInSeconds, mediaElements) => {
  if (!mediaElements) return false;

  try {
    switch (mediaType) {
      case 'video':
        if (mediaElements.video) {
          mediaElements.video.currentTime = timeInSeconds;
          return true;
        }
        break;
      case 'audio':
        if (mediaElements.audio) {
          mediaElements.audio.currentTime = timeInSeconds;
          return true;
        }
        break;
      default:
        // 图片无法跳转
        return false;
    }
  } catch (error) {
    console.error('[mediaPlaybackManager] 跳转时间失败:', error);
  }

  return false;
};

/**
 * 跳转媒体（供外部调用的接口）
 */
export const seekMedia = (timeInSeconds, mediaElements, currentMedia) => {
  if (!mediaElements || !currentMedia) {
    console.warn('[mediaPlaybackManager] 跳转失败: 媒体元素或当前媒体未初始化');
    return false;
  }

  if (typeof timeInSeconds !== 'number' || timeInSeconds < 0) {
    console.warn('[mediaPlaybackManager] 跳转失败: 无效的时间值');
    return false;
  }

  // 只有视频和音频可以跳转
  if (currentMedia.type !== 'video' && currentMedia.type !== 'audio') {
    console.warn('[mediaPlaybackManager] 跳转失败: 只有视频和音频支持跳转');
    return false;
  }

  return seekToTime(currentMedia.type, timeInSeconds, mediaElements);
};