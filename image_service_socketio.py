#!/usr/bin/env python3
"""
使用Flask-SocketIO的媒体服务版本
解决gevent-websocket兼容性问题
"""

import os
import sys
import json
import time
import random
import logging
import logging.handlers
import threading
import urllib.parse
from wsgiref.simple_server import make_server
from flask import Flask, jsonify, request, send_file
from flask_socketio import SocketIO
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask_cors import CORS
import mimetypes
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Set, Any
import fnmatch

# 添加资源路径检测
if getattr(sys, "frozen", False):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = Path(__file__).resolve().parent
# 加载环境变量
from dotenv import load_dotenv

load_dotenv(BASE_DIR / ".env")

# ------------------------------
# 基础配置与初始化
# ------------------------------
# 设置编码
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.getfilesystemencoding = lambda: "utf-8"

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key'

# CORS配置 - 允许SillyTavern前端访问
cors = CORS(
    app,
    resources={
        r"/*": {
            "origins": os.getenv(
                "CORS_ORIGINS",
                "http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:9001,http://localhost:9001",
            ).split(","),
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"],
            "expose_headers": ["X-Request-ID"],
            "supports_credentials": True,
        }
    },
)

socketio = SocketIO(app, async_mode='threading', cors_allowed_origins=os.getenv(
    "CORS_ORIGINS",
    "http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:9001,http://localhost:9001"
).split(","))

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(threadName)s] %(levelname)s - %(module)s:%(lineno)d - %(message)s",
    encoding="utf-8",
    handlers=[
        logging.StreamHandler(),
        logging.handlers.RotatingFileHandler(
            filename="image_service.log",
            encoding="utf-8",
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
        ),
    ],
)

# 添加额外的MIME类型映射
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("video/x-matroska", ".mkv")

# ------------------------------
# 核心状态与配置管理（封装全局变量）
# ------------------------------
class ConfigManager:
    __slots__ = [
        "lock",
        "config_file",
        "config_version",
        "scan_directory",
        "allowed_origins",
        "media_config",
        "mime_map",
        "ignore_patterns",
        "_thread_map",
    ]

    def __init__(self):
        self.lock = threading.RLock()
        self._thread_map = {}
        self.config_file = "local_image_service_config.json"
        self.config_version = "1.2"
        self.scan_directory = ""  # 清空默认目录
        self.allowed_origins = [
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:9001",
            "http://127.0.0.1:9001",
        ]
        # 媒体配置
        self.media_config = {
            "image": {
                "extensions": (
                    ".png",
                    ".jpg",
                    ".jpeg",
                    ".gif",
                    ".bmp",
                    ".webp",
                    ".apng",
                    ".tiff",
                    ".tif",
                ),
                "max_size": 5 * 1024 * 1024,  # 5MB
            },
            "video": {
                "extensions": (
                    ".webm",
                    ".mp4",
                    ".ogv",
                    ".mov",
                    ".avi",
                    ".mkv",
                    ".m4v",
                    ".wmv",
                ),
                "max_size": 100 * 1024 * 1024,  # 100MB
            },
        }
        # MIME类型映射（补充视频类型）
        self.mime_map = {
            ".apng": "image/apng",
            ".webp": "image/webp",
            ".webm": "video/webm",
            ".mp4": "video/mp4",
            ".ogv": "video/ogg",
            ".mov": "video/quicktime",
            ".avi": "video/x-msvideo",
            ".mkv": "video/x-matroska",
            ".m4v": "video/x-m4v",
            ".wmv": "video/x-ms-wmv",
            ".tiff": "image/tiff",
            ".tif": "image/tiff",
        }
        # 忽略的文件模式
        self.ignore_patterns = [".*", "~*", "Thumbs.db", "desktop.ini"]

    @staticmethod
    def _get_default_scan_dir():
        return ""  # 返回空字符串

    def load(self):
        if not self.scan_directory:
            logging.error("请在前端配置扫描目录")
        try:
            if not os.path.exists(self.config_file):
                self.save()  # 生成默认配置
                return True

            with open(self.config_file, "r", encoding="utf-8") as f:
                raw_config = json.load(f)

            # 保存原始配置用于比较
            original_config = self.save()

            self._migrate_config(raw_config)  # 处理旧版本配置

            # 更新配置
            with self.lock:
                self.scan_directory = raw_config.get(
                    "scan_directory", self.scan_directory
                )
                self.allowed_origins = raw_config.get(
                    "allowed_origins", self.allowed_origins
                )
                # 更新媒体配置
                if "media_config" in raw_config:
                    media_cfg = raw_config["media_config"]
                    self.media_config["image"]["max_size"] = int(
                        media_cfg.get("image_max_size_mb", 5) * 1024 * 1024
                    )
                    self.media_config["video"]["max_size"] = int(
                        media_cfg.get("video_max_size_mb", 100) * 1024 * 1024
                    )
                    if "image_extensions" in media_cfg:
                        self.media_config["image"]["extensions"] = tuple(
                            media_cfg["image_extensions"]
                        )
                    if "video_extensions" in media_cfg:
                        self.media_config["video"]["extensions"] = tuple(
                            media_cfg["video_extensions"]
                        )
                # 更新忽略模式
                if "ignore_patterns" in raw_config:
                    self.ignore_patterns = raw_config["ignore_patterns"]

            # 检查配置是否变更
            new_config = self.save()
            if original_config != new_config:
                logging.info("配置已更新")
                self.save()

            return True
        except Exception as e:
            logging.error(f"加载配置失败: {str(e)}", exc_info=True)
            return False

    def save(self):
        """保存当前配置到文件"""
        config = {
            "config_version": self.config_version,
            "scan_directory": self.scan_directory,
            "allowed_origins": self.allowed_origins,
            "media_config": {
                "image_max_size_mb": self.media_config["image"]["max_size"]
                / 1024
                / 1024,
                "video_max_size_mb": self.media_config["video"]["max_size"]
                / 1024
                / 1024,
                "image_extensions": list(self.media_config["image"]["extensions"]),
                "video_extensions": list(self.media_config["video"]["extensions"]),
            },
            "ignore_patterns": self.ignore_patterns,
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
        }

        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            return config
        except Exception as e:
            logging.error(f"保存配置失败: {str(e)}", exc_info=True)
            return {}

    def _migrate_config(self, config):
        """迁移旧版本配置"""
        version = config.get("config_version", "1.0")
        if version == "1.0":
            # 从1.0迁移到1.2
            if "image_max_size" in config:
                config["media_config"] = {
                    "image_max_size_mb": config["image_max_size"] / 1024 / 1024,
                    "video_max_size_mb": 100,  # 默认值
                    "image_extensions": list(
                        self.media_config["image"]["extensions"]
                    ),
                    "video_extensions": list(
                        self.media_config["video"]["extensions"]
                    ),
                }
                del config["image_max_size"]
            config["config_version"] = "1.2"

    def get_scan_dir(self):
        """获取扫描目录"""
        with self.lock:
            return self.scan_directory

    def set_scan_dir(self, new_dir):
        """设置扫描目录"""
        with self.lock:
            if new_dir and os.path.exists(new_dir) and os.path.isdir(new_dir):
                if new_dir != self.scan_directory:
                    self.scan_directory = new_dir
                    self.save()
                    return True
            return False

    def get_media_config(self, media_type):
        """获取媒体配置"""
        with self.lock:
            return self.media_config.get(media_type, {})

    def update_media_size_limit(self, image_max_mb=None, video_max_mb=None):
        """更新媒体大小限制"""
        with self.lock:
            if image_max_mb is not None:
                self.media_config["image"]["max_size"] = int(image_max_mb * 1024 * 1024)
            if video_max_mb is not None:
                self.media_config["video"]["max_size"] = int(video_max_mb * 1024 * 1024)
            self.save()

    def get_mime_type(self, ext):
        """获取MIME类型"""
        with self.lock:
            return self.mime_map.get(ext.lower())


# 全局配置实例
config_mgr = ConfigManager()


class MediaState:
    """媒体库状态管理器（线程安全）"""

    def __init__(self):
        self.lock = threading.RLock()
        self.media_db = []  # 存储媒体文件信息
        self.last_scan_time = 0  # 上次扫描时间戳
        self.scan_in_progress = False  # 扫描是否正在进行

    def update_media(self, new_media):
        """更新媒体库"""
        with self.lock:
            self.media_db = new_media
            self.last_scan_time = time.time()

    def get_media_list(self, media_type="all", limit=0, offset=0):
        """获取媒体列表"""
        with self.lock:
            if media_type == "all":
                filtered = self.media_db
            else:
                filtered = [m for m in self.media_db if m["media_type"] == media_type]

            # 应用分页
            if limit > 0:
                start = offset
                end = offset + limit
                return filtered[start:end]
            return filtered

    def get_counts(self):
        """获取各类媒体数量"""
        with self.lock:
            total = len(self.media_db)
            images = len([m for m in self.media_db if m["media_type"] == "image"])
            videos = len([m for m in self.media_db if m["media_type"] == "video"])
            return {"total": total, "image": images, "video": videos}

    def remove_media(self, file_path):
        """移除指定媒体文件"""
        with self.lock:
            self.media_db = [
                m for m in self.media_db if m["path"] != file_path
            ]

    def cleanup_invalid(self):
        """清理无效媒体（文件不存在）"""
        with self.lock:
            original_count = len(self.media_db)
            valid_media = []
            removed = 0

            for media in self.media_db:
                if os.path.exists(media["path"]):
                    valid_media.append(media)
                else:
                    removed += 1

            self.media_db = valid_media
            return removed

    def set_last_scan_time(self, timestamp):
        """设置上次扫描时间"""
        with self.lock:
            self.last_scan_time = timestamp

    def set_scan_in_progress(self, in_progress):
        """设置扫描状态"""
        with self.lock:
            self.scan_in_progress = in_progress

    def is_scan_in_progress(self):
        """检查是否正在扫描"""
        with self.lock:
            return self.scan_in_progress


# 全局媒体状态实例
media_state = MediaState()


class MediaManager:
    """媒体文件管理（扫描、验证等）"""

    @staticmethod
    def scan_media(full_scan=False):
        """扫描媒体文件"""
        scan_dir = config_mgr.get_scan_dir()
        if not scan_dir or not os.path.exists(scan_dir):
            logging.error(f"扫描目录无效: {scan_dir}")
            return

        media_state.set_scan_in_progress(True)
        scan_start_time = time.time()
        logging.info(f"开始{'全量' if full_scan else '增量'}扫描: {scan_dir}")

        try:
            new_media = []
            image_cfg = config_mgr.get_media_config("image")
            video_cfg = config_mgr.get_media_config("video")

            for root, dirs, files in os.walk(scan_dir):
                # 跳过隐藏目录
                dirs[:] = [d for d in dirs if not d.startswith(".")]

                for file in files:
                    # 检查忽略模式
                    if any(fnmatch.fnmatch(file, pattern) for pattern in config_mgr.ignore_patterns):
                        continue

                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, scan_dir)

                    # 确定媒体类型
                    file_ext = os.path.splitext(file)[1].lower()
                    media_type = None
                    max_size = 0

                    if file_ext in image_cfg["extensions"]:
                        media_type = "image"
                        max_size = image_cfg["max_size"]
                    elif file_ext in video_cfg["extensions"]:
                        media_type = "video"
                        max_size = video_cfg["max_size"]

                    if media_type:
                        try:
                            file_size = os.path.getsize(full_path)
                            last_modified = os.path.getmtime(full_path)

                            # 检查大小限制
                            if max_size > 0 and file_size > max_size:
                                logging.debug(
                                    f"文件超大小限制 {file}: {file_size/1024/1024:.2f}MB > {max_size/1024/1024:.2f}MB"
                                )
                                continue

                            new_media.append(
                                {
                                    "path": full_path,
                                    "rel_path": rel_path,
                                    "name": file,
                                    "size": file_size,
                                    "media_type": media_type,
                                    "last_modified": last_modified,
                                }
                            )
                        except Exception as e:
                            logging.error(
                                f"处理文件错误 {file}: {str(e)}", exc_info=True
                            )

            # 更新媒体库
            media_state.update_media(new_media)
            media_state.set_last_scan_time(scan_start_time)
            counts = media_state.get_counts()
            logging.info(
                f"扫描完成: 总计{counts['total']}个（图片{counts['image']} | 视频{counts['video']}）"
            )

            # 保存配置并通知WebSocket客户端
            config_mgr.save()
            socketio.emit('media_updated', {
                'type': 'media_updated',
                'total_count': counts['total'],
                'image_count': counts['image'],
                'video_count': counts['video'],
                'timestamp': time.time()
            })
        finally:
            media_state.set_scan_in_progress(False)


class FileSystemMonitor(FileSystemEventHandler):
    """文件系统监控处理器"""

    def __init__(self):
        self.observer = None

    def on_created(self, event):
        """文件创建事件"""
        if not event.is_directory:
            try:
                scan_dir = config_mgr.get_scan_dir()
                full_path = event.src_path
                rel_path = os.path.relpath(full_path, scan_dir)

                # 确定媒体类型
                file_ext = os.path.splitext(full_path)[1].lower()
                image_cfg = config_mgr.get_media_config("image")
                video_cfg = config_mgr.get_media_config("video")

                if file_ext in image_cfg["extensions"] or file_ext in video_cfg["extensions"]:
                    file_size = os.path.getsize(full_path)
                    last_modified = os.path.getmtime(full_path)

                    # 检查大小限制
                    max_size = image_cfg["max_size"] if file_ext in image_cfg["extensions"] else video_cfg["max_size"]
                    if max_size > 0 and file_size > max_size:
                        logging.debug(f"文件超大小限制: {os.path.basename(full_path)}")
                        return

                    # 添加到媒体库
                    media_type = "image" if file_ext in image_cfg["extensions"] else "video"
                    new_media = {
                        "path": full_path,
                        "rel_path": rel_path,
                        "name": os.path.basename(full_path),
                        "size": file_size,
                        "media_type": media_type,
                        "last_modified": last_modified,
                    }

                    with media_state.lock:
                        media_state.media_db.append(new_media)

                    logging.info(f"新增媒体文件: {os.path.basename(full_path)}")
                    config_mgr.save()
                    socketio.emit('media_updated', {
                        'type': 'media_updated',
                        'total_count': media_state.get_counts()['total'],
                        'image_count': media_state.get_counts()['image'],
                        'video_count': media_state.get_counts()['video'],
                        'timestamp': time.time()
                    })
            except Exception as e:
                logging.error(f"处理创建事件失败: {str(e)}")

    def on_deleted(self, event):
        """文件删除事件"""
        if not event.is_directory:
            try:
                media_state.remove_media(event.src_path)
                logging.info(f"移除媒体文件: {os.path.basename(event.src_path)}")
                config_mgr.save()
                socketio.emit('media_updated', {
                    'type': 'media_updated',
                    'total_count': media_state.get_counts()['total'],
                    'image_count': media_state.get_counts()['image'],
                    'video_count': media_state.get_counts()['video'],
                    'timestamp': time.time()
                })
            except Exception as e:
                logging.error(f"处理删除事件失败: {str(e)}")

    def start_monitoring(self, directory):
        """启动目录监控"""
        self.stop_monitoring()

        if directory and os.path.exists(directory):
            self.observer = Observer()
            self.observer.schedule(self, directory, recursive=True)
            self.observer.start()
            logging.info(f"开始监控目录: {directory}")

    def stop_monitoring(self):
        """停止目录监控"""
        if self.observer:
            self.observer.stop()
            self.observer.join()
            self.observer = None
            logging.info("停止目录监控")


# 全局监控实例
file_monitor = FileSystemMonitor()


# ------------------------------
# SocketIO事件处理
# ------------------------------
@socketio.on('connect')
def handle_connect():
    """处理客户端连接"""
    print('客户端连接成功')
    
    # 发送初始化消息
    counts = media_state.get_counts()
    socketio.emit('init', {
        'type': 'init',
        'total_count': counts['total'],
        'image_count': counts['image'],
        'video_count': counts['video']
    })

@socketio.on('disconnect')
def handle_disconnect():
    """处理客户端断开连接"""
    print('客户端断开连接')

@socketio.on('ping')
def handle_ping(data):
    """处理心跳消息"""
    socketio.emit('pong', {'type': 'pong', 'timestamp': time.time()})

@socketio.on('filter_media')
def handle_filter_media(data):
    """处理媒体筛选请求"""
    media_type = data.get('media_type', 'all')
    filtered = len(media_state.get_media_list(media_type))
    socketio.emit('filtered_media', {'type': 'filtered_media', 'count': filtered})


# ------------------------------
# REST API接口
# ------------------------------
@app.route("/validate-directory", methods=["POST", "OPTIONS"])
def validate_directory():
    """验证目录路径是否有效"""
    try:
        # 处理OPTIONS预检请求
        if request.method == "OPTIONS":
            response = jsonify({"status": "ok"})
            response.headers.add("Access-Control-Allow-Origin", request.headers.get("Origin", "*"))
            response.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
            response.headers.add("Access-Control-Allow-Headers", "Content-Type, Authorization")
            return response
        
        data = request.json or {}
        directory_path = data.get("path", "")
        
        if not directory_path:
            return jsonify({"valid": False, "error": "目录路径不能为空"}), 400
        
        # 检查目录是否存在
        if not os.path.exists(directory_path):
            return jsonify({"valid": False, "error": f"目录不存在: {directory_path}"}), 404
        
        # 检查是否为目录
        if not os.path.isdir(directory_path):
            return jsonify({"valid": False, "error": f"路径不是目录: {directory_path}"}), 400
        
        # 检查目录可读性
        try:
            test_file = os.path.join(directory_path, ".test_access")
            with open(test_file, "w") as f:
                f.write("test")
            os.remove(test_file)
        except PermissionError:
            return jsonify({"valid": False, "error": f"无权限访问目录: {directory_path}"}), 403
        except Exception:
            return jsonify({"valid": False, "error": f"目录不可写: {directory_path}"}), 403
        
        return jsonify({"valid": True, "message": "目录验证成功"})
        
    except Exception as e:
        logging.error(f"目录验证接口错误: {str(e)}", exc_info=True)
        return jsonify({"valid": False, "error": str(e)}), 500

@app.route("/scan", methods=["POST"])
def trigger_scan():
    """触发媒体扫描（支持更新目录和大小限制）"""
    try:
        data = request.json or {}
        new_dir = data.get("path", config_mgr.get_scan_dir())
        image_max_mb = data.get("image_max_mb")
        video_max_mb = data.get("video_max_mb")

        # 更新大小限制
        config_mgr.update_media_size_limit(image_max_mb, video_max_mb)

        # 更新扫描目录（如需要）
        dir_updated = config_mgr.set_scan_dir(new_dir)
        if dir_updated:
            file_monitor.start_monitoring(new_dir)  # 重启监控

        # 启动后台扫描（全量）
        threading.Thread(
            target=MediaManager.scan_media, kwargs={"full_scan": True}, daemon=True
        ).start()
        return jsonify({"status": "扫描已启动", "directory": new_dir})
    except Exception as e:
        logging.error(f"扫描接口错误: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/media", methods=["GET"])
def get_media():
    """获取媒体列表"""
    try:
        media_type = request.args.get("type", "all")
        limit = int(request.args.get("limit", 0))
        offset = int(request.args.get("offset", 0))

        media_list = media_state.get_media_list(media_type, limit, offset)
        counts = media_state.get_counts()

        # 添加分页信息
        pagination = {
            "total": (
                counts["total"]
                if media_type == "all"
                else len(media_state.get_media_list(media_type))
            ),
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < counts["total"] if limit > 0 else False,
        }

        return jsonify(
            {
                "media": media_list,
                "total_count": counts["total"],
                "filtered_count": len(media_list),
                "image_count": counts["image"],
                "video_count": counts["video"],
                "last_updated": config_mgr.save().get("last_updated", ""),
                "pagination": pagination,
            }
        )
    except Exception as e:
        logging.error(f"媒体列表接口错误: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/random-media", methods=["GET"])
def get_random_media():
    """获取随机媒体"""
    try:
        media_type = request.args.get("type", "all").lower()
        candidates = media_state.get_media_list(media_type)

        if not candidates:
            return jsonify({"status": "error", "message": f"无{media_type}媒体"}), 404

        media = random.choice(candidates)
        return jsonify(
            {
                "url": f"/media/{urllib.parse.quote(media['rel_path'])}",
                "name": media["name"],
                "size": media["size"],
                "media_type": media["media_type"],
                "last_modified": time.strftime(
                    "%Y-%m-%d %H:%M:%S", time.localtime(media["last_modified"])
                ),
            }
        )
    except Exception as e:
        logging.error(f"随机媒体接口错误: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/media/<path:rel_path>", methods=["GET"])
# 增强路径校验
def get_media_file(rel_path):
    try:
        # 解码并规范化路径
        rel_path = urllib.parse.unquote(rel_path)
        scan_dir = os.path.realpath(config_mgr.get_scan_dir())
        full_path = os.path.normpath(os.path.join(scan_dir, rel_path))

        # 多重安全检查
        if not os.path.exists(full_path):
            logging.warning(f"文件不存在: {rel_path}")
            return jsonify({"error": "文件不存在"}), 404

        if not os.path.isfile(full_path):
            logging.warning(f"非法文件类型: {rel_path}")
            return jsonify({"error": "路径不合法"}), 403

        if not os.path.normcase(full_path).startswith(os.path.normcase(scan_dir)):
            logging.warning(f"路径越界尝试: {rel_path} → {full_path} (scan_dir: {scan_dir})")
            return jsonify({"error": "路径不合法"}), 403

        # 新增符号链接检查
        if os.path.islink(full_path):
            logging.warning(f"拒绝符号链接访问: {rel_path}")
            return jsonify({"error": "非法文件类型"}), 403

        if not os.path.exists(full_path) or not os.path.isfile(full_path):
            return jsonify({"error": "文件不存在"}), 404

        # 确定MIME类型
        file_ext = os.path.splitext(full_path)[1].lower()
        mime_type = (
            config_mgr.get_mime_type(file_ext) or mimetypes.guess_type(full_path)[0]
        )
        if not mime_type:
            # 更健壮的MIME类型回退逻辑
            image_exts = config_mgr.get_media_config("image").get("extensions", ())
            video_exts = config_mgr.get_media_config("video").get("extensions", ())

            if file_ext.lower() in image_exts:
                mime_type = "image/jpeg"  # 默认图片类型
            elif file_ext.lower() in video_exts:
                mime_type = "video/mp4"  # 默认视频类型
            else:
                mime_type = "application/octet-stream"

        return send_file(full_path, mimetype=mime_type)
    except Exception as e:
        logging.error(f"媒体文件接口错误: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/cleanup", methods=["POST"])
def cleanup_media():
    """清理无效媒体"""
    try:
        removed = media_state.cleanup_invalid()
        counts = media_state.get_counts()
        config_mgr.save()
        socketio.emit('media_updated', {
            'type': 'media_updated',
            'total_count': counts['total'],
            'image_count': counts['image'],
            'video_count': counts['video'],
            'timestamp': time.time()
        })

        return jsonify(
            {
                "status": "success",
                "removed": removed,
                "remaining_total": counts["total"],
                "remaining_image": counts["image"],
                "remaining_video": counts["video"],
            }
        )
    except Exception as e:
        logging.error(f"清理接口错误: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/status", methods=["GET"])
def service_status():
    """获取服务状态"""
    try:
        config = config_mgr.save()
        counts = media_state.get_counts()
        return jsonify(
            {
                "active": True,
                "observer_active": (
                    file_monitor.observer and file_monitor.observer.is_alive()
                ),
                "scan_in_progress": media_state.is_scan_in_progress(),
                "directory": config_mgr.get_scan_dir(),
                "total_count": counts["total"],
                "image_count": counts["image"],
                "video_count": counts["video"],
                "last_updated": config.get("last_updated", "未知"),
                "media_config": config.get("media_config", {}),
            }
        )
    except Exception as e:
        logging.error(f"状态接口错误: {str(e)}", exc_info=True)
        return jsonify({"active": False, "error": str(e)}), 500


@app.route("/config", methods=["GET", "POST"])
def handle_config():
    """配置管理接口"""
    if request.method == "POST":
        try:
            data = request.json or {}
            # 更新CORS域名
            if "allowed_origins" in data and isinstance(data["allowed_origins"], list):
                config_mgr.allowed_origins = data["allowed_origins"]
            # 更新媒体格式
            if "media_config" in data:
                media_cfg = data["media_config"]
                if "image_extensions" in media_cfg:
                    config_mgr.media_config["image"]["extensions"] = tuple(
                        media_cfg["image_extensions"]
                    )
                if "video_extensions" in media_cfg:
                    config_mgr.media_config["video"]["extensions"] = tuple(
                        media_cfg["video_extensions"]
                    )
                # 更新大小限制
                if "image_max_size_mb" in media_cfg:
                    config_mgr.media_config["image"]["max_size"] = int(media_cfg["image_max_size_mb"] * 1024 * 1024)
                if "video_max_size_mb" in media_cfg:
                    config_mgr.media_config["video"]["max_size"] = int(media_cfg["video_max_size_mb"] * 1024 * 1024)
            # 更新忽略模式
            if "ignore_patterns" in data:
                config_mgr.ignore_patterns = data["ignore_patterns"]
            config_mgr.save()
            return jsonify({"status": "配置已更新"})
        except Exception as e:
            logging.error(f"配置更新错误: {str(e)}", exc_info=True)
            return jsonify({"error": str(e)}), 500
    else:
        # GET请求返回当前配置
        config = config_mgr.save()
        return jsonify(config)


@app.route("/health", methods=["GET"])
def health_check():
    """健康检查接口"""
    return jsonify({"status": "healthy", "timestamp": time.time()})


# ------------------------------
# 启动与初始化
# ------------------------------
def initialize_service():
    """初始化服务"""
    logging.info("正在初始化媒体服务...")
    
    # 加载配置
    if not config_mgr.load():
        logging.warning("配置加载失败，使用默认配置")
    
    # 启动文件监控
    scan_dir = config_mgr.get_scan_dir()
    if scan_dir and os.path.exists(scan_dir):
        file_monitor.start_monitoring(scan_dir)
        # 启动初始扫描
        threading.Thread(
            target=MediaManager.scan_media, kwargs={"full_scan": True}, daemon=True
        ).start()
    else:
        logging.warning("扫描目录未配置或不存在，请在前端设置")
    
    logging.info("媒体服务初始化完成")


if __name__ == "__main__":
    try:
        initialize_service()
        logging.info("启动Flask-SocketIO服务器 (端口: 9000)")
        socketio.run(app, host="0.0.0.0", port=9000, debug=False, use_reloader=False)
    except KeyboardInterrupt:
        logging.info("服务被用户中断")
    except Exception as e:
        logging.error(f"服务启动失败: {str(e)}", exc_info=True)
    finally:
        file_monitor.stop_monitoring()
        logging.info("服务已停止")