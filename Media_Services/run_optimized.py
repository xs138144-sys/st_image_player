#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
优化版本地媒体服务启动脚本
包含所有优化功能：内存优化、配置管理、增量扫描、缓存、WebSocket管理等
"""

import os
import sys
import signal
import time
from pathlib import Path

def main():
    """主启动函数"""
    print("=" * 80)
    print("优化版本地媒体服务启动器")
    print("=" * 80)
    
    # 检查依赖
    try:
        import flask
        import gevent
        import watchdog
        print("✓ 依赖检查通过")
    except ImportError as e:
        print(f"✗ 依赖缺失: {e}")
        print("请运行: pip install -r requirements.txt")
        return 1
    
    # 检查优化版本文件
    if not os.path.exists("image_service_optimized.py"):
        print("✗ 优化版本文件不存在")
        print("请确保 image_service_optimized.py 文件存在")
        return 1
    
    # 导入优化版本
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from image_service_optimized import MediaService, pywsgi, WebSocketHandler
        print("✓ 优化版本加载成功")
    except Exception as e:
        print(f"✗ 优化版本加载失败: {e}")
        return 1
    
    # 信号处理函数
    def signal_handler(signum, frame):
        print("\n接收到终止信号，正在优雅关闭服务...")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # 创建并启动服务
        print("正在初始化优化版服务...")
        media_service = MediaService()
        media_service.init_service()
        
        # 启动服务器
        server = pywsgi.WSGIServer(('127.0.0.1', 9000), media_service.app, handler_class=WebSocketHandler)
        print("✓ 服务器启动成功")
        print("服务地址: http://127.0.0.1:9000")
        print("按 Ctrl+C 停止服务")
        print("-" * 80)
        
        server.serve_forever()
        
    except KeyboardInterrupt:
        print("\n服务已停止")
    except Exception as e:
        print(f"服务启动失败: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())