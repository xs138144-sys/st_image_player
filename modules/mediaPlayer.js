import { deps } from "../core/deps.js";

const { EventBus, toastr, settings: { get, save }, utils } = deps;
let switchTimer = null;
let progressUpdateInterval = null;
let preloadedMedia = null;
const winSelector = "#st-image-player-window";

/**
 * 初始化媒体播放器
 */
export const init = () => {
  // 注册事件监听
  const removePlayListener = EventBus.on("requestPlayMedia", (index) => {
    playMedia(index);
  });

  const removeNextListener = EventBus.on("requestNextMedia", () => {
    playNextMedia();
  });

  const removePrevListener = EventBus.on("requestPrevMedia", () => {
    playPrevMedia();
  });

  const removeResumeListener = EventBus.on("requestResumePlayback", () => {
    startAutoSwitch();
  });

  window.mediaPlayerListeners = [
    removePlayListener,
    removeNextListener,
    removePrevPrevListener,
    removeResumeListener
  ];

  console.log(`[mediaPlayer] 模块初始化完成`);
};

/**
 * 播放指定索引的媒体
 */
export const playMedia = (index) => {
  const settings = get();
  const mediaList = window.mediaList || [];

  if (!mediaList.length || index < 0 || index >= mediaList.length) {
    toastr.warning("无可用媒体");
    return;
  }

  window.currentMediaIndex = index;
  const media = mediaList[index];
  const $win = $(winSelector);
  const $imgContainer = $win.find(".image-container");

  // 显示加载状态
  $imgContainer.find(".loading-animation").show();
  $imgContainer.find(".image-player-img, .image-player-video").hide();

  // 根据类型加载媒体
  if (media.type === "image") {
    loadImageMedia(media, $imgContainer);
  } else if (media.type === "video") {
    loadVideoMedia(media, $imgContainer);
  }

  // 更新媒体信息
  if (settings.showMediaInfo) {
    $win.find(".image-info").text(`${media.name} (${media.type})`);
  }

  settings.isPlaying = true;
  save();
  startAutoSwitch();
};

/**
 * 加载图片媒体
 */
const loadImageMedia = (media, $container) => {
  const img = new Image();
  img.src = media.url;
  img.className = "image-player-img";

  img.onload = () => {
    $container.find(".loading-animation").hide();
    $container.find(".image-player-img").remove();
    $container.append(img);
    utils.applyTransitionEffect(img, get().transitionEffect);
    img.style.display = "block";
  };

  img.onerror = () => {
    $container.find(".loading-animation").text("图片加载失败");
    toastr.error(`无法加载图片: ${media.name}`);
  };
};

/**
 * 加载视频媒体
 */
const loadVideoMedia = (media, $container) => {
  const $video = $("<video>", {
    class: "image-player-video",
    src: media.url,
    preload: get().mediaConfig.preload_strategy.video ? "metadata" : "none",
    controls: false
  });

  $container.find(".image-player-video").remove();
  $container.append($video);

  // 视频控制逻辑
  $video.on("loadedmetadata", () => {
    $container.find(".loading-animation").hide();
    $video.show();
    updateVideoProgress($video);
  });

  $video.on("error", () => {
    $container.find(".loading-animation").text("视频加载失败");
    toastr.error(`无法加载视频: ${media.name}`);
  });

  // 绑定控制事件
  bindVideoControls($video[0]);
};

/**
 * 绑定视频控制事件
 */
const bindVideoControls = (video) => {
  const $win = $(winSelector);
  const $progress = $win.find(".progress-played");
  const $loaded = $win.find(".progress-loaded");
  const $timeDisplay = $win.find(".time-display");
  const $volumeSlider = $win.find(".volume-slider");
  const $loopBtn = $win.find(".loop-control");

  // 进度更新
  if (progressUpdateInterval) clearInterval(progressUpdateInterval);
  progressUpdateInterval = setInterval(() => {
    updateVideoProgress($(video));
  }, 1000);

  // 进度条点击
  $win.find(".progress-container").off("click").on("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
  });

  // 音量控制
  $volumeSlider.off("input").on("input", () => {
    video.volume = $volumeSlider.val() / 100;
  });

  // 播放/暂停
  $win.find(".play-pause-control").off("click").on("click", () => {
    if (video.paused) video.play();
    else video.pause();
  });

  // 循环播放
  $loopBtn.off("click").on("click", () => {
    video.loop = !video.loop;
    $loopBtn.toggleClass("active", video.loop);
  });
};

/**
 * 更新视频进度
 */
const updateVideoProgress = ($video) => {
  const video = $video[0];
  if (!video || isNaN(video.duration)) return;

  const percent = (video.currentTime / video.duration) * 100;
  const loadedPercent = (video.buffered.length
    ? (video.buffered.end(video.buffered.length - 1) / video.duration) * 100
    : 0);

  $(winSelector).find(".progress-played").css("width", `${percent}%`);
  $(winSelector).find(".progress-loaded").css("width", `${loadedPercent}%`);
  $(winSelector).find(".time-display").text(
    `${utils.formatTime(video.currentTime)} / ${utils.formatTime(video.duration)}`
  );
};

/**
 * 播放下一个媒体
 */
export const playNextMedia = () => {
  const mediaList = window.mediaList || [];
  if (!mediaList.length) return;

  const settings = get();
  let nextIndex;

  // 随机播放逻辑
  if (settings.playMode === "random") {
    if (settings.randomPlayedIndices.length >= mediaList.length) {
      settings.randomPlayedIndices = [];
      toastr.info("已循环一轮，重新开始随机播放");
    }

    // 找到未播放过的索引
    do {
      nextIndex = Math.floor(Math.random() * mediaList.length);
    } while (settings.randomPlayedIndices.includes(nextIndex));

    settings.randomPlayedIndices.push(nextIndex);
  }
  // 顺序播放逻辑
  else {
    nextIndex = window.currentMediaIndex + 1;
    if (nextIndex >= mediaList.length) nextIndex = 0; // 循环
  }

  playMedia(nextIndex);
  save();
};

/**
 * 播放上一个媒体
 */
export const playPrevMedia = () => {
  const mediaList = window.mediaList || [];
  if (!mediaList.length) return;

  let prevIndex = window.currentMediaIndex - 1;
  if (prevIndex < 0) prevIndex = mediaList.length - 1;

  playMedia(prevIndex);
};

/**
 * 启动自动切换
 */
const startAutoSwitch = () => {
  if (switchTimer) clearTimeout(switchTimer);

  const settings = get();
  if (settings.autoSwitchMode !== "timer" || !settings.isPlaying) return;

  switchTimer = setTimeout(() => {
    // 视频如果在循环播放则不自动切换
    const video = $(winSelector).find(".image-player-video")[0];
    if (!video || !video.loop) {
      playNextMedia();
    } else {
      startAutoSwitch(); // 继续计时
    }
  }, settings.autoSwitchDelay);
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

    console.log(`[mediaPlayer] 资源清理完成`);
  } catch (e) {
    toastr.error(`[mediaPlayer] 清理失败: ${e.message}`);
    console.error(`[mediaPlayer] 清理错误:`, e);
  }
};