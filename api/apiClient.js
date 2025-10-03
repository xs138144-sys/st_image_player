// API通信客户端模块
import { ConfigManager } from '../config/config.js';

class APIClient {
    constructor(serviceUrl) {
        this.configManager = new ConfigManager();
        this.settings = this.configManager.getConfig();
        this.serviceUrl = serviceUrl || this.settings.serviceUrl;
    }

    async request(endpoint, options = {}) {
        const url = `${this.serviceUrl}${endpoint}`;
        
        try {
            const response = await fetch(url, {
                headers: { 'Content-Type': 'application/json' },
                ...options
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`[API Client] 请求失败: ${endpoint}`, error);
            throw error;
        }
    }

    // 检查服务状态
    async checkServiceStatus() {
        try {
            const data = await this.request('/status');
            return {
                active: data.active,
                observerActive: data.observer_active || false,
                totalCount: data.total_count || 0,
                imageCount: data.image_count || 0,
                videoCount: data.video_count || 0,
                directory: data.directory || "",
                mediaConfig: data.media_config || {}
            };
        } catch (error) {
            console.error('[API Client] 服务状态检查失败', error);
            return { active: false, error: error.message };
        }
    }

    // 获取媒体列表
    async fetchMediaList(filterType = 'all') {
        try {
            const data = await this.request(`/media?type=${filterType}`);
            return data.media || [];
        } catch (error) {
            console.error('[API Client] 获取媒体列表失败', error);
            throw error;
        }
    }

    // 更新扫描目录
    async updateScanDirectory(newPath, imageMaxMb = null, videoMaxMb = null) {
        try {
            const body = { path: newPath };
            
            if (imageMaxMb !== null) body.image_max_mb = imageMaxMb;
            if (videoMaxMb !== null) body.video_max_mb = videoMaxMb;
            
            const data = await this.request('/scan', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            
            return data;
        } catch (error) {
            console.error('[API Client] 更新目录失败', error);
            throw error;
        }
    }

    // 清理无效媒体
    async cleanupInvalidMedia() {
        try {
            const data = await this.request('/cleanup', { method: 'POST' });
            return data;
        } catch (error) {
            console.error('[API Client] 清理失败', error);
            throw error;
        }
    }

    // 获取随机媒体
    async getRandomMedia(filterType = 'all') {
        try {
            const data = await this.request(`/random-media?type=${filterType}`);
            return data;
        } catch (error) {
            console.error('[API Client] 获取随机媒体失败', error);
            throw error;
        }
    }

    // 获取媒体列表
    async getMediaList(directories = []) {
        try {
            const queryParams = new URLSearchParams();
            if (directories && directories.length > 0) {
                queryParams.append('directories', directories.join(','));
            }
            
            const data = await this.request(`/media?${queryParams}`);
            return data.media || [];
        } catch (error) {
            console.error('[API Client] 获取媒体列表失败', error);
            return [];
        }
    }
}

export { APIClient };