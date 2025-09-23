import { deps } from "../core/deps.js";

/**
 * DOM操作工具模块
 */
export const init = () => {
  console.log(`[domUtils] DOM工具模块初始化完成`);
};

export const cleanup = () => {
  console.log(`[domUtils] DOM工具模块无资源需清理`);
};

/**
 * 安全等待jQuery就绪
 */
export const safeJQuery = (callback) => {
  if (typeof window.jQuery !== "undefined") {
    callback();
    return;
  }

  let retry = 0;
  const interval = setInterval(() => {
    if (typeof window.jQuery !== "undefined" || retry > 20) {
      clearInterval(interval);
      if (typeof window.jQuery !== "undefined") callback();
      else console.error("jQuery 20秒内未就绪，扩展无法运行");
    }
    retry++;
  }, 500);
};

/**
 * 安全获取全局变量
 */
export const getSafeGlobal = (name, defaultValue) => {
  return window[name] === undefined ? defaultValue : window[name];
};

/**
 * 检查元素是否存在
 */
export const elementExists = (selector) => {
  const $ = deps.jQuery;
  return $ && $(selector).length > 0;
};

/**
 * 安全创建元素
 */
export const createElement = (tagName, attributes = {}, innerHTML = '') => {
  const element = document.createElement(tagName);
  
  // 设置属性
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else {
      element.setAttribute(key, value);
    }
  });
  
  // 设置内容
  if (innerHTML) {
    element.innerHTML = innerHTML;
  }
  
  return element;
};

/**
 * 安全添加CSS样式
 */
export const addStyles = (css, id = '') => {
  const styleId = id || `style-${Date.now()}`;
  
  // 移除已存在的样式
  removeStyles(styleId);
  
  const styleElement = document.createElement('style');
  styleElement.id = styleId;
  styleElement.textContent = css;
  document.head.appendChild(styleElement);
  
  return styleId;
};

/**
 * 移除CSS样式
 */
export const removeStyles = (id) => {
  const existingStyle = document.getElementById(id);
  if (existingStyle) {
    existingStyle.remove();
  }
};

/**
 * 切换元素显示状态
 */
export const toggleElement = (selector, show) => {
  const $ = deps.jQuery;
  if (!$) return;
  
  const $element = $(selector);
  if ($element.length) {
    show ? $element.show() : $element.hide();
  }
};

/**
 * 添加或移除CSS类
 */
export const toggleClass = (selector, className, add) => {
  const $ = deps.jQuery;
  if (!$) return;
  
  const $element = $(selector);
  if ($element.length) {
    add ? $element.addClass(className) : $element.removeClass(className);
  }
};

export default {
  init,
  cleanup,
  safeJQuery,
  getSafeGlobal,
  elementExists,
  createElement,
  addStyles,
  removeStyles,
  toggleElement,
  toggleClass
};