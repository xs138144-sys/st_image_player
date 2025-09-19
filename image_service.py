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
import magic  # 需安装 python-magic-bin (Windows) 或 python-magic (Linux/macOS)
from gevent import pywsgi
from geventwebsocket.handler import WebSocketHandler

# 设置编码
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
sys.getfilesystemencoding = lambda: 'utf-8'

app = Flask(__name__)
# 限制CORS域名（从配置加载）
CORS(app, resources={r"/*": {"origins": []}})

# 线程锁（保证共享资源安全）
media_db_lock = threading.Lock()
websocket_lock = threading.Lock()
config_lock = threading.Lock()

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("image_service.log", encoding='utf-8')
    ]
)

# 全局变量
CONFIG_FILE = "local_image_service_config.json"
MEDIA_DB = []  # 存储图片+视频
SCAN_DIRECTORY = ""
OBSERVER = None
active_websockets = []  # 活跃WebSocket连接
LAST_SCAN_TIME = 0  # 上次扫描时间（用于增量扫描）
CONFIG_VERSION = "1.1"  # 配置版本

# 默认媒体配置（可被配置文件覆盖）
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

# MIME类型映射
MIME_MAP = {
    '.apng': 'image/apng', '.webp': 'image/webp',
    '.webm': 'video/webm', '.mp4': 'video/mp4',
    '.ogv': 'video/ogg', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska'
}


class MediaDBHandler(FileSystemEventHandler):
    def update_db(self, full_scan=False):
        """更新媒体库（支持增量扫描）"""
        global MEDIA_DB, SCAN_DIRECTORY, LAST_SCAN_TIME
        new_media = []
        scan_start_time = time.time()

        if not SCAN_DIRECTORY or not os.path.exists(SCAN_DIRECTORY):
            logging.warning(f"扫描目录无效: {SCAN_DIRECTORY}")
            return

        if not os.access(SCAN_DIRECTORY, os.R_OK):
            logging.error(f"无目录读权限: {SCAN_DIRECTORY}")
            return

        logging.info(f"开始{'全量' if full_scan else '增量'}扫描: {SCAN_DIRECTORY}")
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
                        last_modified = os.path.getmtime(full_path)

                        # 增量扫描：只处理上次扫描后修改的文件
                        if not full_scan and last_modified <= LAST_SCAN_TIME:
                            continue

                        # 检测真实媒体类型（结合文件头）
                        media_type = self.detect_media_type(full_path, file_lower)
                        if not media_type:
                            continue

                        # 检查大小限制
                        max_size = MEDIA_CONFIG[media_type]["max_size"]
                        if file_size > max_size:
                            logging.debug(f"文件超大小限制: {file} ({file_size/1024/1024:.2f}MB)")
                            continue

                        new_media.append({
                            "path": full_path,
                            "rel_path": rel_path,
                            "name": file,
                            "size": file_size,
                            "media_type": media_type,
                            "last_modified": last_modified
                        })
                    except Exception as e:
                        logging.error(f"处理文件错误: {file} - {str(e)}", exc_info=True)

        # 合并新数据并去重
        with media_db_lock:
            # 移除已删除文件
            existing_paths = {m["path"] for m in MEDIA_DB}
            MEDIA_DB = [m for m in MEDIA_DB if os.path.exists(m["path"])]
            
            # 添加新文件
            for m in new_media:
                if m["path"] not in existing_paths:
                    MEDIA_DB.append(m)
            
            # 排序
            MEDIA_DB.sort(key=lambda x: x["last_modified"], reverse=True)

        LAST_SCAN_TIME = scan_start_time
        image_count = len([x for x in MEDIA_DB if x["media_type"] == "image"])
        video_count = len([x for x in MEDIA_DB if x["media_type"] == "video"])
        logging.info(f"扫描完成: 总计{len(MEDIA_DB)}个（图片{image_count} | 视频{video_count}）")

        save_config()
        self.send_update_event()

    def detect_media_type(self, file_path, file_lower):
        """通过文件头检测真实媒体类型"""
        try:
            mime = magic.from_file(file_path, mime=True)
            if mime.startswith('image/'):
                return "image"
            elif mime.startswith('video/'):
                return "video"
            # 降级到扩展名检测
            if file_lower.endswith(MEDIA_CONFIG["image"]["extensions"]):
                return "image"
            elif file_lower.endswith(MEDIA_CONFIG["video"]["extensions"]):
                return "video"
            return None
        except Exception as e:
            logging.warning(f"类型检测失败: {file_path} - {e}")
            # 扩展名兜底
            if file_lower.endswith(MEDIA_CONFIG["image"]["extensions"]):
                return "image"
            elif file_lower.endswith(MEDIA_CONFIG["video"]["extensions"]):
                return "video"
            return None

    def send_update_event(self):
        """向所有WebSocket客户端发送更新通知"""
        message = json.dumps({
            'type': 'media_updated',
            'total_count': len(MEDIA_DB),
            'image_count': len([x for x in MEDIA_DB if x["media_type"] == "image"]),
            'video_count': len([x for x in MEDIA_DB if x["media_type"] == "video"])
        })

        with websocket_lock:
            for ws in list(active_websockets):
                try:
                    ws.send(message)
                except Exception as e:
                    logging.error(f"WebSocket发送失败: {str(e)}")
                    active_websockets.remove(ws)

    def on_created(self, event):
        if not event.is_directory:
            file_size = os.path.getsize(event.src_path) if os.path.exists(event.src_path) else 0
            delay = min(10, max(1.5, file_size / (100 * 1024 * 1024)))  # 动态延迟
            threading.Timer(delay, self.update_db).start()

    def on_deleted(self, event):
        if not event.is_directory:
            with media_db_lock:
                global MEDIA_DB
                deleted_path = os.path.normpath(event.src_path)
                MEDIA_DB = [m for m in MEDIA_DB if os.path.normpath(m["path"]) != deleted_path]
            logging.info(f"移除媒体: {os.path.basename(deleted_path)}")
            save_config()
            self.send_update_event()

    def on_modified(self, event):
        if not event.is_directory:
            file_size = os.path.getsize(event.src_path) if os.path.exists(event.src_path) else 0
            delay = min(5, max(1, file_size / (200 * 1024 * 1024)))
            threading.Timer(delay, self.update_db).start()


def setup_watchdog():
    """设置文件监控"""
    global OBSERVER
    with config_lock:
        if OBSERVER and OBSERVER.is_alive():
            OBSERVER.stop()
            OBSERVER.join()
        
        if SCAN_DIRECTORY and os.path.exists(SCAN_DIRECTORY):
            event_handler = MediaDBHandler()
            OBSERVER = Observer()
            OBSERVER.schedule(event_handler, SCAN_DIRECTORY, recursive=True)
            OBSERVER.start()
            logging.info(f"文件监控启动: {SCAN_DIRECTORY}")
        else:
            logging.warning("监控未启动: 目录无效")


def get_default_scan_dir():
    """自动检测系统默认下载目录"""
    if os.name == 'nt':
        return os.path.join(os.environ.get('USERPROFILE', ''), 'Downloads')
    else:
        return os.path.expanduser('~/Downloads')


def migrate_old_config(old_config):
    """配置迁移（处理旧版本配置）"""
    if "config_version" not in old_config:
        logging.info("检测到旧版本配置，开始迁移")
        # 迁移v1.0到v1.1
        if "media_config" not in old_config:
            old_config["media_config"] = {
                "image_max_size_mb": 5,
                "video_max_size_mb": 100
            }
        old_config["config_version"] = CONFIG_VERSION
        old_config["allowed_origins"] = ["http://localhost:8000", "http://127.0.0.1:8000"]
    return old_config


def save_config():
    """保存配置到文件"""
    try:
        with config_lock:
            config = {
                "config_version": CONFIG_VERSION,
                "scan_directory": SCAN_DIRECTORY,
                "allowed_origins": app.config["CORS_ORIGINS"],
                "total_count": len(MEDIA_DB),
                "image_count": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
                "video_count": len([x for x in MEDIA_DB if x["media_type"] == "video"]),
                "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
                "media_config": {
                    "image_max_size_mb": MEDIA_CONFIG["image"]["max_size"] / 1024 / 1024,
                    "video_max_size_mb": MEDIA_CONFIG["video"]["max_size"] / 1024 / 1024,
                    "image_extensions": list(MEDIA_CONFIG["image"]["extensions"]),
                    "video_extensions": list(MEDIA_CONFIG["video"]["extensions"])
                }
            }
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return config
    except Exception as e:
        logging.error(f"保存配置失败: {str(e)}", exc_info=True)
        return {}


def load_config():
    """加载并初始化配置"""
    global SCAN_DIRECTORY
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
                config = migrate_old_config(config)  # 处理配置迁移
                
                # 更新全局变量
                SCAN_DIRECTORY = config.get("scan_directory", get_default_scan_dir())
                app.config["CORS_ORIGINS"] = config.get("allowed_origins", ["*"])
                
                # 更新媒体配置
                if "media_config" in config:
                    media_cfg = config["media_config"]
                    MEDIA_CONFIG["image"]["max_size"] = int(media_cfg["image_max_size_mb"] * 1024 * 1024)
                    MEDIA_CONFIG["video"]["max_size"] = int(media_cfg["video_max_size_mb"] * 1024 * 1024)
                    if "image_extensions" in media_cfg:
                        MEDIA_CONFIG["image"]["extensions"] = tuple(media_cfg["image_extensions"])
                    if "video_extensions" in media_cfg:
                        MEDIA_CONFIG["video"]["extensions"] = tuple(media_cfg["video_extensions"])
                
                save_config()  # 保存迁移后的配置
                return True
        else:
            # 生成默认配置
            default_dir = get_default_scan_dir()
            default_config = {
                "config_version": CONFIG_VERSION,
                "scan_directory": default_dir,
                "allowed_origins": ["http://localhost:8000", "http://127.0.0.1:8000"],
                "total_count": 0, "image_count": 0, "video_count": 0,
                "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
                "media_config": {
                    "image_max_size_mb": 5,
                    "video_max_size_mb": 100,
                    "image_extensions": list(MEDIA_CONFIG["image"]["extensions"]),
                    "video_extensions": list(MEDIA_CONFIG["video"]["extensions"])
                }
            }
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(default_config, f, indent=2, ensure_ascii=False)
            logging.info(f"生成默认配置: {CONFIG_FILE}")
            load_config()  # 重新加载
    except Exception as e:
        logging.warning(f"加载配置失败: {str(e)}，使用默认值", exc_info=True)
        SCAN_DIRECTORY = get_default_scan_dir()
        app.config["CORS_ORIGINS"] = ["*"]


# WebSocket心跳检测
def websocket_heartbeat():
    """定期清理无效连接"""
    while True:
        with websocket_lock:
            for ws in list(active_websockets):
                if not ws.connected:
                    active_websockets.remove(ws)
        time.sleep(30)


# API接口
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({"status": "ok"})
        response.headers.add("Access-Control-Allow-Origin", ", ".join(app.config["CORS_ORIGINS"]))
        response.headers.add("Access-Control-Allow-Headers", "Content-Type")
        response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        return response


@app.route('/scan', methods=['POST'])
def scan_media():
    """触发扫描并更新大小限制"""
    data = request.json
    new_dir = data.get("path", SCAN_DIRECTORY)
    image_max_mb = data.get("image_max_mb")
    video_max_mb = data.get("video_max_mb")

    # 更新大小限制
    if image_max_mb is not None and 1 <= image_max_mb <= 50:
        MEDIA_CONFIG["image"]["max_size"] = int(image_max_mb * 1024 * 1024)
    if video_max_mb is not None and 10 <= video_max_mb <= 500:
        MEDIA_CONFIG["video"]["max_size"] = int(video_max_mb * 1024 * 1024)

    # 更新目录（如果有变化）
    global SCAN_DIRECTORY
    if new_dir and new_dir != SCAN_DIRECTORY:
        with config_lock:
            SCAN_DIRECTORY = new_dir
        setup_watchdog()  # 重启监控

    # 启动后台扫描
    threading.Thread(target=lambda: MediaDBHandler().update_db(full_scan=True)).start()
    return jsonify({"status": "扫描已启动"})


@app.route('/media', methods=['GET'])
def get_media_list():
    """获取媒体列表"""
    media_type = request.args.get("type", "all")
    with media_db_lock:
        if media_type == "image":
            filtered = [m for m in MEDIA_DB if m["media_type"] == "image"]
        elif media_type == "video":
            filtered = [m for m in MEDIA_DB if m["media_type"] == "video"]
        else:
            filtered = MEDIA_DB.copy()
    return jsonify(filtered)


@app.route('/media/<path:rel_path>', methods=['GET'])
def get_media_file(rel_path):
    """获取媒体文件（防路径遍历）"""
    try:
        rel_path = urllib.parse.unquote(rel_path)
        full_path = os.path.abspath(os.path.join(SCAN_DIRECTORY, rel_path))
        
        # 验证路径安全性
        if not full_path.startswith(os.path.abspath(SCAN_DIRECTORY)):
            return jsonify({"error": "路径不合法"}), 403
        
        if not os.path.exists(full_path):
            return jsonify({"error": "文件不存在"}), 404

        # 确定MIME类型
        ext = os.path.splitext(full_path)[1].lower()
        mime_type = MIME_MAP.get(ext, mimetypes.guess_type(full_path)[0] or 'application/octet-stream')
        return send_file(full_path, mimetype=mime_type)
    except Exception as e:
        logging.error(f"文件访问错误: {rel_path} - {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route('/ws')
def websocket_endpoint():
    """WebSocket端点"""
    ws = request.environ.get('wsgi.websocket')
    if not ws:
        return "需要WebSocket连接", 400

    with websocket_lock:
        active_websockets.append(ws)
    
    try:
        while True:
            message = ws.receive()
            if message is None:
                break
            # 处理客户端消息（如心跳回应）
            if message == 'ping':
                ws.send('pong')
    except Exception as e:
        logging.error(f"WebSocket错误: {e}")
    finally:
        with websocket_lock:
            if ws in active_websockets:
                active_websockets.remove(ws)
    return ""


@app.route('/config', methods=['GET', 'POST'])
def handle_config():
    """配置管理接口（动态重载）"""
    if request.method == 'POST':
        try:
            data = request.json
            with config_lock:
                # 更新CORS域名
                if "allowed_origins" in data:
                    app.config["CORS_ORIGINS"] = data["allowed_origins"]
                # 更新媒体格式
                if "media_config" in data:
                    # 验证并更新配置
                    pass
            save_config()
            return jsonify({"status": "配置已更新"})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    else:
        return jsonify(save_config())


if __name__ == '__main__':
    # 初始化
    load_config()
    setup_watchdog()
    # 启动WebSocket心跳线程
    threading.Thread(target=websocket_heartbeat, daemon=True).start()
    # 启动扫描
    threading.Thread(target=lambda: MediaDBHandler().update_db(full_scan=True), daemon=True).start()
    
    # 启动服务器
    server = pywsgi.WSGIServer(('0.0.0.0', 9000), app, handler_class=WebSocketHandler)
    logging.info("服务启动: http://localhost:9000")
    server.serve_forever()