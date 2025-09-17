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
IMAGE_DB = []  # 存储所有媒体文件（图片+视频）
SCAN_DIRECTORY = ""
OBSERVER = None
active_websockets = []  # 存储活跃的WebSocket连接

# 新增：支持的媒体格式配置（便于维护）
MEDIA_CONFIG = {
    "image": {
        "extensions": ('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.apng'),
        "max_size": 5 * 1024 * 1024  # 图片最大5MB
    },
    "video": {
        "extensions": ('.webm', '.mp4', '.ogv', '.mov', '.avi', '.mkv'),  # 扩展MKV格式
        "max_size": 100 * 1024 * 1024  # 视频最大100MB（放宽限制）
    }
}

# 新增：MIME类型映射（覆盖系统识别不足）
MIME_MAP = {
    # 图片MIME
    '.apng': 'image/apng',
    '.webp': 'image/webp',
    # 视频MIME
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.ogv': 'video/ogg',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska'
}


class ImageDBHandler(FileSystemEventHandler):
    def update_db(self):
        global IMAGE_DB, SCAN_DIRECTORY
        IMAGE_DB = []
        
        if not SCAN_DIRECTORY or not os.path.exists(SCAN_DIRECTORY):
            logging.warning(f"目录不存在: {SCAN_DIRECTORY}")
            return
        
        logging.info(f"开始扫描目录: {SCAN_DIRECTORY}")
        all_extensions = MEDIA_CONFIG["image"]["extensions"] + MEDIA_CONFIG["video"]["extensions"]
        
        for root, _, files in os.walk(SCAN_DIRECTORY):
            for file in files:
                file_lower = file.lower()
                # 匹配支持的媒体格式
                if any(file_lower.endswith(ext) for ext in all_extensions):
                    try:
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(full_path, SCAN_DIRECTORY)
                        file_size = os.path.getsize(full_path)
                        
                        # 判定媒体类型并检查大小限制
                        if file_lower.endswith(MEDIA_CONFIG["image"]["extensions"]):
                            media_type = "image"
                            max_size = MEDIA_CONFIG["image"]["max_size"]
                        else:
                            media_type = "video"
                            max_size = MEDIA_CONFIG["video"]["max_size"]
                        
                        if file_size <= max_size:
                            IMAGE_DB.append({
                                "path": full_path,
                                "rel_path": rel_path.replace("\\", "/"),
                                "name": file,
                                "size": file_size,
                                "media_type": media_type,  # 新增：媒体类型标记
                                "last_modified": os.path.getmtime(full_path)  # 新增：最后修改时间（用于排序）
                            })
                    except Exception as e:
                        logging.error(f"处理媒体文件错误: {file} - {str(e)}")
        
        # 按最后修改时间排序（最新在前）
        IMAGE_DB.sort(key=lambda x: x["last_modified"], reverse=True)
        logging.info(f"扫描完成, 共找到 {len(IMAGE_DB)} 个媒体文件（图片: {len([x for x in IMAGE_DB if x['media_type']=='image'])} | 视频: {len([x for x in IMAGE_DB if x['media_type']=='video'])}）")
        save_config()
        self.send_update_event()

    def send_update_event(self):
        global active_websockets
        # 发送更新事件给所有客户端（包含媒体统计）
        message = json.dumps({
            'type': 'media_updated',
            'total_count': len(IMAGE_DB),
            'image_count': len([x for x in IMAGE_DB if x['media_type']=='image']),
            'video_count': len([x for x in IMAGE_DB if x['media_type']=='video'])
        })
        current_websockets = list(active_websockets)
        for ws in current_websockets:
            try:
                ws.send(message)
            except Exception as e:
                logging.error(f"发送WebSocket消息失败: {str(e)}")
                if ws in active_websockets:
                    active_websockets.remove(ws)

    def on_created(self, event):
        if not event.is_directory and any(event.src_path.lower().endswith(ext) for ext in 
            MEDIA_CONFIG["image"]["extensions"] + MEDIA_CONFIG["video"]["extensions"]):
            time.sleep(1.5)  # 等待大文件（视频）完全写入
            self.update_db()

    def on_deleted(self, event):
        global IMAGE_DB
        if not event.is_directory:
            deleted_path = os.path.normpath(event.src_path)
            IMAGE_DB = [img for img in IMAGE_DB if os.path.normpath(img["path"]) != deleted_path]
            logging.info(f"媒体文件已删除: {os.path.basename(deleted_path)}")
            save_config()
            self.send_update_event()

    # 新增：文件修改时更新DB（如视频重新保存）
    def on_modified(self, event):
        if not event.is_directory and any(event.src_path.lower().endswith(ext) for ext in 
            MEDIA_CONFIG["image"]["extensions"] + MEDIA_CONFIG["video"]["extensions"]):
            time.sleep(1)
            self.update_db()


def setup_watchdog():
    global OBSERVER
    if OBSERVER and OBSERVER.is_alive():
        OBSERVER.stop()
        OBSERVER.join()  # 确保线程完全停止
    
    if SCAN_DIRECTORY and os.path.exists(SCAN_DIRECTORY):
        event_handler = ImageDBHandler()
        OBSERVER = Observer()
        OBSERVER.schedule(event_handler, SCAN_DIRECTORY, recursive=True)
        OBSERVER.start()
        logging.info(f"文件监控已启用: {SCAN_DIRECTORY}")
    else:
        logging.warning("文件监控未启动: 目录无效或未设置")


def save_config():
    try:
        # 配置中新增媒体统计信息
        config = {
            "scan_directory": SCAN_DIRECTORY,
            "total_media_count": len(IMAGE_DB),
            "image_count": len([x for x in IMAGE_DB if x['media_type']=='image']),
            "video_count": len([x for x in IMAGE_DB if x['media_type']=='video']),
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
            # 新增：配置文件不存在时自动生成默认配置
            default_config = {
                "scan_directory": "F:\\Download",
                "total_media_count": 0,
                "image_count": 0,
                "video_count": 0,
                "last_updated": time.strftime("%Y-%m-%d %H:%M:%S"),
                "media_config": {
                    "image_max_size_mb": 5,
                    "video_max_size_mb": 100
                }
            }
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(default_config, f, indent=2, ensure_ascii=False)
            logging.info("默认配置文件已生成: local_image_service_config.json")
    except Exception as e:
        logging.warning(f"加载配置失败: {str(e)}, 使用默认设置")
    
    # 默认配置
    SCAN_DIRECTORY = "F:\\Download"
    MEDIA_CONFIG["image"]["max_size"] = 5 * 1024 * 1024
    MEDIA_CONFIG["video"]["max_size"] = 100 * 1024 * 1024
    return False

@app.route("/scan", methods=["POST"])
def scan_endpoint():
    try:
        data = request.get_json()
        new_dir = data.get("path", "").strip()
        # 新增：可选调整媒体大小限制
        image_max_mb = data.get("image_max_mb", MEDIA_CONFIG["image"]["max_size"] / 1024 / 1024)
        video_max_mb = data.get("video_max_mb", MEDIA_CONFIG["video"]["max_size"] / 1024 / 1024)
        
        if not new_dir or not os.path.isdir(new_dir):
            return jsonify({"status": "error", "message": "目录不存在或无效"}), 400
            
        # 更新全局变量
        global SCAN_DIRECTORY
        SCAN_DIRECTORY = os.path.normpath(new_dir)
        MEDIA_CONFIG["image"]["max_size"] = int(image_max_mb * 1024 * 1024)
        MEDIA_CONFIG["video"]["max_size"] = int(video_max_mb * 1024 * 1024)
        
        # 重新扫描目录
        handler = ImageDBHandler()
        handler.update_db()
        
        # 重启监控
        setup_watchdog()
        
        return jsonify({
            "status": "success",
            "path": SCAN_DIRECTORY,
            "total_count": len(IMAGE_DB),
            "image_count": len([x for x in IMAGE_DB if x['media_type']=='image']),
            "video_count": len([x for x in IMAGE_DB if x['media_type']=='video']),
            "media_config": {
                "image_max_size_mb": image_max_mb,
                "video_max_size_mb": video_max_mb
            }
        })
    except Exception as e:
        logging.error(f"扫描目录失败: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500



@app.route("/images", methods=["GET"])
def get_images():
    # 新增：支持按媒体类型筛选（url参数：?type=image/video/all）
    media_type = request.args.get("type", "all").lower()
    filtered_media = IMAGE_DB
    if media_type == "image":
        filtered_media = [x for x in IMAGE_DB if x['media_type'] == "image"]
    elif media_type == "video":
        filtered_media = [x for x in IMAGE_DB if x['media_type'] == "video"]
    
    result = {
        "media": filtered_media,  # 重命名为media（更通用）
        "total_count": len(IMAGE_DB),
        "filtered_count": len(filtered_media),
        "image_count": len([x for x in IMAGE_DB if x['media_type']=='image']),
        "video_count": len([x for x in IMAGE_DB if x['media_type']=='video']),
        "last_updated": save_config().get("last_updated", "")
    }
    return jsonify(result)


@app.route("/random-image", methods=["GET"])
def get_random_image():
    # 新增：支持按媒体类型随机（url参数：?type=image/video/all）
    media_type = request.args.get("type", "all").lower()
    filtered_media = IMAGE_DB
    if media_type == "image":
        filtered_media = [x for x in IMAGE_DB if x['media_type'] == "image"]
    elif media_type == "video":
        filtered_media = [x for x in IMAGE_DB if x['media_type'] == "video"]
    
    if not filtered_media:
        return jsonify({"status": "error", "message": f"无可用{media_type}媒体文件"}), 404
    
    import random
    media = random.choice(filtered_media)
    return jsonify({
        "url": f"/file/{media['rel_path']}",
        "name": media["name"],
        "size": media["size"],
        "media_type": media["media_type"],
        "last_modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(media["last_modified"]))
    })


@app.route("/file/<path:filename>", methods=["GET"])
def serve_file(filename):
    try:
        # 解码URL编码
        decoded_filename = urllib.parse.unquote(filename)
        
        # 构建完整路径
        file_path = os.path.join(SCAN_DIRECTORY, decoded_filename)
        abs_path = os.path.abspath(file_path)
        
        # 安全检查（防止路径穿越）
        base_dir = os.path.abspath(SCAN_DIRECTORY)
        if not abs_path.startswith(base_dir) or ".." in abs_path.replace(base_dir, ""):
            logging.warning(f"非法访问尝试: {abs_path}")
            return "禁止访问: 路径无效", 403
        
        # 检查文件是否存在
        if not os.path.isfile(abs_path):
            logging.warning(f"文件不存在: {abs_path}")
            return "文件不存在", 404
        
        # 确定MIME类型（优先使用自定义映射）
        file_ext = os.path.splitext(abs_path)[1].lower()
        mime_type = MIME_MAP.get(file_ext)
        if not mime_type:
            # 回退到系统识别
            mime_type, _ = mimetypes.guess_type(abs_path)
            # 兜底判断
            if not mime_type:
                if file_ext in MEDIA_CONFIG["image"]["extensions"]:
                    mime_type = f"image/{file_ext[1:]}"
                elif file_ext in MEDIA_CONFIG["video"]["extensions"]:
                    mime_type = f"video/{file_ext[1:]}"
                else:
                    mime_type = "application/octet-stream"
        
        # 视频文件支持断点续传（新增：提升大视频加载体验）
        range_header = request.headers.get('Range', None)
        if range_header and mime_type.startswith("video/"):
            file_size = os.path.getsize(abs_path)
            range_str = range_header.split('=')[1]
            start, end = range_str.split('-')
            start = int(start)
            end = int(end) if end else file_size - 1
            length = end - start + 1
            
            with open(abs_path, 'rb') as f:
                f.seek(start)
                data = f.read(length)
            
            response_headers = {
                'Content-Range': f'bytes {start}-{end}/{file_size}',
                'Accept-Ranges': 'bytes',
                'Content-Length': length,
                'Content-Type': mime_type
            }
            return data, 206, response_headers
        
        # 记录访问
        logging.debug(f"服务媒体文件: {abs_path} (MIME: {mime_type} | 大小: {os.path.getsize(abs_path)/1024/1024:.2f}MB)")
        
        return send_file(
            abs_path, 
            mimetype=mime_type,
            as_attachment=False,
            conditional=True,
            etag=True,  # 启用缓存
            last_modified=os.path.getmtime(abs_path)  # 最后修改时间（用于缓存）
        )
        
    except Exception as e:
        logging.error(f"文件服务错误: {str(e)}", exc_info=True)
        return f"服务器错误: {str(e)}", 500


@app.route("/cleanup", methods=["POST"])
def cleanup():
    global IMAGE_DB
    initial_count = len(IMAGE_DB)
    
    # 移除无效文件+超大小限制文件
    valid_media = []
    for media in IMAGE_DB:
        if os.path.exists(media["path"]):
            # 重新检查大小（防止配置修改后有超限制文件）
            file_size = os.path.getsize(media["path"])
            max_size = MEDIA_CONFIG["image"]["max_size"] if media["media_type"] == "image" else MEDIA_CONFIG["video"]["max_size"]
            if file_size <= max_size:
                valid_media.append(media)
                continue
            logging.info(f"媒体文件超大小限制，已清理: {media['name']} ({file_size/1024/1024:.2f}MB)")
        else:
            logging.info(f"媒体文件不存在，已清理: {media['name']}")
    
    IMAGE_DB = valid_media
    removed = initial_count - len(IMAGE_DB)
    
    save_config()
    return jsonify({
        "status": "success",
        "removed": removed,
        "remaining_total": len(IMAGE_DB),
        "remaining_image": len([x for x in IMAGE_DB if x['media_type']=='image']),
        "remaining_video": len([x for x in IMAGE_DB if x['media_type']=='video'])
    })


@app.route("/status", methods=["GET"])
def service_status():
    try:
        config = save_config()
        # 检查监控状态
        observer_active = OBSERVER and OBSERVER.is_alive()
        return jsonify({
            "active": True,
            "observer_active": observer_active,
            "directory": SCAN_DIRECTORY,
            "total_count": len(IMAGE_DB),
            "image_count": len([x for x in IMAGE_DB if x['media_type']=='image']),
            "video_count": len([x for x in IMAGE_DB if x['media_type']=='video']),
            "last_updated": config.get("last_updated", "未知"),
            "media_config": config.get("media_config", {})
        })
    except Exception as e:
        logging.error(f"状态检查错误: {str(e)}")
        return jsonify({
            "active": False,
            "error": str(e),
            "observer_active": False
        }), 500


@app.route('/socket.io')
def handle_websocket():
    if request.environ.get('wsgi.websocket'):
        ws = request.environ['wsgi.websocket']
        active_websockets.append(ws)
        logging.info(f"新的WebSocket连接, 当前连接数: {len(active_websockets)}")
        
        try:
            # 连接成功后发送当前媒体统计
            init_msg = json.dumps({
                'type': 'init',
                'total_count': len(IMAGE_DB),
                'image_count': len([x for x in IMAGE_DB if x['media_type']=='image']),
                'video_count': len([x for x in IMAGE_DB if x['media_type']=='video']),
                'observer_active': OBSERVER and OBSERVER.is_alive()
            })
            ws.send(init_msg)
            
            while True:
                # 接收客户端消息（支持心跳+媒体筛选指令）
                message = ws.receive()
                if message is None:
                    break
                try:
                    msg = json.loads(message)
                    # 心跳响应
                    if msg.get('type') == 'ping':
                        ws.send(json.dumps({'type': 'pong', 'timestamp': time.time()}))
                    # 媒体筛选指令（客户端主动请求筛选后列表）
                    elif msg.get('type') == 'filter_media':
                        media_type = msg.get('media_type', 'all').lower()
                        filtered = IMAGE_DB
                        if media_type == 'image':
                            filtered = [x for x in IMAGE_DB if x['media_type']=='image']
                        elif media_type == 'video':
                            filtered = [x for x in IMAGE_DB if x['media_type']=='video']
                        ws.send(json.dumps({
                            'type': 'filtered_media',
                            'media_type': media_type,
                            'count': len(filtered)
                        }))
                except Exception as e:
                    logging.error(f"处理WebSocket消息错误: {str(e)}")
        except Exception as e:
            logging.error(f"WebSocket连接错误: {str(e)}")
        finally:
            # 连接关闭时移除
            if ws in active_websockets:
                active_websockets.remove(ws)
            logging.info(f"WebSocket连接关闭, 剩余连接数: {len(active_websockets)}")
    return ''


def init_service():
    logging.info("=" * 80)
    logging.info("本地媒体服务启动中（支持图片+视频）")
    logging.info("服务地址: http://127.0.0.1:9000")
    logging.info(f"图片大小限制: {MEDIA_CONFIG['image']['max_size']/1024/1024:.1f}MB | 视频大小限制: {MEDIA_CONFIG['video']['max_size']/1024/1024:.1f}MB")
    logging.info("支持格式:")
    logging.info(f"  图片: {', '.join([ext[1:].upper() for ext in MEDIA_CONFIG['image']['extensions']])}")
    logging.info(f"  视频: {', '.join([ext[1:].upper() for ext in MEDIA_CONFIG['video']['extensions']])}")
    logging.info("=" * 80)
    
    load_config()
    
    handler = ImageDBHandler()
    handler.update_db()
    
    setup_watchdog()
    
    logging.info(f"当前扫描目录: {SCAN_DIRECTORY}")
    logging.info(f"媒体统计: 总计{len(IMAGE_DB)}个 | 图片{len([x for x in IMAGE_DB if x['media_type']=='image'])}个 | 视频{len([x for x in IMAGE_DB if x['media_type']=='video'])}个")
    logging.info("=" * 80)
    logging.info("服务已就绪 | 按Ctrl+C终止")
    logging.info("=" * 80)


if __name__ == "__main__":
    # 确保文件系统编码正确
    if not sys.stdout.encoding or sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    if not sys.stderr.encoding or sys.stderr.encoding.lower() != 'utf-8':
        sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)
    
    init_service()
    
    # 使用gevent的WSGIServer（支持WebSocket+高并发）
    server = pywsgi.WSGIServer(
        ('0.0.0.0', 9000), 
        app,
        handler_class=WebSocketHandler,
        log=logging.getLogger("gevent-server")  # 集成日志
    )
    server.serve_forever()