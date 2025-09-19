import { deps } from "../core/deps.js";

// 模块私有变量
let mediaList = [];
let currentMediaIndex = 0;
let switchTimer = null;
let preloadedMedia = null;
let currentMediaType = "image";
let progressUpdateInterval = null;
let eventListeners = []; // 事件监听器集合

const winSelector = "#st-image-player-window";

/**
 * 初始化媒体播放器模块
 */
export const init = () => {
  try {
    // 注册事件监听（接收外部请求）
    const removePlayListener = deps.EventBus.on("requestMediaPlay", (data) => {
      showMedia(data?.direction || "current");
    });

    const removeStartPlaybackListener = deps.EventBus.on(
      "requestStartPlayback",
      startPlayback
    );

    const removeStopPlaybackListener = deps.EventBus.on(
      "requestStopPlayback",
      stopPlayback
    );

    const removeResumePlaybackListener = deps.EventBus.on(
      "requestResumePlayback",
      startPlayback
    );

    const removeUpdateVolumeListener = deps.EventBus.on(
      "requestUpdateVolume",
      (data) => {
        updateVolume(data.volume);
      }
    );

    const removeMediaListListener = deps.EventBus.on(
      "mediaListRefreshed",
      (data) => {
        mediaList = data.list;
        console.log(
          `[mediaPlayer] 媒体列表已更新，共${mediaList.length}个媒体`
        );
      }
    );

    // 保存事件监听器
    eventListeners = [
      removePlayListener,
      removeStartPlaybackListener,
      removeStopPlaybackListener,
      removeResumePlaybackListener,
      removeUpdateVolumeListener,
      removeMediaListListener,
    ];

    // 初始化媒体列表
    deps.EventBus.emit("requestRefreshMediaList");

    console.log(`[mediaPlayer] 媒体播放器模块初始化完成`);
  } catch (e) {
    deps.toastr.error(`[mediaPlayer] 初始化失败: ${e.message}`);
    console.error(`[mediaPlayer] 初始化错误:`, e);
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

    // 取消所有事件监听
    eventListeners.forEach((removeListener) => removeListener());
    eventListeners = [];

    // 停止视频播放
    const $ = deps.jQuery;
    if ($) {
      const video = $(winSelector).find(".image-player-video")[0];
      if (video) video.pause();
    }

    // 释放预加载资源
    preloadedMedia = null;

    console.log(`[mediaPlayer] 媒体播放器模块已清理`);
  } catch (e) {
    deps.toastr.error(`[mediaPlayer] 清理失败: ${e.message}`);
    console.error(`[mediaPlayer] 清理错误:`, e);
  }
};

/**
 * 获取随机媒体索引（避免重复）
 */
const getRandomMediaIndex = () => {
  const settings = deps.settings.getSettings();
  const list = settings.randomMediaList || [];

  // 空列表兜底
  if (list.length === 0) return 0;

  // 所有媒体已播放 → 重置
  if (settings.randomPlayedIndices.length >= list.length) {
    settings.randomPlayedIndices = [];
    deps.toastr.info("随机播放列表已循环，重新开始");
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
  deps.settings.saveSettings({
    currentRandomIndex: randomIndex,
    randomPlayedIndices: [...settings.randomPlayedIndices, randomIndex],
  });

  return randomIndex;
};

/**
 * 预加载媒体（图片/视频）
 */
const preloadMediaItem = async (url, type) => {
  const settings = deps.settings.getSettings();

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
  const settings = deps.settings.getSettings();
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

  deps.settings.saveSettings({ isMediaLoading: true });
  win.find(".control-text").text("加载中...");

  try {
    // 1. 检查服务状态
    const status = await new Promise((resolve) => {
      const removeListener = deps.EventBus.on(
        "serviceStatusChecked",
        (status) => {
          removeListener();
          resolve(status);
        }
      );
      deps.EventBus.emit("requestCheckServiceStatus");
    });

    if (!status.active) throw new Error("媒体服务未连接");

    // 2. 确保媒体列表最新
    mediaList = await new Promise((resolve) => {
      const removeListener = deps.EventBus.on("mediaListRefreshed", (data) => {
        removeListener();
        resolve(data.list);
      });
      deps.EventBus.emit("requestRefreshMediaList", {
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
            const newIndices = [...settings.randomPlayedIndices];
            newIndices.pop();
            randomIndex = newIndices.pop();
            newIndices.push(randomIndex);

            deps.settings.saveSettings({
              randomPlayedIndices: newIndices,
              currentRandomIndex: randomIndex,
            });
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
      deps.utils.applyTransitionEffect(imgElement, settings.transitionEffect);
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
        const onLoaded = () => {
          videoElement.removeEventListener("loadedmetadata", onLoaded);
          videoElement.removeEventListener("error", onError);
          resolve();
        };

        const onError = () => {
          videoElement.removeEventListener("loadedmetadata", onLoaded);
          videoElement.removeEventListener("error", onError);
          reject(new Error("视频加载失败"));
        };

        videoElement.addEventListener("loadedmetadata", onLoaded);
        videoElement.addEventListener("error", onError);
      });

      $(imgElement).hide();
      videoElement.play();
      startProgressUpdate(videoElement); // 启动视频进度更新
    }

    // 6. 更新信息显示
    $(infoElement).text(mediaName);
    win
      .find(".control-text")
      .text(`${mediaType === "image" ? "图片" : "视频"}: ${mediaName}`);

    // 7. 预加载下一个媒体
    if (
      settings.autoSwitchMode === "timer" ||
      settings.preloadImages ||
      settings.preloadVideos
    ) {
      const nextIndex =
        settings.playMode === "random"
          ? getRandomMediaIndex()
          : (currentMediaIndex + 1) % mediaList.length;

      const nextMedia =
        settings.playMode === "random"
          ? (settings.randomMediaList || mediaList)[nextIndex]
          : mediaList[nextIndex];

      if (nextMedia) {
        const nextUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
          nextMedia.rel_path
        )}`;
        preloadedMedia = await preloadMediaItem(nextUrl, nextMedia.media_type);
      }
    }

    // 8. 自动切换设置
    if (settings.autoSwitchMode === "timer" && settings.isPlaying) {
      setupNextMediaSwitch();
    }
  } catch (e) {
    console.error(`[mediaPlayer] 显示媒体失败:`, e);
    deps.toastr.error(`显示媒体失败: ${e.message}`);
    $(loadingElement).hide();
  } finally {
    deps.settings.saveSettings({ isMediaLoading: false });
  }
};

/**
 * 设置下一个媒体切换定时器
 */
const setupNextMediaSwitch = () => {
  if (switchTimer) clearTimeout(switchTimer);

  const settings = deps.settings.getSettings();
  // 视频模式下使用视频时长作为切换时间
  const switchTime =
    currentMediaType === "video" && !settings.videoLoop
      ? Math.max(
          5000,
          deps.jQuery(winSelector).find(".image-player-video")[0]?.duration *
            1000 || 5000
        )
      : settings.switchInterval;

  switchTimer = setTimeout(() => {
    showMedia("next");
  }, switchTime);
};

/**
 * 开始播放（自动切换）
 */
export const startPlayback = () => {
  const settings = deps.settings.getSettings();
  if (settings.isPlaying) return;

  deps.settings.saveSettings({ isPlaying: true });
  deps.toastr.info("开始自动播放");
  setupNextMediaSwitch();
};

/**
 * 停止播放（自动切换）
 */
export const stopPlayback = () => {
  if (switchTimer) {
    clearTimeout(switchTimer);
    switchTimer = null;
  }

  deps.settings.saveSettings({ isPlaying: false });
  deps.toastr.info("已停止自动播放");
};

/**
 * 启动视频进度更新
 */
const startProgressUpdate = (videoElement) => {
  if (progressUpdateInterval) clearInterval(progressUpdateInterval);

  const $ = deps.jQuery;
  const progressBar = $(winSelector).find(".video-progress");

  progressUpdateInterval = setInterval(() => {
    if (!videoElement || videoElement.paused) return;

    const percent = (videoElement.currentTime / videoElement.duration) * 100;
    progressBar.val(percent);

    // 更新时间显示
    $(winSelector)
      .find(".video-time")
      .text(
        `${deps.utils.formatTime(
          videoElement.currentTime
        )} / ${deps.utils.formatTime(videoElement.duration)}`
      );
  }, 1000);
};

/**
 * 停止视频进度更新
 */
const stopProgressUpdate = () => {
  if (progressUpdateInterval) {
    clearInterval(progressUpdateInterval);
    progressUpdateInterval = null;
  }
};

/**
 * 更新音量
 */
export const updateVolume = (volume) => {
  const $ = deps.jQuery;
  const video = $(winSelector).find(".image-player-video")[0];
  if (video) {
    video.volume = volume;
    deps.settings.saveSettings({ volume });
  }
};
