import { deps } from "../../core/deps.js";

const { jQuery: $ } = deps;

const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings-panel";

/**
 * 播放器窗口样式
 */
export const createPlayerStyles = () => {
  const css = `
    <style id="image-player-css">
      /* 播放器窗口基础样式 */
      #${PLAYER_WINDOW_ID} {
        position: fixed !important;
        top: 100px !important;
        right: 20px !important;
        width: 320px !important;
        height: 240px !important;
        background: rgba(40, 40, 40, 0.95) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 16px !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4) !important;
        backdrop-filter: blur(10px) !important;
        z-index: 9998 !important;
        overflow: hidden !important;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        user-select: none !important;
        pointer-events: all !important;
      }

      #${PLAYER_WINDOW_ID}:hover {
        border-color: rgba(114, 137, 218, 0.4) !important;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5) !important;
      }

      #${PLAYER_WINDOW_ID}.hidden {
        opacity: 0 !important;
        transform: translateY(20px) scale(0.95) !important;
        pointer-events: none !important;
      }

      #${PLAYER_WINDOW_ID}.minimized {
        width: 160px !important;
        height: 120px !important;
        opacity: 0.7 !important;
      }

      #${PLAYER_WINDOW_ID}.maximized {
        top: 50px !important;
        left: 50px !important;
        right: 50px !important;
        bottom: 50px !important;
        width: auto !important;
        height: auto !important;
      }

      #${PLAYER_WINDOW_ID}.locked {
        cursor: not-allowed !important;
      }

      #${PLAYER_WINDOW_ID}.locked .resize-handle {
        display: none !important;
      }

      /* 媒体容器样式 */
      #${PLAYER_WINDOW_ID} .media-container {
        width: 100% !important;
        height: 100% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        position: relative !important;
        overflow: hidden !important;
      }

      #${PLAYER_WINDOW_ID} .media-container img,
      #${PLAYER_WINDOW_ID} .media-container video {
        max-width: 100% !important;
        max-height: 100% !important;
        object-fit: contain !important;
        border-radius: 12px !important;
      }

      #${PLAYER_WINDOW_ID} .media-container video {
        background: #000 !important;
      }

      /* 控制栏样式 */
      #${PLAYER_WINDOW_ID} .image-player-controls {
        position: absolute !important;
        bottom: 0 !important;
        left: 0 !important;
        right: 0 !important;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.9), transparent) !important;
        padding: 16px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 12px !important;
        opacity: 0 !important;
        transition: opacity 0.3s ease !important;
        pointer-events: none !important;
      }

      #${PLAYER_WINDOW_ID}:hover .image-player-controls {
        opacity: 1 !important;
        pointer-events: all !important;
      }

      #${PLAYER_WINDOW_ID} .controls-group {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
      }

      /* 控制按钮样式 */
      #${PLAYER_WINDOW_ID} .control-btn {
        width: 40px !important;
        height: 40px !important;
        border: none !important;
        border-radius: 10px !important;
        background: rgba(255, 255, 255, 0.1) !important;
        color: #b0b0b0 !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 16px !important;
        transition: all 0.2s ease !important;
        backdrop-filter: blur(10px) !important;
      }

      #${PLAYER_WINDOW_ID} .control-btn:hover {
        background: rgba(255, 255, 255, 0.15) !important;
        color: #fff !important;
        transform: translateY(-2px) !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3) !important;
      }

      #${PLAYER_WINDOW_ID} .control-btn:active {
        transform: translateY(0) scale(0.98) !important;
      }

      /* 播放/暂停按钮特殊样式 */
      #${PLAYER_WINDOW_ID} .control-btn.play-pause {
        width: 56px !important;
        height: 56px !important;
        background: linear-gradient(135deg, #7289da, #5b6eae) !important;
        color: white !important;
        font-size: 18px !important;
        box-shadow: 0 6px 20px rgba(114, 137, 218, 0.4) !important;
      }

      #${PLAYER_WINDOW_ID} .control-btn.play-pause:hover {
        background: linear-gradient(135deg, #8396e1, #6c7fc6) !important;
        transform: scale(1.1) translateY(-3px) !important;
        box-shadow: 0 10px 30px rgba(114, 137, 218, 0.6) !important;
      }

      #${PLAYER_WINDOW_ID} .control-btn.play-pause:active {
        transform: scale(0.95) translateY(0) !important;
      }

      #${PLAYER_WINDOW_ID} .control-btn.active {
        background: rgba(114, 137, 218, 0.25) !important;
        color: #7289da !important;
        border: 1px solid rgba(114, 137, 218, 0.4) !important;
        box-shadow: 0 4px 16px rgba(114, 137, 218, 0.3) !important;
      }

      #${PLAYER_WINDOW_ID} .control-btn.active:hover {
        background: rgba(114, 137, 218, 0.35) !important;
        box-shadow: 0 6px 20px rgba(114, 137, 218, 0.4) !important;
      }

      #${PLAYER_WINDOW_ID} .control-text {
        color: #b0b0b0 !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        text-align: center !important;
        min-width: 100px !important;
        padding: 0 12px !important;
        letter-spacing: 0.5px !important;
        text-transform: uppercase !important;
      }

      #${PLAYER_WINDOW_ID} .media-filter-group {
        gap: 8px !important;
      }

      #${PLAYER_WINDOW_ID} .media-filter-group .control-btn {
        width: 44px !important;
        height: 44px !important;
        font-size: 14px !important;
        border-radius: 10px !important;
      }

      /* 调整手柄样式 */
      #${PLAYER_WINDOW_ID} .resize-handle {
        position: absolute !important;
        width: 16px !important;
        height: 16px !important;
        cursor: nwse-resize !important;
        opacity: 0.6 !important;
        transition: opacity 0.2s ease !important;
        z-index: 1000 !important;
        pointer-events: all !important;
      }

      /* 右下角手柄 */
      #${PLAYER_WINDOW_ID} .resize-handle-se {
        bottom: 3px !important;
        right: 3px !important;
        cursor: nwse-resize !important;
      }

      /* 左下角手柄 */
      #${PLAYER_WINDOW_ID} .resize-handle-sw {
        bottom: 3px !important;
        left: 3px !important;
        cursor: nesw-resize !important;
      }

      /* 右上角手柄 */
      #${PLAYER_WINDOW_ID} .resize-handle-ne {
        top: 3px !important;
        right: 3px !important;
        cursor: nesw-resize !important;
      }

      /* 左上角手柄 */
      #${PLAYER_WINDOW_ID} .resize-handle-nw {
        top: 3px !important;
        left: 3px !important;
        cursor: nwse-resize !important;
      }

      #${PLAYER_WINDOW_ID} .resize-handle:hover {
        opacity: 1 !important;
      }

      #${PLAYER_WINDOW_ID} .resize-handle::before {
        content: '' !important;
        position: absolute !important;
        width: 8px !important;
        height: 8px !important;
        border-radius: 1px !important;
      }

      #${PLAYER_WINDOW_ID} .resize-handle-se::before,
      #${PLAYER_WINDOW_ID} .resize-handle-nw::before {
        bottom: 3px !important;
        right: 3px !important;
        border-right: 2px solid rgba(255, 255, 255, 0.4) !important;
        border-bottom: 2px solid rgba(255, 255, 255, 0.4) !important;
      }

      #${PLAYER_WINDOW_ID} .resize-handle-sw::before {
        bottom: 3px !important;
        left: 3px !important;
        border-left: 2px solid rgba(255, 255, 255, 0.4) !important;
        border-bottom: 2px solid rgba(255, 255, 255, 0.4) !important;
      }

      #${PLAYER_WINDOW_ID} .resize-handle-ne::before {
        top: 3px !important;
        right: 3px !important;
        border-right: 2px solid rgba(255, 255, 255, 0.4) !important;
        border-top: 2px solid rgba(255, 255, 255, 0.4) !important;
      }

      /* 加载动画 */
      #${PLAYER_WINDOW_ID} .loading-animation {
        color: #b0b0b0 !important;
        font-size: 15px !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        font-weight: 500 !important;
      }

      #${PLAYER_WINDOW_ID} .loading-animation::before {
        content: '' !important;
        width: 20px !important;
        height: 20px !important;
        border: 2px solid rgba(255, 255, 255, 0.2) !important;
        border-top: 2px solid #7289da !important;
        border-radius: 50% !important;
        animation: spin 1s linear infinite !important;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      /* 拖动状态 */
      #${PLAYER_WINDOW_ID}.dragging {
        cursor: grabbing !important;
      }

      #${PLAYER_WINDOW_ID}.resizing {
        cursor: nwse-resize !important;
      }

      /* 响应式设计 */
      @media (max-width: 600px) {
        #${PLAYER_WINDOW_ID} .image-player-controls {
          flex-direction: column !important;
          gap: 12px !important;
          padding: 12px !important;
        }

        #${PLAYER_WINDOW_ID} .controls-group {
          width: 100% !important;
          justify-content: center !important;
        }

        #${PLAYER_WINDOW_ID} .control-btn {
          width: 36px !important;
          height: 36px !important;
        }

        #${PLAYER_WINDOW_ID} .control-btn.play-pause {
          width: 44px !important;
          height: 44px !important;
        }
      }
    </style>
  `;

  if ($(`#image-player-css`).length === 0) {
    $("head").append(css);
  }
};

/**
 * 设置面板样式
 */
export const createSettingsStyles = () => {
  const css = `
    <style id="settings-panel-css">
      /* 设置面板样式 */
      #${SETTINGS_PANEL_ID} {
        background: rgba(40, 40, 40, 0.98) !important;
        border: 1px solid rgba(114, 137, 218, 0.3) !important;
        border-radius: 12px !important;
        padding: 20px !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4) !important;
        backdrop-filter: blur(15px) !important;
        max-width: 500px !important;
        z-index: 9999 !important;
      }

      #${SETTINGS_PANEL_ID} .settings-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        margin-bottom: 20px !important;
        padding-bottom: 15px !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
      }

      #${SETTINGS_PANEL_ID} .settings-title {
        color: #fff !important;
        font-size: 18px !important;
        font-weight: 600 !important;
        margin: 0 !important;
      }

      #${SETTINGS_PANEL_ID} .settings-close {
        background: none !important;
        border: none !important;
        color: #b0b0b0 !important;
        cursor: pointer !important;
        font-size: 16px !important;
        padding: 5px !important;
        border-radius: 6px !important;
        transition: all 0.2s ease !important;
      }

      #${SETTINGS_PANEL_ID} .settings-close:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        color: #fff !important;
      }

      #${SETTINGS_PANEL_ID} .settings-section {
        margin-bottom: 25px !important;
      }

      #${SETTINGS_PANEL_ID} .section-title {
        color: #fff !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        margin-bottom: 12px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
      }

      #${SETTINGS_PANEL_ID} .setting-row {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        margin-bottom: 12px !important;
        padding: 10px 0 !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
      }

      #${SETTINGS_PANEL_ID} .setting-label {
        color: #b0b0b0 !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        flex: 1 !important;
      }

      #${SETTINGS_PANEL_ID} .setting-control {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
      }

      #${SETTINGS_PANEL_ID} .toggle-switch {
        position: relative !important;
        width: 40px !important;
        height: 20px !important;
      }

      #${SETTINGS_PANEL_ID} .toggle-switch input {
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
      }

      #${SETTINGS_PANEL_ID} .toggle-slider {
        position: absolute !important;
        cursor: pointer !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        background-color: rgba(255, 255, 255, 0.2) !important;
        transition: .4s !important;
        border-radius: 20px !important;
      }

      #${SETTINGS_PANEL_ID} .toggle-slider:before {
        position: absolute !important;
        content: "" !important;
        height: 16px !important;
        width: 16px !important;
        left: 2px !important;
        bottom: 2px !important;
        background-color: white !important;
        transition: .4s !important;
        border-radius: 50% !important;
      }

      #${SETTINGS_PANEL_ID} input:checked + .toggle-slider {
        background-color: #7289da !important;
      }

      #${SETTINGS_PANEL_ID} input:checked + .toggle-slider:before {
        transform: translateX(20px) !important;
      }

      #${SETTINGS_PANEL_ID} .slider-container {
        width: 200px !important;
      }

      #${SETTINGS_PANEL_ID} .slider-container input[type="range"] {
        width: 100% !important;
        height: 6px !important;
        background: rgba(255, 255, 255, 0.2) !important;
        border-radius: 3px !important;
        outline: none !important;
      }

      #${SETTINGS_PANEL_ID} .slider-container input[type="range"]::-webkit-slider-thumb {
        appearance: none !important;
        width: 16px !important;
        height: 16px !important;
        background: #7289da !important;
        border-radius: 50% !important;
        cursor: pointer !important;
      }

      #${SETTINGS_PANEL_ID} .slider-value {
        color: #b0b0b0 !important;
        font-size: 12px !important;
        min-width: 40px !important;
        text-align: right !important;
      }

      #${SETTINGS_PANEL_ID} .button-group {
        display: flex !important;
        gap: 10px !important;
        margin-top: 20px !important;
      }

      #${SETTINGS_PANEL_ID} .settings-button {
        padding: 8px 16px !important;
        border: 1px solid rgba(114, 137, 218, 0.3) !important;
        background: rgba(114, 137, 218, 0.2) !important;
        color: #fff !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        font-size: 12px !important;
        transition: all 0.2s ease !important;
      }

      #${SETTINGS_PANEL_ID} .settings-button:hover {
        background: rgba(114, 137, 218, 0.3) !important;
        border-color: rgba(114, 137, 218, 0.5) !important;
      }

      #${SETTINGS_PANEL_ID} .settings-button.danger {
        background: rgba(220, 53, 69, 0.2) !important;
        border-color: rgba(220, 53, 69, 0.3) !important;
      }

      #${SETTINGS_PANEL_ID} .settings-button.danger:hover {
        background: rgba(220, 53, 69, 0.3) !important;
        border-color: rgba(220, 53, 69, 0.5) !important;
      }

      #${SETTINGS_PANEL_ID} .status-indicator {
        display: inline-block !important;
        width: 8px !important;
        height: 8px !important;
        border-radius: 50% !important;
        margin-right: 8px !important;
      }

      #${SETTINGS_PANEL_ID} .status-online {
        background: #28a745 !important;
      }

      #${SETTINGS_PANEL_ID} .status-offline {
        background: #dc3545 !important;
      }

      #${SETTINGS_PANEL_ID} .status-connecting {
        background: #ffc107 !important;
        animation: pulse 1.5s infinite !important;
      }

      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }

      #${SETTINGS_PANEL_ID} .help-text {
        color: #888 !important;
        font-size: 11px !important;
        font-style: italic !important;
        margin-top: 4px !important;
      }
    </style>
  `;

  if ($(`#settings-panel-css`).length === 0) {
    $("head").append(css);
  }
};

/**
 * 清理样式
 */
export const cleanupStyles = () => {
  if ($) {
    $(`#image-player-css`).remove();
    $(`#settings-panel-css`).remove();
  }
};