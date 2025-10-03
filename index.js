// SillyTavern 媒体播放器扩展 - 模块化重构版本
// 主入口文件，负责模块化初始化和SillyTavern集成

import { initializeExtension, destroyExtension, getExtensionInstance } from './modules/main.js';
import { ConfigManager } from './config/config.js';
import { EventBus, ErrorHandler } from './utils/helpers.js';

// 扩展常量定义
const EXTENSION_ID = "st_image_player";
const EXTENSION_NAME = "媒体播放器";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings";

// SillyTavern 兼容性包装器
const getSafeGlobal = (name, defaultValue) =>
  window[name] === undefined ? defaultValue : window[name];

const getSafeToastr = () => {
  return window.toastr || {
    success: (msg) => console.log(`SUCCESS: ${msg}`),
    info: (msg) => console.info(`INFO: ${msg}`),
    warning: (msg) => console.warn(`WARNING: ${msg}`),
    error: (msg) => console.error(`ERROR: ${msg}`),
  };
};

const toastr = getSafeToastr();

// 全局事件总线
const eventBus = new EventBus();

// 扩展管理器类
class ExtensionManager {
  constructor() {
    this.isInitialized = false;
    this.configManager = new ConfigManager();
    this.settings = null;
    this.toastr = toastr;
    
    this.bindEvents();
  }

  // 初始化扩展
  async initialize() {
    try {
      console.log(`[${EXTENSION_ID}] 开始模块化初始化...`);
      
      // 初始化配置管理器
      await this.configManager.loadConfig();
      this.settings = await this.configManager.getConfig();
      
      // 检查总开关状态
      if (!this.settings.masterEnabled) {
        console.log(`[${EXTENSION_ID}] 扩展总开关关闭，创建最小化设置面板`);
        this.createMinimalSettingsPanel();
        return false;
      }
      
      // 初始化主模块
      const success = await initializeExtension();
      
      if (success) {
        this.isInitialized = true;
        console.log(`[${EXTENSION_ID}] 模块化初始化完成`);
        this.toastr.success(`${EXTENSION_NAME}扩展加载成功`);
        
        // 添加菜单按钮
        this.addMenuButton();
        
        // 创建设置面板
        this.createSettingsPanel();
        
        return true;
      } else {
        console.error(`[${EXTENSION_ID}] 模块化初始化失败`);
        this.toastr.error('扩展初始化失败，请检查后端服务');
        return false;
      }
      
    } catch (error) {
      const errorInfo = ErrorHandler.handle(error, 'extension-manager-initialize');
      console.error(`[${EXTENSION_ID}] 初始化错误:`, errorInfo);
      this.toastr.error(`初始化失败: ${error.message}`);
      return false;
    }
  }

  // 绑定事件
  bindEvents() {
    // SillyTavern 事件集成
    eventBus.on('extensionReady', () => {
      this.handleExtensionReady();
    });
    
    eventBus.on('extensionStopped', () => {
      this.handleExtensionStopped();
    });
    
    eventBus.on('serviceError', () => {
      this.handleServiceError();
    });
    
    eventBus.on('serviceRecovered', () => {
      this.handleServiceRecovered();
    });
  }

  // 创建最小化设置面板
  createMinimalSettingsPanel() {
    if ($(`#${SETTINGS_PANEL_ID}-minimal`).length) return;

    const html = `
      <div id="${SETTINGS_PANEL_ID}-minimal">
        <div class="extension_settings inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-cog"></i> ${EXTENSION_NAME}</b>
            <div class="inline-drawer-icon">
              <span class="glyphicon glyphicon-chevron-down"></span>
            </div>
          </div>
          <div class="inline-drawer-content">
            <div class="image-player-settings">
              <div class="settings-row">
                <label class="checkbox_label" style="min-width:auto;">
                  <input type="checkbox" id="master-enabled-minimal" />
                  <i class="fa-solid fa-power-off"></i>启用媒体播放器扩展
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    $("#extensions_settings").append(html);

    // 设置事件
    $(`#${SETTINGS_PANEL_ID}-minimal #master-enabled-minimal`).on("change", async () => {
      const masterEnabled = $(`#master-enabled-minimal`).prop("checked");
      await this.configManager.updateConfig({ masterEnabled });
      this.settings.masterEnabled = masterEnabled;

      if (this.settings.masterEnabled) {
        $(`#${SETTINGS_PANEL_ID}-minimal`).remove();
        this.initialize();
        this.toastr.success("媒体播放器扩展已启用");
      }
    });
  }

  // 添加菜单按钮
  addMenuButton() {
    const menuBtnId = `ext_menu_${EXTENSION_ID}`;
    
    if ($(`#${menuBtnId}`).length) return;

    const btnHtml = `
      <div id="${menuBtnId}" class="list-group-item flex-container flexGap5">
        <i class="fa-solid fa-film"></i>
        <span>${EXTENSION_NAME}</span>
        <span class="play-status" style="margin-left:8px; font-size:10px; color:#a0a0a0;">已暂停</span>
        <span class="mode-text" style="margin-left:8px; font-size:10px; color:#a0a0a0;">随机</span>
        <span class="filter-text" style="margin-left:8px; font-size:10px; color:#a0a0a0;">所有</span>
        <span class="media-info" style="margin-left:8px; font-size:10px; color:#a0a0a0; display:none;"></span>
      </div>
    `;
    
    $("#extensionsMenu").append(btnHtml);

    // 菜单点击跳转设置面板
    $(`#${menuBtnId}`).on("click", () => {
      $("#extensions-settings-button").trigger("click");
      $(`#${SETTINGS_PANEL_ID}`).scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });

    // 菜单状态更新
    this.startMenuStatusUpdates(menuBtnId);
  }

  // 开始菜单状态更新
  startMenuStatusUpdates(menuBtnId) {
    setInterval(async () => {
      const extensionInstance = getExtensionInstance();
      if (!extensionInstance) return;
      
      const status = await extensionInstance.getStatus();
      if (!status) return;

      const menuBtn = $(`#${menuBtnId}`);
      
      // 更新播放状态
      menuBtn.find(".play-status").text(status.isPlaying ? "播放中" : "已暂停");
      
      // 更新播放模式
      menuBtn.find(".mode-text").text(status.playMode === "random" ? "随机" : "顺序");
      
      // 更新媒体筛选
      menuBtn.find(".filter-text").text(
        status.mediaFilter === "all" ? "所有" : 
        status.mediaFilter === "image" ? "图片" : "视频"
      );
      
      // 更新媒体信息
      if (status.currentMedia) {
        menuBtn.find(".media-info").text(status.currentMedia.name).show();
      } else {
        menuBtn.find(".media-info").text("无媒体").show();
      }
      
    }, 1000);
  }

  // 创建设置面板
  createSettingsPanel() {
    if ($(`#${SETTINGS_PANEL_ID}`).length) return;

    const html = this.generateSettingsPanelHTML();
    $("#extensions_settings").append(html);
    
    this.bindSettingsEvents();
    this.updateUI();
  }

  // 更新UI显示
  async updateUI() {
    if (!this.settings) {
      this.settings = await this.configManager.getConfig();
    }
    
    // 更新设置面板
    $('#service-url').val(this.settings.serviceUrl || '');
    $('#media-directories').val(this.settings.mediaDirectories?.join(', ') || '');
    $('#play-mode').val(this.settings.playMode || 'random');
    $('#switch-interval').val(this.settings.switchInterval || 5000);
    $('#auto-play').prop('checked', this.settings.autoPlay || false);
    $('#loop-play').prop('checked', this.settings.loopPlay || false);
    $('#show-filename').prop('checked', this.settings.showFilename || false);
    $('#master-enabled').prop('checked', this.settings.masterEnabled || false);
  }

  // 生成设置面板HTML
  generateSettingsPanelHTML() {
    return `
      <div id="${SETTINGS_PANEL_ID}">
        <div class="extension_settings inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b><i class="fa-solid fa-film"></i> ${EXTENSION_NAME}</b>
            <div class="inline-drawer-icon">
              <span class="glyphicon glyphicon-chevron-down"></span>
            </div>
          </div>
          <div class="inline-drawer-content">
            <div class="image-player-settings">
              <!-- 基本设置 -->
              <div class="settings-row">
                <label for="service-url">服务地址:</label>
                <input id="service-url" type="text" value="${this.settings.serviceUrl}" />
              </div>
              
              <div class="settings-row">
                <label for="media-directories">媒体目录:</label>
                <input id="media-directories" type="text" value="${this.settings.mediaDirectories || ''}" placeholder="多个目录用逗号分隔" />
              </div>
              
              <!-- 播放设置 -->
              <div class="settings-row">
                <label for="play-mode">播放模式:</label>
                <select id="play-mode">
                  <option value="random" ${this.settings.playMode === 'random' ? 'selected' : ''}>随机播放</option>
                  <option value="sequential" ${this.settings.playMode === 'sequential' ? 'selected' : ''}>顺序播放</option>
                </select>
              </div>
              
              <div class="settings-row">
                <label for="switch-interval">切换间隔(ms):</label>
                <input id="switch-interval" type="number" value="${this.settings.switchInterval}" min="1000" max="60000" />
              </div>
              
              <!-- 控制按钮 -->
              <div class="settings-row">
                <button id="reload-extension" class="menu_button">
                  <i class="fa-solid fa-refresh"></i> 重新加载扩展
                </button>
                <button id="disable-extension" class="menu_button">
                  <i class="fa-solid fa-power-off"></i> 禁用扩展
                </button>
              </div>
              
              <!-- 状态信息 -->
              <div class="settings-row status-info">
                <div><strong>扩展状态:</strong> <span id="extension-status">初始化中...</span></div>
                <div><strong>服务连接:</strong> <span id="service-status">检查中...</span></div>
                <div><strong>媒体数量:</strong> <span id="media-count">0</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 绑定设置事件
  bindSettingsEvents() {
    // 服务地址变更
    $('#service-url').on('change', async () => {
      const newUrl = $('#service-url').val();
      await this.configManager.updateConfig({ serviceUrl: newUrl });
      this.toastr.info('服务地址已更新，需要重新加载扩展');
    });
    
    // 媒体目录变更
    $('#media-directories').on('change', async () => {
      const directories = $('#media-directories').val().split(',').map(dir => dir.trim()).filter(dir => dir);
      await this.configManager.updateConfig({ mediaDirectories: directories });
      this.toastr.info('媒体目录已更新');
    });
    
    // 播放模式变更
    $('#play-mode').on('change', async () => {
      const mode = $('#play-mode').val();
      await this.configManager.updateConfig({ playMode: mode });
      this.toastr.info(`播放模式已切换为: ${mode === 'random' ? '随机' : '顺序'}`);
    });
    
    // 切换间隔变更
    $('#switch-interval').on('change', async () => {
      const interval = parseInt($('#switch-interval').val());
      await this.configManager.updateConfig({ switchInterval: interval });
      this.toastr.info(`切换间隔已更新: ${interval}ms`);
    });
    
    // 自动播放开关
    $('#auto-play').on('change', async () => {
      const autoPlay = $('#auto-play').prop('checked');
      await this.configManager.updateConfig({ autoPlay });
      this.toastr.info(`自动播放${autoPlay ? '开启' : '关闭'}`);
    });
    
    // 循环播放开关
    $('#loop-play').on('change', async () => {
      const loopPlay = $('#loop-play').prop('checked');
      await this.configManager.updateConfig({ loopPlay });
      this.toastr.info(`循环播放${loopPlay ? '开启' : '关闭'}`);
    });
    
    // 显示文件名开关
    $('#show-filename').on('change', async () => {
      const showFilename = $('#show-filename').prop('checked');
      await this.configManager.updateConfig({ showFilename });
      this.toastr.info(`文件名显示${showFilename ? '开启' : '关闭'}`);
    });
    
    // 总开关
    $('#master-enabled').on('change', async () => {
      const masterEnabled = $('#master-enabled').prop('checked');
      await this.configManager.updateConfig({ masterEnabled });
      
      if (!masterEnabled) {
        this.toastr.info('扩展已禁用，需要重新加载页面');
      } else {
        this.toastr.success('扩展已启用');
      }
    });
    
    // 重新加载扩展
    $('#reload-extension').on('click', async () => {
      await this.reloadExtension();
    });
    
    // 禁用扩展
    $('#disable-extension').on('click', () => {
      this.disableExtension();
    });
    
    // 状态信息更新
    this.startStatusUpdates();
  }

  // 开始状态信息更新
  startStatusUpdates() {
    setInterval(async () => {
      const extensionInstance = getExtensionInstance();
      if (!extensionInstance) return;
      
      const status = await extensionInstance.getStatus();
      if (!status) return;
      
      $('#extension-status').text(status.initialized ? '运行中' : '未初始化');
      $('#service-status').text(status.serviceConnected ? '已连接' : '未连接');
      $('#media-count').text(status.mediaCount);
      
    }, 2000);
  }

  // 重新加载扩展
  async reloadExtension() {
    this.toastr.info('正在重新加载扩展...');
    
    try {
      await destroyExtension();
      await new Promise(resolve => setTimeout(resolve, 500));
      await this.initialize();
      this.toastr.success('扩展重新加载完成');
    } catch (error) {
      this.toastr.error('重新加载失败: ' + error.message);
    }
  }

  // 禁用扩展
  async disableExtension() {
    this.toastr.info('正在禁用扩展...');
    
    destroyExtension();
    
    // 移除UI元素
    $(`#${PLAYER_WINDOW_ID}`).remove();
    $(`#${SETTINGS_PANEL_ID}`).remove();
    $(`#ext_menu_${EXTENSION_ID}`).remove();
    
    // 更新设置
    await this.configManager.updateConfig({ masterEnabled: false });
    
    // 创建最小化设置面板
    this.createMinimalSettingsPanel();
    
    this.toastr.success('扩展已禁用');
  }

  // 事件处理函数
  handleExtensionReady() {
    console.log(`[${EXTENSION_ID}] 扩展模块准备就绪`);
  }
  
  handleExtensionStopped() {
    console.log(`[${EXTENSION_ID}] 扩展模块已停止`);
  }
  
  handleServiceError() {
    this.toastr.warning('后端服务连接失败，请检查服务状态');
  }
  
  handleServiceRecovered() {
    this.toastr.success('后端服务连接已恢复');
  }

  // 销毁管理器
  destroy() {
    destroyExtension();
    eventBus.off('*');
    console.log(`[${EXTENSION_ID}] 扩展管理器已销毁`);
  }
}

// 全局扩展管理器实例
let extensionManager = null;

// SillyTavern 页面就绪触发
jQuery(() => {
  console.log(`[${EXTENSION_ID}] 模块化脚本开始加载`);
  
  const initWhenReady = () => {
    const checkGlobalSettings = async () => {
      const globalSettings = getSafeGlobal("extension_settings", {});
      
      // 检查DOM就绪
      const isDOMReady = document.getElementById("extensionsMenu") && 
                         document.getElementById("extensions_settings");
      
      // 检查设置就绪（或超时强制尝试）
      const isSettingsReady = !!globalSettings[EXTENSION_ID] || Date.now() - startTime > 5000;

      if (isDOMReady && isSettingsReady) {
        clearInterval(checkTimer);
        
        if (!extensionManager) {
          extensionManager = new ExtensionManager();
        }
        
        const settings = await extensionManager.configManager.getConfig();
        console.log(`[${EXTENSION_ID}] 初始化前总开关状态: masterEnabled=${settings.masterEnabled}`);

        if (settings.masterEnabled) {
          extensionManager.initialize();
        } else {
          extensionManager.createMinimalSettingsPanel();
        }

        console.log(`[${EXTENSION_ID}] DOM+全局设置均就绪,启动模块化初始化`);
        return;
      }

      // 超时保护
      if (Date.now() - startTime > 5000) {
        clearInterval(checkTimer);
        const finalDOMReady = document.getElementById("extensionsMenu") && 
                             document.getElementById("extensions_settings");
        
        if (finalDOMReady) {
          console.warn(`[${EXTENSION_ID}] 5秒超时,强制启动模块化初始化`);
          if (!extensionManager) {
            extensionManager = new ExtensionManager();
          }
          extensionManager.initialize();
        } else {
          console.error(`[${EXTENSION_ID}] 5秒超时,DOM未就绪,初始化失败`);
          toastr.error("扩展初始化失败,核心DOM未加载");
        }
      }
    };

    const startTime = Date.now();
    const checkTimer = setInterval(checkGlobalSettings, 300);
  };

  initWhenReady();
});

console.log(`[${EXTENSION_ID}] 模块化脚本文件加载完成`);
