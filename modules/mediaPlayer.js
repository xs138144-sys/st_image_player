import { deps } from "../core/deps.js";

const {
  EventBus,
  toastr,
  settings: { get, save },
  utils: { formatTime, applyTransitionEffect }
} = deps;

const winSelector = "#st-image-player-window";
let currentMediaIndex = 0;
let mediaList = [];
let videoPlaybackTimer = null;
let autoSwitchTimer = null;
let videoSeekInProgress = false; // 新增：跟踪视频 seek 状态

/**
 * 初始化媒体播放器模块
 */
export const init = () => {
  try {
    // 注册事件监听
    const removePlayListener = EventBus.on("requestMediaPlay", (data) => {
      playMedia(data?.direction || "current");
    });

    const removePauseListener = EventBus.on("requestMediaPause", pauseMedia);
    const removeNextListener = EventBus.on("requestMediaNext", () => playMedia("next"));
    const removePrevListener = EventBus.on("requestMediaPrev", () => playMedia("prev"));
    const removeModeListener = EventBus.on("requestTogglePlayMode", togglePlayMode);
    const removeSwitchModeListener = EventBus.on("requestToggleAutoSwitchMode", toggleAutoSwitchMode);
    const removeListListener = EventBus.on("mediaListRefreshed", (data) => {
      mediaList = data.list;
      updateMediaDisplay();

      // 如果没有媒体，更新状态显示
      if (mediaList.length === 0) {
        EventBus.emit("requestUpdateStatusDisplay", {
          type: "warning",
          message: "未找到媒体文件，请检查目录设置"
        });
      } else {
        EventBus.emit("requestUpdateStatusDisplay", {
          type: "ready",
          count: mediaList.length
        });
      }
    });
    const removeResumeListener = EventBus.on("requestResumePlayback", resumePlayback);
    const removeVolumeListener = EventBus.on("requestUpdateVolume", (data) => {
      updateVolume(data.volume);
    });
    const removeVideoSeekListener = EventBus.on("requestVideoSeek", (data) => {
      videoSeek(data.position);
    });

    // 保存事件监听器以便清理
    window.mediaPlayerListeners = [
      removePlayListener,
      removePauseListener,
      removeNextListener,
      removePrevListener,
      removeModeListener,
      removeSwitchModeListener,
      removeListListener,
      removeResumeListener,
      removeVolumeListener,
      removeVideoSeekListener
    ];

    // 初始化媒体列表
    EventBus.emit("requestRefreshMediaList");

    console.log(`[mediaPlayer] 初始化完成`);
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
    // 清除定时器
    if (videoPlaybackTimer) {
      clearInterval(videoPlaybackTimer);
      videoPlaybackTimer = null;
    }
    if (autoSwitchTimer) {
      clearInterval(autoSwitchTimer);
      autoSwitchTimer = null;
    }

    // 暂停所有播放
    pauseMedia();

    // 取消事件监听
    if (window.mediaPlayerListeners) {
      window.mediaPlayerListeners.forEach((removeListener) => removeListener());
      window.mediaPlayerListeners = null;
    }

    console.log(`[mediaPlayer] 资源清理完成`);
  } catch (e) {
    toastr.error(`[mediaPlayer] 清理失败: ${e.message}`);
    console.error(`[mediaPlayer] 清理错误:`, e);
  }
};

/**
 * 更新媒体显示信息
 */
const updateMediaDisplay = () => {
  const settings = get();
  const $ = deps.jQuery;
  if (!$ || !mediaList.length) return;

  // 更新播放模式显示
  const modeText = settings.playMode === "random"
    ? "随机模式"
    : `顺序模式: ${currentMediaIndex + 1}/${mediaList.length}`;
  $(winSelector).find(".control-text").text(modeText);

  // 更新筛选按钮状态
  $(winSelector).find(".media-filter-btn").removeClass("active");
  $(winSelector).find(`.media-filter-btn[data-type="${settings.mediaFilter}"]`).addClass("active");
};

/**
 * 播放媒体
 * @param {string} direction - 播放方向: current, next, prev
 */
export const playMedia = (direction = "current") => {
  const settings = get();
  const $ = deps.jQuery;
  if (!$ || !mediaList.length) return;

  const prevIndex = currentMediaIndex;

  // 根据方向更新索引
  if (direction === "next") {
    if (settings.playMode === "random") {
      // 随机模式
      if (settings.randomPlayedIndices.length >= mediaList.length) {
        // 所有媒体已播放过，重置
        settings.randomPlayedIndices = [];
        toastr.info("已循环播放所有媒体，将重新开始随机播放");
      }

      // 找到未播放过的媒体
      let newIndex;
      do {
        newIndex = Math.floor(Math.random() * mediaList.length);
      } while (settings.randomPlayedIndices.includes(newIndex) && mediaList.length > 1);

      currentMediaIndex = newIndex;
      settings.randomPlayedIndices.push(newIndex);
      settings.currentRandomIndex = newIndex;
    } else {
      // 顺序模式
      currentMediaIndex = (currentMediaIndex + 1) % mediaList.length;
    }
  } else if (direction === "prev") {
    // 上一个
    currentMediaIndex = (currentMediaIndex - 1 + mediaList.length) % mediaList.length;
  }

  // 保存当前播放位置
  settings.lastPlayed = mediaList[currentMediaIndex].path;
  save();

  // 显示加载状态
  $(winSelector).find(".loading-animation").show();
  $(winSelector).find(".image-player-img, .image-player-video").hide();
  $(winSelector).find(".video-progress-controls").hide();

  const media = mediaList[currentMediaIndex];

  // 更新媒体信息显示
  $(winSelector).find(".image-info").html(`
    <strong>${media.name}</strong><br>
    类型: ${media.media_type === "image" ? "图片" : "视频"}<br>
    大小: ${formatFileSize(media.size)}<br>
    修改时间: ${new Date(media.last_modified * 1000).toLocaleString()}
  `);

  if (media.media_type === "image") {
    // 处理图片
    handleImagePlayback(media, prevIndex !== currentMediaIndex);
  } else {
    // 处理视频
    handleVideoPlayback(media);
  }

  // 更新播放状态
  settings.isPlaying = true;
  $(winSelector).find(".play-pause i")
    .removeClass("fa-play fa-pause")
    .addClass("fa-pause");

  updateMediaDisplay();
  save();

  // 设置自动切换（如果需要）
  setupAutoSwitch();
};

/**
 * 处理图片播放
 */
const handleImagePlayback = (media, applyTransition = true) => {
  const $ = deps.jQuery;
  const imgElement = $(winSelector).find(".image-player-img")[0];
  const settings = get();

  // 隐藏视频元素和控制条
  $(winSelector).find(".image-player-video").hide();
  $(winSelector).find(".video-progress-controls").hide();

  // 预加载图片
  const img = new Image();
  img.onload = () => {
    // 应用过渡效果
    if (applyTransition) {
      applyTransitionEffect(imgElement, settings.transitionEffect || "fade");
    }

    // 更新图片源并显示
    imgElement.src = img.src;
    $(imgElement).show();
    $(winSelector).find(".loading-animation").hide();
  };

  img.onerror = () => {
    console.error(`加载图片失败: ${media.path}`);
    toastr.error(`加载图片失败: ${media.name}`);
    $(winSelector).find(".loading-animation").hide();
    // 自动尝试下一张
    setTimeout(() => playMedia("next"), 1000);
  };

  // 设置图片源
  img.src = `${settings.serviceUrl}/media/file?path=${encodeURIComponent(media.rel_path)}`;
};

/**
 * 处理视频播放
 */
const handleVideoPlayback = (media) => {
  const $ = deps.jQuery;
  const videoElement = $(winSelector).find(".image-player-video")[0];
  const settings = get();

  // 隐藏图片元素
  $(winSelector).find(".image-player-img").hide();

  // 显示视频控制条（如果启用）
  if (settings.showVideoControls) {
    $(winSelector).find(".video-progress-controls").show();
  }

  // 更新视频源
  videoElement.src = `${settings.serviceUrl}/media/file?path=${encodeURIComponent(media.rel_path)}`;

  // 处理预加载
  if (settings.mediaConfig.preload_strategy.video) {
    videoElement.preload = "auto";
  } else {
    videoElement.preload = "metadata";
  }

  // 设置音量
  videoElement.volume = settings.videoVolume;

  // 视频加载完成后播放
  videoElement.onloadedmetadata = () => {
    $(winSelector).find(".total-time").text(formatTime(videoElement.duration));
    $(winSelector).find(".loading-animation").hide();
    $(videoElement).show();

    // 如果启用循环，则设置视频循环
    videoElement.loop = settings.videoLoop;

    // 开始播放
    videoElement.play().catch(e => {
      console.error(`视频播放失败:`, e);
      toastr.warning("视频自动播放失败，请点击播放按钮");
    });

    // 更新进度条
    updateVideoProgress();
  };

  // 视频播放结束
  videoElement.onended = () => {
    if (!settings.videoLoop) {
      playMedia("next");
    }
  };

  // 视频进度更新
  if (!videoPlaybackTimer) {
    videoPlaybackTimer = setInterval(updateVideoProgress, 1000);
  }
};

/**
 * 更新视频进度
 */
const updateVideoProgress = () => {
  if (videoSeekInProgress) return; // 正在拖动时不更新

  const $ = deps.jQuery;
  const videoElement = $(winSelector).find(".image-player-video")[0];
  if (!videoElement || videoElement.paused) return;

  // 更新时间显示
  $(winSelector).find(".current-time").text(formatTime(videoElement.currentTime));

  // 更新进度条
  const progress = (videoElement.currentTime / videoElement.duration) * 100;
  $(winSelector).find(".progress-played").css("width", `${progress}%`);

  // 更新已加载部分
  if (videoElement.buffered.length > 0) {
    const bufferedEnd = videoElement.buffered.end(videoElement.buffered.length - 1);
    const bufferedProgress = (bufferedEnd / videoElement.duration) * 100;
    $(winSelector).find(".progress-loaded").css("width", `${bufferedProgress}%`);
  }
};

/**
 * 视频定位
 */
const videoSeek = (position) => {
  const $ = deps.jQuery;
  const videoElement = $(winSelector).find(".image-player-video")[0];
  if (!videoElement) return;

  try {
    videoSeekInProgress = true;
    const newTime = position * videoElement.duration;
    videoElement.currentTime = newTime;
    $(winSelector).find(".current-time").text(formatTime(newTime));
    $(winSelector).find(".progress-played").css("width", `${position * 100}%`);

    // 短暂延迟后允许进度更新
    setTimeout(() => {
      videoSeekInProgress = false;
    }, 300);
  } catch (e) {
    console.error("视频定位失败:", e);
    videoSeekInProgress = false;
  }
};

/**
 * 暂停媒体播放
 */
export const pauseMedia = () => {
  const settings = get();
  const $ = deps.jQuery;

  // 暂停图片自动切换
  if (autoSwitchTimer) {
    clearInterval(autoSwitchTimer);
    autoSwitchTimer = null;
  }

  // 暂停视频播放
  const videoElement = $(winSelector).find(".image-player-video")[0];
  if (videoElement && !videoElement.paused) {
    videoElement.pause();
  }

  // 更新播放状态
  settings.isPlaying = false;
  $(winSelector).find(".play-pause i")
    .removeClass("fa-play fa-pause")
    .addClass("fa-play");

  save();
};

/**
 * 恢复播放
 */
export const resumePlayback = () => {
  const settings = get();
  const $ = deps.jQuery;

  if (!settings.isPlaying) return;

  // 恢复视频播放
  const videoElement = $(winSelector).find(".image-player-video")[0];
  if (videoElement && videoElement.paused && videoElement.currentTime > 0) {
    videoElement.play().catch(e => {
      console.error(`恢复视频播放失败:`, e);
    });
  }

  // 设置自动切换
  setupAutoSwitch();
};

/**
 * 设置自动切换
 */
const setupAutoSwitch = () => {
  const settings = get();

  // 清除现有定时器
  if (autoSwitchTimer) {
    clearInterval(autoSwitchTimer);
    autoSwitchTimer = null;
  }

  // 如果是视频且启用循环，则不自动切换
  const currentMedia = mediaList[currentMediaIndex];
  if (currentMedia && currentMedia.media_type === "video" && settings.videoLoop) {
    return;
  }

  // 定时切换模式
  if (settings.autoSwitchMode === "timer" && settings.isPlaying) {
    autoSwitchTimer = setInterval(() => {
      playMedia("next");
    }, settings.autoSwitchInterval || 5000);
  }
};

/**
 * 切换播放模式（随机/顺序）
 */
export const togglePlayMode = () => {
  const settings = get();

  // 切换模式
  settings.playMode = settings.playMode === "random" ? "sequence" : "random";
  settings.randomPlayedIndices = []; // 重置随机播放历史
  save();

  // 更新UI
  const $ = deps.jQuery;
  $(winSelector).find(".mode-switch i")
    .removeClass("fa-shuffle fa-list-ol")
    .addClass(settings.playMode === "random" ? "fa-shuffle" : "fa-list-ol");

  $(winSelector).find(".mode-switch").attr("title",
    settings.playMode === "random" ? "随机模式" : "顺序模式");

  updateMediaDisplay();
  toastr.info(`已切换到${settings.playMode === "random" ? "随机" : "顺序"}播放模式`);
};

/**
 * 切换自动切换模式（检测/定时）
 */
export const toggleAutoSwitchMode = () => {
  const settings = get();

  // 切换模式
  settings.autoSwitchMode = settings.autoSwitchMode === "detect" ? "timer" : "detect";
  save();

  // 更新UI
  const $ = deps.jQuery;
  $(winSelector).find(".switch-mode-toggle i")
    .removeClass("fa-robot fa-clock")
    .addClass(settings.autoSwitchMode === "detect" ? "fa-robot" : "fa-clock");

  $(winSelector).find(".switch-mode-toggle").attr("title",
    settings.autoSwitchMode === "detect" ? "检测播放" : "定时切换");

  // 重新设置自动切换
  setupAutoSwitch();

  toastr.info(`已切换到${settings.autoSwitchMode === "detect" ? "AI检测" : "定时"}切换模式`);
};

/**
 * 更新音量
 */
export const updateVolume = (volume) => {
  const settings = get();
  if (!settings.customVideoControls.showVolume) return;

  volume = Math.max(0, Math.min(1, volume));
  settings.videoVolume = volume;
  save();

  // 更新视频音量
  const $ = deps.jQuery;
  if ($) {
    const video = $(winSelector).find(".image-player-video")[0];
    if (video) video.volume = volume;

    // 更新音量图标
    const icon = $(winSelector).find(".volume-btn i");
    if (volume === 0) {
      icon
        .removeClass("fa-volume-high fa-volume-low")
        .addClass("fa-volume-mute");
    } else if (volume < 0.5) {
      icon
        .removeClass("fa-volume-high fa-volume-mute")
        .addClass("fa-volume-low");
    } else {
      icon
        .removeClass("fa-volume-low fa-volume-mute")
        .addClass("fa-volume-high");
    }

    // 更新音量滑块
    $(winSelector).find(".volume-slider").val(volume);
  }
};

/**
 * 格式化文件大小
 */
const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
