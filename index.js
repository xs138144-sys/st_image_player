// 图片播放器扩展
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    is_send_press,
} from "../../../../script.js";

const EXTENSION_ID = "st_image_player";
const EXTENSION_NAME = "图片播放器";
const PLAYER_WINDOW_ID = "st-image-player-window";
const SETTINGS_PANEL_ID = "st-image-player-settings";

// 安全访问全局对象
const getSafeGlobal = (name, defaultValue) => {
    return window[name] === undefined ? defaultValue : window[name];
};

// 安全访问扩展设置
const getExtensionSettings = () => {
    const settings = getSafeGlobal("extension_settings", {});
    if (!settings[EXTENSION_ID]) {
        settings[EXTENSION_ID] = {
            enabled: true,
            serviceUrl: "http://localhost:9000",
            playMode: "random",
            autoSwitch: false,
            slideshowMode: true,
            switchInterval: 5000,
            position: { x: 100, y: 100, width: 500, height: 500 },
            isLocked: false,
            isWindowVisible: true,
            showInfo: false,
            autoSwitchMode: "timer",
            aiResponseCooldown: 3000,
            lastAISwitchTime: 0,
            randomPlayedIndices: [],
            randomImageList: [],
            isPlaying: false,
            // 新增设置项
            transitionEffect: "fade",
            preloadImages: true,
            playerDetectEnabled: true,
            aiDetectEnabled: true,
            pollingInterval: 30000,
        };
    }
    return settings[EXTENSION_ID];
};

// 安全设置方法
const saveSafeSettings = () => {
    const saveFn = getSafeGlobal("saveSettingsDebounced", null);
    if (saveFn && typeof saveFn === "function") {
        saveFn();
    }
};

// 安全 toastr 方案
const getSafeToastr = () => {
    const toastrExists = window.toastr && typeof window.toastr === "object";
    return toastrExists
        ? window.toastr
        : {
              success: (msg) => console.log(`TOAST_SUCCESS: ${msg}`),
              info: (msg) => console.info(`TOAST_INFO: ${msg}`),
              warning: (msg) => console.warn(`TOAST_WARNING: ${msg}`),
              error: (msg) => console.error(`TOAST_ERROR: ${msg}`),
          };
};

const toastr = getSafeToastr();

// ==================== 播放器状态 ====================
let imageList = [];
let currentImageIndex = 0;
let switchTimer = null;
let serviceStatus = { active: false, imageCount: 0 };
let retryCount = 0;
let pollingTimer = null;
let preloadedImage = null;

// ==================== API 通信 ====================
const checkServiceStatus = async () => {
    const settings = getExtensionSettings();
    try {
        const response = await fetch(`${settings.serviceUrl}/status`);
        if (!response.ok) throw new Error(`HTTP错误 ${response.status}`);
        const data = await response.json();
        serviceStatus = {
            active: data.active,
            imageCount: data.image_count || 0,
        };
        return serviceStatus;
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 服务检查失败`, error);
        return { active: false, error: error.message };
    }
};

const fetchImageList = async () => {
    const settings = getExtensionSettings();
    if (!settings.serviceUrl) throw new Error("无服务地址");

    try {
        const response = await fetch(`${settings.serviceUrl}/images`);
        if (!response.ok) throw new Error(`HTTP错误 ${response.status}`);
        const data = await response.json();
        return data.images || [];
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 获取图片列表失败`, error);
        toastr.error("获取图片列表失败");
        return [];
    }
};

const updateScanDirectory = async (newPath) => {
    const settings = getExtensionSettings();
    try {
        const response = await fetch(`${settings.serviceUrl}/scan`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ path: newPath }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "更新目录失败");
        }

        const result = await response.json();
        toastr.success(`目录已更新: ${result.path}`);
        return true;
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 更新目录失败`, error);
        toastr.error(`更新目录失败: ${error.message}`);
        return false;
    }
};

// ==================== 播放器窗口 ====================
const createImagePlayerWindow = async () => {
    // 确保只创建一次窗口
    if ($(`#${PLAYER_WINDOW_ID}`).length > 0) return;

    const settings = getExtensionSettings();
    const infoHTML = settings.showInfo
        ? `<div class="image-info">加载中...</div>`
        : "";

    const html = `
    <div id="${PLAYER_WINDOW_ID}" class="image-player-window">
        <div class="image-player-header">
            <div class="title"><i class="fa-solid fa-images"></i> ${EXTENSION_NAME}</div>
            <div class="window-controls">
                <button class="lock"><i class="fa-solid ${
                    settings.isLocked ? "fa-lock" : "fa-lock-open"
                }"></i></button>
                <button class="toggle-info ${
                    settings.showInfo ? "active" : ""
                }"><i class="fa-solid fa-circle-info"></i></button>
                <button class="hide"><i class="fa-solid fa-minus"></i></button>
            </div>
        </div>
        
        <div class="image-player-body">
            <div class="image-container">
                <div class="loading-animation">加载中...</div>
                <img class="image-player-img" 
                     onerror="this.onerror=null;this.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQYV2P4z8DwHwAFAAH/l8iC5gAAAABJRU5ErkJggg=='" />
            </div>
            ${infoHTML}
        </div>
        
        <div class="image-player-controls">
            <div class="controls-group">
                <button class="control-btn play-pause"><i class="fa-solid ${
                    settings.isPlaying ? "fa-pause" : "fa-play"
                }"></i></button>
                <button class="control-btn mode-switch" title="${
                    settings.playMode === "random" ? "随机模式" : "顺序模式"
                }">
                    <i class="fa-solid ${
                        settings.playMode === "random"
                            ? "fa-shuffle"
                            : "fa-list-ol"
                    }"></i>
                </button>
                <button class="control-btn switch-mode-toggle ${
                    settings.autoSwitchMode === "detect" ? "active" : ""
                }" title="切换模式: ${
        settings.autoSwitchMode === "detect" ? "检测播放" : "定时切换"
    }">
                    <i class="fa-solid ${
                        settings.autoSwitchMode === "detect"
                            ? "fa-robot"
                            : "fa-clock"
                    }"></i>
                </button>
            </div>
            
            <div class="controls-group">
                <button class="control-btn prev" title="上一张"><i class="fa-solid fa-backward-step"></i></button>
                <div class="control-text">${
                    settings.playMode === "random"
                        ? "随机模式"
                        : "顺序模式: 0/0"
                }</div>
                <button class="control-btn next" title="下一张"><i class="fa-solid fa-forward-step"></i></button>
            </div>
            <div class="resize-handle"></div>
        </div>
    </div>`;

    // 添加到DOM
    $("body").append(html);
    setupWindowEvents(PLAYER_WINDOW_ID);
    positionWindow(PLAYER_WINDOW_ID);

    console.log(`[${EXTENSION_ID}] 播放器窗口已创建`);
};

const positionWindow = (windowId) => {
    const settings = getExtensionSettings();
    const win = $(`#${windowId}`);

    win.css({
        left: `${settings.position.x}px`,
        top: `${settings.position.y}px`,
        width: `${settings.position.width}px`,
        height: `${settings.position.height}px`,
    })
        .toggleClass("locked", settings.isLocked)
        .toggle(settings.isWindowVisible);
};

// ==================== 窗口事件 ====================
let dragData = null;
let resizeData = null;

const setupWindowEvents = (windowId) => {
    const winElement = document.getElementById(windowId);
    const header = winElement.querySelector(".image-player-header");
    const resizeHandle = winElement.querySelector(".resize-handle");
    const winSelector = `#${windowId}`;
    const settings = getExtensionSettings();

    // 拖拽处理
    header.addEventListener("mousedown", (e) => {
        if (settings.isLocked) return;
        dragData = {
            element: winElement,
            startX: e.clientX,
            startY: e.clientY,
            startLeft: winElement.offsetLeft,
            startTop: winElement.offsetTop,
        };
    });

    // 调整大小
    resizeHandle.addEventListener("mousedown", (e) => {
        if (settings.isLocked) return;
        e.preventDefault();
        resizeData = {
            element: winElement,
            startX: e.clientX,
            startY: e.clientY,
            startWidth: winElement.offsetWidth,
            startHeight: winElement.offsetHeight,
        };
    });

    // 全局事件
    document.addEventListener("mousemove", (e) => {
        if (dragData) {
            const diffX = e.clientX - dragData.startX;
            const diffY = e.clientY - dragData.startY;
            dragData.element.style.left = `${dragData.startLeft + diffX}px`;
            dragData.element.style.top = `${dragData.startTop + diffY}px`;
        }

        if (resizeData) {
            const diffX = e.clientX - resizeData.startX;
            const diffY = e.clientY - resizeData.startY;

            resizeData.element.style.width = `${Math.max(
                200,
                resizeData.startWidth + diffX
            )}px`;
            resizeData.element.style.height = `${Math.max(
                200,
                resizeData.startHeight + diffY
            )}px`;
        }
    });

    document.addEventListener("mouseup", () => {
        if (dragData || resizeData) {
            const settings = getExtensionSettings();
            const element = dragData?.element || resizeData?.element;

            settings.position = {
                x: element.offsetLeft,
                y: element.offsetTop,
                width: element.offsetWidth,
                height: element.offsetHeight,
            };

            saveSafeSettings();
            dragData = null;
            resizeData = null;
        }
    });

    // 按钮事件
    $(`${winSelector} .lock`).on("click", function () {
        const settings = getExtensionSettings();
        settings.isLocked = !settings.isLocked;
        saveSafeSettings();

        $(this)
            .find("i")
            .toggleClass("fa-lock fa-lock-open")
            .closest(".image-player-window")
            .toggleClass("locked");

        toastr.info(`窗口已${settings.isLocked ? "锁定" : "解锁"}`);
    });

    $(`${winSelector} .play-pause`).on("click", function () {
        const settings = getExtensionSettings();
        const wasPlaying = settings.isPlaying;
        settings.isPlaying = !wasPlaying;
        saveSafeSettings();

        const icon = $(this).find("i");
        icon.toggleClass("fa-play fa-pause");

        if (settings.isPlaying) {
            // 如果之前是停止状态，现在开始播放
            if (!wasPlaying) {
                startPlayback();
            }
        } else {
            clearTimeout(switchTimer);
        }
    });

    $(`${winSelector} .mode-switch`).on("click", function () {
        const settings = getExtensionSettings();
        settings.playMode =
            settings.playMode === "random" ? "sequential" : "random";
        saveSafeSettings();

        const icon = $(this).find("i");
        icon.toggleClass("fa-shuffle fa-list-ol");

        if (settings.playMode === "random") {
            toastr.info("切换到随机播放模式");
        } else {
            toastr.info("切换到顺序播放模式");
        }

        // 更新UI
        updateExtensionMenu();
    });

    $(`${winSelector} .toggle-info`).on("click", function () {
        const settings = getExtensionSettings();
        settings.showInfo = !settings.showInfo;
        saveSafeSettings();

        $(this).toggleClass("active", settings.showInfo);
        $(`${winSelector} .image-info`).toggle(settings.showInfo);
        toastr.info(`图片信息${settings.showInfo ? "显示" : "隐藏"}`);
    });

    $(`${winSelector} .hide`).on("click", function () {
        $(winElement).hide();
        const settings = getExtensionSettings();
        settings.isWindowVisible = false;
        saveSafeSettings();
    });

    $(`${winSelector} .prev`).on("click", () => showImage("prev"));
    $(`${winSelector} .next`).on("click", () => showImage("next"));

    // 切换模式按钮事件
    $(`${winSelector} .switch-mode-toggle`).on("click", function () {
        const settings = getExtensionSettings();
        settings.autoSwitchMode =
            settings.autoSwitchMode === "detect" ? "timer" : "detect";
        settings.isPlaying = settings.autoSwitchMode !== null; // 切换模式时自动开始播放
        saveSafeSettings();

        $(this)
            .toggleClass("active", settings.autoSwitchMode === "detect")
            .find("i")
            .toggleClass("fa-robot fa-clock");

        // 更新播放按钮状态
        $(`${winSelector} .play-pause i`)
            .toggleClass("fa-play", !settings.isPlaying)
            .toggleClass("fa-pause", settings.isPlaying);

        if (settings.autoSwitchMode === "detect") {
            toastr.info("检测播放模式已启动");
        } else if (settings.autoSwitchMode === "timer") {
            toastr.info("定时切换已启动");
        } else {
            toastr.info("播放已停止");
        }

        // 启动或停止播放
        if (settings.isPlaying) {
            startPlayback();
        } else {
            clearTimeout(switchTimer);
        }
    });
};

// ==================== 播放控制 ====================
const startPlayback = () => {
    const settings = getExtensionSettings();
    if (!settings.isPlaying) return;

    clearTimeout(switchTimer);

    // 只有定时切换模式才使用定时器
    if (settings.autoSwitchMode === "timer") {
        showImage("next");
        switchTimer = setTimeout(startPlayback, settings.switchInterval);
    }
};

const getRandomImageIndex = () => {
    const settings = getExtensionSettings();

    // 如果所有图片都已播放过，重置播放记录
    if (
        settings.randomPlayedIndices.length >= settings.randomImageList.length
    ) {
        settings.randomPlayedIndices = [];
    }

    // 获取未播放的图片索引
    const availableIndices = settings.randomImageList
        .map((_, index) => index)
        .filter((index) => !settings.randomPlayedIndices.includes(index));

    if (availableIndices.length === 0) {
        return -1;
    }

    // 随机选择一个未播放的图片
    const randomIndex = Math.floor(Math.random() * availableIndices.length);
    return availableIndices[randomIndex];
};

// 图片预加载功能
const preloadImage = async (imageUrl) => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = imageUrl;
    });
};

const applyTransitionEffect = (element, effectType) => {
    // 移除所有过渡类
    element.classList.remove(
        "fade-transition",
        "slide-transition",
        "zoom-transition"
    );

    // 添加当前过渡效果
    if (effectType !== "none") {
        element.classList.add(`${effectType}-transition`);
    }
};

const showImage = async (direction) => {
    const winId = `#${PLAYER_WINDOW_ID}`;
    const settings = getExtensionSettings();
    const imgElement = $(winId).find(".image-player-img")[0];

    // 应用过渡效果
    applyTransitionEffect(imgElement, settings.transitionEffect);

    // 显示加载状态
    $(winId).find(".loading-animation").show();
    $(winId).find(".image-player-img").hide();
    $(winId).find(".control-text").text("加载中...");

    try {
        if (!settings.serviceUrl) throw new Error("无服务地址");

        // 每次显示图片前检查服务状态
        const status = await checkServiceStatus();
        if (!status.active) {
            throw new Error("图片服务未连接");
        }

        let imageData = null;
        let imageUrl;
        let imageName;

        if (settings.playMode === "random") {
            // 确保随机图片列表不为空
            if (settings.randomImageList.length === 0) {
                settings.randomImageList = await fetchImageList();
                settings.randomPlayedIndices = [];
            }

            // 获取随机图片索引
            let randomIndex = -1;
            if (direction === "next") {
                randomIndex = getRandomImageIndex();
                if (randomIndex === -1) {
                    settings.randomPlayedIndices = [];
                    randomIndex = getRandomImageIndex();
                }
                settings.randomPlayedIndices.push(randomIndex);
            } else if (direction === "prev") {
                // 上一张：从播放记录中取出上一个
                if (settings.randomPlayedIndices.length > 1) {
                    settings.randomPlayedIndices.pop(); // 移除当前
                    randomIndex = settings.randomPlayedIndices.pop(); // 获取上一个
                    settings.randomPlayedIndices.push(randomIndex); // 重新添加
                } else {
                    randomIndex = settings.randomPlayedIndices[0] || 0;
                }
            } else if (direction === "current") {
                if (settings.randomPlayedIndices.length > 0) {
                    randomIndex =
                        settings.randomPlayedIndices[
                            settings.randomPlayedIndices.length - 1
                        ];
                } else {
                    randomIndex = getRandomImageIndex();
                    if (randomIndex !== -1) {
                        settings.randomPlayedIndices.push(randomIndex);
                    }
                }
            }

            if (randomIndex === -1) {
                throw new Error("无可用图片");
            }

            const imageItem = settings.randomImageList[randomIndex];
            imageUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
                imageItem.rel_path
            )}`;
            imageName = imageItem.name;
        } else {
            // 确保顺序图片列表不为空
            if (imageList.length === 0) {
                imageList = await fetchImageList();
            }

            if (imageList.length === 0) throw new Error("无可用图片");

            if (direction === "next") {
                currentImageIndex = (currentImageIndex + 1) % imageList.length;
                if (!settings.slideshowMode && currentImageIndex === 0) {
                    // 非循环模式到达结尾
                    $(winId + " .play-pause i")
                        .removeClass("fa-pause")
                        .addClass("fa-play");
                    settings.isPlaying = false;
                    saveSafeSettings();
                    return;
                }
            } else if (direction === "prev") {
                currentImageIndex =
                    (currentImageIndex - 1 + imageList.length) %
                    imageList.length;
            } else if (direction === "current") {
                // 保持当前索引不变
                if (currentImageIndex >= imageList.length) {
                    currentImageIndex = 0;
                }
            }

            const imageItem = imageList[currentImageIndex];
            imageUrl = `${settings.serviceUrl}/file/${encodeURIComponent(
                imageItem.rel_path
            )}`;
            imageName = imageItem.name;
        }

        // 使用预加载的图片（如果有）
        if (preloadedImage && preloadedImage.src === imageUrl) {
            $(winId).find(".image-player-img").attr("src", imageUrl).show();
        } else {
            // 加载图片
            const img = new Image();
            img.src = imageUrl;
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = () => reject(new Error("图片加载失败"));
            });

            // 更新显示
            $(winId).find(".image-player-img").attr("src", imageUrl).show();
        }

        $(winId).find(".loading-animation").hide();

        // 显示图片信息
        if (settings.showInfo) {
            $(winId)
                .find(".image-info")
                .text(imageName || "")
                .show();
        } else {
            $(winId).find(".image-info").hide();
        }

        // 更新状态文本
        let statusText;
        if (settings.playMode === "random") {
            const playedCount = settings.randomPlayedIndices.length;
            const totalCount = settings.randomImageList.length || 0;
            statusText = `随机模式: ${playedCount}/${totalCount}`;
        } else {
            const totalCount = imageList.length || 0;
            statusText = `顺序模式: ${currentImageIndex + 1}/${totalCount}`;
        }
        $(winId).find(".control-text").text(statusText);

        // 重置重试计数器
        retryCount = 0;

        // 预加载下一张图片
        if (settings.preloadImages) {
            let nextImageUrl;

            if (settings.playMode === "random") {
                const nextRandomIndex = getRandomImageIndex();
                if (nextRandomIndex !== -1) {
                    const nextImageItem =
                        settings.randomImageList[nextRandomIndex];
                    nextImageUrl = `${
                        settings.serviceUrl
                    }/file/${encodeURIComponent(nextImageItem.rel_path)}`;
                }
            } else {
                const nextIndex = (currentImageIndex + 1) % imageList.length;
                const nextImageItem = imageList[nextIndex];
                nextImageUrl = `${
                    settings.serviceUrl
                }/file/${encodeURIComponent(nextImageItem.rel_path)}`;
            }

            if (nextImageUrl) {
                preloadedImage = await preloadImage(nextImageUrl);
            }
        }
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 加载图片失败`, error);

        // 更详细的错误处理
        let errorMessage = "图片加载失败";
        if (error.message.includes("Failed to fetch")) {
            errorMessage = "无法连接到图片服务";
        } else if (error.message.includes("404")) {
            errorMessage = "图片不存在";
        } else if (error.message.includes("无可用图片")) {
            errorMessage = "没有可用的图片";
        }

        // 重试机制
        if (retryCount < 3 && settings.enabled) {
            retryCount++;
            toastr.warning(`${errorMessage}，重试中 (${retryCount}/3)...`);
            setTimeout(() => showImage(direction), 3000);
        } else {
            toastr.error(`${errorMessage}，已停止重试`);
            $(winId).find(".control-text").text("加载失败");
        }
    }
};

// ==================== AI回复检测 ====================
const onAIResponse = () => {
    const settings = getExtensionSettings();
    if (settings.autoSwitchMode !== "detect") return;
    if (!settings.isWindowVisible) return;
    if (!settings.aiDetectEnabled) return;

    // 使用高精度计时器
    const now = performance.now();
    if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) {
        console.log(`[${EXTENSION_ID}] 冷却时间未结束`);
        return;
    }

    // 更新最后切换时间
    settings.lastAISwitchTime = now;
    saveSafeSettings();

    // 切换到下一张图片
    showImage("next");
    console.log(`[${EXTENSION_ID}] AI回复检测: 切换到下一张图片`);
};

// ==================== 玩家消息检测 ====================
const onPlayerMessage = () => {
    const settings = getExtensionSettings();
    if (settings.autoSwitchMode !== "detect") return;
    if (!settings.isWindowVisible) return;
    if (!settings.playerDetectEnabled) return;

    // 使用高精度计时器
    const now = performance.now();
    if (now - settings.lastAISwitchTime < settings.aiResponseCooldown) {
        console.log(`[${EXTENSION_ID}] 冷却时间未结束`);
        return;
    }

    // 更新最后切换时间
    settings.lastAISwitchTime = now;
    saveSafeSettings();

    // 切换到下一张图片
    showImage("next");
    console.log(`[${EXTENSION_ID}] 玩家消息检测: 切换到下一张图片`);
};

// ==================== 轮询服务状态 ====================
const startPollingService = () => {
    const settings = getExtensionSettings();
    if (pollingTimer) clearTimeout(pollingTimer);

    const poll = async () => {
        try {
            const prevCount = serviceStatus.imageCount;
            await checkServiceStatus();

            if (serviceStatus.imageCount !== prevCount) {
                // 图片数量变化，刷新列表
                if (settings.playMode === "random") {
                    settings.randomImageList = await fetchImageList();
                    settings.randomPlayedIndices = [];
                } else {
                    imageList = await fetchImageList();
                }

                toastr.info(`图片列表已更新 (${serviceStatus.imageCount}张)`);
            }
        } catch (error) {
            console.error(`[${EXTENSION_ID}] 轮询服务失败`, error);
        } finally {
            pollingTimer = setTimeout(poll, settings.pollingInterval);
        }
    };

    poll();
};

// ==================== 设置面板 ====================
const createSettingsPanel = () => {
    // 确保只创建一次设置面板
    if ($(`#${SETTINGS_PANEL_ID}`).length > 0) return;

    const settings = getExtensionSettings();
    const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
    const imageCount =
        serviceStatus.imageCount > 0
            ? `${serviceStatus.imageCount}张图片`
            : "无图片";

    const html = `
    <div id="${SETTINGS_PANEL_ID}">
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
                        <label class="service-status">
                            <i class="fa-solid ${
                                serviceStatus.active
                                    ? "fa-plug-circle-check"
                                    : "fa-plug"
                            }"></i>
                            服务状态: <span class="${
                                serviceStatus.active
                                    ? "status-success"
                                    : "status-error"
                            }">${serviceActive}</span> (${imageCount})
                        </label>
                    </div>
                    
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-link"></i>服务地址
                        </label>
                        <input type="text" id="player-service-url" value="${
                            settings.serviceUrl
                        }" placeholder="http://localhost:9000" />
                    </div>
                    
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-folder"></i>图片目录
                        </label>
                        <input type="text" id="player-scan-directory" placeholder="输入完整路径" />
                        <button id="update-directory" class="menu-button">更新目录</button>
                    </div>
                    
                    <div class="function-toggle-group">
                        <div class="function-toggle ${
                            settings.autoSwitchMode === "timer" ? "active" : ""
                        }" id="toggle-timer-mode">
                            <i class="fa-solid fa-clock"></i>
                            <span>定时播放</span>
                        </div>
                        <div class="function-toggle ${
                            settings.autoSwitchMode === "detect" ? "active" : ""
                        }" id="toggle-detect-mode">
                            <i class="fa-solid fa-robot"></i>
                            <span>检测播放</span>
                        </div>
                    </div>
                    
                    <!-- 检测播放子选项 -->
                    <div class="settings-group" ${
                        settings.autoSwitchMode !== "detect"
                            ? 'style="display:none;"'
                            : ""
                    } id="detect-sub-options">
                        <div class="settings-row">
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-ai-detect" ${
                                    settings.aiDetectEnabled ? "checked" : ""
                                } />
                                <i class="fa-solid fa-comment-dots"></i>AI回复时切换
                            </label>
                            
                            <label class="checkbox_label">
                                <input type="checkbox" id="player-player-detect" ${
                                    settings.playerDetectEnabled
                                        ? "checked"
                                        : ""
                                } />
                                <i class="fa-solid fa-keyboard"></i>玩家发送时切换
                            </label>
                        </div>
                    </div>
                    
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-clone"></i>播放模式
                        </label>
                        <select id="player-play-mode">
                            <option value="random" ${
                                settings.playMode === "random" ? "selected" : ""
                            }>随机播放</option>
                            <option value="sequential" ${
                                settings.playMode === "sequential"
                                    ? "selected"
                                    : ""
                            }>顺序播放</option>
                        </select>
                    </div>
                    
                    <div class="settings-row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-slideshow-mode" ${
                                settings.slideshowMode ? "checked" : ""
                            } ${
        settings.playMode === "random" ? "disabled" : ""
    }/>
                            <i class="fa-solid fa-repeat"></i>循环播放
                        </label>
                        
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-show-info" ${
                                settings.showInfo ? "checked" : ""
                            } />
                            <i class="fa-solid fa-circle-info"></i>显示图片信息
                        </label>
                        
                        <label class="checkbox_label">
                            <input type="checkbox" id="player-preload" ${
                                settings.preloadImages ? "checked" : ""
                            } />
                            <i class="fa-solid fa-bolt"></i>预加载图片
                        </label>
                    </div>
                    
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-clock"></i>切换间隔
                        </label>
                        <input type="number" id="player-interval" value="${
                            settings.switchInterval
                        }" min="1000" max="60000" />
                        <span>毫秒</span>
                    </div>
                    
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-sync"></i>轮询间隔
                        </label>
                        <input type="number" id="player-polling-interval" value="${
                            settings.pollingInterval
                        }" min="5000" max="300000" />
                        <span>毫秒</span>
                    </div>
                    
                    <div class="settings-row">
                        <label>
                            <i class="fa-solid fa-paint-brush"></i>过渡效果
                        </label>
                        <select id="player-transition-effect">
                            <option value="none" ${
                                settings.transitionEffect === "none"
                                    ? "selected"
                                    : ""
                            }>无效果</option>
                            <option value="fade" ${
                                settings.transitionEffect === "fade"
                                    ? "selected"
                                    : ""
                            }>淡入淡出</option>
                            <option value="slide" ${
                                settings.transitionEffect === "slide"
                                    ? "selected"
                                    : ""
                            }>滑动</option>
                            <option value="zoom" ${
                                settings.transitionEffect === "zoom"
                                    ? "selected"
                                    : ""
                            }>缩放</option>
                        </select>
                    </div>
                    
                    <div class="settings-group">
                        <h4 style="margin-top:0;color:#e0e0e0;border-bottom:1px solid #444;padding-bottom:5px;">
                            <i class="fa-solid fa-robot"></i> 检测设置
                        </h4>
                        
                        <div class="settings-row">
                            <label>
                                <i class="fa-solid fa-hourglass-half"></i>冷却时间
                            </label>
                            <input type="number" id="player-ai-cooldown" value="${
                                settings.aiResponseCooldown
                            }" min="1000" max="30000" />
                            <span>毫秒</span>
                        </div>
                    </div>
                    
                    <div class="settings-action-row">
                        <button id="show-player" class="menu-button">
                            <i class="fa-solid fa-eye"></i>显示播放器
                        </button>
                        <button id="player-refresh" class="menu-button">
                            <i class="fa-solid fa-rotate"></i>刷新服务
                        </button>
                        <button id="clear-random-history" class="menu-button">
                            <i class="fa-solid fa-trash"></i>清理随机记录
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    // 添加到设置区域
    $("#extensions_settings").append(html);

    // 添加事件监听
    setupSettingsEvents();

    console.log(`[${EXTENSION_ID}] 设置面板已创建`);
};

// 更新扩展菜单按钮状态
const updateExtensionMenu = () => {
    const settings = getExtensionSettings();

    // 播放/暂停按钮
    $(`#${PLAYER_WINDOW_ID} .play-pause i`)
        .toggleClass("fa-play", !settings.isPlaying)
        .toggleClass("fa-pause", settings.isPlaying);

    // 模式切换按钮
    $(`#${PLAYER_WINDOW_ID} .mode-switch i`)
        .toggleClass("fa-shuffle", settings.playMode === "random")
        .toggleClass("fa-list-ol", settings.playMode === "sequential");

    // 切换模式按钮
    $(`#${PLAYER_WINDOW_ID} .switch-mode-toggle`)
        .toggleClass("active", settings.autoSwitchMode === "detect")
        .find("i")
        .toggleClass("fa-robot", settings.autoSwitchMode === "detect")
        .toggleClass("fa-clock", settings.autoSwitchMode !== "detect");

    // 图片信息按钮
    $(`#${PLAYER_WINDOW_ID} .toggle-info`).toggleClass(
        "active",
        settings.showInfo
    );

    // 扩展菜单按钮
    if ($(`#${SETTINGS_PANEL_ID}`).length) {
        $("#toggle-timer-mode").toggleClass(
            "active",
            settings.autoSwitchMode === "timer"
        );
        $("#toggle-detect-mode").toggleClass(
            "active",
            settings.autoSwitchMode === "detect"
        );
        $("#player-play-mode").val(settings.playMode);
        $("#player-slideshow-mode").prop("checked", settings.slideshowMode);
        $("#player-show-info").prop("checked", settings.showInfo);
        $("#player-preload").prop("checked", settings.preloadImages);
        $("#player-transition-effect").val(settings.transitionEffect);
        $("#player-polling-interval").val(settings.pollingInterval);
        $("#player-ai-detect").prop("checked", settings.aiDetectEnabled);
        $("#player-player-detect").prop(
            "checked",
            settings.playerDetectEnabled
        );

        // 显示/隐藏检测子选项
        $("#detect-sub-options").toggle(settings.autoSwitchMode === "detect");
    }
};

const setupSettingsEvents = () => {
    // 更新服务状态
    $("#player-refresh").on("click", async () => {
        try {
            serviceStatus = await checkServiceStatus();
            toastr.info("服务状态已刷新");
            updateStatusDisplay();
        } catch (error) {
            console.error(error);
            toastr.error("刷新服务失败");
        }
    });

    // 清理随机播放记录
    $("#clear-random-history").on("click", function () {
        const settings = getExtensionSettings();
        settings.randomPlayedIndices = [];
        saveSafeSettings();
        toastr.success("随机播放记录已清理");
        showImage("current"); // 刷新显示
    });

    // 更新目录
    $("#update-directory").on("click", async function () {
        const newPath = $("#player-scan-directory").val().trim();
        if (!newPath) {
            toastr.warning("请输入有效的目录路径");
            return;
        }

        const success = await updateScanDirectory(newPath);
        if (success) {
            // 刷新图片列表
            const settings = getExtensionSettings();
            if (settings.playMode === "random") {
                settings.randomImageList = await fetchImageList();
                settings.randomPlayedIndices = [];
            } else {
                imageList = await fetchImageList();
            }

            showImage("current");
        }
    });

    // 定时播放按钮
    $("#toggle-timer-mode").on("click", function () {
        const settings = getExtensionSettings();
        const wasActive = settings.autoSwitchMode === "timer";

        // 切换状态
        if (wasActive) {
            // 取消激活
            settings.autoSwitchMode = null;
            settings.isPlaying = false;
        } else {
            // 激活定时模式
            settings.autoSwitchMode = "timer";
            settings.isPlaying = true;
        }
        saveSafeSettings();

        // 更新UI
        $(this).toggleClass("active", !wasActive);
        $("#toggle-detect-mode").toggleClass("active", false);

        // 更新播放器按钮
        $(`#${PLAYER_WINDOW_ID} .switch-mode-toggle`)
            .toggleClass("active", false)
            .find("i")
            .removeClass("fa-robot")
            .addClass("fa-clock");

        $(`#${PLAYER_WINDOW_ID} .play-pause i`)
            .toggleClass("fa-play", !settings.isPlaying)
            .toggleClass("fa-pause", settings.isPlaying);

        // 启动或停止播放
        if (settings.autoSwitchMode === "timer") {
            startPlayback();
        } else {
            clearTimeout(switchTimer);
        }
    });

    // 检测播放按钮
    $("#toggle-detect-mode").on("click", function () {
        const settings = getExtensionSettings();
        const wasActive = settings.autoSwitchMode === "detect";

        // 切换状态
        if (wasActive) {
            // 取消激活
            settings.autoSwitchMode = null;
            settings.isPlaying = false;
        } else {
            // 激活检测模式
            settings.autoSwitchMode = "detect";
            settings.isPlaying = true;
        }
        saveSafeSettings();

        // 更新UI
        $(this).toggleClass("active", !wasActive);
        $("#toggle-timer-mode").toggleClass("active", false);
        $("#detect-sub-options").toggle(!wasActive); // 显示/隐藏子选项

        // 更新播放器按钮
        $(`#${PLAYER_WINDOW_ID} .switch-mode-toggle`)
            .toggleClass("active", true)
            .find("i")
            .removeClass("fa-clock")
            .addClass("fa-robot");

        $(`#${PLAYER_WINDOW_ID} .play-pause i`)
            .toggleClass("fa-play", !settings.isPlaying)
            .toggleClass("fa-pause", settings.isPlaying);

        // 启动或停止播放
        if (settings.autoSwitchMode === "detect") {
            // 检测模式不需要定时器
        } else {
            clearTimeout(switchTimer);
        }
    });

    // 设置项变更
    const saveCurrentSettings = () => {
        const settings = getExtensionSettings();

        // 更新设置值
        settings.serviceUrl = $("#player-service-url").val().trim();
        settings.playMode = $("#player-play-mode").val();
        settings.slideshowMode = $("#player-slideshow-mode").prop("checked");
        settings.showInfo = $("#player-show-info").prop("checked");
        settings.preloadImages = $("#player-preload").prop("checked");
        settings.transitionEffect = $("#player-transition-effect").val();
        settings.pollingInterval =
            parseInt($("#player-polling-interval").val()) || 30000;
        settings.switchInterval = parseInt($("#player-interval").val()) || 5000;
        settings.aiResponseCooldown =
            parseInt($("#player-ai-cooldown").val()) || 3000;
        settings.aiDetectEnabled = $("#player-ai-detect").prop("checked");
        settings.playerDetectEnabled = $("#player-player-detect").prop(
            "checked"
        );

        // 保存并应用
        saveSafeSettings();

        // 启用/禁用依赖项
        $("#player-slideshow-mode").prop(
            "disabled",
            settings.playMode === "random"
        );

        // 更新轮询
        startPollingService();

        // 更新播放器UI
        $(`#${PLAYER_WINDOW_ID} .mode-switch i`)
            .toggleClass("fa-shuffle", settings.playMode === "random")
            .toggleClass("fa-list-ol", settings.playMode === "sequential");

        $(`#${PLAYER_WINDOW_ID} .toggle-info`).toggleClass(
            "active",
            settings.showInfo
        );
        $(`#${PLAYER_WINDOW_ID} .image-info`).toggle(settings.showInfo);

        // 重启播放
        if (settings.isPlaying && settings.autoSwitchMode === "timer") {
            startPlayback();
        }
    };

    // 更新状态显示
    const updateStatusDisplay = () => {
        const serviceActive = serviceStatus.active ? "已连接" : "服务离线";
        const imageCount =
            serviceStatus.imageCount > 0
                ? `${serviceStatus.imageCount}张图片`
                : "无图片";

        $(`#${SETTINGS_PANEL_ID} .service-status span`)
            .removeClass("status-success status-error")
            .addClass(serviceStatus.active ? "status-success" : "status-error")
            .text(`${serviceActive} (${imageCount})`);
    };

    // 绑定事件
    $(
        "#player-service-url, #player-interval, #player-ai-cooldown, #player-polling-interval"
    ).on("change", saveCurrentSettings);

    $("#player-play-mode").on("change", function () {
        $("#player-slideshow-mode").prop(
            "disabled",
            $(this).val() === "random"
        );
        saveCurrentSettings();
    });

    $(
        "#player-slideshow-mode, #player-show-info, #player-preload, #player-ai-detect, #player-player-detect"
    ).on("change", saveCurrentSettings);

    $("#player-transition-effect").on("change", saveCurrentSettings);

    // 显示播放器
    $("#show-player").on("click", function () {
        const settings = getExtensionSettings();
        settings.isWindowVisible = true;
        saveSafeSettings();
        $(`#${PLAYER_WINDOW_ID}`).show();
    });

    // 初始化设置值
    saveCurrentSettings();
};

// ==================== 扩展初始化 ====================
jQuery(async () => {
    console.log(`[${EXTENSION_ID}] 脚本开始加载`);

    // 延迟初始化确保环境稳定
    if (document.readyState === "complete") {
        initExtension();
    } else {
        $(document).on("ready", initExtension);
        window.setTimeout(initExtension, 1000);
    }
});

// ==================== 带重试的事件监听注册 ====================
function registerEventListenersWithRetry() {
    const maxRetries = 5;
    const delay = 1000;
    let retries = 0;

    const tryRegister = () => {
        try {
            // 关键依赖检查
            if (!eventSource || !event_types) {
                throw new Error("事件源未就绪");
            }

            // 注册AI回复事件
            eventSource.on(event_types.MESSAGE_RECEIVED, () => {
                const settings = getExtensionSettings();
                if (
                    settings.autoSwitchMode === "detect" &&
                    settings.aiDetectEnabled
                ) {
                    console.log(`[${EXTENSION_ID}] 检测到AI回复完成`);
                    onAIResponse();
                }
            });

            // 注册玩家消息事件
            eventSource.on(event_types.MESSAGE_SENT, () => {
                const settings = getExtensionSettings();
                if (
                    settings.autoSwitchMode === "detect" &&
                    settings.playerDetectEnabled
                ) {
                    console.log(`[${EXTENSION_ID}] 检测到玩家发送消息`);
                    onPlayerMessage();
                }
            });

            console.log(`[${EXTENSION_ID}] 成功注册事件监听器`);
        } catch (e) {
            retries++;
            if (retries < maxRetries) {
                console.warn(
                    `[${EXTENSION_ID}] 注册失败，${delay}ms后重试(${retries}/${maxRetries})`
                );
                setTimeout(tryRegister, delay);
            } else {
                console.error(`[${EXTENSION_ID}] 事件监听注册失败`, e);
                toastr.error("事件监听注册失败，请刷新页面");
            }
        }
    };

    // 延迟初始尝试
    console.log(`[${EXTENSION_ID}] 计划2000ms后注册事件监听`);
    setTimeout(tryRegister, 2000);
}

async function initExtension() {
    try {
        console.log(`[${EXTENSION_ID}] 初始化开始`);

        // 确保核心对象存在
        if (typeof window.extension_settings === "undefined") {
            window.extension_settings = {};
        }

        // 初始化设置（安全方式）
        if (!window.extension_settings[EXTENSION_ID]) {
            window.extension_settings[EXTENSION_ID] = {
                enabled: true,
                serviceUrl: "http://localhost:9000",
                playMode: "random",
                autoSwitch: false,
                slideshowMode: true,
                switchInterval: 5000,
                position: { x: 100, y: 100, width: 500, height: 500 },
                isLocked: false,
                isWindowVisible: true,
                showInfo: false,
                autoSwitchMode: "timer",
                aiResponseCooldown: 3000,
                lastAISwitchTime: 0,
                randomPlayedIndices: [],
                randomImageList: [],
                isPlaying: false,
                // 新增设置项
                transitionEffect: "fade",
                preloadImages: true,
                playerDetectEnabled: true,
                aiDetectEnabled: true,
                pollingInterval: 30000,
            };
            saveSafeSettings();
            console.log(`[${EXTENSION_ID}] 创建新设置对象`);
        }

        // 添加菜单按钮
        addMenuButton();

        // 创建播放器窗口
        createImagePlayerWindow();

        // 创建设置面板
        createSettingsPanel();

        // 初始化事件监听
        registerEventListenersWithRetry();

        // 启动轮询
        startPollingService();

        console.log(`[${EXTENSION_ID}] 初始化完成`);
        toastr.success(`图片播放器扩展加载成功`);
    } catch (e) {
        console.error(`[${EXTENSION_ID}] 初始化错误:`, e);

        // 失败后重试
        window.setTimeout(() => {
            console.warn(`[${EXTENSION_ID}] 重新尝试初始化...`);
            initExtension();
        }, 1500);
    }
}

function addMenuButton() {
    // 防止多次添加
    const menuButtonId = `#ext_menu_${EXTENSION_ID}`;
    if ($(menuButtonId).length > 0) return;

    console.log(`[${EXTENSION_ID}] 添加菜单按钮`);

    // 添加菜单按钮
    const buttonHtml = `
        <div id="ext_menu_${EXTENSION_ID}" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-images"></div>
            <span>图片播放器</span>
        </div>`;

    $("#extensionsMenu").append(buttonHtml);

    // 点击事件处理
    $(`#ext_menu_${EXTENSION_ID}`).on("click", function () {
        $("#extensions-settings-button").trigger("click");
    });
}

console.log(`[${EXTENSION_ID}] 脚本已加载`);
