// 工具函数模块

// 防抖函数
export function debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func(...args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func(...args);
    };
}

// 节流函数
export function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// 深拷贝函数
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const clonedObj = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                clonedObj[key] = deepClone(obj[key]);
            }
        }
        return clonedObj;
    }
}

// 格式化文件大小
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化时间
export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 生成随机ID
export function generateId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 验证文件类型
export function isValidMediaFile(filename) {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    
    const extension = filename.split('.').pop().toLowerCase();
    return imageExtensions.includes(extension) || videoExtensions.includes(extension);
}

// 获取文件类型
export function getFileType(filename) {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    
    const extension = filename.split('.').pop().toLowerCase();
    if (imageExtensions.includes(extension)) return 'image';
    if (videoExtensions.includes(extension)) return 'video';
    return 'unknown';
}

// 数组洗牌（随机排序）
export function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// 数组去重
export function uniqueArray(array, key = null) {
    if (key) {
        const seen = new Set();
        return array.filter(item => {
            const value = item[key];
            if (seen.has(value)) return false;
            seen.add(value);
            return true;
        });
    }
    return [...new Set(array)];
}

// 过滤数组
export function filterArray(array, filters) {
    return array.filter(item => {
        for (const key in filters) {
            if (filters[key] && item[key] !== filters[key]) return false;
        }
        return true;
    });
}

// 排序数组
export function sortArray(array, key, order = 'asc') {
    return [...array].sort((a, b) => {
        let aVal = a[key];
        let bVal = b[key];
        
        // 处理字符串比较
        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }
        
        if (aVal < bVal) return order === 'asc' ? -1 : 1;
        if (aVal > bVal) return order === 'asc' ? 1 : -1;
        return 0;
    });
}

// 本地存储操作
export const storage = {
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Storage set error:', error);
            return false;
        }
    },
    
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error('Storage get error:', error);
            return defaultValue;
        }
    },
    
    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('Storage remove error:', error);
            return false;
        }
    },
    
    clear() {
        try {
            localStorage.clear();
            return true;
        } catch (error) {
            console.error('Storage clear error:', error);
            return false;
        }
    }
};

// 事件总线
export class EventBus {
    constructor() {
        this.events = {};
    }
    
    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }
    
    off(event, callback) {
        if (!this.events[event]) return;
        
        if (callback) {
            this.events[event] = this.events[event].filter(cb => cb !== callback);
        } else {
            delete this.events[event];
        }
    }
    
    emit(event, data) {
        if (!this.events[event]) return;
        
        this.events[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`EventBus error in event "${event}":`, error);
            }
        });
    }
    
    once(event, callback) {
        const onceCallback = (data) => {
            callback(data);
            this.off(event, onceCallback);
        };
        this.on(event, onceCallback);
    }
}

// 错误处理
export class ErrorHandler {
    static handle(error, context = '') {
        const errorInfo = {
            message: error.message || 'Unknown error',
            stack: error.stack,
            context: context,
            timestamp: new Date().toISOString()
        };
        
        console.error(`[ErrorHandler] ${context}:`, errorInfo);
        
        // 可以根据错误类型进行不同的处理
        if (error.name === 'NetworkError') {
            this.handleNetworkError(errorInfo);
        } else if (error.name === 'TypeError') {
            this.handleTypeError(errorInfo);
        } else {
            this.handleGenericError(errorInfo);
        }
        
        return errorInfo;
    }
    
    static handleNetworkError(errorInfo) {
        // 网络错误处理逻辑
        console.warn('Network error detected, attempting recovery...');
    }
    
    static handleTypeError(errorInfo) {
        // 类型错误处理逻辑
        console.warn('Type error detected, check data consistency...');
    }
    
    static handleGenericError(errorInfo) {
        // 通用错误处理逻辑
        console.warn('Generic error detected, continuing with fallback...');
    }
}

// 性能监控
export class PerformanceMonitor {
    static marks = new Map();
    
    static startMark(name) {
        if (typeof performance !== 'undefined') {
            performance.mark(`${name}-start`);
            this.marks.set(name, performance.now());
        }
    }
    
    static endMark(name) {
        if (typeof performance !== 'undefined' && this.marks.has(name)) {
            performance.mark(`${name}-end`);
            const duration = performance.now() - this.marks.get(name);
            
            performance.measure(name, `${name}-start`, `${name}-end`);
            
            console.log(`[PerformanceMonitor] ${name}: ${duration.toFixed(2)}ms`);
            this.marks.delete(name);
            
            return duration;
        }
        return 0;
    }
    
    static measure(name, callback) {
        this.startMark(name);
        const result = callback();
        this.endMark(name);
        return result;
    }
}

// 验证工具
export class Validator {
    static isEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
    
    static isUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
    
    static isNumber(value) {
        return !isNaN(parseFloat(value)) && isFinite(value);
    }
    
    static isEmpty(value) {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'object') return Object.keys(value).length === 0;
        return false;
    }
    
    static isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
}

// 字符串工具
export class StringUtils {
    static truncate(str, length, suffix = '...') {
        if (str.length <= length) return str;
        return str.substring(0, length - suffix.length) + suffix;
    }
    
    static capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }
    
    static camelToKebab(str) {
        return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    }
    
    static kebabToCamel(str) {
        return str.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
    }
    
    static escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
    
    static unescapeHtml(str) {
        const div = document.createElement('div');
        div.innerHTML = str;
        return div.textContent;
    }
}

// 日期工具
export class DateUtils {
    static format(date, format = 'YYYY-MM-DD') {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        
        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }
    
    static isToday(date) {
        const today = new Date();
        const target = new Date(date);
        return today.toDateString() === target.toDateString();
    }
    
    static isYesterday(date) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const target = new Date(date);
        return yesterday.toDateString() === target.toDateString();
    }
    
    static addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }
    
    static differenceInDays(date1, date2) {
        const timeDiff = Math.abs(new Date(date2) - new Date(date1));
        return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
    }
}

// 数学工具
export class MathUtils {
    static clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
    
    static lerp(start, end, factor) {
        return start + (end - start) * factor;
    }
    
    static random(min, max) {
        return Math.random() * (max - min) + min;
    }
    
    static randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    static roundTo(value, decimals = 2) {
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }
}

export default {
    debounce,
    throttle,
    deepClone,
    formatFileSize,
    formatTime,
    generateId,
    isValidMediaFile,
    getFileType,
    shuffleArray,
    uniqueArray,
    filterArray,
    sortArray,
    storage,
    EventBus,
    ErrorHandler,
    PerformanceMonitor,
    Validator,
    StringUtils,
    DateUtils,
    MathUtils
};