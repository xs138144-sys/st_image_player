# 图片播放器扩展

## 功能
- 本地图片播放器窗口
- 支持随机/顺序播放模式
- AI回复检测自动切换图片
- 窗口锁定/解锁功能
- 多种过渡效果

## 安装
   本地安装
1. 本地安装就将扩展文件夹放入 SillyTavern 的 `public\scripts\extensions\third-party` 目录
2. 安装Python依赖：`pip install flask flask-cors watchdog gevent gevent-websocket`
3. 启动图片服务：`python image_service.py`

   或者通过github仓库安装，这个就不用解释了。

## 配置
1. 在扩展设置中配置图片目录
2. 选择播放模式（随机/顺序）
3. 设置切换条件（定时/AI检测）

因为是玩AI顺便搞出来的东西，应该不会更新了。

## 作者
DeepSeek和反死

