import { deps } from "../../core/deps.js";

const { utils } = deps;

// 媒体元素引用
let mediaElements = {
  image: null,
  video: null,
  audio: null
};

/**
 * 初始化媒体元素
 */
export const initMediaElements = () => {
  // 创建图片元素
  mediaElements.image = document.createElement('img');
  mediaElements.image.className = 'media-image';
  mediaElements.image.style.display = 'none';
  mediaElements.image.style.maxWidth = '100%';
  mediaElements.image.style.maxHeight = '100%';
  mediaElements.image.style.objectFit = 'contain';
  
  // 创建视频元素
  mediaElements.video = document.createElement('video');
  mediaElements.video.className = 'media-video';
  mediaElements.video.style.display = 'none';
  mediaElements.video.controls = false;
  mediaElements.video.muted = false;
  mediaElements.video.loop = false;
  
  // 创建音频元素（用于背景音乐）
  mediaElements.audio = document.createElement('audio');
  mediaElements.audio.className = 'media-audio';
  mediaElements.audio.style.display = 'none';
  
  // 添加到DOM
  document.body.appendChild(mediaElements.image);
  document.body.appendChild(mediaElements.video);
  document.body.appendChild(mediaElements.audio);
  
  console.log('[mediaElementManager] 媒体元素初始化完成');
  
  return mediaElements;
};

/**
 * 移除媒体元素
 */
export const removeMediaElements = () => {
  if (mediaElements.image && mediaElements.image.parentNode) {
    mediaElements.image.parentNode.removeChild(mediaElements.image);
  }
  if (mediaElements.video && mediaElements.video.parentNode) {
    mediaElements.video.parentNode.removeChild(mediaElements.video);
  }
  if (mediaElements.audio && mediaElements.audio.parentNode) {
    mediaElements.audio.parentNode.removeChild(mediaElements.audio);
  }
  
  mediaElements = { image: null, video: null, audio: null };
  console.log('[mediaElementManager] 媒体元素已移除');
};

/**
 * 获取媒体元素
 */
export const getMediaElements = () => {
  return { ...mediaElements };
};

/**
 * 获取特定类型的媒体元素
 */
export const getMediaElement = (type) => {
  return mediaElements[type] || null;
};

/**
 * 隐藏其他媒体元素
 */
export const hideOtherMediaElements = (currentType) => {
  Object.keys(mediaElements).forEach(type => {
    if (type !== currentType && mediaElements[type]) {
      mediaElements[type].style.display = 'none';
    }
  });
};

/**
 * 设置媒体元素属性
 */
export const setMediaElementAttribute = (type, attribute, value) => {
  if (mediaElements[type]) {
    mediaElements[type][attribute] = value;
    return true;
  }
  return false;
};

/**
 * 设置媒体元素样式
 */
export const setMediaElementStyle = (type, style, value) => {
  if (mediaElements[type]) {
    mediaElements[type].style[style] = value;
    return true;
  }
  return false;
};

/**
 * 检查媒体元素是否就绪
 */
export const isMediaElementReady = (type) => {
  const element = mediaElements[type];
  if (!element) return false;
  
  switch (type) {
    case 'image':
      return element.complete && element.naturalWidth > 0;
    case 'video':
      return element.readyState >= 2; // HAVE_CURRENT_DATA
    case 'audio':
      return element.readyState >= 2;
    default:
      return false;
  }
};