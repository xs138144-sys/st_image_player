import { eventSource } from "../../../../extensions.js";
import { stMediaPlayer } from "../index.js";

const EXT_ID = "st_media_player";
let player = null;
let playerContainer = null;
let settings = null;
let currentMedia = null;
let playbackHistory = [];

// 创建视频播放器
function createPlayer(container) {
  if (player) {
    destroyPlayer();
  }

  // 创建播放器元素
  player = document.createElement("video");
  player.id = `${EXT_ID}-video-player`;
  player.className = "st-media-player";
  player.controls = true;
  player.style.width = "100%";
  player.style.maxHeight = "500px";
  player.volume = settings.defaultVolume / 100;
  player.autoplay = settings.autoPlay;

  // 添加到容器
  container.innerHTML = "";
  container.appendChild(player);

  // 绑定播放器事件
  player.addEventListener("play", handlePlay);
  player.addEventListener("pause", handlePause);
  player.addEventListener("ended", handleEnded);
  player.addEventListener("error", handleError);
  player.addEventListener("timeupdate", handleTimeUpdate);

  console.log(`[${EXT_ID}] 播放器已创建`);
  return player;
}

// 销毁播放器
function destroyPlayer() {
  if (!player) return;

  // 移除事件监听器
  player.removeEventListener("play", handlePlay);
  player.removeEventListener("pause", handlePause);
  player.removeEventListener("ended", handleEnded);
  player.removeEventListener("error", handleError);
  player.removeEventListener("timeupdate", handleTimeUpdate);

  // 停止播放并移除元素
  player.pause();
  if (player.parentNode) {
    player.parentNode.removeChild(player);
  }
  player = null;

  console.log(`[${EXT_ID}] 播放器已销毁`);
}

// 加载媒体文件
function loadMedia(url, type = "video/mp4") {
  if (!player) {
    eventSource.emit(`${EXT_ID}:error`, {
      message: "播放器未初始化",
    });
    return false;
  }

  try {
    player.src = url;
    player.type = type;
    currentMedia = { url, type, lastPosition: 0 };

    // 尝试恢复上次播放位置
    const historyItem = playbackHistory.find((item) => item.url === url);
    if (historyItem && settings.rememberLastPosition) {
      setTimeout(() => {
        player.currentTime = historyItem.lastPosition;
      }, 1000);
    }

    eventSource.emit(`${EXT_ID}:status`, {
      message: `正在加载媒体: ${url}`,
    });

    if (settings.autoPlay) {
      player.play().catch(handlePlayError);
    }

    return true;
  } catch (error) {
    eventSource.emit(`${EXT_ID}:error`, {
      message: `加载媒体失败: ${error.message}`,
    });
    return false;
  }
}

// 播放/暂停切换
function togglePlayback() {
  if (!player) return false;

  if (player.paused) {
    player.play().catch(handlePlayError);
    return true;
  } else {
    player.pause();
    return true;
  }
}

// 处理播放错误
function handlePlayError(error) {
  let message = "播放失败";

  switch (error.name) {
    case "NotAllowedError":
      message = "自动播放被浏览器阻止，请手动点击播放";
      break;
    case "NotFoundError":
      message = "媒体文件未找到";
      break;
    case "NotSupportedError":
      message = "不支持的媒体格式";
      break;
  }

  eventSource.emit(`${EXT_ID}:error`, { message });
}

// 播放器事件处理函数
function handlePlay() {
  eventSource.emit(`${EXT_ID}:status`, {
    message: "开始播放",
  });
}

function handlePause() {
  // 保存当前播放位置
  if (currentMedia) {
    currentMedia.lastPosition = player.currentTime;
    updatePlaybackHistory(currentMedia);
  }

  eventSource.emit(`${EXT_ID}:status`, {
    message: "已暂停",
  });
}

function handleEnded() {
  eventSource.emit(`${EXT_ID}:status`, {
    message: "播放结束",
  });
}

function handleError() {
  const errorMessages = {
    1: "获取媒体时发生错误",
    2: "媒体格式不支持",
    3: "解码媒体时发生错误",
    4: "媒体无法播放",
  };

  const message = errorMessages[player.error.code] || "播放时发生未知错误";
  eventSource.emit(`${EXT_ID}:error`, { message });
}

function handleTimeUpdate() {
  // 定期保存播放位置（每30秒）
  if (currentMedia && player.currentTime % 30 < 0.5) {
    currentMedia.lastPosition = player.currentTime;
    updatePlaybackHistory(currentMedia);
  }
}

// 更新播放历史
function updatePlaybackHistory(media) {
  const index = playbackHistory.findIndex((item) => item.url === media.url);
  if (index >= 0) {
    playbackHistory[index] = { ...media };
  } else {
    // 限制历史记录数量
    if (playbackHistory.length >= 10) {
      playbackHistory.shift();
    }
    playbackHistory.push({ ...media });
  }

  // 可以在这里添加本地存储逻辑
}

// 初始化播放器模块
function init(settingsConfig) {
  settings = settingsConfig;
  playbackHistory = [];

  // 监听UI容器就绪事件
  eventSource.on(`${EXT_ID}:playerContainerReady`, (data) => {
    playerContainer = data.container;
    createPlayer(playerContainer);
  });

  // 监听窗口显示事件
  eventSource.on(`${EXT_ID}:windowShown`, () => {
    if (currentMedia && player) {
      eventSource.emit(`${EXT_ID}:status`, {
        message: `继续播放: ${currentMedia.url}`,
      });
    }
  });

  // 监听暂停命令
  eventSource.on(`${EXT_ID}:pause`, () => {
    if (player && !player.paused) {
      player.pause();
    }
  });

  console.log(`[${EXT_ID}] 播放器模块初始化完成`);
  return true;
}

// 清理播放器资源
function cleanup() {
  // 保存最后播放位置
  handlePause();

  // 销毁播放器
  destroyPlayer();

  // 清除引用
  playerContainer = null;
  currentMedia = null;
  playbackHistory = [];

  // 移除事件监听器
  eventSource.removeAllListeners(`${EXT_ID}:playerContainerReady`);
  eventSource.removeAllListeners(`${EXT_ID}:windowShown`);
  eventSource.removeAllListeners(`${EXT_ID}:pause`);

  console.log(`[${EXT_ID}] 播放器模块已清理`);
}

export default {
  init,
  cleanup,
  loadMedia,
  togglePlayback,
  getPlayer: () => player,
};
