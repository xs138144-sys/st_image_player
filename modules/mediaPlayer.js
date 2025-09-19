import { deps } from "../core/deps.js";

const {
  EventBus,
  toastr,
  settings: { get, save },
  utils,
} = deps;
const { formatTime, applyTransitionEffect } = utils;

// 模块内状态
let mediaList = [];
let currentMediaIndex = 0;
let switchTimer = null;
let preloadedMedia = null;
let currentMediaType = "image";
let progressUpdateInterval = null;
const winSelector = "#st-image-player-window";

/**
 * 初始化媒体播放器
 */
export const init = () => {
  try {
    // 注册事件监听（接收外部请求）
    const removePlayListener = EventBus.on("requestMediaPlay", (data) => {
      showMedia(data?.direction || "current");
    });

    const removeStartPlaybackListener = EventBus.on(
      "requestStartPlayback",
      startPlayback
    );
    const removeStopPlaybackListener = EventBus.on(
      "requestStopPlayback",
      stopPlayback
    );
    const removeResumePlaybackListener = EventBus.on(
      "requestResumePlayback",
      startPlayback
    );
    const removeUpdateVolumeListener = EventBus.on(
      "requestUpdateVolume",
      (data) => {
        updateVolume(data.volume);
      }
    );
    const removeMediaListListener = EventBus.on(
      "mediaListRefreshed",
      (data) => {
        mediaList = data.list;
        console.log(
          `[mediaPlayer] 媒体列表已更新，共${mediaList.length}个媒体`
        );
      }
    );

    // 保存取消监听方法
    window.mediaPlayerListeners = [
      removePlayListener,
      removeStartPlaybackListener,
      removeStopPlaybackListener,
      removeResumePlaybackListener,
      removeUpdateVolumeListener,
      removeMediaListListener,
    ];

    // 初始化媒体列表
    EventBus.emit("requestRefreshMediaList");

    console.log(`[mediaPlayer] 初始化完成，已注册冊事件监听`);
  } catch (e) {
    toastr.error(`[mediaPlayer] 初始化失败: ${e.message}`);
    console.error(`[mediaPlayer] 初始化错误:`, e);
  }
};

/**
 * 清理媒体播放器资源
 */
export const cleanup = () => {
  try {
    // 清除切换定时器
    if (switchTimer) {
      clearTimeout(switchTimer);
      switchTimer = null;
    }

    // 清除进度更新定时器
    if (progressUpdateInterval) {
      clearInterval(progressUpdateInterval);
      progressUpdateInterval = null;
    }

    // 取消事件监听
    if (window.mediaPlayerListeners) {
      window.mediaPlayerListeners.forEach((removeListener) => removeListener());
      window.mediaPlayerListeners = null;
    }

    // 停止视频播放
    const $ = deps.jQuery;
    if ($) {
      const video = $(winSelector).find(".image-player-video")[0];
      if (video) video.pause();
    }

    // 释放预加载资源
    preloadedMedia = null;

    console.log(`[mediaPlayer] 资源清理理完成`);
  } catch (e) {
    toastr.error(`[mediaPlayer] 清理失败: ${e.message}`);
    console.error(`[mediaPlayer] 清理错误:`, e);
  }
};

/**
 * 获取随机媒体索引（避免重复）
 */
const getRandomMediaIndex = () => {
  const settings = get();
  const list = settings.randomMediaList || mediaList;

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
  settings.current.currentRandomIndex = randomIndex;
  settings.randomPlayedIndices.push(randomIndex);
  save();

  return randomIndex;
};

/**
 * 预加载媒体（图片/视频）
 */
const preloadMediaItem = async (url, type) => {
  const settings = get();
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
    console.warn(`[mediaPlayer] 预加载${type}失败:`, e);
    return null;
  }
};

/**
 * 显示媒体（图片/视频）
 */
export const showMedia = async (direction) => {
  const settings = get();
  const $ = deps.jQuery;
  if (!$) {
    console.warn(`[mediaPlayer] jQuery未就绪，无法显示媒体`);
    return;
  }

  const win = $(winSelector);
  const imgElement = win.find(".image-player-img")[0];
  const videoElement = win.find(".image-player-video")[0];
  const loadingElement = win.find(".loading-animation")[0];
  const infoElement = win.find(".image-info")[0];

  // 加载中 → 跳过重复调用
  if (settings.isMediaLoading) {
    console.log(`[mediaPlayer] 加载中，跳过调用`);
    return;
  }

  settings.isMediaLoading = true;
  save();

  // 清理定时器
  if (switchTimer) clearTimeout(switchTimer);
  win.find(".control-text").text("加载中...");

  try {
    // 1. 检查服务状态
    const status = await new Promise((resolve) => {
      const removeListener = EventBus.on("serviceStatusChecked", (status) => {
        removeListener();
        resolve(status);
      });
      EventBus.emit("requestCheckServiceStatus");
    });

    if (!status.active) throw new Error("媒体体服务未连接");

    // 2. 确保媒体列表最新
    mediaList = await new Promise((resolve) => {
      const removeListener = EventBus.on("mediaListRefreshed", (data) => {
        removeListener();
        resolve(data.list);
      });
      EventBus.emit("requestRefreshMediaList", {
        filterType: settings.mediaFilter,
      });
    });

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
      await new Promise((resolve) => {
        videoElement.onloadedmetadata = resolve;
      });
      videoElement.play();
      startProgressUpdate(videoElement);
    }

    // 更新信息显示
    $(infoElement).text(mediaName);
    settings.isMediaLoading = false;
    save();
    startAutoSwitch(); // 启动自动切换

  } catch (e) {
    console.error(`[mediaPlayer] 显示媒体失败:`, e);
    toastr.error(`显示媒体失败: ${e.message}`);
    settings.isMediaLoading = false;
    save();
  }
};

/**
 * 开始自动切换
 */
const startAutoSwitch = () => {
  const settings = get();
  if (settings.autoSwitchMode !== "timer" || !settings.isPlaying) return;

  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => {
    const video = $(winSelector).find(".image-player-video")[0];
    if (!video || !video.loop) {
      showMedia("next");
    } else {
      startAutoSwitch();
    }
  }, settings.autoSwitchDelay);
};

/**
 * 开始播放
 */
export const startPlayback = () => {
  const settings = get();
  settings.isPlaying = true;
  save();
  startAutoSwitch();
  const video = $(winSelector).find(".image-player-video")[0];
  if (video) video.play();
};

/**
 * 停止播放
 */
export const stopPlayback = () => {
  const settings = get();
  settings.isPlaying = false;
  save();
  clearTimeout(switchTimer);
  const video = $(winSelector).find(".image-player-video")[0];
  if (video) video.pause();
};

/**
 * 更新音量
 */
const updateVolume = (volume) => {
  const video = $(winSelector).find(".image-player-video")[0];
  if (video) {
    video.volume = volume;
  }
};

/**
 * 启动进度更新
 */
const startProgressUpdate = (video) => {
  if (progressUpdateInterval) clearInterval(progressUpdateInterval);
  progressUpdateInterval = setInterval(() => {
    updateVideoProgress(video);
  }, 1000);
};

/**
 * 停止进度更新
 */
const stopProgressUpdate = () => {
  if (progressUpdateInterval) {
    clearInterval(progressUpdateInterval);
    progressUpdateInterval = null;
  }
};

/**
 * 更新视频进度
 */
const updateVideoProgress = (video) => {
  const $win = $(winSelector);
  $win.find(".time-display").text(
    `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
  );
  const percent = (video.currentTime / video.duration) * 100;
  $win.find(".progress-played").css("width", `${percent}%`);
};