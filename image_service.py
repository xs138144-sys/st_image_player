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

# 配置参数（扩展媒体支持）
CONFIG_FILE = "local_image_service_config.json"
MEDIA_DB = []  # 存储图片+视频
SCAN_DIRECTORY = ""
OBSERVER = None
active_websockets = []  # 活跃WebSocket连接

# 媒体格式配置（图片+视频）
MEDIA_CONFIG = {
    "image": {
        "extensions": ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.apng'),
        "max_size": 5 * 1024 * 1024  # 5MB
    },
    "video": {
        "extensions": ('.webm', '.mp4', '.ogv', '.mov', '.avi', '.mkv'),
        "max_size": 100 * 1024 * 1024  # 100MB
    }
}

# MIME类型映射（补充视频类型）
MIME_MAP = {
    '.apng': 'image/apng', '.webp': 'image/webp',
    '.webm': 'video/webm', '.mp4': 'video/mp4',
    '.ogv': 'video/ogg', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska'
}


class MediaDBHandler(FileSystemEventHandler):
    # 修复：类内方法统一缩进4个空格
    def update_db(self):
        global MEDIA_DB, SCAN_DIRECTORY
        MEDIA_DB = []
        
        if not SCAN_DIRECTORY or not os.path.exists(SCAN_DIRECTORY):
            logging.warning(f"目录不存在: {SCAN_DIRECTORY}")
            return
        
        # 目录存在时检查读权限
        if not os.access(SCAN_DIRECTORY, os.R_OK):
            logging.error(f"无目录读权限: {SCAN_DIRECTORY}")
            return
        
        logging.info(f"开始扫描目录: {SCAN_DIRECTORY}")
        all_extensions = MEDIA_CONFIG["image"]["extensions"] + MEDIA_CONFIG["video"]["extensions"]
        
        # 遍历目录收集媒体文件
        for root, _, files in os.walk(SCAN_DIRECTORY):
            for file in files:
                file_lower = file.lower()
                if any(file_lower.endswith(ext) for ext in all_extensions):
                    try:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, SCAN_DIRECTORY).replace("\\", "/")
                        file_size = os.path.getsize(full_path)
                        
                        # 判断媒体类型并检查大小限制
                        if file_lower.endswith(MEDIA_CONFIG["image"]["extensions"]):
                            media_type = "image"
                            max_size = MEDIA_CONFIG["image"]["max_size"]
                        else:
                            media_type = "video"
                            max_size = MEDIA_CONFIG["video"]["max_size"]
                        
                        if file_size <= max_size:
                            MEDIA_DB.append({
                                "path": full_path,
                                "rel_path": rel_path,
                                "name": file,
                                "size": file_size,
                                "media_type": media_type,
                                "last_modified": os.path.getmtime(full_path)
                            })
                    except Exception as e:
                        logging.error(f"处理媒体文件错误: {file} - {str(e)}")
        
        # 遍历结束后统一排序、统计、保存
        if MEDIA_DB:
            MEDIA_DB.sort(key=lambda x: x["last_modified"], reverse=True)
        
        image_count = len([x for x in MEDIA_DB if x["media_type"] == "image"])
        video_count = len([x for x in MEDIA_DB if x["media_type"] == "video"])
        logging.info(f"扫描完成: 总计{len(MEDIA_DB)}个（图片{image_count} | 视频{video_count}）")
        
        save_config()
        self.send_update_event()

    def send_update_event(self):
        # 向客户端发送媒体库更新通知
        message = json.dumps({
            'type': 'media_updated',
            'total_count': len(MEDIA_DB),
            'image_count': len([x for x in MEDIA_DB if x["media_type"] == "image"]),
            'video_count': len([x for x in MEDIA_DB if x["media_type"] == "video"])
        })
        
        for ws in list(active_websockets):
            try:
                ws.send(message)
            except Exception as e:
                logging.error(f"WebSocket发送失败: {str(e)}")
                if ws in active_websockets:
                    active_websockets.remove(ws)

    # 文件创建时更新DB
    def on_created(self, event):
        if not event.is_directory and any(event.src_path.lower().endswith(ext) for ext in 
            MEDIA_CONFIG["image"]["extensions"] + MEDIA_CONFIG["video"]["extensions"]):
            LARGE_FILE_THRESHOLD = 200 * 1024 * 1024  # 200MB阈值
            if os.path.exists(event.src_path) and os.path.getsize(event.src_path) > LARGE_FILE_THRESHOLD:
                time.sleep(5)  # 大文件等待5秒
            else:
                time.sleep(1.5)  # 普通文件等待1.5秒
            self.update_db()

    def on_deleted(self, event):
        global MEDIA_DB
        if not event.is_directory:
            deleted_path = os.path.normpath(event.src_path)
            MEDIA_DB = [m for m in MEDIA_DB if os.path.normpath(m["path"]) != deleted_path]
            logging.info(f"删除媒体: {os.path.basename(deleted_path)}")
            save_config()
            self.send_update_event()

    def on_modified(self, event):
        # 仅处理非目录且是媒体文件的情况
        if not event.is_directory and any(event.src_path.lower().endswith(ext) for ext in 
            MEDIA_CONFIG["image"]["extensions"] + MEDIA_CONFIG["video"]["extensions"]):
            LARGE_FILE_THRESHOLD = 200 * 1024 * 1024
            if os.path.exists(event.src_path) and os.path.getsize(event.src_path) > LARGE_FILE_THRESHOLD:
                time.sleep(3)
            else:
                time.sleep(1)
            self.update_db()


def setup_watchdog():
    global OBSERVER
    if OBSERVER and OBSERVER.is_alive():
        OBSERVER.stop()
        OBSERVER.join()
    
    if SCAN_DIRECTORY and os.path.exists(SCAN_DIRECTORY):
        event_handler = MediaDBHandler()
        OBSERVER = Observer()
        OBSERVER.schedule(event_handler, SCAN_DIRECTORY, recursive=True)
        OBSERVER.start()
        logging.info(f"文件监控启用: {SCAN_DIRECTORY}")
    else:
        logging.warning("监控未启动: 目录无效")


def save_config():
    try:
        config = {
            "scan_directory": SCAN_DIRECTORY,
            "total_count": len(MEDIA_DB),
            "image_count": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
            "video_count": len([x for x in MEDIA_DB if x["media_type"] == "video"]),
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "media_config": {
                "image_max_size_mb": MEDIA_CONFIG["image"]["max_size"] / 1024 / 1024,
                "video_max_size_mb": MEDIA_CONFIG["video"]["max_size"] / 1024 / 1024
            }
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
                # 加载媒体大小限制
                if "media_config" in config:
                    MEDIA_CONFIG["image"]["max_size"] = int(config["media_config"]["image_max_size_mb"] * 1024 * 1024)
                    MEDIA_CONFIG["video"]["max_size"] = int(config["media_config"]["video_max_size_mb"] * 1024 * 1024)
            return True
        else:
            # 优化：跨平台默认目录
            if os.name == 'nt':
                default_dir = "F:\\Download"
            else:
                default_dir = os.path.expanduser("~/Downloads")
            default_config = {
                "scan_directory": default_dir,
                "total_count": 0, "image_count": 0, "video_count": 0,
                "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
                "media_config": {"image_max_size_mb": 5, "video_max_size_mb": 100}
            }
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(default_config, f, indent=2, ensure_ascii=False)
            logging.info("生成默认配置: local_image_service_config.json")
    except Exception as e:
        logging.warning(f"加载配置失败: {str(e)}，使用默认值")
    
    # 默认配置
    SCAN_DIRECTORY = "F:\\Download"
    MEDIA_CONFIG["image"]["max_size"] = 5 * 1024 * 1024
    MEDIA_CONFIG["video"]["max_size"] = 100 * 1024 * 1024
    return False


# API: 扫描目录（支持更新媒体大小限制）
@app.route("/scan", methods=["POST"])
def scan_endpoint():
    try:
        data = request.get_json()
        new_dir = data.get("path", "").strip()
        image_max_mb = data.get("image_max_mb", MEDIA_CONFIG["image"]["max_size"] / 1024 / 1024)
        video_max_mb = data.get("video_max_mb", MEDIA_CONFIG["video"]["max_size"] / 1024 / 1024)
        
        if not new_dir or not os.path.isdir(new_dir):
            return jsonify({"status": "error", "message": "目录无效"}), 400
        
        # 更新全局配置
        global SCAN_DIRECTORY
        SCAN_DIRECTORY = os.path.normpath(new_dir)
        MEDIA_CONFIG["image"]["max_size"] = int(image_max_mb * 1024 * 1024)
        MEDIA_CONFIG["video"]["max_size"] = int(video_max_mb * 1024 * 1024)
        
        # 重新扫描
        handler = MediaDBHandler()
        handler.update_db()
        setup_watchdog()
        
        return jsonify({
            "status": "success",
            "path": SCAN_DIRECTORY,
            "total_count": len(MEDIA_DB),
            "image_count": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
            "video_count": len([x for x in MEDIA_DB if x["media_type"] == "video"]),
            "media_config": {"image_max_size_mb": image_max_mb, "video_max_size_mb": video_max_mb}
        })
    except Exception as e:
        logging.error(f"扫描失败: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500


# API: 获取媒体列表（支持筛选类型）
@app.route("/media", methods=["GET"])
def get_media():
    media_type = request.args.get("type", "all").lower()
    if media_type == "image":
        filtered = [m for m in MEDIA_DB if m["media_type"] == "image"]
    elif media_type == "video":
        filtered = [m for m in MEDIA_DB if m["media_type"] == "video"]
    else:
        filtered = MEDIA_DB
    
    return jsonify({
        "media": filtered,
        "total_count": len(MEDIA_DB),
        "filtered_count": len(filtered),
        "image_count": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
        "video_count": len([x for x in MEDIA_DB if x["media_type"] == "video"]),
        "last_updated": save_config().get("last_updated", "")
    })


# API: 获取随机媒体
@app.route("/random-media", methods=["GET"])
def get_random_media():
    media_type = request.args.get("type", "all").lower()
    if media_type == "image":
        candidates = [m for m in MEDIA_DB if m["media_type"] == "image"]
    elif media_type == "video":
        candidates = [m for m in MEDIA_DB if m["media_type"] == "video"]
    else:
        candidates = MEDIA_DB
    
    if not candidates:
        return jsonify({"status": "error", "message": f"无{media_type}媒体"}), 404
    
    import random
    media = random.choice(candidates)
    return jsonify({
        "url": f"/file/{media['rel_path']}",
        "name": media["name"],
        "size": media["size"],
        "media_type": media["media_type"],
        "last_modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(media["last_modified"]))
    })


# API: 提供媒体文件（支持视频断点续传）
@app.route("/file/<path:filename>", methods=["GET"])
def serve_file(filename):
    try:
        # 解码URL
        decoded_filename = urllib.parse.unquote(filename)
        file_path = os.path.join(SCAN_DIRECTORY, decoded_filename)
        abs_path = os.path.abspath(file_path)
        
        # 安全检查（防止路径穿越）
        base_dir = os.path.abspath(SCAN_DIRECTORY)
        if not abs_path.startswith(base_dir) or ".." in abs_path.replace(base_dir, ""):
            logging.warning(f"非法访问: {abs_path}")
            return "禁止访问", 403
        
        if not os.path.isfile(abs_path):
            logging.warning(f"文件不存在: {abs_path}")
            return "文件不存在", 404
        
        # 确定MIME类型
        file_ext = os.path.splitext(abs_path)[1].lower()
        mime_type = MIME_MAP.get(file_ext) or mimetypes.guess_type(abs_path)[0]
        if not mime_type:
            mime_type = "image/" + file_ext[1:] if file_ext in MEDIA_CONFIG["image"]["extensions"] else "video/" + file_ext[1:]
        
        # 视频断点续传处理
        range_header = request.headers.get("Range")
        if range_header and mime_type.startswith("video/"):
            file_size = os.path.getsize(abs_path)
            start, end = range_header.split("=")[1].split("-")
            start = int(start)
            end = int(end) if end else file_size - 1
            length = end - start + 1
            
            with open(abs_path, "rb") as f:
                f.seek(start)
                data = f.read(length)
            
            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": length,
                "Content-Type": mime_type
            }
            return data, 206, headers
        
        # 普通文件传输
        logging.debug(f"服务媒体: {abs_path} (MIME: {mime_type})")
        return send_file(
            abs_path,
            mimetype=mime_type,
            as_attachment=False,
            conditional=True,
            last_modified=os.path.getmtime(abs_path)
        )
    except Exception as e:
        logging.error(f"文件服务错误: {str(e)}")
        return f"服务器错误: {str(e)}", 500


# API: 清理无效媒体
@app.route("/cleanup", methods=["POST"])
def cleanup():
    global MEDIA_DB
    initial_count = len(MEDIA_DB)
    
    # 移除不存在/超大小的媒体
    valid_media = []
    for media in MEDIA_DB:
        if os.path.exists(media["path"]):
            max_size = MEDIA_CONFIG[media["media_type"]]["max_size"]
            if os.path.getsize(media["path"]) <= max_size:
                valid_media.append(media)
                continue
            logging.info(f"超大小清理: {media['name']}")
        else:
            logging.info(f"不存在清理: {media['name']}")
    
    MEDIA_DB = valid_media
    removed = initial_count - len(MEDIA_DB)
    save_config()
    
    return jsonify({
        "status": "success",
        "removed": removed,
        "remaining_total": len(MEDIA_DB),
        "remaining_image": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
        "remaining_video": len([x for x in MEDIA_DB if x["media_type"] == "video"])
    })


# API: 服务状态
@app.route("/status", methods=["GET"])
def service_status():
    try:
        config = save_config()
        return jsonify({
            "active": True,
            "observer_active": OBSERVER.is_alive() if OBSERVER else False,
            "directory": SCAN_DIRECTORY,
            "total_count": len(MEDIA_DB),
            "image_count": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
            "video_count": len([x for x in MEDIA_DB if x["media_type"] == "video"]),
            "last_updated": config.get("last_updated", "未知"),
            "media_config": config.get("media_config", {})
        })
    except Exception as e:
        logging.error(f"状态检查错误: {str(e)}")
        return jsonify({"active": False, "error": str(e)}), 500


# WebSocket: 实时更新
@app.route("/socket.io")
def handle_websocket():
    if request.environ.get("wsgi.websocket"):
        ws = request.environ["wsgi.websocket"]
        active_websockets.append(ws)
        logging.info(f"WebSocket连接: 当前{len(active_websockets)}个")
        
        try:
            # 初始化消息
            init_msg = json.dumps({
                "type": "init",
                "total_count": len(MEDIA_DB),
                "image_count": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
                "video_count": len([x for x in MEDIA_DB if x["media_type"] == "video"])
            })
            ws.send(init_msg)
            
            # 心跳与筛选处理
            while True:
                message = ws.receive()
                if not message:
                    break
                msg = json.loads(message)
                if msg.get("type") == "ping":
                    ws.send(json.dumps({"type": "pong", "timestamp": time.time()}))
                elif msg.get("type") == "filter_media":
                    media_type = msg.get("media_type", "all")
                    filtered = len([x for x in MEDIA_DB if x["media_type"] == media_type]) if media_type != "all" else len(MEDIA_DB)
                    ws.send(json.dumps({"type": "filtered_media", "count": filtered}))
        except Exception as e:
            logging.error(f"WebSocket错误: {str(e)}")
        finally:
            if ws in active_websockets:
                active_websockets.remove(ws)
            logging.info(f"WebSocket关闭: 剩余{len(active_websockets)}个")
    return ""


def init_service():
    logging.info("=" * 80)
    logging.info("本地媒体服务启动（支持图片+视频）")
    logging.info("服务地址: http://127.0.0.1:9000")
    logging.info(f"图片限制: {MEDIA_CONFIG['image']['max_size']/1024/1024:.1f}MB | 视频限制: {MEDIA_CONFIG['video']['max_size']/1024/1024:.1f}MB")
    logging.info(f"图片格式: {', '.join([ext[1:].upper() for ext in MEDIA_CONFIG['image']['extensions']])}")
    logging.info(f"视频格式: {', '.join([ext[1:].upper() for ext in MEDIA_CONFIG['video']['extensions']])}")
    logging.info("=" * 80)
    
    load_config()
    handler = MediaDBHandler()
    handler.update_db()
    setup_watchdog()
    
    logging.info(f"当前目录: {SCAN_DIRECTORY}")
    logging.info(f"媒体统计: 总计{len(MEDIA_DB)} | 图片{len([x for x in MEDIA_DB if x['media_type']=='image'])} | 视频{len([x for x in MEDIA_DB if x['media_type']=='video'])}")
    logging.info("服务就绪 | Ctrl+C终止")


if __name__ == "__main__":
    # 确保编码正确
    if not sys.stdout.encoding or sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    if not sys.stderr.encoding or sys.stderr.encoding.lower() != 'utf-8':
        sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    init_service()
    
    # 启动服务
    server = pywsgi.WSGIServer(
        ('0.0.0.0', 9000),
        app,
        handler_class=WebSocketHandler,
        log=logging.getLogger("gevent-server")
    )
    server.serve_forever()