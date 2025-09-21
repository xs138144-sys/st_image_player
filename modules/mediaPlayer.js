import { deps } from "../core/deps.js";

const {
  EventBus,
  settings: { get, save },
  utils,
} = deps;
const { formatTime, applyTransitionEffect } = utils;

// 声明模块级变量
let switchTimer = null;
let progressUpdateInterval = null;
let preloadedMedia = null;
const winSelector = `#st-image-player-window`;

// 模块内状态
let mediaList = [];
let currentMediaIndex = 0;
let currentMediaType = "image";

// modules/mediaPlayer.js 补充完善
export const initPlayer = () => {
  // 原有初始化逻辑...

  // 注册AI事件监听器（关键：确保在初始化时调用）
  const removeListeners = registerAIEventListeners();

  // 绑定播放器播放器销毁时清理事件监听
  EventBus.on("destroyPlayerDestroy", () => {
    removeListeners.forEach(remove => remove());
  });

  // 补充之前缺失的定时切换启动逻辑
  if (get().autoSwitchMode === "timer") {
    EventBus.emit("startTimerSwitch");
  }
};

// 修正原registerAIEventListeners函数事件名称与触发源匹配（关键修复）
const registerAIEventListeners = () => {
  console.log(`[mediaPlayer] 注册AI事件监听器`);

  // 修复事件名称与触发源一致（老版本使用"aiResponse"和"playerMessage"）
  const removeAIResponseListener = EventBus.on("aiResponse", () => {
    const settings = get();
    if (settings.autoSwitchMode === "detect" && settings.aiDetectEnabled) {
      // 补充冷却时间检查（与之前的triggerAuto切换逻辑统一）
      const now = Date.now();
      if (now - (settings.lastSwitchTime || 0) < (settings.aiResponseCooldown || 3000)) {
        return;
      }
      settings.lastSwitchTime = now;
      save();
      showMedia("next");
    }
  });

  const removePlayerMessageListener = EventBus.on("playerMessage", () => {
    const settings = get();
    if (settings.autoSwitchMode === "detect" && settings.playerDetectEnabled) {
      const now = Date.now();
      if (now - (settings.lastSwitchTime || 0) < (settings.aiResponseCooldown || 3000)) {
        return;
      }
      settings.lastSwitchTime = now;
      save();
      showMedia("next");
    }
  });

  return [removeAIResponseListener, removePlayerMessageListener];
};

/**
 * 初始化媒体播放器模块
 */
export const init = () => {
  console.log(`[mediaPlayer] 播放模块初始化`);

  try {
    // 初始化window.mediaPlayerListeners
    window.mediaPlayerListeners = window.mediaPlayerListeners || [];

    // 初始化window.media状态容器
    window.media = window.media || {
      // 媒体元数据
      meta: {
        type: null, // 'image' | 'video'
        url: null,
        name: null,
        path: null, // 原始路径
        size: null, // 尺寸信息
      },
      // 播放状态
      state: {
        isPlaying: false,
        currentTime: 0, // 视频当前时间
        duration: 0, // 总时长
        isLooping: false,
        isLoading: false,
        isError: false
      }
    };

    const aiListeners = registerAIEventListeners();
    // 保存到全局监听器列表
    window.mediaPlayerListeners = [
      ...window.mediaPlayerListeners,
      ...aiListeners
    ];



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
        updateVolume(data);
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

    // 启动进度更新定时器
    progressUpdateInterval = setInterval(updateProgress, 1000);

    console.log(`[mediaPlayer] 初始化完成，已注册事件监听`);
  } catch (e) {
    console.error(`[mediaPlayer] 初始化错误:`, e);
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[mediaPlayer] 初始化失败: ${e.message}`);
    }
  }
};

/**
 * 更新进度显示
 */
const updateProgress = () => {
  const $ = deps.jQuery;
  if (!$) return;

  const video = $(winSelector).find(".image-player-video")[0];
  if (video && video.duration) {
    const $win = $(winSelector);
    $win.find(".current-time").text(formatTime(video.currentTime));
    $win.find(".total-time").text(formatTime(video.duration));

    const percent = (video.currentTime / video.duration) * 100;
    $win.find(".progress-played").css("width", `${percent}%`);

    // 更新window.media状态
    if (window.media) {
      window.media.state.currentTime = video.currentTime;
      window.media.state.duration = video.duration;
    }
  }
};
/**
 * 清理媒体播放器模块
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
      window.mediaPlayerListeners.forEach((removeListener) => {
        if (typeof removeListener === "function") {
          removeListener();
        }
      });
      window.mediaPlayerListeners = null;
    }

    // 停止视频播放
    const $ = deps.jQuery;
    if ($) {
      const video = $(winSelector).find(".image-player-video")[0]; // 修复选择器
      if (video) video.pause();
    }

    // 释放预加载资源
    preloadedMedia = null;

    console.log(`[mediaPlayer] 资源清理完成`);
  } catch (e) {
    console.error(`[mediaPlayer] 清理错误:`, e);
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`[mediaPlayer] 清理失败: ${e.message}`);
    }
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
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.info === "function") {
      deps.toastr.info("随机播放列表已循环，重新开始");
    }
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
    (type === "video" && !settings.mediaConfig.preload_strategy.video) ||
    (type === "image" && !settings.mediaConfig.preload_strategy.image)
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

    if (!status.active) throw new Error("媒体服务未连接");

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

      // 图片加载逻辑
      if (preloadedMedia && preloadedMedia.src === mediaUrl) {
        $(imgElement).attr("src", mediaUrl).show();
        // 更新尺寸信息
        window.media.meta.size = `${preloadedMedia.width}x${preloadedMedia.height}`;
      } else {
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            $(imgElement).attr("src", mediaUrl).show();
            // 图片加载完成后更新尺寸信息
            window.media.meta.size = `${img.width}x${img.height}`;
            resolve();
          };
          img.onerror = () => {
            window.media.state.isError = true;
            reject(new Error("图片加载失败"));
          };
          img.src = mediaUrl;
        });
      }

      // 更新window.media元数据
      window.media.meta = {
        type: "image",
        url: mediaUrl,
        name: mediaName,
        path: media.rel_path,
        size: window.media.meta.size || `${media.width || '?'}x${media.height || '?'}`
      };
      // 更新播放状态
      window.media.state = {
        ...window.media.state,
        isPlaying: true, // 图片默认视为"播放中"状态
        isLoading: false,
        isError: false
      };

      stopProgressUpdate(); // 停止视频进度更新
    } else if (mediaType === "video") {
      // 视频处理逻辑
      // 更新window.media元数据
      window.media.meta = {
        type: "video",
        url: mediaUrl,
        name: mediaName,
        path: media.rel_path,
        size: `${media.width || '?'}x${media.height || '?'}`
      };
      // 更新播放状态
      window.media.state = {
        ...window.media.state,
        isPlaying: false, // 视频需手动播放
        isLooping: settings.videoLoop,
        isLoading: true,
        isError: false,
        duration: 0,
        currentTime: 0
      };

      // 视频加载逻辑
      videoElement.src = mediaUrl;
      videoElement.loop = settings.videoLoop;

      // 等待视频元数据加载
      await new Promise((resolve, reject) => {
        videoElement.onloadedmetadata = () => {
          window.media.state.duration = videoElement.duration;
          window.media.state.isLoading = false;
          $(videoElement).show();
          resolve();
        };
        videoElement.onerror = () => {
          window.media.state.isError = true;
          window.media.state.isLoading = false;
          reject(new Error("视频加载失败"));
        };
      });

      // 尝试自动播放（受浏览器政策限制）
      try {
        await videoElement.play();
        window.media.state.isPlaying = true;
      } catch (e) {
        console.warn("视频自动播放失败，需手动触发", e);
        window.media.state.isPlaying = false;
      }

      // 监听视频时间更新
      videoElement.ontimeupdate = () => {
        window.media.state.currentTime = videoElement.currentTime;
      };
      // 监听播放状态变化
      videoElement.onplay = () => {
        window.media.state.isPlaying = true;
      };
      videoElement.onpause = () => {
        window.media.state.isPlaying = false;
      };

      startProgressUpdate(videoElement); // 启动视频进度更新
    }

    // 更新信息显示（通知UI模块）
    EventBus.emit("mediaStateUpdated", window.media);
    $(infoElement).text(mediaName);
    settings.isMediaLoading = false;
    save();
    startAutoSwitch(); // 启动自动切换


  } catch (e) {
    console.error(`[mediaPlayer] 显示媒体失败:`, e);
    // 使用安全的toastr调用
    if (deps.toastr && typeof deps.toastr.error === "function") {
      deps.toastr.error(`显示媒体失败: ${e.message}`);
    }
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
    const video = $(winSelector).find(".image-player-video")[0]; // 修复选择器
    if (!video || !video.loop) {
      showMedia("next");
    } else {
      startAutoSwitch();
    }
  }, settings.autoSwitchInterval || 5000);
};

/**
 * 开始播放
 */
export const startPlayback = () => {
  const settings = get();
  settings.isPlaying = true;
  save();
  startAutoSwitch();
  const video = $(winSelector).find(".image-player-video")[0]; // 修复选择器
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
  const video = $(winSelector).find(".image-player-video")[0]; // 修复选择器
  if (video) video.pause();
};

/**
 * 更新音量
 */
const updateVolume = (volume) => {
  const $ = deps.jQuery;
  const video = $(winSelector).find(".image-player-video")[0]; // 修复选择器
  if (video) {
    video.volume = volume;
    // 更新设置
    const settings = get();
    settings.videoVolume = volume;
    save();
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
  $win.find(".current-time").text(formatTime(video.currentTime));
  $win.find(".total-time").text(formatTime(video.duration));

  const percent = (video.currentTime / video.duration) * 100;
  $win.find(".progress-played").css("width", `${percent}%`);
};