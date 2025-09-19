import os
import sys
import json
import time
import random
import logging
import threading
import urllib.parse
from wsgiref.simple_server import make_server
from flask import Flask, jsonify, request, send_file
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask_cors import CORS
import mimetypes
import magic
from gevent import pywsgi
from geventwebsocket.handler import WebSocketHandler
from pywsgi import WSGIServer


# ------------------------------
# 基础配置与初始化
# ------------------------------
# 设置编码
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.getfilesystemencoding = lambda: "utf-8"

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": []}})  # 动态配置CORS

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(module)s:%(lineno)d - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("image_service.log", encoding="utf-8"),
    ],
)


# ------------------------------
# 核心状态与配置管理（封装全局变量）
# ------------------------------
class ConfigManager:
    """配置管理器（线程安全）"""

    def __init__(self):
        self.lock = threading.RLock()  # 可重入锁，支持嵌套调用
        self.config_file = "local_image_service_config.json"
        self.config_version = "1.1"
        self.scan_directory = self._get_default_scan_dir()
        self.allowed_origins = ["http://localhost:8000", "http://127.0.0.1:8000"]
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
                ),
                "max_size": 5 * 1024 * 1024,  # 5MB
            },
            "video": {
                "extensions": (".webm", ".mp4", ".ogv", ".mov", ".avi", ".mkv"),
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
        }

    @staticmethod
    def _get_default_scan_dir():
        """获取系统默认下载目录"""
        if os.name == "nt":
            return os.path.join(os.environ.get("USERPROFILE", ""), "Downloads")
        else:
            return os.path.expanduser("~/Downloads")

    def load(self):
        """加载配置文件"""
        try:
            if not os.path.exists(self.config_file):
                self.save()  # 生成默认配置
                return True

            with open(self.config_file, "r", encoding="utf-8") as f:
                raw_config = json.load(f)
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
                        media_cfg["image_max_size_mb"] * 1024 * 1024
                    )
                    self.media_config["video"]["max_size"] = int(
                        media_cfg["video_max_size_mb"] * 1024 * 1024
                    )
                    if "image_extensions" in media_cfg:
                        self.media_config["image"]["extensions"] = tuple(
                            media_cfg["image_extensions"]
                        )
                    if "video_extensions" in media_cfg:
                        self.media_config["video"]["extensions"] = tuple(
                            media_cfg["video_extensions"]
                        )
            self.save()  # 保存迁移后的配置
            return True
        except Exception as e:
            logging.error(f"配置加载失败，使用默认值: {str(e)}", exc_info=True)
            return False

    def _migrate_config(self, config):
        """配置版本迁移"""
        if config.get("config_version") != self.config_version:
            logging.info(
                f"迁移配置 from {config.get('config_version') or '未知'} to {self.config_version}"
            )
            if "config_version" not in config:
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
            return self.media_config.get(media_type, {})

    def update_media_size_limit(self, image_max_mb=None, video_max_mb=None):
        with self.lock:
            if image_max_mb is not None and 1 <= image_max_mb <= 50:
                self.media_config["image"]["max_size"] = int(image_max_mb * 1024 * 1024)
            if video_max_mb is not None and 10 <= video_max_mb <= 500:
                self.media_config["video"]["max_size"] = int(video_max_mb * 1024 * 1024)

    def get_mime_type(self, file_ext):
        with self.lock:
            return self.mime_map.get(file_ext.lower())


class MediaState:
    """媒体库状态管理器（线程安全）"""

    def __init__(self):
        self.lock = threading.RLock()
        self.media_db = []  # 存储媒体文件信息
        self.last_scan_time = 0  # 上次扫描时间戳

    def get_media_list(self, media_type="all"):
        """获取过滤后的媒体列表"""
        with self.lock:
            if media_type == "image":
                return [m.copy() for m in self.media_db if m["media_type"] == "image"]
            elif media_type == "video":
                return [m.copy() for m in self.media_db if m["media_type"] == "video"]
            else:
                return [m.copy() for m in self.media_db]

    def update_media(self, new_media):
        """更新媒体库（去重+删除无效文件）"""
        with self.lock:
            # 移除已删除的文件
            existing_paths = {m["path"] for m in self.media_db}
            self.media_db = [m for m in self.media_db if os.path.exists(m["path"])]

            # 添加新文件（去重）
            current_paths = {m["path"] for m in self.media_db}
            for m in new_media:
                if m["path"] not in current_paths:
                    self.media_db.append(m)
                    current_paths.add(m["path"])

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
                        logging.error(f"处理文件错误 {file}: {str(e)}", exc_info=True)

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


class FileSystemMonitor(FileSystemEventHandler):
    """文件系统事件监控器"""

    def __init__(self):
        self.observer = None

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
        if self.observer and self.observer.is_alive():
            try:
                self.observer.stop()
                self.observer.join(timeout=5)  # 等待5秒超时
                if self.observer.is_alive():
                    logging.warning("监控线程未正常退出")
            except Exception as e:
                logging.error(f"监控停止失败: {str(e)}", exc_info=True)
            finally:
                self.observer = None

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
                threading.Timer(delay, MediaManager.scan_media).start()
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
                threading.Timer(delay, MediaManager.scan_media).start()
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
            }
        )

        with cls._lock:
            # 遍历副本，避免迭代中修改列表
            for ws in list(cls._active_ws):
                try:
                    if ws.connected:
                        ws.send(message)
                    else:
                        cls._active_ws.remove(ws)
                except Exception as e:
                    logging.error(f"WebSocket发送失败: {str(e)}")
                    cls._active_ws.remove(ws)

    @classmethod
    def cleanup_inactive(cls):
        """清理无效连接（心跳检测）"""
        with cls._lock:
            cls._active_ws = [ws for ws in cls._active_ws if ws.connected]


# ------------------------------
# API接口
# ------------------------------
@app.before_request
def handle_preflight():
    """处理跨域预检请求"""
    if request.method == "OPTIONS":
        response = jsonify({"status": "ok"})
        origins = config_mgr.allowed_origins
        response.headers.add(
            "Access-Control-Allow-Origin", ", ".join(origins) if origins else "*"
        )
        response.headers.add("Access-Control-Allow-Headers", "Content-Type")
        response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        return response


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
        return jsonify({"status": "扫描已启动"})
    except Exception as e:
        logging.error(f"扫描接口错误: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/media", methods=["GET"])
def get_media():
    """获取媒体列表"""
    try:
        media_type = request.args.get("type", "all")
        media_list = media_state.get_media_list(media_type)
        counts = media_state.get_counts()
        return jsonify(
            {
                "media": media_list,
                "total_count": counts["total"],
                "filtered_count": len(media_list),
                "image_count": counts["image"],
                "video_count": counts["video"],
                "last_updated": config_mgr.save().get("last_updated", ""),
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
                "url": f"/media/{media['rel_path']}",
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
def get_media_file(rel_path):
    """获取媒体文件（支持断点续传）"""
    try:
        # 解码URL编码的路径
        rel_path = urllib.parse.unquote(rel_path)
        scan_dir = config_mgr.get_scan_dir()
        full_path = os.path.abspath(os.path.join(scan_dir, rel_path))

        # 严格验证路径是否在扫描目录内
        scan_dir_abs = os.path.abspath(scan_dir)
        if not full_path.startswith(scan_dir_abs) or ".." in os.path.relpath(
            full_path, scan_dir_abs
        ):
            logging.warning(f"路径越界尝试: {rel_path} -> {full_path}")
            return jsonify({"error": "路径不合法"}), 403

        if not os.path.exists(full_path) or not os.path.isfile(full_path):
            return jsonify({"error": "文件不存在"}), 404

        # 确定MIME类型
        file_ext = os.path.splitext(full_path)[1].lower()
        mime_type = (
            config_mgr.get_mime_type(file_ext) or mimetypes.guess_type(full_path)[0]
        )
        if not mime_type:
            mime_type = (
                "image/" + file_ext[1:]
                if file_ext
                in config_mgr.get_media_config("image").get("extensions", ())
                else "video/" + file_ext[1:]
            )

        # 视频断点续传处理
        range_header = request.headers.get("Range")
        if range_header and mime_type.startswith("video/"):
            file_size = os.path.getsize(full_path)
            start, end = range_header.split("=")[1].split("-")
            start = int(start)
            end = int(end) if end else file_size - 1
            length = end - start + 1

            with open(full_path, "rb") as f:
                f.seek(start)
                data = f.read(length)

            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": length,
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
                    file_monitor.observer.is_alive() if file_monitor.observer else False
                ),
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
    threading.Thread(
        target=lambda: [
            WebSocketManager.cleanup_inactive() or time.sleep(30) for _ in iter(int, 1)
        ],
        daemon=True,
    ).start()
    # 启动初始扫描
    threading.Thread(
        target=MediaManager.scan_media, kwargs={"full_scan": True}, daemon=True
    ).start()

    # 打印启动信息
    logging.info("=" * 80)
    logging.info("本地媒体服务启动（支持图片+视频）")
    logging.info("服务地址: http://127.0.0.1:9000")
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
    server = pywsgi.WSGIServer(("0.0.0.0", 9000), app, handler_class=WebSocketHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("服务被手动终止")
    finally:
        file_monitor.stop_monitoring()  # 确保监控资源释放


if __name__ == "__main__":
    main()
