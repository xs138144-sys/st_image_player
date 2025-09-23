import { deps } from "../core/deps.js";
import { createPlayerStyles, cleanupStyles } from "./styles/playerStyles.js";
import { createPlayerWindow, cleanupPlayerWindow } from "./components/playerWindow.js";
import { createSettingsPanel, cleanupSettingsPanel } from "./components/settingsPanel.js";
import { initUIEvents, cleanupUIEvents } from "./events/uiEvents.js";

const { EventBus, jQuery: $, utils } = deps;
const { safeJQuery } = utils;

/**
 * UI模块初始化
 */
export const init = async () => {
  console.log('[UI] 初始化UI模块');
  
  try {
    // 1. 注入CSS样式
    await createPlayerStyles();
    
    // 2. 初始化UI事件处理器
    initUIEvents();
    
    // 3. 创建播放器窗口
    await createPlayerWindow();
    
    // 4. 创建设置面板
    await createSettingsPanel();
    
    // 5. 注册扩展菜单
    registerExtensionMenu();
    
    console.log('[UI] UI模块初始化完成');
    return true;
  } catch (error) {
    console.error('[UI] UI模块初始化失败:', error);
    return false;
  }
};

/**
 * UI模块清理
 */
export const cleanup = () => {
  console.log('[UI] 清理UI模块');
  
  try {
    // 1. 清理UI事件处理器
    cleanupUIEvents();
    
    // 2. 清理播放器窗口
    cleanupPlayerWindow();
    
    // 3. 清理设置面板
    cleanupSettingsPanel();
    
    // 4. 清理CSS样式
    cleanupStyles();
    
    // 5. 移除扩展菜单
    unregisterExtensionMenu();
    
    console.log('[UI] UI模块清理完成');
  } catch (error) {
    console.error('[UI] UI模块清理失败:', error);
  }
};

/**
 * 注册扩展菜单
 */
const registerExtensionMenu = () => {
  safeJQuery(() => {
    // 确保扩展菜单容器存在
    ensureExtensionMenuContainer();
    
    // 添加扩展菜单项
    addExtensionMenuItems();
    
    console.log('[UI] 扩展菜单注册完成');
  });
};

/**
 * 确保扩展菜单容器存在
 */
const ensureExtensionMenuContainer = () => {
  if ($("#extensionsMenu").length === 0) {
    $("body").append(`
      <div id="extensionsMenu" class="extensions-menu"></div>
    `);
  }
};

/**
 * 添加扩展菜单项
 */
const addExtensionMenuItems = () => {
  const menuHtml = `
    <div class="extension-menu-item" data-extension="st_image_player">
      <div class="extension-menu-header">
        <span class="extension-icon">🎬</span>
        <span class="extension-title">媒体播放器</span>
        <span class="extension-status"></span>
      </div>
      
      <div class="extension-menu-actions">
        <button class="menu-action-btn" data-action="toggle_player" title="显示/隐藏播放器">
          <i class="fa-solid fa-display"></i>
        </button>
        
        <button class="menu-action-btn" data-action="play_pause" title="播放/暂停">
          <i class="fa-solid fa-play"></i>
        </button>
        
        <button class="menu-action-btn" data-action="next_media" title="下一个媒体">
          <i class="fa-solid fa-forward"></i>
        </button>
        
        <button class="menu-action-btn" data-action="prev_media" title="上一个媒体">
          <i class="fa-solid fa-backward"></i>
        </button>
        
        <button class="menu-action-btn" data-action="toggle_lock" title="锁定/解锁位置">
          <i class="fa-solid fa-lock"></i>
        </button>
        
        <button class="menu-action-btn" data-action="toggle_info" title="显示/隐藏信息">
          <i class="fa-solid fa-info"></i>
        </button>
        
        <button class="menu-action-btn" data-action="refresh_media" title="刷新媒体列表">
          <i class="fa-solid fa-rotate"></i>
        </button>
        
        <button class="menu-action-btn" data-action="show_settings" title="设置">
          <i class="fa-solid fa-gear"></i>
        </button>
      </div>
    </div>
  `;
  
  // 移除旧的菜单项（如果存在）
  $("#extensionsMenu .extension-menu-item[data-extension='st_image_player']").remove();
  
  // 添加新的菜单项
  $("#extensionsMenu").append(menuHtml);
  
  // 绑定菜单项点击事件
  bindMenuEvents();
};

/**
 * 绑定菜单事件
 */
const bindMenuEvents = () => {
  $("#extensionsMenu .extension-menu-item[data-extension='st_image_player'] .menu-action-btn")
    .off('click')
    .on('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const $btn = $(this);
      const action = $btn.data('action');
      const extensionId = $btn.closest('.extension-menu-item').data('extension');
      
      EventBus.emit('extensionMenuClicked', {
        extensionId,
        action
      });
    });
};

/**
 * 移除扩展菜单
 */
const unregisterExtensionMenu = () => {
  safeJQuery(() => {
    $("#extensionsMenu .extension-menu-item[data-extension='st_image_player']").remove();
    console.log('[UI] 扩展菜单已移除');
  });
};

/**
 * 更新扩展菜单状态
 */
export const updateMenuStatus = (status) => {
  safeJQuery(() => {
    const $status = $("#extensionsMenu .extension-menu-item[data-extension='st_image_player'] .extension-status");
    if ($status.length) {
      $status.removeClass('status-online status-offline status-connecting');
      $status.addClass(`status-${status}`);
      
      switch (status) {
        case 'online':
          $status.attr('title', '服务在线');
          break;
        case 'offline':
          $status.attr('title', '服务离线');
          break;
        case 'connecting':
          $status.attr('title', '连接中...');
          break;
      }
    }
  });
};

/**
 * 更新播放状态显示
 */
export const updatePlayStatus = (isPlaying) => {
  safeJQuery(() => {
    const $playBtn = $("#extensionsMenu .extension-menu-item[data-extension='st_image_player'] [data-action='play_pause']");
    if ($playBtn.length) {
      const $icon = $playBtn.find('i');
      if (isPlaying) {
        $icon.removeClass('fa-play').addClass('fa-pause');
        $playBtn.attr('title', '暂停');
      } else {
        $icon.removeClass('fa-pause').addClass('fa-play');
        $playBtn.attr('title', '播放');
      }
    }
  });
};

/**
 * 更新锁定状态显示
 */
export const updateLockStatus = (isLocked) => {
  safeJQuery(() => {
    const $lockBtn = $("#extensionsMenu .extension-menu-item[data-extension='st_image_player'] [data-action='toggle_lock']");
    if ($lockBtn.length) {
      const $icon = $lockBtn.find('i');
      if (isLocked) {
        $icon.removeClass('fa-lock-open').addClass('fa-lock');
        $lockBtn.attr('title', '解锁位置');
      } else {
        $icon.removeClass('fa-lock').addClass('fa-lock-open');
        $lockBtn.attr('title', '锁定位置');
      }
    }
  });
};

/**
 * 更新信息显示状态
 */
export const updateInfoStatus = (showInfo) => {
  safeJQuery(() => {
    const $infoBtn = $("#extensionsMenu .extension-menu-item[data-extension='st_image_player'] [data-action='toggle_info']");
    if ($infoBtn.length) {
      if (showInfo) {
        $infoBtn.addClass('active');
        $infoBtn.attr('title', '隐藏信息');
      } else {
        $infoBtn.removeClass('active');
        $infoBtn.attr('title', '显示信息');
      }
    }
  });
};

/**
 * 显示通知
 */
export const showNotification = (message, type = 'info') => {
  EventBus.emit('showNotification', { message, type });
};

/**
 * 重新加载UI
 */
export const reloadUI = () => {
  console.log('[UI] 重新加载UI');
  
  // 清理现有UI
  cleanup();
  
  // 重新初始化UI
  return init();
};

/**
 * 获取UI状态
 */
export const getUIState = () => {
  return {
    playerWindowVisible: deps.settings.get().isWindowVisible,
    playerLocked: deps.settings.get().isLocked,
    showInfo: deps.settings.get().showInfo,
    isPlaying: deps.settings.get().isPlaying
  };
};

// 导出所有子模块功能
export * from "./styles/playerStyles.js";
export * from "./components/playerWindow.js";
export * from "./components/settingsPanel.js";
export * from "./events/uiEvents.js";