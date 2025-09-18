const $ = window.jQuery || window.$;
import { getSettings, saveSafeSettings } from "./settings.js";
import { getSafeToastr, formatTime, applyTransitionEffect } from "./utils.js";
import { refreshMediaList } from "./api.js";

// 模块内状态（避免全局污染）
let mediaList = [];
let currentMediaIndex = 0;
let switchTimer = null;
let preloadedMedia = null;
let currentMediaType = "image";
let progressDrag = false;
let volumeDrag = false;

const toastr = getSafeToastr();
const winSelector = "#st-image-player-window";

/**
 * 初始化媒体播放器状态
 */
export const initMediaPlayer = async () => {
  mediaList = await refreshMediaList();
  currentMediaIndex = 0;
  console.log(`[MediaPlayer] 初始化完成，媒体数量: ${mediaList.length}`);
};

/**
 * 获取随机媒体索引（避免重复）
 * @returns {number} 随机索引
 */
export const getRandomMediaIndex = () => {
  const settings = getSettings();
  const list = settings.randomMediaList || [];

  // 空列表兜底
  if (list.length === 0) return 0;

  // 所有媒体已播放 → 重置
  if (settings.randomPlayedIndices.length >= list.length) {
    settings.randomPlayedIndices = [];
    toastr.info("随机播放列表已循环，重新开始");
  }

  // 筛选可用索引
  let availableIndices = list
    .map((_, i) => i)
    .filter((i) => !settings.randomPlayedIndices.includes(i));

  // 极端情况：索引为空 → 强制重置
  if (availableIndices.length === 0) {
    settings.randomPlayedIndices = [];
    availableIndices = list.map((_, i) => i);
  }

  // 随机选择并记录
  const randomIndex =
    availableIndices[Math.floor(Math.random() * availableIndices.length)];
  settings.currentRandomIndex = randomIndex;
  settings.randomPlayedIndices.push(randomIndex);
  return randomIndex;
};

/**
 * 预加载媒体（图片/视频）
 * @param {string} url - 媒体URL
 * @param {string} type - 媒体类型（image/video）
 * @returns {Promise<HTMLImageElement|HTMLVideoElement|null>} 预加载元素
 */
export const preloadMediaItem = async (url, type) => {
  const settings = getSettings();

  // 跳过预加载的情况
  if (
    (type === "video" && !settings.preloadVideos) ||
    (type === "image" && !settings.preloadImages)
  ) {
    return null;
  }

  try {
    return await new Promise((resolve, reject) => {
      if (type === "image") {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("图片预加载失败"));
        img.src = url;
      } else if (type === "video") {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve(video);
        video.onerror = () => reject(new Error("视频预加载失败"));
        video.src = url;
      } else {
        resolve(null);
      }
    });
  } catch (e) {
    console.warn(`[MediaPlayer] 预加载${type}失败:`, e);
    return null;
  }
};

/**
 * 显示媒体（图片/视频）
 * @param {string} direction - 方向（next/prev/current）
 * @returns {Promise<void>}
 */
export const showMedia = async (direction) => {
  const settings = getSettings();
  const win = $(winSelector);
  const imgElement = win.find(".image-player-img")[0];
  const videoElement = win.find(".image-player-video")[0];
  const loadingElement = win.find(".loading-animation")[0];
  const infoElement = win.find(".image-info")[0];

  // 加载中 → 跳过重复调用
  if (settings.isMediaLoading) {
    console.log(`[MediaPlayer] 加载中，跳过调用`);
    return;
  }
  settings.isMediaLoading = true;

  // 清理定时器
  if (switchTimer) clearTimeout(switchTimer);
  win.find(".control-text").text("加载中...");

  try {
    // 1. 服务状态检查
    const serviceStatus = await import("./api.js").then(
      ({ checkServiceStatus }) => checkServiceStatus()
    );
    if (!serviceStatus.active) throw new Error("媒体服务未连接");

    // 2. 媒体列表更新
    mediaList = await refreshMediaList();
    if (mediaList.length === 0)
      throw new Error(`无可用${settings.mediaFilter}媒体`);

    // 3. 隐藏当前媒体，显示加载中
    $(imgElement).hide();
    $(videoElement).hide();
    $(loadingElement).show();

    // 4. 确定当前媒体（随机/顺序）
    let mediaUrl, mediaName, mediaType;
    if (settings.playMode === "random") {
      const list = settings.randomMediaList || mediaList;
      let randomIndex = -1;

      switch (direction) {
        case "next":
          randomIndex = getRandomMediaIndex();
          break;
        case "prev":
          if (settings.randomPlayedIndices.length > 1) {
            settings.randomPlayedIndices.pop();
            randomIndex = settings.randomPlayedIndices.pop();
            settings.randomPlayedIndices.push(randomIndex);
            settings.currentRandomIndex = randomIndex;
          } else {
            randomIndex = settings.randomPlayedIndices[0] || 0;
          }
          break;
        case "current":
          randomIndex =
            settings.currentRandomIndex !== -1
              ? settings.currentRandomIndex
              : getRandomMediaIndex();
          break;
      }

      // 索引安全检查
      randomIndex = Math.max(0, Math.min(randomIndex, list.length - 1));
      const media = list[randomIndex];
      mediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
        media.rel_path
      )}`;
      mediaName = media.name;
      mediaType = media.media_type;
    } else {
      // 顺序播放 → 更新索引
      switch (direction) {
        case "next":
          currentMediaIndex = (currentMediaIndex + 1) % mediaList.length;
          break;
        case "prev":
          currentMediaIndex =
            (currentMediaIndex - 1 + mediaList.length) % mediaList.length;
          break;
        case "current":
          currentMediaIndex = Math.max(
            0,
            Math.min(currentMediaIndex, mediaList.length - 1)
          );
          break;
      }

      const media = mediaList[currentMediaIndex];
      mediaUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
        media.rel_path
      )}`;
      mediaName = media.name;
      mediaType = media.media_type;
    }
    currentMediaType = mediaType;

    // 5. 隐藏加载，显示媒体
    $(loadingElement).hide();
    if (mediaType === "image") {
      // 显示图片
      applyTransitionEffect(imgElement, settings.transitionEffect);
      if (preloadedMedia && preloadedMedia.src === mediaUrl) {
        $(imgElement).attr("src", mediaUrl).show();
      } else {
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            $(imgElement).attr("src", mediaUrl).show();
            resolve();
          };
          img.onerror = () => reject(new Error("图片加载失败"));
          img.src = mediaUrl;
        });
      }
      $(videoElement).hide();
      stopProgressUpdate(); // 停止视频进度更新
    } else if (mediaType === "video") {
      // 显示视频
      videoElement.currentTime = 0;
      videoElement.loop = settings.videoLoop;
      $(videoElement).attr("src", mediaUrl).show();

      // 等待视频元数据加载
      await new Promise((resolve, reject) => {
        const loadHandler = () => {
          videoElement.removeEventListener("loadedmetadata", loadHandler);
          resolve();
        };
        const errorHandler = () => {
          videoElement.removeEventListener("error", errorHandler);
          reject(new Error("视频加载失败"));
        };
        videoElement.addEventListener("loadedmetadata", loadHandler);
        videoElement.addEventListener("error", errorHandler);
      });

      $(imgElement).hide();
      // 自动播放（处理浏览器限制）
      if (settings.isPlaying) {
        videoElement
          .play()
          .then(() => {
            startProgressUpdate();
          })
          .catch(() => {
            console.warn(`[MediaPlayer] 视频自动播放失败（浏览器限制）`);
            win.find(".control-text").text("点击视频手动播放");
          });
      }
    }

    // 6. 显示媒体信息
    if (settings.showInfo) {
      $(infoElement).text(`${mediaName}(${mediaType})`).show();
    } else {
      $(infoElement).hide();
    }

    // 7. 更新控制栏文本
    const totalCount =
      settings.playMode === "random"
        ? settings.randomMediaList.length || 0
        : mediaList.length;
    const currentCount =
      settings.playMode === "random"
        ? settings.randomPlayedIndices.length
        : currentMediaIndex + 1;
    win
      .find(".control-text")
      .text(
        `${
          settings.playMode === "random" ? "随机模式" : "顺序模式"
        }: ${currentCount}/${totalCount}(${mediaType})`
      );

    // 8. 预加载下一个媒体
    const nextUrl = await getNextMediaUrl();
    if (nextUrl) {
      preloadedMedia = await preloadMediaItem(nextUrl, currentMediaType);
    }
  } catch (e) {
    console.error(`[MediaPlayer] 显示媒体失败:`, e);
    let errorMsg = "媒体加载失败";
    if (e.message.includes("Failed to fetch")) errorMsg = "服务连接失败";
    else if (e.message.includes("404")) errorMsg = "媒体文件不存在";
    else if (e.message.includes("无可用")) errorMsg = e.message;

    // 重试逻辑（最多3次）
    if (settings.retryCount === undefined) settings.retryCount = 0;
    if (settings.retryCount < 3 && settings.enabled) {
      settings.retryCount++;
      toastr.warning(`${errorMsg}，重试中（${settings.retryCount}/3）`);
      setTimeout(() => showMedia(direction), 3000);
    } else {
      settings.retryCount = 0;
      toastr.error(`${errorMsg}，已停止重试`);
      win.find(".control-text").text("加载失败");
      $(loadingElement).hide();
    }
  } finally {
    settings.isMediaLoading = false;
    saveSafeSettings();
  }
};

/**
 * 获取下一个媒体的URL（用于预加载）
 * @returns {Promise<string|null>} 下一个媒体URL
 */
const getNextMediaUrl = async () => {
  const settings = getSettings();
  mediaList = await refreshMediaList();

  if (settings.playMode === "random") {
    const nextIndex = getRandomMediaIndex();
    const list = settings.randomMediaList || mediaList;
    if (nextIndex >= 0 && nextIndex < list.length) {
      return `${settings.serviceUrl}/file/${encodeURIComponent(
        list[nextIndex].rel_path
      )}`;
    }
  } else {
    const nextIndex = (currentMediaIndex + 1) % mediaList.length;
    if (nextIndex >= 0 && nextIndex < mediaList.length) {
      return `${settings.serviceUrl}/file/${encodeURIComponent(
        mediaList[nextIndex].rel_path
      )}`;
    }
  }
  return null;
};

/**
 * 开始播放（定时切换）
 */
export const startPlayback = () => {
  const settings = getSettings();
  if (!settings.masterEnabled || !settings.enabled) return;

  // 清理旧定时器（避免叠加）
  if (switchTimer) clearTimeout(switchTimer);

  const win = $(winSelector);
  const video = win.find(".image-player-video")[0];
  const isVideoVisible = video && video.style.display !== "none";

  // 视频播放逻辑
  if (isVideoVisible) {
    if (video.paused && settings.isPlaying) {
      video.play().catch(() => {
        toastr.warning("请点击视频手动播放");
      });
      startProgressUpdate();
    }
    // 续设定时器
    switchTimer = setTimeout(startPlayback, settings.switchInterval);
    return;
  }

  // 图片播放逻辑（立即执行+强制定时器）
  (async () => {
    try {
      await showMedia("next");
      console.log(`[MediaPlayer] 图片切换成功，续设定时器`);
    } catch (e) {
      console.error(`[MediaPlayer] 图片切换失败，重试当前`, e);
      if (settings.isPlaying) await showMedia("current");
    } finally {
      // 续设定时器（最低1秒间隔，防止卡死）
      if (
        settings.enabled &&
        settings.isPlaying &&
        settings.autoSwitchMode === "timer"
      ) {
        const delay = Math.max(1000, settings.switchInterval);
        switchTimer = setTimeout(startPlayback, delay);
      }
    }
  })();
};

/**
 * 停止播放（清理定时器）
 */
export const stopPlayback = () => {
  if (switchTimer) {
    clearTimeout(switchTimer);
    switchTimer = null;
  }
  const video = $(winSelector).find(".image-player-video")[0];
  if (video) video.pause();
  stopProgressUpdate();
};

/**
 * 更新视频进度条
 * @param {number} progress - 进度（0-1）
 */
export const updateProgressBar = (progress) => {
  const settings = getSettings();
  if (!settings.customVideoControls.showProgress) return;

  progress = Math.max(0, Math.min(1, progress));
  $(winSelector)
    .find(".progress-played")
    .css("width", `${progress * 100}%`);
  $(winSelector)
    .find(".progress-handle")
    .css("left", `${progress * 100}%`);
};

/**
 * 更新音量
 * @param {number} volume - 音量（0-1）
 */
export const updateVolume = (volume) => {
  const settings = getSettings();
  if (!settings.customVideoControls.showVolume) return;

  volume = Math.max(0, Math.min(1, volume));
  settings.videoVolume = volume;
  saveSafeSettings();

  // 更新视频音量
  const video = $(winSelector).find(".image-player-video")[0];
  if (video) video.volume = volume;

  // 更新音量图标
  const icon = $(winSelector).find(".volume-btn i");
  if (volume === 0) {
    icon.removeClass("fa-volume-high fa-volume-low").addClass("fa-volume-mute");
  } else if (volume < 0.5) {
    icon.removeClass("fa-volume-high fa-volume-mute").addClass("fa-volume-low");
  } else {
    icon.removeClass("fa-volume-low fa-volume-mute").addClass("fa-volume-high");
  }

  // 更新音量滑块
  $(winSelector).find(".volume-slider").val(volume);
};

/**
 * 开始更新视频进度
 */
export const startProgressUpdate = () => {
  const settings = getSettings();
  if (
    !settings.customVideoControls.showProgress &&
    !settings.customVideoControls.showTime
  )
    return;

  stopProgressUpdate(); // 先停止旧的更新

  settings.progressUpdateInterval = setInterval(() => {
    const video = $(winSelector).find(".image-player-video")[0];
    if (!video || video.paused || isNaN(video.duration)) return;

    // 更新进度条
    const progress = video.currentTime / video.duration;
    updateProgressBar(progress);

    // 更新时间显示
    if (settings.customVideoControls.showTime) {
      $(winSelector).find(".current-time").text(formatTime(video.currentTime));
    }
  }, 500);
};

/**
 * 停止更新视频进度
 */
export const stopProgressUpdate = () => {
  const settings = getSettings();
  if (settings.progressUpdateInterval) {
    clearInterval(settings.progressUpdateInterval);
    settings.progressUpdateInterval = null;
  }
};
