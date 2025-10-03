// 扩展配置管理模块
const EXTENSION_ID = "st_image_player";
const EXTENSION_NAME = "媒体播放器";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings";

// 默认配置
const DEFAULT_CONFIG = {
    masterEnabled: true,
    enabled: true,
    serviceUrl: "http://localhost:9000",
    playMode: "random",
    autoSwitchMode: "timer",
    switchInterval: 5000,
    position: { x: 100, y: 100, width: 600, height: 400 },
    isLocked: false,
    isWindowVisible: true,
    showInfo: false,
    aiResponseCooldown: 3000,
    lastAISwitchTime: 0,
    randomPlayedIndices: [],
    randomMediaList: [],
    isPlaying: false,
    transitionEffect: "fade",
    preloadImages: true,
    preloadVideos: false,
    playerDetectEnabled: true,
    aiDetectEnabled: true,
    pollingInterval: 30000,
    slideshowMode: false,
    videoLoop: false,
    videoVolume: 0.8,
    mediaFilter: "all",
    showVideoControls: true,
    hideBorder: false,
    customVideoControls: {
        showProgress: true,
        showVolume: true,
        showLoop: true,
        showTime: true,
    },
    progressUpdateInterval: null,
    serviceDirectory: "",
    isMediaLoading: false,
    currentRandomIndex: -1,
    showMediaUpdateToast: false,
    aiEventRegistered: false,
    filterTriggerSource: null,
};

// 配置管理类
class ConfigManager {
    constructor() {
        this.config = this.loadConfig();
    }

    loadConfig() {
        const globalSettings = window.extension_settings || {};
        
        if (globalSettings[EXTENSION_ID]) {
            return { ...DEFAULT_CONFIG, ...globalSettings[EXTENSION_ID] };
        }

        // 初始化默认配置
        globalSettings[EXTENSION_ID] = DEFAULT_CONFIG;
        return DEFAULT_CONFIG;
    }

    saveConfig() {
        const saveFn = window.saveSettingsDebounced || null;
        if (saveFn && typeof saveFn === 'function') {
            saveFn();
            console.log(`[${EXTENSION_ID}] 配置已保存`);
        }
    }

    updateConfig(updates) {
        Object.assign(this.config, updates);
        this.saveConfig();
    }

    getConfig() {
        return { ...this.config };
    }

    resetConfig() {
        this.config = { ...DEFAULT_CONFIG };
        this.saveConfig();
    }
}

export { ConfigManager, EXTENSION_ID, EXTENSION_NAME, PLAYER_WINDOW_ID, SETTINGS_PANEL_ID };
export default ConfigManager;