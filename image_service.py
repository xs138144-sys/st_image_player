#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SillyTavern 媒体服务后端 - 优化版本
基于 Flask + Watchdog 的图片和视频媒体服务
支持实时监控、WebSocket通信、断点续传等功能
"""

import os
import sys
import json
import time
import logging
import threading
import urllib.parse
import mimetypes
import hashlib
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

from flask import Flask, jsonify, request, send_file
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from flask_cors import CORS
from gevent import pywsgi
from geventwebsocket.handler import WebSocketHandler

# 设置文件系统编码为UTF-8
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
sys.getfilesystemencoding = lambda: 'utf-8'

# 全局配置
class Config:
    """配置管理类"""
    CONFIG_FILE = "local_image_service_config.json"
    LOG_FILE = "image_service.log"
    
    # 默认配置
    DEFAULT_CONFIG = {
        "scan_directory": "F:\\Download" if os.name == 'nt' else os.path.expanduser("~/Downloads"),
        "port": 9000,
        "host": "127.0.0.1",
        "debug": False,
        "max_workers": 4,
        "cache_size": 100,
        "media_config": {
            "image_max_size_mb": 5,
            "video_max_size_mb": 100
        }
    }
    
    # 媒体格式配置
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

# 初始化应用
app = Flask(__name__)
CORS(app)

# 全局变量
MEDIA_DB: List[Dict[str, Any]] = []
SCAN_DIRECTORY: str = ""
OBSERVER: Optional[Observer] = None
active_websockets: List[Any] = []
thread_pool: Optional[ThreadPoolExecutor] = None

# 配置日志系统
def setup_logging():
    """配置日志系统"""
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    
    # 清除现有处理器
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)
    
    # 文件处理器
    file_handler = logging.FileHandler(Config.LOG_FILE, encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    
    # 控制台处理器
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    
    # 格式化器
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    file_handler.setFormatter(formatter)
    console_handler.setFormatter(formatter)
    
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

logger = setup_logging()


class MediaDBHandler(FileSystemEventHandler):
    """媒体数据库处理器 - 优化版本"""
    
    def __init__(self):
        super().__init__()
        self._scan_lock = threading.Lock()
        self._last_scan_time = 0
        self._scan_interval = 5  # 扫描间隔（秒）
    
    def update_db(self) -> bool:
        """更新媒体数据库"""
        global MEDIA_DB, SCAN_DIRECTORY
        
        # 防止频繁扫描
        current_time = time.time()
        if current_time - self._last_scan_time < self._scan_interval:
            logger.debug("扫描过于频繁，跳过本次更新")
            return False
        
        # 线程安全扫描
        with self._scan_lock:
            try:
                self._last_scan_time = current_time
                
                if not SCAN_DIRECTORY or not os.path.exists(SCAN_DIRECTORY):
                    logger.warning(f"目录不存在: {SCAN_DIRECTORY}")
                    return False
                
                if not os.access(SCAN_DIRECTORY, os.R_OK):
                    logger.error(f"无目录读权限: {SCAN_DIRECTORY}")
                    return False
                
                logger.info(f"开始扫描目录: {SCAN_DIRECTORY}")
                
                # 使用线程池并行处理文件
                all_extensions = Config.MEDIA_CONFIG["image"]["extensions"] + Config.MEDIA_CONFIG["video"]["extensions"]
                new_media_db = []
                
                # 收集所有媒体文件路径
                media_files = []
                for root, _, files in os.walk(SCAN_DIRECTORY):
                    for file in files:
                        file_lower = file.lower()
                        if any(file_lower.endswith(ext) for ext in all_extensions):
                            media_files.append((root, file))
                
                # 并行处理文件
                if thread_pool:
                    futures = []
                    for root, file in media_files:
                        future = thread_pool.submit(self._process_media_file, root, file)
                        futures.append(future)
                    
                    # 收集结果
                    for future in futures:
                        try:
                            result = future.result(timeout=10)  # 10秒超时
                            if result:
                                new_media_db.append(result)
                        except Exception as e:
                            logger.warning(f"处理文件超时或出错: {e}")
                else:
                    # 串行处理（备用方案）
                    for root, file in media_files:
                        result = self._process_media_file(root, file)
                        if result:
                            new_media_db.append(result)
                
                # 更新数据库
                MEDIA_DB = new_media_db
                
                # 按修改时间排序（最新在前）
                MEDIA_DB.sort(key=lambda x: x["last_modified"], reverse=True)
                
                # 统计信息
                image_count = len([x for x in MEDIA_DB if x["media_type"] == "image"])
                video_count = len([x for x in MEDIA_DB if x["media_type"] == "video"])
                
                logger.info(f"扫描完成: 总计{len(MEDIA_DB)}个（图片{image_count} | 视频{video_count}）")
                
                # 保存配置并发送更新
                save_config()
                self.send_update_event()
                
                return True
                
            except Exception as e:
                logger.error(f"扫描目录失败: {str(e)}")
                return False
    
    def _process_media_file(self, root: str, file: str) -> Optional[Dict[str, Any]]:
        """处理单个媒体文件"""
        try:
            file_lower = file.lower()
            full_path = os.path.join(root, file)
            
            # 获取文件信息
            stat_info = os.stat(full_path)
            file_size = stat_info.st_size
            
            # 判断媒体类型
            if file_lower.endswith(Config.MEDIA_CONFIG["image"]["extensions"]):
                media_type = "image"
                max_size = Config.MEDIA_CONFIG["image"]["max_size"]
            elif file_lower.endswith(Config.MEDIA_CONFIG["video"]["extensions"]):
                media_type = "video"
                max_size = Config.MEDIA_CONFIG["video"]["max_size"]
            else:
                return None
            
            # 检查文件大小
            if file_size > max_size:
                logger.debug(f"文件过大跳过: {file} ({file_size/1024/1024:.1f}MB > {max_size/1024/1024:.1f}MB)")
                return None
            
            # 计算文件哈希（用于去重）
            file_hash = self._calculate_file_hash(full_path)
            
            # 相对路径
            rel_path = os.path.relpath(full_path, SCAN_DIRECTORY).replace("\\", "/")
            
            return {
                "path": full_path,
                "rel_path": rel_path,
                "name": file,
                "size": file_size,
                "media_type": media_type,
                "last_modified": stat_info.st_mtime,
                "file_hash": file_hash,
                "created_time": stat_info.st_ctime
            }
            
        except Exception as e:
            logger.warning(f"处理媒体文件错误: {file} - {str(e)}")
            return None
    
    def _calculate_file_hash(self, file_path: str) -> str:
        """计算文件哈希值"""
        try:
            hasher = hashlib.md5()
            with open(file_path, 'rb') as f:
                # 只读取文件前1MB来计算哈希（性能优化）
                buf = f.read(1024 * 1024)
                hasher.update(buf)
            return hasher.hexdigest()
        except Exception as e:
            logger.warning(f"计算文件哈希失败: {file_path} - {str(e)}")
            return ""
    
    def send_update_event(self):
        """发送媒体库更新通知"""
        message = json.dumps({
            'type': 'media_updated',
            'total_count': len(MEDIA_DB),
            'image_count': len([x for x in MEDIA_DB if x["media_type"] == "image"]),
            'video_count': len([x for x in MEDIA_DB if x["media_type"] == "video"]),
            'timestamp': time.time()
        })
        
        # 安全发送WebSocket消息
        for ws in list(active_websockets):
            try:
                ws.send(message)
            except Exception as e:
                logger.error(f"WebSocket发送失败: {str(e)}")
                if ws in active_websockets:
                    active_websockets.remove(ws)

    # 文件监控事件处理
    
    def on_created(self, event):
        """文件创建事件处理"""
        if not event.is_directory and self._is_media_file(event.src_path):
            logger.info(f"检测到新文件: {os.path.basename(event.src_path)}")
            self._handle_file_event(event.src_path, "created")
    
    def on_deleted(self, event):
        """文件删除事件处理"""
        if not event.is_directory and self._is_media_file(event.src_path):
            logger.info(f"检测到文件删除: {os.path.basename(event.src_path)}")
            self._handle_file_event(event.src_path, "deleted")
    
    def on_modified(self, event):
        """文件修改事件处理"""
        if not event.is_directory and self._is_media_file(event.src_path):
            logger.debug(f"检测到文件修改: {os.path.basename(event.src_path)}")
            self._handle_file_event(event.src_path, "modified")
    
    def _is_media_file(self, file_path: str) -> bool:
        """检查是否为媒体文件"""
        file_lower = file_path.lower()
        all_extensions = Config.MEDIA_CONFIG["image"]["extensions"] + Config.MEDIA_CONFIG["video"]["extensions"]
        return any(file_lower.endswith(ext) for ext in all_extensions)
    
    def _handle_file_event(self, file_path: str, event_type: str):
        """处理文件事件"""
        try:
            if event_type == "deleted":
                # 立即从数据库中删除
                deleted_path = os.path.normpath(file_path)
                global MEDIA_DB
                initial_count = len(MEDIA_DB)
                MEDIA_DB = [m for m in MEDIA_DB if os.path.normpath(m["path"]) != deleted_path]
                
                if len(MEDIA_DB) < initial_count:
                    logger.info(f"从数据库删除媒体: {os.path.basename(deleted_path)}")
                    save_config()
                    self.send_update_event()
            else:
                # 创建或修改事件，延迟更新数据库
                LARGE_FILE_THRESHOLD = 200 * 1024 * 1024  # 200MB阈值
                
                # 检查文件大小并设置适当的延迟
                if os.path.exists(file_path):
                    file_size = os.path.getsize(file_path)
                    if file_size > LARGE_FILE_THRESHOLD:
                        delay = 5 if event_type == "created" else 3  # 大文件创建5秒，修改3秒
                    else:
                        delay = 1.5 if event_type == "created" else 1  # 普通文件创建1.5秒，修改1秒
                    
                    # 使用线程延迟执行数据库更新
                    def delayed_update():
                        time.sleep(delay)
                        self.update_db()
                    
                    if thread_pool:
                        thread_pool.submit(delayed_update)
                    else:
                        threading.Thread(target=delayed_update, daemon=True).start()
                        
        except Exception as e:
            logger.error(f"处理文件事件失败: {file_path} - {event_type} - {str(e)}")


def setup_watchdog():
    """设置文件监控"""
    global OBSERVER
    if OBSERVER and OBSERVER.is_alive():
        OBSERVER.stop()
        OBSERVER.join()
    
    if SCAN_DIRECTORY and os.path.exists(SCAN_DIRECTORY):
        event_handler = MediaDBHandler()
        OBSERVER = Observer()
        OBSERVER.schedule(event_handler, SCAN_DIRECTORY, recursive=True)
        OBSERVER.start()
        logger.info(f"文件监控启用: {SCAN_DIRECTORY}")
    else:
        logger.warning("监控未启动: 目录无效")


def save_config():
    """保存配置到文件"""
    try:
        config = {
            "scan_directory": SCAN_DIRECTORY,
            "total_count": len(MEDIA_DB),
            "image_count": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
            "video_count": len([x for x in MEDIA_DB if x["media_type"] == "video"]),
            "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "media_config": {
                "image_max_size_mb": Config.MEDIA_CONFIG["image"]["max_size"] / 1024 / 1024,
                "video_max_size_mb": Config.MEDIA_CONFIG["video"]["max_size"] / 1024 / 1024
            }
        }
        with open(Config.CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return config
    except Exception as e:
        logger.error(f"保存配置失败: {str(e)}")
        return {}


def load_config():
    """从文件加载配置"""
    global SCAN_DIRECTORY
    try:
        if os.path.exists(Config.CONFIG_FILE):
            with open(Config.CONFIG_FILE, "r", encoding="utf-8") as f:
                config = json.load(f)
                SCAN_DIRECTORY = config.get("scan_directory", Config.DEFAULT_CONFIG["scan_directory"])
                # 加载媒体大小限制
                if "media_config" in config:
                    Config.MEDIA_CONFIG["image"]["max_size"] = int(config["media_config"]["image_max_size_mb"] * 1024 * 1024)
                    Config.MEDIA_CONFIG["video"]["max_size"] = int(config["media_config"]["video_max_size_mb"] * 1024 * 1024)
            return True
        else:
            # 生成默认配置
            default_config = {
                "scan_directory": Config.DEFAULT_CONFIG["scan_directory"],
                "total_count": 0, "image_count": 0, "video_count": 0,
                "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
                "media_config": {
                    "image_max_size_mb": Config.DEFAULT_CONFIG["media_config"]["image_max_size_mb"],
                    "video_max_size_mb": Config.DEFAULT_CONFIG["media_config"]["video_max_size_mb"]
                }
            }
            with open(Config.CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(default_config, f, indent=2, ensure_ascii=False)
            logger.info("生成默认配置: local_image_service_config.json")
    except Exception as e:
        logger.warning(f"加载配置失败: {str(e)}，使用默认值")
    
    # 默认配置
    SCAN_DIRECTORY = Config.DEFAULT_CONFIG["scan_directory"]
    Config.MEDIA_CONFIG["image"]["max_size"] = Config.DEFAULT_CONFIG["media_config"]["image_max_size_mb"] * 1024 * 1024
    Config.MEDIA_CONFIG["video"]["max_size"] = Config.DEFAULT_CONFIG["media_config"]["video_max_size_mb"] * 1024 * 1024
    return False


# API: 扫描目录（支持更新媒体大小限制）
@app.route('/scan', methods=['POST'])
def scan_directory():
    """扫描目录API端点"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "无效的JSON数据"}), 400
        
        directory = data.get('directory', '').strip()
        if not directory:
            return jsonify({"error": "目录参数不能为空"}), 400
        
        if not os.path.exists(directory):
            return jsonify({"error": f"目录不存在: {directory}"}), 404
        
        if not os.path.isdir(directory):
            return jsonify({"error": f"路径不是目录: {directory}"}), 400
        
        # 更新全局目录变量
        global SCAN_DIRECTORY
        SCAN_DIRECTORY = directory
        
        # 启动扫描
        result = MEDIA_DB_HANDLER.update_db()
        
        # 保存配置
        save_config()
        
        return jsonify({
            "message": "扫描完成",
            "directory": directory,
            "total_files": len(MEDIA_DB),
            "images": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
            "videos": len([x for x in MEDIA_DB if x["media_type"] == "video"])
        }), 200
        
    except Exception as e:
        logger.error(f"扫描目录失败: {str(e)}")
        return jsonify({"error": f"扫描失败: {str(e)}"}), 500


@app.route('/media', methods=['GET'])
def get_media_list():
    """获取媒体列表API端点"""
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 20))
        media_type = request.args.get('type', '')
        
        # 参数验证
        if page < 1:
            page = 1
        if per_page < 1 or per_page > 100:
            per_page = 20
        
        # 过滤媒体类型
        filtered_media = MEDIA_DB
        if media_type and media_type in ['image', 'video']:
            filtered_media = [x for x in MEDIA_DB if x["media_type"] == media_type]
        
        # 分页计算
        total = len(filtered_media)
        start_idx = (page - 1) * per_page
        end_idx = start_idx + per_page
        
        # 获取分页数据
        paginated_media = filtered_media[start_idx:end_idx]
        
        return jsonify({
            "data": paginated_media,
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "total_pages": (total + per_page - 1) // per_page
            },
            "summary": {
                "total_files": len(MEDIA_DB),
                "images": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
                "videos": len([x for x in MEDIA_DB if x["media_type"] == "video"])
            }
        }), 200
        
    except ValueError as e:
        logger.warning(f"参数类型错误: {str(e)}")
        return jsonify({"error": "参数类型错误"}), 400
    except Exception as e:
        logger.error(f"获取媒体列表失败: {str(e)}")
        return jsonify({"error": f"获取列表失败: {str(e)}"}), 500


@app.route('/random-media', methods=['GET'])
def get_random_media():
    """获取随机媒体API端点"""
    try:
        count = int(request.args.get('count', 1))
        media_type = request.args.get('type', '')
        
        # 参数验证
        if count < 1 or count > 50:
            count = 1
        
        # 过滤媒体类型
        filtered_media = MEDIA_DB
        if media_type and media_type in ['image', 'video']:
            filtered_media = [x for x in MEDIA_DB if x["media_type"] == media_type]
        
        if not filtered_media:
            return jsonify({"error": "没有找到符合条件的媒体文件"}), 404
        
        # 随机选择
        selected_media = random.sample(filtered_media, min(count, len(filtered_media)))
        
        return jsonify({
            "data": selected_media,
            "count": len(selected_media),
            "total_available": len(filtered_media)
        }), 200
        
    except ValueError as e:
        logger.warning(f"参数类型错误: {str(e)}")
        return jsonify({"error": "参数类型错误"}), 400
    except Exception as e:
        logger.error(f"获取随机媒体失败: {str(e)}")
        return jsonify({"error": f"获取随机媒体失败: {str(e)}"}), 500


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


@app.route('/status')
def get_status():
    """获取服务器状态API端点"""
    try:
        # 检查监控状态
        watchdog_status = "运行中" if OBSERVER and OBSERVER.is_alive() else "未运行"
        
        # 检查WebSocket连接数
        ws_count = len(WS_CONNECTIONS)
        
        # 获取系统信息
        import psutil
        process = psutil.Process()
        memory_info = process.memory_info()
        
        status_info = {
            "server": {
                "status": "运行中",
                "uptime": time.time() - START_TIME,
                "memory_usage_mb": round(memory_info.rss / 1024 / 1024, 2),
                "cpu_percent": process.cpu_percent(interval=0.1)
            },
            "media": {
                "scan_directory": SCAN_DIRECTORY,
                "total_files": len(MEDIA_DB),
                "images": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
                "videos": len([x for x in MEDIA_DB if x["media_type"] == "video"]),
                "last_scan_time": MEDIA_DB_HANDLER.last_scan_time
            },
            "monitoring": {
                "watchdog_status": watchdog_status,
                "websocket_connections": ws_count
            },
            "config": {
                "image_max_size_mb": Config.MEDIA_CONFIG["image"]["max_size"] / 1024 / 1024,
                "video_max_size_mb": Config.MEDIA_CONFIG["video"]["max_size"] / 1024 / 1024
            }
        }
        
        return jsonify(status_info), 200
        
    except ImportError:
        # psutil不可用时的降级处理
        status_info = {
            "server": {
                "status": "运行中",
                "uptime": time.time() - START_TIME,
                "memory_usage_mb": "未知",
                "cpu_percent": "未知"
            },
            "media": {
                "scan_directory": SCAN_DIRECTORY,
                "total_files": len(MEDIA_DB),
                "images": len([x for x in MEDIA_DB if x["media_type"] == "image"]),
                "videos": len([x for x in MEDIA_DB if x["media_type"] == "video"]),
                "last_scan_time": MEDIA_DB_HANDLER.last_scan_time
            },
            "monitoring": {
                "watchdog_status": watchdog_status,
                "websocket_connections": ws_count
            },
            "config": {
                "image_max_size_mb": Config.MEDIA_CONFIG["image"]["max_size"] / 1024 / 1024,
                "video_max_size_mb": Config.MEDIA_CONFIG["video"]["max_size"] / 1024 / 1024
            }
        }
        return jsonify(status_info), 200
    except Exception as e:
        logger.error(f"获取状态失败: {str(e)}")
        return jsonify({"error": f"获取状态失败: {str(e)}"}), 500


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