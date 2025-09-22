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
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask_cors import CORS
import mimetypes
from pathlib import Path
from gevent import pywsgi
from geventwebsocket.handler import WebSocketHandler
from gevent.pywsgi import WSGIServer
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
        }
    },
)

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

            # 只有在配置确实发生变化时才保存
            new_config = self.save()
            if new_config != original_config:
                logging.info("配置已更新并保存")
            return True
        except Exception as e:
            logging.error(f"配置加载失败，使用默认值: {str(e)}", exc_info=True)
            return False

    def _migrate_config(self, config):
        """配置版本迁移"""
        # 注释掉暂时不需要的迁移模块
        # from .migrators import VersionMigrator_1_1_to_1_2  # 新增迁移器
        current_version = config.get("config_version")
        if current_version != self.config_version:
            pass  # 暂时禁用迁移功能
            # migrator = VersionMigrator_1_1_to_1_2(config)
            # return migrator.execute()
            logging.info(
                f"迁移配置 from {current_version or '未知'} to {self.config_version}"
            )

            # 版本迁移逻辑
            if current_version is None:
                # 从无版本迁移到1.2
                config["config_version"] = self.config_version
                config.setdefault("allowed_origins", self.allowed_origins)
                if "media_config" not in config:
                    config["media_config"] = {
                        "image_max_size_mb": 5,
                        "video_max_size_mb": 100,
                        "image_extensions": list(
                            self.media_config["image"]["extensions"]
                        ),
                        "video_extensions": list(
                            self.media_config["video"]["extensions"]
                        ),
                    }
                # 添加忽略模式
                if "ignore_patterns" not in config:
                    config["ignore_patterns"] = self.ignore_patterns
            elif current_version == "1.1":
                # 从1.1迁移到1.2
                config["config_version"] = self.config_version
                config.setdefault("allowed_origins", self.allowed_origins)
                if "media_config" not in config:
                    config["media_config"] = {
                        "image_max_size_mb": 5,
                        "video_max_size_mb": 100,
                        "image_extensions": list(
                            self.media_config["image"]["extensions"]
                        ),
                        "video_extensions": list(
                            self.media_config["video"]["extensions"]
                        ),
                    }
                # 添加忽略模式
                if "ignore_patterns" not in config:
                    config["ignore_patterns"] = self.ignore_patterns

    def save(self):
        """保存配置到文件"""
        try:
            with self.lock:
                config = {
                    "config_version": self.config_version,
                    "scan_directory": self.scan_directory,
                    "allowed_origins": self.allowed_origins,
                    "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "media_config": {
                        "image_max_size_mb": self.media_config["image"]["max_size"]
                        / 1024
                        / 1024,
                        "video_max_size_mb": self.media_config["video"]["max_size"]
                        / 1024
                        / 1024,
                        "image_extensions": list(
                            self.media_config["image"]["extensions"]
                        ),
                        "video_extensions": list(
                            self.media_config["video"]["extensions"]
                        ),
                    },
                    "ignore_patterns": self.ignore_patterns,
                }
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2, ensure_ascii=False)
            return config
        except Exception as e:
            logging.error(f"配置保存失败: {str(e)}", exc_info=True)
            return {}

    # 安全的getter/setter方法（自动加锁）
    def get_scan_dir(self):
        with self.lock:
            return self.scan_directory

    def set_scan_dir(self, new_dir):
        with self.lock:
            if new_dir and new_dir != self.scan_directory:
                self.scan_directory = new_dir
                return True
            return False

    def get_media_config(self, media_type):
        with self.lock:
            return self.media_config.get(media_type, {}).copy()

    def update_media_size_limit(self, image_max_mb=None, video_max_mb=None):
        with self.lock:
            if image_max_mb is not None and 1 <= image_max_mb <= 50:
                self.media_config["image"]["max_size"] = int(image_max_mb * 1024 * 1024)
            if video_max_mb is not None and 10 <= video_max_mb <= 500:
                self.media_config["video"]["max_size"] = int(video_max_mb * 1024 * 1024)

    def get_mime_type(self, file_ext):
        with self.lock:
            return self.mime_map.get(file_ext.lower())

    def should_ignore(self, filename):
        """检查文件是否应该被忽略"""
        with self.lock:
            for pattern in self.ignore_patterns:
                if fnmatch.fnmatch(filename, pattern):
                    return True
            return False


class MediaState:
    """媒体库状态管理器（线程安全）"""

    def __init__(self):
        self.lock = threading.RLock()
        self.media_db = []  # 存储媒体文件信息
        self.last_scan_time = 0  # 上次扫描时间戳
        self.scan_in_progress = False  # 扫描是否正在进行

    def get_media_list(self, media_type="all", limit=0, offset=0):
        """获取过滤后的媒体列表"""
        with self.lock:
            if media_type == "image":
                filtered = [
                    m.copy() for m in self.media_db if m["media_type"] == "image"
                ]
            elif media_type == "video":
                filtered = [
                    m.copy() for m in self.media_db if m["media_type"] == "video"
                ]
            else:
                filtered = [m.copy() for m in self.media_db]

            # 应用分页
            if limit > 0:
                start = offset
                end = offset + limit
                filtered = filtered[start:end]

            return filtered

    def update_media(self, new_media):
        """更新媒体库（去重+删除无效文件）"""
        with self.lock:
            # 移除已删除的文件
            existing_paths = {
                os.path.normcase(os.path.normpath(m["path"])) for m in self.media_db
            }
            self.media_db = [m for m in self.media_db if os.path.exists(m["path"])]

            # 添加新文件（去重）- 使用规范化路径比较
            current_paths = {
                os.path.normcase(os.path.normpath(m["path"])) for m in self.media_db
            }
            for m in new_media:
                norm_path = os.path.normcase(os.path.normpath(m["path"]))
                if norm_path not in current_paths:
                    self.media_db.append(m)
                    current_paths.add(norm_path)

            # 按修改时间排序（最新的在前）
            self.media_db.sort(key=lambda x: x["last_modified"], reverse=True)

    def remove_media(self, path):
        """移除指定路径的媒体"""
        with self.lock:
            norm_path = os.path.normpath(path)
            self.media_db = [
                m for m in self.media_db if os.path.normpath(m["path"]) != norm_path
            ]

    def set_last_scan_time(self, timestamp):
        with self.lock:
            self.last_scan_time = timestamp

    def get_last_scan_time(self):
        with self.lock:
            return self.last_scan_time

    def set_scan_in_progress(self, status):
        with self.lock:
            self.scan_in_progress = status

    def is_scan_in_progress(self):
        with self.lock:
            return self.scan_in_progress

    def get_counts(self):
        """获取媒体统计数量"""
        with self.lock:
            total = len(self.media_db)
            image = len([m for m in self.media_db if m["media_type"] == "image"])
            video = total - image
            return {"total": total, "image": image, "video": video}

    def cleanup_invalid(self):
        """清理无效媒体（不存在或超大小）"""
        with self.lock:
            initial_count = len(self.media_db)
            valid_media = []
            for media in self.media_db:
                try:
                    if os.path.exists(media["path"]):
                        max_size = config_mgr.get_media_config(media["media_type"]).get(
                            "max_size", 0
                        )
                        file_size = os.path.getsize(media["path"])
                        if file_size <= max_size:
                            valid_media.append(media)
                            continue
                        logging.info(
                            f"超大小清理: {media['name']} ({file_size/1024/1024:.1f}MB)"
                        )
                    else:
                        logging.info(f"不存在清理: {media['name']}")
                except Exception as e:
                    logging.error(f"清理媒体{media['name']}失败: {str(e)}")
                    continue
            self.media_db = valid_media
            return initial_count - len(self.media_db)


# 全局实例化
config_mgr = ConfigManager()
media_state = MediaState()


@app.route("/validate-directory", methods=["POST"])
def validate_directory():
    """验证目录是否有效"""
    try:
        data = request.json or {}
        directory = data.get("path", "")

        if not directory:
            return jsonify({"valid": False, "error": "目录路径为空"})

        if not os.path.exists(directory):
            return jsonify({"valid": False, "error": "目录不存在"})

        if not os.path.isdir(directory):
            return jsonify({"valid": False, "error": "路径不是目录"})

        if not os.access(directory, os.R_OK):
            return jsonify({"valid": False, "error": "无目录读权限"})

        return jsonify({"valid": True, "message": "目录有效"})

    except Exception as e:
        logging.error(f"目录验证错误: {str(e)}", exc_info=True)
        return jsonify({"valid": False, "error": str(e)})


# ------------------------------
# 媒体处理与监控
# ------------------------------
class MediaManager:
    """媒体扫描与类型检测管理器"""

    @staticmethod
    def detect_media_type(file_path, file_name):
        """检测文件真实媒体类型（优先文件头，次选扩展名）"""
        try:
            # 优先通过文件头检测
            mime = magic.from_file(file_path, mime=True)
            if mime.startswith("image/"):
                return "image"
            elif mime.startswith("video/"):
                return "video"

            # 扩展名兜底
            file_lower = file_name.lower()
            image_exts = config_mgr.get_media_config("image").get("extensions", ())
            video_exts = config_mgr.get_media_config("video").get("extensions", ())
            if any(file_lower.endswith(ext) for ext in image_exts):
                return "image"
            elif any(file_lower.endswith(ext) for ext in video_exts):
                return "video"
            return None
        except Exception as e:
            logging.warning(f"类型检测失败 {file_path}: {str(e)}")
            # 纯扩展名检测
            file_lower = file_name.lower()
            image_exts = config_mgr.get_media_config("image").get("extensions", ())
            video_exts = config_mgr.get_media_config("video").get("extensions", ())
            if any(file_lower.endswith(ext) for ext in image_exts):
                return "image"
            elif any(file_lower.endswith(ext) for ext in video_exts):
                return "video"
            return None

    @staticmethod
    def scan_media(full_scan=False):
        """扫描媒体文件（支持增量扫描）"""
        if media_state.is_scan_in_progress():
            logging.info("扫描正在进行中，跳过此次扫描")
            return

        media_state.set_scan_in_progress(True)

        try:
            scan_dir = config_mgr.get_scan_dir()
            if not scan_dir or not os.path.exists(scan_dir):
                logging.warning(f"扫描目录无效: {scan_dir}")
                return

            if not os.access(scan_dir, os.R_OK):
                logging.error(f"无目录读权限: {scan_dir}")
                return

            scan_start_time = time.time()
            logging.info(f"开始{'全量' if full_scan else '增量'}扫描: {scan_dir}")

            # 收集所有支持的扩展名
            image_exts = config_mgr.get_media_config("image").get("extensions", ())
            video_exts = config_mgr.get_media_config("video").get("extensions", ())
            all_extensions = image_exts + video_exts

            new_media = []
            last_scan_time = media_state.get_last_scan_time() if not full_scan else 0

            # 遍历目录
            for root, _, files in os.walk(scan_dir):
                for file in files:
                    # 检查是否应该忽略该文件
                    if config_mgr.should_ignore(file):
                        continue

                    file_lower = file.lower()
                    if any(file_lower.endswith(ext) for ext in all_extensions):
                        try:
                            full_path = os.path.join(root, file)
                            # 安全检查：确保文件在扫描目录内
                            if not full_path.startswith(os.path.abspath(scan_dir)):
                                logging.warning(f"跳过跨目录文件: {full_path}")
                                continue

                            rel_path = os.path.relpath(full_path, scan_dir).replace(
                                "\\", "/"
                            )
                            file_size = os.path.getsize(full_path)
                            last_modified = os.path.getmtime(full_path)

                            # 增量扫描：只处理上次扫描后修改的文件
                            if not full_scan and last_modified <= last_scan_time:
                                continue

                            # 检测媒体类型
                            media_type = MediaManager.detect_media_type(full_path, file)
                            if not media_type:
                                continue

                            # 检查大小限制
                            max_size = config_mgr.get_media_config(media_type).get(
                                "max_size", 0
                            )
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
            WebSocketManager.send_update_event()
        finally:
            media_state.set_scan_in_progress(False)


class FileSystemMonitor(FileSystemEventHandler):
    """文件系统事件监控器"""

    def __init__(self):
        self.observer = None
        self._scan_timer = None
        self._scan_delay = 2  # 默认扫描延迟（秒）
        self._timer_lock = threading.Lock()  # 添加线程锁

    def start_monitoring(self, directory):
        """启动监控"""
        # 先停止现有监控
        self.stop_monitoring()

        if not directory or not os.path.exists(directory):
            logging.warning("监控目录无效，不启动监控")
            return

        try:
            self.observer = Observer()
            self.observer.schedule(self, directory, recursive=True)
            self.observer.start()
            logging.info(f"文件监控启动: {directory}")
        except Exception as e:
            logging.error(f"监控启动失败: {str(e)}", exc_info=True)
            self.observer = None

    def stop_monitoring(self):
        """停止监控（安全释放资源）"""
        if self.observer is not None and self.observer.is_alive():
            try:
                self.observer.stop()
                self.observer.join(timeout=5)  # 等待5秒超时
                if self.observer.is_alive():
                    logging.warning("监控线程未正常退出")
            except Exception as e:
                logging.error(f"监控停止失败: {str(e)}", exc_info=True)
            finally:
                self.observer = None

        # 取消任何待处理的扫描计时器（使用线程锁）
        with self._timer_lock:
            if self._scan_timer is not None and self._scan_timer.is_alive():
                self._scan_timer.cancel()
                self._scan_timer = None

    def _schedule_scan(self, delay=None):
        """安排扫描任务（合并多次事件）"""
        with self._timer_lock:  # 添加线程安全保护
            if self._scan_timer and self._scan_timer.is_alive():
                self._scan_timer.cancel()

            actual_delay = delay if delay is not None else self._scan_delay
            self._scan_timer = threading.Timer(actual_delay, MediaManager.scan_media)
            self._scan_timer.daemon = True
            self._scan_timer.start()

    def on_created(self, event):
        """文件创建事件（延迟扫描，避免文件未写完）"""
        if not event.is_directory:
            try:
                file_size = (
                    os.path.getsize(event.src_path)
                    if os.path.exists(event.src_path)
                    else 0
                )
                # 动态延迟：大文件等待更久（最多10秒）
                delay = min(
                    10, max(1.5, file_size / (100 * 1024 * 1024))
                )  # 100MB/s的写入速度估算
                self._schedule_scan(delay)
            except Exception as e:
                logging.error(f"处理创建事件失败: {str(e)}")

    def on_deleted(self, event):
        """文件删除事件"""
        if not event.is_directory:
            try:
                media_state.remove_media(event.src_path)
                logging.info(f"移除媒体文件: {os.path.basename(event.src_path)}")
                config_mgr.save()
                WebSocketManager.send_update_event()
            except Exception as e:
                logging.error(f"处理删除事件失败: {str(e)}")

    def on_modified(self, event):
        """文件修改事件（延迟扫描）"""
        if not event.is_directory:
            try:
                file_size = (
                    os.path.getsize(event.src_path)
                    if os.path.exists(event.src_path)
                    else 0
                )
                delay = min(5, max(1, file_size / (200 * 1024 * 1024)))  # 200MB/s估算
                self._schedule_scan(delay)
            except Exception as e:
                logging.error(f"处理修改事件失败: {str(e)}")


# 全局监控实例
file_monitor = FileSystemMonitor()


# ------------------------------
# WebSocket管理
# ------------------------------
class WebSocketManager:
    """WebSocket连接管理器（线程安全）"""

    _active_ws = []
    _lock = threading.Lock()
    allowed_origins = config_mgr.allowed_origins

    @classmethod
    def add_connection(cls, ws):
        """添加新连接"""
        with cls._lock:
            cls._active_ws.append(ws)

    @classmethod
    def remove_connection(cls, ws):
        """移除连接"""
        with cls._lock:
            if ws in cls._active_ws:
                cls._active_ws.remove(ws)

    @classmethod
    def send_update_event(cls):
        """发送媒体更新通知"""
        counts = media_state.get_counts()
        message = json.dumps(
            {
                "type": "media_updated",
                "total_count": counts["total"],
                "image_count": counts["image"],
                "video_count": counts["video"],
                "timestamp": time.time(),
            }
        )

        with cls._lock:
            # 创建完全独立的副本，避免迭代中修改列表
            active_ws_copy = list(cls._active_ws)

        # 在锁外处理发送，避免阻塞
        inactive_connections = []
        for ws in active_ws_copy:
            try:
                # 添加超时和心跳检测
                if (
                    not ws.closed
                    and hasattr(ws, "last_activity")
                    and (time.time() - ws.last_activity < 60)
                ):
                    ws.send(message)
                else:
                    inactive_connections.append(ws)
            except Exception as e:
                logging.error(f"WebSocket发送失败: {str(e)}")
                inactive_connections.append(ws)

        # 清理不活跃连接
        if inactive_connections:
            with cls._lock:
                cls._active_ws = [
                    ws for ws in cls._active_ws if ws not in inactive_connections
                ]

    @classmethod
    def cleanup_inactive(cls):
        """清理无效连接（心跳检测）"""
        with cls._lock:
            cls._active_ws = [ws for ws in cls._active_ws if not ws.closed]


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

        if not full_path.startswith(os.path.normcase(scan_dir)):
            logging.warning(f"路径越界尝试: {rel_path} → {full_path}")
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
                mime_type = f"image/{file_ext[1:]}"
            elif file_ext.lower() in video_exts:
                mime_type = f"video/{file_ext[1:]}"
            else:
                # 使用更通用的MIME类型作为最后手段
                mime_type = "application/octet-stream"
                logging.warning(f"无法确定文件类型 {file_ext}，使用通用类型")

        # 视频断点续传处理
        range_header = request.headers.get("Range")
        if range_header and mime_type.startswith("video/"):
            file_size = os.path.getsize(full_path)
            range_val = range_header.split("=")[1]
            if "-" in range_val:
                start, end = range_val.split("-")
                start = int(start) if start else 0
                end = int(end) if end else file_size - 1
            else:
                start = int(range_val)
                end = file_size - 1

            length = end - start + 1

            with open(full_path, "rb") as f:
                f.seek(start)
                data = f.read(length)

            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
                "Content-Type": mime_type,
            }
            return data, 206, headers

        # 普通文件传输
        logging.debug(f"服务媒体: {full_path} (MIME: {mime_type})")
        return send_file(
            full_path,
            mimetype=mime_type,
            as_attachment=False,
            conditional=True,
            last_modified=os.path.getmtime(full_path),
        )
    except Exception as e:
        logging.error(f"文件访问错误 {rel_path}: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/cleanup", methods=["POST"])
def cleanup_media():
    """清理无效媒体"""
    try:
        removed = media_state.cleanup_invalid()
        counts = media_state.get_counts()
        config_mgr.save()
        WebSocketManager.send_update_event()

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


# 兼容前端WebSocket路径请求
@app.route("/socket.io/", methods=["GET"])
@app.route("/socket.io", methods=["GET"])
@app.route("/ws", methods=["GET"])
def websocket_endpoint():
    """WebSocket连接端点（支持多路径兼容）"""
    ws = request.environ.get("wsgi.websocket")
    if not ws:
        return "需要WebSocket连接", 400

    # 握手阶段验证Origin
    origin = request.environ.get("HTTP_ORIGIN")
    if origin not in WebSocketManager.allowed_origins:
        ws.close(code=4001, reason="Origin not allowed")
        return

    WebSocketManager.add_connection(ws)
    try:
        # 发送初始化消息
        counts = media_state.get_counts()
        init_msg = json.dumps(
            {
                "type": "init",
                "total_count": counts["total"],
                "image_count": counts["image"],
                "video_count": counts["video"],
            }
        )
        ws.send(init_msg)

        while True:
            message = ws.receive()
            if message is None:  # 连接关闭
                break

            try:
                msg = json.loads(message)
                if msg.get("type") == "ping":
                    ws.send(json.dumps({"type": "pong", "timestamp": time.time()}))
                elif msg.get("type") == "filter_media":
                    media_type = msg.get("media_type", "all")
                    filtered = len(media_state.get_media_list(media_type))
                    ws.send(json.dumps({"type": "filtered_media", "count": filtered}))
            except json.JSONDecodeError:
                logging.warning("收到无效的WebSocket消息")
                ws.send(json.dumps({"type": "error", "message": "无效消息格式"}))
            except Exception as e:
                logging.error(f"处理WebSocket消息错误: {str(e)}")
                break

    except Exception as e:
        logging.error(f"WebSocket错误: {str(e)}")
    finally:
        WebSocketManager.remove_connection(ws)
    return ""


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
                    config_mgr.media_config["image"]["max_size"] = int(
                        media_cfg["image_max_size_mb"] * 1024 * 1024
                    )
                if "video_max_size_mb" in media_cfg:
                    config_mgr.media_config["video"]["max_size"] = int(
                        media_cfg["video_max_size_mb"] * 1024 * 1024
                    )
            # 更新忽略模式
            if "ignore_patterns" in data:
                config_mgr.ignore_patterns = data["ignore_patterns"]

            config_mgr.save()
            return jsonify({"status": "配置已更新"})
        except Exception as e:
            logging.error(f"配置更新错误: {str(e)}", exc_info=True)
            return jsonify({"error": str(e)}), 500
    else:
        # 获取当前配置
        return jsonify(config_mgr.save())


# ------------------------------
# 程序入口
# ------------------------------
def main():
    # 初始化配置
    config_mgr.load()
    # 启动文件监控
    file_monitor.start_monitoring(config_mgr.get_scan_dir())

    # 启动WebSocket心跳清理线程
    def ws_cleanup_loop():
        while True:
            WebSocketManager.cleanup_inactive()
            time.sleep(30)

    threading.Thread(target=ws_cleanup_loop, daemon=True).start()

    # 启动初始扫描
    threading.Thread(
        target=MediaManager.scan_media, kwargs={"full_scan": True}, daemon=True
    ).start()

    # 打印启动信息
    logging.info("=" * 80)
    logging.info("本地媒体服务启动（支持图片+视频）")
    logging.info("服务地址: http://127.0.0.1:9001")
    img_cfg = config_mgr.get_media_config("image")
    video_cfg = config_mgr.get_media_config("video")
    logging.info(
        f"图片限制: {img_cfg['max_size']/1024/1024:.1f}MB | 视频限制: {video_cfg['max_size']/1024/1024:.1f}MB"
    )
    logging.info(
        f"图片格式: {', '.join([ext[1:].upper() for ext in img_cfg['extensions']])}"
    )
    logging.info(
        f"视频格式: {', '.join([ext[1:].upper() for ext in video_cfg['extensions']])}"
    )
    logging.info(f"当前扫描目录: {config_mgr.get_scan_dir()}")
    logging.info("=" * 80)

    # 启动服务器
    # 修改服务启动配置
    server = pywsgi.WSGIServer(("0.0.0.0", 9001), app, handler_class=WebSocketHandler)

    # 添加端口检测
    import socket

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if sock.connect_ex(("localhost", 9001)) == 0:
        logging.error("端口9001已被占用，请使用其他端口")
        sys.exit(1)
    sock.close()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("服务被手动终止")
    finally:
        file_monitor.stop_monitoring()  # 确保监控资源释放


if __name__ == "__main__":
    main()
