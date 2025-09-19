import { eventSource, event_types } from "../../../../extensions.js";
import { stMediaPlayer } from "../index.js";

const EXT_ID = "st_media_player";
let $ = null;
let playerWindow = null;
let extensionButton = null;
let settings = null;

// 创建扩展菜单按钮
function createExtensionButton() {
  if (extensionButton || !$) return;

  // 检查按钮是否已存在
  if ($(`#${EXT_ID}-menu-button`).length) {
    extensionButton = $(`#${EXT_ID}-menu-button`);
    return;
  }

  // 创建按钮元素
  extensionButton = $(`
        <button id="${EXT_ID}-menu-button" class="btn btn-sm btn-secondary st-extension-btn" title="媒体播放器">
            <i class="fas fa-play-circle mr-1"></i> 媒体播放器
        </button>
    `);

  // 绑定点击事件
  extensionButton.on("click", togglePlayerWindow);

  // 尝试多种可能的菜单容器
  const possibleContainers = [
    "#extensions-menu .dropdown-menu",
    ".main-menu .dropdown-menu",
    "#extensions-dropdown .dropdown-menu",
    ".extensions-container",
  ];

  let containerFound = false;
  for (const selector of possibleContainers) {
    const container = $(selector);
    if (container.length) {
      container.append(
        $("<li class='extension-item'></li>").append(extensionButton)
      );
      containerFound = true;
      break;
    }
  }

  // 如果所有容器都没找到，使用备用方案
  if (!containerFound) {
    console.warn(`[${EXT_ID}] 未找到标准扩展菜单容器，使用备用位置`);
    $("body").append(`
            <div id="${EXT_ID}-floating-button" style="position: fixed; bottom: 20px; right: 20px; z-index: 9999;">
            </div>
        `);
    $(`#${EXT_ID}-floating-button`).append(extensionButton);
  }
}

// 创建播放器窗口
function createPlayerWindow() {
  if (playerWindow && !playerWindow.isDestroyed()) return;

  // 创建窗口元素
  playerWindow = $(`
        <div id="${EXT_ID}-window" class="st-modal modal fade" tabindex="-1" role="dialog">
            <div class="modal-dialog modal-lg" role="document">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-play-circle mr-2"></i>媒体播放器
                        </h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div id="${EXT_ID}-player-container" class="player-container">
                            <!-- 播放器内容将由mediaPlayer模块填充 -->
                            <div class="loading-indicator">加载播放器中...</div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">关闭</button>
                    </div>
                </div>
            </div>
        </div>
    `);

  // 添加到页面
  $("body").append(playerWindow);

  // 绑定窗口事件
  playerWindow.on("hidden.bs.modal", () => {
    // 通知播放器暂停
    eventSource.emit(`${EXT_ID}:pause`);
  });

  // 通知播放器容器已准备好
  eventSource.emit(`${EXT_ID}:playerContainerReady`, {
    container: $(`#${EXT_ID}-player-container`)[0],
  });
}

// 切换播放器窗口显示状态
function togglePlayerWindow() {
  if (!playerWindow) {
    createPlayerWindow();
  }

  if (playerWindow.hasClass("show")) {
    playerWindow.modal("hide");
  } else {
    playerWindow.modal("show");
    // 通知播放器窗口已显示
    eventSource.emit(`${EXT_ID}:windowShown`);
  }
}

// 初始化UI模块
async function init(settingsConfig) {
  settings = settingsConfig;
  $ = stMediaPlayer.deps.jQuery;

  if (!$) {
    console.error(`[${EXT_ID}] UI初始化失败：jQuery未加载`);
    return false;
  }

  // 创建菜单按钮
  createExtensionButton();

  // 监听播放器事件
  eventSource.on(`${EXT_ID}:error`, (data) => {
    showNotification(data.message, "error");
  });

  eventSource.on(`${EXT_ID}:status`, (data) => {
    showNotification(data.message, "info");
  });

  console.log(`[${EXT_ID}] UI模块初始化完成`);
  return true;
}

// 显示通知
function showNotification(message, type = "info") {
  if (!window.toastr) {
    console.log(`[${EXT_ID}] ${message}`);
    return;
  }

  switch (type) {
    case "error":
      toastr.error(message, EXT_ID);
      break;
    case "success":
      toastr.success(message, EXT_ID);
      break;
    case "warning":
      toastr.warning(message, EXT_ID);
      break;
    default:
      toastr.info(message, EXT_ID);
  }
}

// 清理UI资源
function cleanup() {
  // 移除菜单按钮
  if (extensionButton) {
    extensionButton.off("click");
    extensionButton.remove();
    extensionButton = null;
  }

  // 移除浮动按钮容器
  $(`#${EXT_ID}-floating-button`).remove();

  // 关闭并移除播放器窗口
  if (playerWindow) {
    playerWindow.off("hidden.bs.modal");
    playerWindow.modal("hide");
    playerWindow.remove();
    playerWindow = null;
  }

  // 移除事件监听器
  eventSource.removeAllListeners(`${EXT_ID}:error`);
  eventSource.removeAllListeners(`${EXT_ID}:status`);

  console.log(`[${EXT_ID}] UI模块已清理`);
}

export default {
  init,
  cleanup,
  togglePlayerWindow,
  showNotification,
};
