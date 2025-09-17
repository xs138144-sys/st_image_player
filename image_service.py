import os
import sys
import json
import time
import logging
import threading
import urllib.parse
from flask import Flask, jsonify, request, send_file
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask_cors import CORS
import mimetypes
from gevent import pywsgi
from geventwebsocket.handler import WebSocketHandler

# 设置文件系统编码为UTF-8
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
sys.getfilesystemencoding = lambda: 'utf-8'

app = Flask(__name__)
CORS(app)

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("image_service.log", encoding='utf-8')
    ]
)

# 配置参数
CONFIG_FILE = "local_image_service_config.json"
IMAGE_DB = []
SCAN_DIRECTORY = ""
OBSERVER = None
active_websockets = []  # 存储活跃的WebSocket连接

class ImageDBHandler(FileSystemEventHandler):
    def update_db(self):
        global IMAGE_DB, SCAN_DIRECTORY
        IMAGE_DB = []
        
        if not SCAN_DIRECTORY or not os.path.exists(SCAN_DIRECTORY):
            logging.warning(f"目录不存在: {SCAN_DIRECTORY}")
            return
        
        logging.info(f"开始扫描目录: {SCAN_DIRECTORY}")
        image_formats = ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp')
        
        for root, _, files in os.walk(SCAN_DIRECTORY):
            for file in files:
                if file.lower().endswith(image_formats):
                    try:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, SCAN_DIRECTORY)
                        file_size = os.path.getsize(full_path)
                        
                        # 只添加小于5MB的图片
                        if file_size <= 5 * 1024 * 1024:  # 5MB限制
                            IMAGE_DB.append({
                                "path": full_path,
                                "rel_path": rel_path.replace("\\", "/"),
                                "name": file,
                                "size": file_size
                            })
                    except Exception as e:
                        logging.error(f"处理图片错误: {file} - {str(e)}")
        
        logging.info(f"扫描完成, 找到 {len(IMAGE_DB)} 张图片")
        save_config()
        
        # 发送实时更新通知
        self.send_update_event()

    def send_update_event(self):
        global active_websockets
        # 发送更新事件给所有客户端
        message = json.dumps({
            'type': 'images_updated',
            'count': len(IMAGE_DB)
        })
        # 复制一份当前的连接列表，避免在迭代时修改
        current_websockets = list(active_websockets)
        for ws in current_websockets:
            try:
                ws.send(message)
            except Exception as e:
                logging.error(f"发送WebSocket消息失败: {str(e)}")
                # 如果发送失败，从列表中移除
                if ws in active_websockets:
                    active_websockets.remove(ws)

    def on_created(self, event):
        if not event.is_directory and any(event.src_path.lower().endswith(ext) for ext in ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp')):
            time.sleep(1)  # 等待文件完全写入
            self.update_db()

    def on_deleted(self, event):
        global IMAGE_DB
        if not event.is_directory:
            deleted_path = os.path.normpath(event.src_path)
            IMAGE_DB = [img for img in IMAGE_DB if os.path.normpath(img["path"]) != deleted_path]
            logging.info(f"图片已删除: {os.path.basename(deleted_path)}")
            save_config()
            self.send_update_event()

def setup_watchdog():
    global OBSERVER
    if OBSERVER and OBSERVER.is_alive():
        OBSERVER.stop()
    
    if SCAN_DIRECTORY and os.path.exists(SCAN_DIRECTORY):
        event_handler = ImageDBHandler()
        OBSERVER = Observer()
        OBSERVER.schedule(event_handler, SCAN_DIRECTORY, recursive=True)
        OBSERVER.start()
        logging.info(f"监控已启用: {SCAN_DIRECTORY}")
    else:
        logging.warning("监控未启动: 目录无效")

def save_config():
    try:
        config = {
            "scan_directory": SCAN_DIRECTORY,
            "image_count": len(IMAGE_DB),
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return config
    except Exception as e:
        logging.error(f"保存配置失败: {str(e)}")
        return {}

def load_config():
    global SCAN_DIRECTORY
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
                SCAN_DIRECTORY = config.get("scan_directory", "F:\\Download")
                return True
    except Exception as e:
        logging.warning(f"加载配置失败: {str(e)}, 使用默认目录")
    SCAN_DIRECTORY = "F:\\Download"
    return False

@app.route("/scan", methods=["POST"])
def scan_endpoint():
    try:
        data = request.get_json()
        new_dir = data.get("path", "").strip()
        
        if not new_dir or not os.path.isdir(new_dir):
            return jsonify({"status": "error", "message": "目录不存在或无效"}), 400
            
        # 更新全局变量
        global SCAN_DIRECTORY
        SCAN_DIRECTORY = os.path.normpath(new_dir)
        
        # 重新扫描目录
        handler = ImageDBHandler()
        handler.update_db()
        
        # 重启监控
        setup_watchdog()
        
        return jsonify({
            "status": "success",
            "path": SCAN_DIRECTORY,
            "image_count": len(IMAGE_DB)
        })
    except Exception as e:
        logging.error(f"扫描目录失败: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

def scan_directory(path):
    global SCAN_DIRECTORY
    SCAN_DIRECTORY = os.path.normpath(path)
    
    handler = ImageDBHandler()
    handler.update_db()
    setup_watchdog()
    
    return jsonify({
        "status": "success",
        "path": SCAN_DIRECTORY,
        "image_count": len(IMAGE_DB)
    })

@app.route("/images", methods=["GET"])
def get_images():
    result = {
        "images": IMAGE_DB,
        "count": len(IMAGE_DB),
        "last_updated": save_config().get("last_updated", "")
    }
    return jsonify(result)

@app.route("/random-image", methods=["GET"])
def get_random_image():
    if not IMAGE_DB:
        return jsonify({"status": "error", "message": "无可用图片"}), 404
    
    import random
    img = random.choice(IMAGE_DB)
    return jsonify({
        "url": f"/file/{img['rel_path']}",
        "name": img["name"],
        "size": img["size"]
    })

@app.route("/file/<path:filename>", methods=["GET"])
def serve_file(filename):
    try:
        # 解码URL编码
        decoded_filename = urllib.parse.unquote(filename)
        
        # 构建完整路径
        file_path = os.path.join(SCAN_DIRECTORY, decoded_filename)
        abs_path = os.path.abspath(file_path)
        
        # 安全检查
        base_dir = os.path.abspath(SCAN_DIRECTORY)
        if not abs_path.startswith(base_dir) or ".." in abs_path:
            logging.warning(f"非法访问尝试: {abs_path}")
            return "禁止访问: 路径无效", 403
        
        # 检查文件是否存在
        if not os.path.isfile(abs_path):
            logging.warning(f"文件不存在: {abs_path}")
            return "文件不存在", 404
        
        # 获取MIME类型
        mime_type, _ = mimetypes.guess_type(abs_path)
        if not mime_type or not mime_type.startswith("image"):
            mime_type = "application/octet-stream"
        
        # 发送文件（对Windows特别处理文件名编码）
        if sys.platform.startswith("win"):
            # Windows需要正确处理Unicode路径
            file_path = os.path.normpath(decoded_filename)
        else:
            file_path = abs_path
        
        # 记录访问（可选）
        logging.debug(f"服务文件: {abs_path} (MIME: {mime_type})")
        
        return send_file(
            abs_path, 
            mimetype=mime_type,
            as_attachment=False,
            conditional=True
        )
        
    except Exception as e:
        logging.error(f"文件服务错误: {str(e)}", exc_info=True)
        return f"服务器错误: {str(e)}", 500

@app.route("/cleanup", methods=["POST"])
def cleanup():
    global IMAGE_DB
    initial_count = len(IMAGE_DB)
    
    # 移除无效文件
    IMAGE_DB = [img for img in IMAGE_DB if os.path.exists(img["path"])]
    removed = initial_count - len(IMAGE_DB)
    
    save_config()
    return jsonify({
        "status": "success",
        "removed": removed,
        "remaining": len(IMAGE_DB)
    })

@app.route("/status", methods=["GET"])
def service_status():
    try:
        config = save_config()
        return jsonify({
            "active": True,
            "directory": SCAN_DIRECTORY,
            "image_count": len(IMAGE_DB),
            "last_updated": config.get("last_updated", "未知")
        })
    except Exception as e:
        logging.error(f"状态检查错误: {str(e)}")
        return jsonify({
            "active": False,
            "error": str(e)
        }), 500

@app.route('/socket.io')
def handle_websocket():
    if request.environ.get('wsgi.websocket'):
        ws = request.environ['wsgi.websocket']
        active_websockets.append(ws)
        logging.info(f"新的WebSocket连接, 当前连接数: {len(active_websockets)}")
        
        try:
            while True:
                # 接收消息（保持连接活跃）
                message = ws.receive()
                if message is None:
                    break
                # 可以处理心跳等消息
                try:
                    msg = json.loads(message)
                    if msg.get('type') == 'ping':
                        ws.send(json.dumps({'type': 'pong'}))
                except:
                    pass
        except Exception as e:
            logging.error(f"WebSocket错误: {str(e)}")
        finally:
            # 连接关闭时移除
            if ws in active_websockets:
                active_websockets.remove(ws)
            logging.info(f"WebSocket连接关闭, 剩余连接数: {len(active_websockets)}")
    return ''


def init_service():
    logging.info("=" * 60)
    logging.info("本地图片服务启动中")
    logging.info("服务地址: http://127.0.0.1:9000")
    logging.info("=" * 60)
    
    load_config()
    
    handler = ImageDBHandler()
    handler.update_db()
    
    setup_watchdog()
    
    logging.info(f"扫描目录: {SCAN_DIRECTORY}")
    logging.info(f"已加载图片: {len(IMAGE_DB)} 张")
    logging.info("=" * 60)
    logging.info("服务已就绪 | 按Ctrl+C终止")
    logging.info("=" * 60)

if __name__ == "__main__":
    # 确保文件系统编码正确
    if not sys.stdout.encoding or sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    if not sys.stderr.encoding or sys.stderr.encoding.lower() != 'utf-8':
        sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    init_service()
    
    # 使用gevent的WSGIServer
    server = pywsgi.WSGIServer(
        ('0.0.0.0', 9000), 
        app,
        handler_class=WebSocketHandler
    )
    server.serve_forever()
