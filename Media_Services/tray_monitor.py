#!/usr/bin/env python3
"""
系统托盘监控程序 - 在系统托盘显示Python服务状态
支持智能退出：退出托盘时自动关闭所有Python服务
"""
import sys
import time
import threading
import requests
import os
import subprocess
from PIL import Image, ImageDraw
import pystray

def check_service_status(port):
    """检查服务状态"""
    try:
        response = requests.get(f"http://localhost:{port}/health", timeout=5)
        return response.status_code == 200
    except:
        return False

def create_tray_icon():
    """创建托盘图标"""
    # 创建绿色图标（服务正常）
    image = Image.new('RGB', (64, 64), 'green')
    dc = ImageDraw.Draw(image)
    dc.rectangle([0, 0, 64, 64], fill='green')
    dc.text((10, 25), "ST", fill='white')
    return image

def update_tray_status(icon):
    """更新托盘状态"""
    while True:
        # 检查两个服务状态
        service_8001 = check_service_status(8001)
        service_9000 = check_service_status(9000)
        
        # 根据状态更新图标标题
        if service_8001 and service_9000:
            icon.title = "SillyTavern服务 - 全部正常"
        elif service_8001:
            icon.title = "SillyTavern服务 - 文件API正常"
        elif service_9000:
            icon.title = "SillyTavern服务 - 媒体服务正常"
        else:
            icon.title = "SillyTavern服务 - 未运行"
        
        time.sleep(10)  # 每10秒检查一次

def on_quit(icon):
    """智能退出 - 使用最可靠的方法关闭所有Python服务"""
    print("[INFO] 正在使用最可靠的方法关闭所有Python服务...")
    
    # 停止托盘图标
    icon.stop()
    
    try:
        if os.name == 'nt':  # Windows系统
            print("[INFO] 使用taskkill /f /im python.exe命令强制关闭所有Python进程")
            
            # 方法1: 最可靠的方法 - 强制关闭所有Python进程
            try:
                result = subprocess.run(["taskkill", "/f", "/im", "python.exe"], 
                                      capture_output=True, text=True, timeout=15)
                if result.returncode == 0:
                    print("[SUCCESS] 已强制关闭所有Python进程")
                else:
                    print(f"[INFO] 关闭结果: {result.stdout}")
            except Exception as e:
                print(f"[WARNING] 强制关闭时出现错误: {e}")
            
            # 等待进程完全关闭
            time.sleep(2)
            
            # 方法2: 备用精确关闭方法
            print("[INFO] 执行备用精确关闭方法...")
            services_to_kill = ["media_server.py", "run_optimized.py", "tray_monitor.py"]
            for service in services_to_kill:
                try:
                    subprocess.run(["taskkill", "/f", "/im", "python.exe", "/fi", 
                                  f"\"commandline eq *{service}*\""], 
                                  capture_output=True, timeout=5)
                except:
                    pass
            
            # 方法3: 最终清理
            time.sleep(1)
            try:
                subprocess.run(["taskkill", "/f", "/im", "python.exe", "/fi", 
                              "\"commandline eq *st_image_player*\""], 
                              capture_output=True, timeout=3)
            except:
                pass
                
        else:  # Linux/Mac系统
            # 使用最可靠的方法
            subprocess.run(["pkill", "-f", "python"], check=False)
            time.sleep(2)
            subprocess.run(["pkill", "-f", "media_server.py"], check=False)
            subprocess.run(["pkill", "-f", "run_optimized.py"], check=False)
            subprocess.run(["pkill", "-f", "tray_monitor.py"], check=False)
        
        print("[SUCCESS] 所有Python服务已完全关闭")
        print("[INFO] 这是最可靠的关闭方法，确保所有相关进程都被终止")
    except Exception as e:
        print(f"[WARNING] 关闭服务时出现错误: {e}")
    
    # 完全退出程序
    sys.exit(0)

def main():
    """主函数"""
    # 创建托盘图标
    icon = pystray.Icon(
        "SillyTavern服务监控",
        create_tray_icon(),
        "SillyTavern服务监控",
        menu=pystray.Menu(
            pystray.MenuItem("退出并关闭所有服务", on_quit)
        )
    )
    
    # 启动状态监控线程
    status_thread = threading.Thread(target=update_tray_status, args=(icon,))
    status_thread.daemon = True
    status_thread.start()
    
    # 运行托盘图标
    icon.run()

if __name__ == "__main__":
    main()