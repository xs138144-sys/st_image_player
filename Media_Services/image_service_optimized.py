import os
import sys
import json
import time
import logging
import threading
import urllib.parse
import functools
from datetime import datetime, timedelta
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

# 配置日志 - 优化：INFO级别 + 日志轮转
logging.basicConfig(
    level=logging.INFO,  # 从DEBUG改为INFO
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("image_service.log", encoding='utf-8')
    ]
)

# MIME类型映射
MIME_MAP = {
    '.apng': 'image/apng', '.webp': 'image/webp',
    '.webm': 'video/webm', '.mp4': 'video/mp4',
    '.ogv': 'video/ogg', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska'
}

# 缓存装饰器 - 优化：添加元数据缓存
class MediaCache:
    def __init__(self, ttl=300):  # 5分钟缓存
        self.cache = {}
        self.ttl = ttl
    
    def get(self, key):
        if key in self.cache:
            timestamp, result = self.cache[key]
            if datetime.now() - timestamp < timedelta(seconds=self.ttl):
                return result
        return None
    
    def set(self, key, value):
        self.cache[key] = (datetime.now(), value)
    
    def clear(self):
        self.cache.clear()

# 配置管理器 - 优化：配置管理
class ConfigManager:
    def __init__(self, config_file="local_image_service_config.json"):
        self.config_file = config_file
        self.default_config = {
            "scan_directory": "F:\\Download" if os.name == 'nt' else os.path.expanduser("~/Downloads"),
            "image_max_size_mb": 5,
            "video_max_size_mb": 100
        }
    
    def load_config(self):
        try:
            if os.path.exists(self.config_file):
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    return {**self.default_config, **json.load(f)}
            return self.default_config
        except Exception as e:
            logging.warning(f"配置加载失败: {e}")
            return self.default_config
    
    def save_config(self, config):
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            logging.error(f"配置保存失败: {e}")
            return False

# WebSocket连接管理器 - 优化：连接管理
class WebSocketManager:
    def __init__(self, timeout=300):  # 5分钟超时
        self.active_connections = {}
        self.timeout = timeout
    
    def add_connection(self, ws):
        connection_id = id(ws)
        self.active_connections[connection_id] = {
            'ws': ws,
            'last_activity': time.time(),
            'thread': threading.Thread(target=self._monitor_connection, args=(connection_id,), daemon=True)
        }
        self.active_connections[connection_id]['thread'].start()
        logging.info(f"WebSocket连接: 当前{len(self.active_connections)}个")
    
    def remove_connection(self, connection_id):
        if connection_id in self.active_connections:
            del self.active_connections[connection_id]
            logging.info(f"WebSocket关闭: 剩余{len(self.active_connections)}个")
    
    def update_activity(self, connection_id):
        if connection_id in self.active_connections:
            self.active_connections[connection_id]['last_activity'] = time.time()
    
    def _monitor_connection(self, connection_id):
        while connection_id in self.active_connections:
            conn = self.active_connections[connection_id]
            if time.time() - conn['last_activity'] > self.timeout:
                self.remove_connection(connection_id)
                break
            time.sleep(60)  # 每分钟检查一次
    
    def broadcast(self, message):
        disconnected = []
        for connection_id, conn in list(self.active_connections.items()):
            try:
                conn['ws'].send(message)
                self.update_activity(connection_id)
            except Exception as e:
                logging.error(f"WebSocket发送失败: {str(e)}")
                disconnected.append(connection_id)
        
        for connection_id in disconnected:
            self.remove_connection(connection_id)
    
    def get_connection_count(self):
        return len(self.active_connections)

# 主服务类 - 优化：类封装全局变量
class MediaService:
    def __init__(self):
        self.app = Flask(__name__)
        CORS(self.app)
        
        # 配置
        self.config_manager = ConfigManager()
        self.config = self.config_manager.load_config()
        
        # 媒体配置
        self.media_config = {
            "image": {
                "extensions": ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.apng'),
                "max_size": int(self.config["image_max_size_mb"] * 1024 * 1024)
            },
            "video": {
                "extensions": ('.webm', '.mp4', '.ogv', '.mov', '.avi', '.mkv'),
                "max_size": int(self.config["video_max_size_mb"] * 1024 * 1024)
            }
        }
        
        # 数据存储
        self.media_db = []
        self.scan_directory = self.config["scan_directory"]
        self.observer = None
        
        # 缓存和连接管理
        self.cache = MediaCache()
        self.ws_manager = WebSocketManager()
        
        # 注册路由
        self._register_routes()
    
    def _register_routes(self):
        @self.app.route("/scan", methods=["POST"])
        def scan_endpoint():
            return self._scan_endpoint()
        
        @self.app.route("/media", methods=["GET"])
        def get_media():
            return self._get_media()
        
        @self.app.route("/random-media", methods=["GET"])
        def get_random_media():
            return self._get_random_media()
        
        @self.app.route("/file/<path:filename>", methods=["GET"])
        def serve_file(filename):
            return self._serve_file(filename)
        
        @self.app.route("/cleanup", methods=["POST"])
        def cleanup():
            return self._cleanup()
        
        @self.app.route("/status", methods=["GET"])
        def service_status():
            return self._service_status()
        
        @self.app.route("/socket.io")
        def handle_websocket():
            return self._handle_websocket()
    
    # 文件扫描优化：增量扫描
    def update_db_incremental(self, changed_files=None):
        """增量更新媒体库"""
        if changed_files:
            # 只处理变化的文件
            for file_path in changed_files:
                self._process_single_file(file_path)
        else:
            # 首次扫描才全量
            self._scan_full_directory()
    
    def _scan_full_directory(self):
        """全量扫描目录"""
        self.media_db = []
        
        if not self.scan_directory or not os.path.exists(self.scan_directory):
            logging.warning(f"目录不存在: {self.scan_directory}")
            return
        
        if not os.access(self.scan_directory, os.R_OK):
            logging.error(f"无目录读权限: {self.scan_directory}")
            return

        logging.info(f"开始扫描目录: {self.scan_directory}")
        all_extensions = self.media_config["image"]["extensions"] + self.media_config["video"]["extensions"]
        
        for root, _, files in os.walk(self.scan_directory):
            for file in files:
                file_lower = file.lower()
                if any(file_lower.endswith(ext) for ext in all_extensions):
                    full_path = os.path.join(root, file)
                    self._process_single_file(full_path)
        
        # 按修改时间排序（最新在前）
        self.media_db.sort(key=lambda x: x["last_modified"], reverse=True)
        image_count = len([x for x in self.media_db if x["media_type"] == "image"])
        video_count = len([x for x in self.media_db if x["media_type"] == "video"])
        logging.info(f"扫描完成: 总计{len(self.media_db)}个（图片{image_count} | 视频{video_count}）")
        
        self._save_config()
        self._send_update_event()
    
    def _process_single_file(self, full_path):
        """处理单个文件"""
        try:
            file_lower = os.path.basename(full_path).lower()
            rel_path = os.path.relpath(full_path, self.scan_directory).replace("\\", "/")
            file_size = os.path.getsize(full_path)
            
            # 判断媒体类型并检查大小
            if file_lower.endswith(self.media_config["image"]["extensions"]):
                media_type = "image"
                max_size = self.media_config["image"]["max_size"]
            else:
                media_type = "video"
                max_size = self.media_config["video"]["max_size"]
            
            if file_size <= max_size:
                # 检查是否已存在
                existing_index = next((i for i, m in enumerate(self.media_db) if m["path"] == full_path), -1)
                
                media_info = {
                    "path": full_path,
                    "rel_path": rel_path,
                    "name": os.path.basename(full_path),
                    "size": file_size,
                    "media_type": media_type,
                    "last_modified": os.path.getmtime(full_path)
                }
                
                if existing_index >= 0:
                    # 更新现有记录
                    self.media_db[existing_index] = media_info
                else:
                    # 添加新记录
                    self.media_db.append(media_info)
        except Exception as e:
            logging.error(f"处理媒体文件错误: {full_path} - {str(e)}")
    
    def _send_update_event(self):
        """发送更新事件"""
        message = json.dumps({
            'type': 'media_updated',
            'total_count': len(self.media_db),
            'image_count': len([x for x in self.media_db if x["media_type"] == "image"]),
            'video_count': len([x for x in self.media_db if x["media_type"] == "video"])
        })
        self.ws_manager.broadcast(message)
    
    def _save_config(self):
        """保存配置"""
        config = {
            "scan_directory": self.scan_directory,
            "total_count": len(self.media_db),
            "image_count": len([x for x in self.media_db if x["media_type"] == "image"]),
            "video_count": len([x for x in self.media_db if x["media_type"] == "video"]),
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "image_max_size_mb": self.media_config["image"]["max_size"] / 1024 / 1024,
            "video_max_size_mb": self.media_config["video"]["max_size"] / 1024 / 1024
        }
        self.config_manager.save_config(config)
        return config
    
    # API端点实现 - 优化：错误处理
    def _scan_endpoint(self):
        """扫描目录端点"""
        try:
            data = request.get_json()
            new_dir = data.get("path", "").strip()
            image_max_mb = data.get("image_max_mb", self.media_config["image"]["max_size"] / 1024 / 1024)
            video_max_mb = data.get("video_max_mb", self.media_config["video"]["max_size"] / 1024 / 1024)
            
            if not new_dir or not os.path.isdir(new_dir):
                return jsonify({"status": "error", "message": "目录无效"}), 400
            
            # 更新配置
            self.scan_directory = os.path.normpath(new_dir)
            self.media_config["image"]["max_size"] = int(image_max_mb * 1024 * 1024)
            self.media_config["video"]["max_size"] = int(video_max_mb * 1024 * 1024)
            
            # 重新扫描
            self.update_db_incremental()
            self._setup_watchdog()
            
            return jsonify({
                "status": "success",
                "path": self.scan_directory,
                "total_count": len(self.media_db),
                "image_count": len([x for x in self.media_db if x["media_type"] == "image"]),
                "video_count": len([x for x in self.media_db if x["media_type"] == "video"]),
                "media_config": {"image_max_size_mb": image_max_mb, "video_max_size_mb": video_max_mb}
            })
        except Exception as e:
            logging.error(f"扫描失败: {str(e)}")
            return jsonify({"status": "error", "message": str(e)}), 500
    
    def _get_media(self):
        """获取媒体列表"""
        try:
            media_type = request.args.get("type", "all").lower()
            if media_type == "image":
                filtered = [m for m in self.media_db if m["media_type"] == "image"]
            elif media_type == "video":
                filtered = [m for m in self.media_db if m["media_type"] == "video"]
            else:
                filtered = self.media_db
            
            config = self._save_config()
            return jsonify({
                "media": filtered,
                "total_count": len(self.media_db),
                "filtered_count": len(filtered),
                "image_count": len([x for x in self.media_db if x["media_type"] == "image"]),
                "video_count": len([x for x in self.media_db if x["media_type"] == "video"]),
                "last_updated": config.get("last_updated", "")
            })
        except Exception as e:
            logging.error(f"获取媒体列表失败: {str(e)}")
            return jsonify({"status": "error", "message": "服务器内部错误"}), 500
    
    def _get_random_media(self):
        """获取随机媒体"""
        try:
            media_type = request.args.get("type", "all").lower()
            if media_type == "image":
                candidates = [m for m in self.media_db if m["media_type"] == "image"]
            elif media_type == "video":
                candidates = [m for m in self.media_db if m["media_type"] == "video"]
            else:
                candidates = self.media_db
            
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
        except Exception as e:
            logging.error(f"获取随机媒体失败: {str(e)}")
            return jsonify({"status": "error", "message": "服务器内部错误"}), 500
    
    def _serve_file(self, filename):
        """提供媒体文件 - 优化：错误处理"""
        try:
            # 解码URL
            decoded_filename = urllib.parse.unquote(filename)
            file_path = os.path.join(self.scan_directory, decoded_filename)
            abs_path = os.path.abspath(file_path)
            
            # 安全检查（防止路径穿越）
            base_dir = os.path.abspath(self.scan_directory)
            if not abs_path.startswith(base_dir) or ".." in abs_path.replace(base_dir, ""):
                logging.warning(f"非法访问: {abs_path}")
                return jsonify({"error": "禁止访问"}), 403
            
            if not os.path.exists(abs_path):
                logging.warning(f"文件不存在: {abs_path}")
                return jsonify({"error": "文件不存在"}), 404
                
            if not os.path.isfile(abs_path):
                logging.warning(f"路径不是文件: {abs_path}")
                return jsonify({"error": "路径不是文件"}), 400
            
            # 权限检查
            if not os.access(abs_path, os.R_OK):
                logging.warning(f"文件无读权限: {abs_path}")
                return jsonify({"error": "文件无读权限"}), 403
            
            # 文件大小检查
            file_size = os.path.getsize(abs_path)
            if file_size > self.media_config["video"]["max_size"]:
                logging.warning(f"文件过大: {abs_path} ({file_size} bytes)")
                return jsonify({"error": "文件过大"}), 413
            
            # 确定MIME类型
            file_ext = os.path.splitext(abs_path)[1].lower()
            mime_type = MIME_MAP.get(file_ext) or mimetypes.guess_type(abs_path)[0]
            if not mime_type:
                mime_type = "image/" + file_ext[1:] if file_ext in self.media_config["image"]["extensions"] else "video/" + file_ext[1:]
            
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
        except PermissionError as e:
            logging.error(f"权限错误: {str(e)}")
            return jsonify({"error": "权限不足"}), 403
        except OSError as e:
            logging.error(f"系统错误: {str(e)}")
            return jsonify({"error": "系统错误"}), 500
        except Exception as e:
            logging.error(f"文件服务错误: {str(e)}")
            return jsonify({"error": "服务器内部错误"}), 500
    
    def _cleanup(self):
        """清理无效媒体"""
        try:
            initial_count = len(self.media_db)
            
            # 移除不存在/超大小的媒体
            valid_media = []
            for media in self.media_db:
                if os.path.exists(media["path"]):
                    max_size = self.media_config[media["media_type"]]["max_size"]
                    if os.path.getsize(media["path"]) <= max_size:
                        valid_media.append(media)
                        continue
                    logging.info(f"超大小清理: {media['name']}")
                else:
                    logging.info(f"不存在清理: {media['name']}")
            
            self.media_db = valid_media
            removed = initial_count - len(self.media_db)
            self._save_config()
            
            return jsonify({
                "status": "success",
                "removed": removed,
                "remaining_total": len(self.media_db),
                "remaining_image": len([x for x in self.media_db if x["media_type"] == "image"]),
                "remaining_video": len([x for x in self.media_db if x["media_type"] == "video"])
            })
        except Exception as e:
            logging.error(f"清理失败: {str(e)}")
            return jsonify({"status": "error", "message": "服务器内部错误"}), 500
    
    def _service_status(self):
        """服务状态"""
        try:
            config = self._save_config()
            return jsonify({
                "active": True,
                "observer_active": self.observer.is_alive() if self.observer else False,
                "directory": self.scan_directory,
                "total_count": len(self.media_db),
                "image_count": len([x for x in self.media_db if x["media_type"] == "image"]),
                "video_count": len([x for x in self.media_db if x["media_type"] == "video"]),
                "last_updated": config.get("last_updated", "未知"),
                "media_config": {
                    "image_max_size_mb": self.media_config["image"]["max_size"] / 1024 / 1024,
                    "video_max_size_mb": self.media_config["video"]["max_size"] / 1024 / 1024
                }
            })
        except Exception as e:
            logging.error(f"状态检查错误: {str(e)}")
            return jsonify({"active": False, "error": str(e)}), 500
    
    def _handle_websocket(self):
        """WebSocket处理"""
        if request.environ.get("wsgi.websocket"):
            ws = request.environ["wsgi.websocket"]
            self.ws_manager.add_connection(ws)
            
            try:
                # 初始化消息
                init_msg = json.dumps({
                    "type": "init",
                    "total_count": len(self.media_db),
                    "image_count": len([x for x in self.media_db if x["media_type"] == "image"]),
                    "video_count": len([x for x in self.media_db if x["media_type"] == "video"])
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
                        filtered = len([x for x in self.media_db if x["media_type"] == media_type]) if media_type != "all" else len(self.media_db)
                        ws.send(json.dumps({"type": "filtered_media", "count": filtered}))
            except Exception as e:
                logging.error(f"WebSocket错误: {str(e)}")
            finally:
                connection_id = id(ws)
                self.ws_manager.remove_connection(connection_id)
        return ""
    
    def _setup_watchdog(self):
        """设置文件监控"""
        if self.observer and self.observer.is_alive():
            self.observer.stop()
            self.observer.join()
        
        if self.scan_directory and os.path.exists(self.scan_directory):
            event_handler = MediaDBHandler(self)
            self.observer = Observer()
            self.observer.schedule(event_handler, self.scan_directory, recursive=True)
            self.observer.start()
            logging.info(f"文件监控启用: {self.scan_directory}")
        else:
            logging.warning("监控未启动: 目录无效")
    
    def init_service(self):
        """初始化服务"""
        logging.info("=" * 80)
        logging.info("优化版本地媒体服务启动（支持图片+视频）")
        logging.info("服务地址: http://127.0.0.1:9000")
        logging.info(f"图片限制: {self.media_config['image']['max_size']/1024/1024:.1f}MB | 视频限制: {self.media_config['video']['max_size']/1024/1024:.1f}MB")
        logging.info(f"图片格式: {', '.join([ext[1:].upper() for ext in self.media_config['image']['extensions']])}")
        logging.info(f"视频格式: {', '.join([ext[1:].upper() for ext in self.media_config['video']['extensions']])}")
        logging.info("=" * 80)
        
        self.update_db_incremental()
        self._setup_watchdog()
        
        logging.info(f"当前目录: {self.scan_directory}")
        logging.info(f"媒体统计: 总计{len(self.media_db)} | 图片{len([x for x in self.media_db if x['media_type']=='image'])} | 视频{len([x for x in self.media_db if x['media_type']=='video'])}")
        logging.info("优化版服务就绪 | Ctrl+C终止")

# 优化的文件系统事件处理器
class MediaDBHandler(FileSystemEventHandler):
    def __init__(self, media_service):
        self.media_service = media_service
    
    def on_created(self, event):
        if not event.is_directory and any(event.src_path.lower().endswith(ext) for ext in 
            self.media_service.media_config["image"]["extensions"] + self.media_service.media_config["video"]["extensions"]):
            LARGE_FILE_THRESHOLD = 200 * 1024 * 1024  # 200MB阈值
            # 若为大文件，延长等待时间
            if os.path.exists(event.src_path) and os.path.getsize(event.src_path) > LARGE_FILE_THRESHOLD:
                time.sleep(5)  # 大文件等待5秒
            else:
                time.sleep(1.5)  # 普通文件等待1.5秒
            self.media_service.update_db_incremental([event.src_path])

    def on_deleted(self, event):
        if not event.is_directory:
            deleted_path = os.path.normpath(event.src_path)
            self.media_service.media_db = [m for m in self.media_service.media_db if os.path.normpath(m["path"]) != deleted_path]
            logging.info(f"删除媒体: {os.path.basename(deleted_path)}")
            self.media_service._save_config()
            self.media_service._send_update_event()

    def on_modified(self, event):
        if not event.is_directory and any(event.src_path.lower().endswith(ext) for ext in 
            self.media_service.media_config["image"]["extensions"] + self.media_service.media_config["video"]["extensions"]):
            LARGE_FILE_THRESHOLD = 200 * 1024 * 1024
            if os.path.exists(event.src_path) and os.path.getsize(event.src_path) > LARGE_FILE_THRESHOLD:
                time.sleep(3)  # 大文件修改等待3秒
            else:
                time.sleep(1)   # 普通文件修改等待1秒
            self.media_service.update_db_incremental([event.src_path])

if __name__ == "__main__":
    # 确保编码正确
    if not sys.stdout.encoding or sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    if not sys.stderr.encoding or sys.stderr.encoding.lower() != 'utf-8':
        sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    # 创建并启动服务
    media_service = MediaService()
    media_service.init_service()
    
    # 启动服务器
    server = pywsgi.WSGIServer(('127.0.0.1', 9000), media_service.app, handler_class=WebSocketHandler)
    logging.info("服务器启动成功，监听端口 9000")
    server.serve_forever()