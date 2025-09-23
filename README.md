# 🎯 ST Image Player - 现代化媒体播放器扩展

基于 SillyTavern 的现代化媒体播放器扩展，支持全媒体格式播放，提供稳定、高效的播放体验和丰富的自定义功能。

## ✨ 核心特性

### 🎨 全媒体格式支持

- **图片格式**: PNG、JPG、JPEG、GIF、BMP、WebP、APNG
- **视频格式**: WebM、MP4、OGV、MOV、AVI、MKV
- **智能识别**: 自动识别媒体类型并应用相应播放策略

### 🔄 多种播放模式

- **随机播放**: 智能规避重复媒体，列表循环时重置提示
- **顺序播放**: 支持循环切换，保持播放连续性
- **自动切换**: AI 回复检测、玩家消息检测（可配置冷却时间）

### 🎮 丰富的交互控制

- **窗口操作**: 拖拽标题栏移动、四个角手柄调整大小、锁定功能
- **过渡效果**: 淡入淡出、滑动、缩放、无效果（4 种可选）
- **视频控制**: 进度条拖拽、音量调节、循环播放开关

### ⚡ 性能优化

- **预加载策略**: 图片默认预加载，视频可选预加载
- **智能缓存**: 媒体列表缓存和节流控制
- **连接管理**: WebSocket 实时更新，断连自动重连

## 📦 安装部署

### 环境要求

- SillyTavern 1.10.0+ 版本
- 现代浏览器（Chrome 80+、Firefox 75+、Edge 80+）
- 媒体服务正常运行

### 📋 安装位置说明

- **本地安装**: 手动安装到 `SillyTavern/public/scripts/extensions/third-party/`
- **GitHub 安装**: 自动安装到 `SillyTavern/data/default-user/extensions/`
- 两种方式功能相同，选择适合您的方式即可

## 🏗️ 项目架构

### 模块化设计

项目采用高度模块化的架构，每个功能模块职责单一：

```text
st_image_player/
├── 📂 core/                 # 核心基础设施
│   ├── deps.js            # 依赖注入管理
│   ├── eventBus.js        # 事件总线系统
│   └── moduleLoader.js    # 模块动态加载器
├── 📂 modules/            # 功能模块
│   ├── api/              # API接口模块
│   │   ├── configApi.js  # 配置API
│   │   ├── mediaApi.js   # 媒体API
│   │   └── serviceApi.js # 服务API
│   ├── settings/         # 设置管理
│   │   ├── settingsManager.js    # 设置管理器
│   │   └── settingsMigrator.js  # 设置迁移器
│   ├── migration/        # 迁移适配
│   │   └── legacyModuleAdapter.js # 旧模块适配器
│   ├── timeUtils.js      # 时间工具
│   ├── domUtils.js       # DOM操作工具
│   ├── websocket.js      # WebSocket通信
│   └── aiEvents.js      # AI事件处理
├── 📂 media/             # 媒体播放核心
│   ├── mediaPlayer.js    # 媒体播放器主模块
│   ├── 📂 core/          # 媒体核心功能
│   │   ├── mediaCore.js           # 媒体状态管理
│   │   ├── mediaElementManager.js # 媒体元素管理
│   │   ├── mediaEventManager.js   # 媒体事件管理
│   │   ├── mediaPlaybackManager.js # 播放控制
│   │   ├── mediaStateManager.js   # 状态管理
│   │   ├── mediaStatusChecker.js  # 状态检查
│   │   └── mediaTimerManager.js   # 定时器管理
│   └── 📂 controls/      # 媒体控制
│       └── mediaControls.js       # 控制事件处理
├── 📂 ui/                # 用户界面
│   ├── ui.js            # UI主模块
│   ├── 📂 components/    # UI组件
│   │   ├── playerWindow.js    # 播放器窗口
│   │   └── settingsPanel.js   # 设置面板
│   ├── 📂 styles/       # 样式定义
│   │   └── playerStyles.js    # 播放器样式
│   └── 📂 events/       # 事件处理
│       └── uiEvents.js       # UI事件
├── index.js             # 应用入口点
├── manifest.json        # 扩展清单
└── style.css           # 全局样式
```

### 模块加载顺序

模块按依赖关系顺序加载，确保功能可用性：

1. **基础工具模块**: `timeUtils`, `domUtils`
2. **设置管理模块**: `settingsManager`, `settingsMigrator`
3. **API 接口模块**: `serviceApi`, `mediaApi`, `configApi`
4. **迁移适配模块**: `legacyModuleAdapter`
5. **通信模块**: `websocket`
6. **媒体核心模块**: 媒体播放相关模块
7. **AI 事件模块**: `aiEvents`
8. **UI 界面模块**: UI 相关模块

## 🚀 快速开始

### 基本配置

1. 确保媒体服务正常运行
2. 在设置面板配置服务地址
3. 设置媒体目录路径
4. 调整播放参数（切换模式、冷却时间等）

### 代码示例

```javascript
// 通过依赖注入使用模块功能
const mediaApi = deps.mediaApi;
const settings = deps.settings;

// 刷新媒体列表
async function refreshMedia() {
  const mediaList = await mediaApi.refreshMediaList();
  console.log(`刷新完成，共 ${mediaList.length} 个媒体文件`);
}

// 获取设置
function getPlayerSettings() {
  return settings.get(["volume", "autoSwitch", "filterType"]);
}
```

## 🐛 故障排除

### 常见问题

#### 媒体加载失败

1. 检查文件路径是否包含特殊字符
2. 确认文件格式浏览器支持
3. 验证文件大小是否超过限制

#### 自动切换无效

1. 确认自动切换模式设置正确
2. 检查冷却时间配置
3. 验证事件监听是否正常

#### WebSocket 连接问题

1. 检查服务是否正常运行
2. 扩展会自动尝试重连（10 秒间隔）

### 调试模式

启用浏览器开发者工具，查看控制台日志：

```javascript
// 手动触发调试信息
localStorage.setItem("debugMediaPlayer", "true");
```

## 🔧 开发指南

### 添加新功能

1. 确定功能所属模块组
2. 创建新的模块文件
3. 实现 `init()` 和 `cleanup()` 函数
4. 在 `index.js` 中添加模块路径
5. 在 `deps.js` 中注册模块访问器

### 代码规范

- 使用 JSDoc 注释
- 保持函数职责单一
- 添加适当的错误处理
- 遵循现有的命名约定

## 📊 性能优化

### 内存管理

- 及时清理不再使用的媒体元素
- 使用对象池管理频繁创建的对象
- 避免内存泄漏

### 网络优化

- 实现媒体文件缓存机制
- 使用适当的预加载策略
- 优化 WebSocket 消息频率

### 渲染性能

- 减少不必要的 DOM 操作
- 使用 CSS 动画代替 JavaScript 动画
- 优化图片和视频解码

## 📞 支持与反馈

- **项目地址**: [https://github.com/xs138144-sys/st_image_player](https://github.com/xs138144-sys/st_image_player)
- **问题反馈**: 通过 GitHub Issues
- **讨论交流**: GitHub Discussions

## 👥 贡献者

- **DeepSeek** - 核心开发
- **豆包** - 功能设计
- **反死** - 测试验证
