#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    Image = None
    ImageDraw = None
    ImageFilter = None
    ImageFont = None


API_URL = "https://whatslink.info/api/v1/link"
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/130.0.0.0 Safari/537.36"
    ),
    "Referer": "https://whatslink.info/",
    "Cache-Control": "no-cache",
}
HASH_RE = re.compile(r"^[0-9a-zA-Z]{40}$|^[0-9a-zA-Z]{32}$")
HASH_SEARCH_RE = re.compile(r"(?<![0-9A-Za-z])([0-9A-Za-z]{40}|[0-9A-Za-z]{32})(?![0-9A-Za-z])")
MAGNET_RE = re.compile(
    r"magnet:\?xt=urn:btih:([0-9a-zA-Z]{40}|[0-9a-zA-Z]{32})(?:[^\s\"'<>，。；、]*)?",
    re.IGNORECASE,
)
DEFAULT_MAPLE_ORDER = [
    "MapleMono-CN-Regular.ttf",
    "MapleMono-CN-Medium.ttf",
    "MapleMono-CN-Light.ttf",
    "MapleMono-NF-CN-Regular.ttf",
    "MapleMono-NF-CN-Medium.ttf",
    "MapleMono-NF-CN-Light.ttf",
    "MapleMono-Regular.ttf",
]
SYSTEM_CJK_FONT_CANDIDATES = [
    "/usr/share/fonts/msyh.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.otf",
    "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf",
    "/usr/share/fonts/opentype/source-han-serif/SourceHanSerifSC-Regular.otf",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]
DEFAULT_FONT_URL = (
    "https://github.com/notofonts/noto-cjk/raw/main/"
    "Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"
)
DEFAULT_FONT_FILENAME = "NotoSansCJKsc-Regular.otf"
MAX_BATCH_ITEMS = 20


def skill_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return None
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        value = value[1:-1]
    return key, value


def load_default_env() -> None:
    configured_env_file = os.getenv("TORRENT_ANALYZE_ENV_FILE", "").strip()
    if configured_env_file:
        env_file = Path(configured_env_file).expanduser()
    else:
        env_file = skill_dir() / "config" / "default.env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        parsed = parse_env_line(line)
        if parsed is None:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on", "开", "是"}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError:
        return default


def env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    return value


@dataclass
class TorrentInput:
    magnet_url: str
    torrent_hash: str
    raw_text: str


@dataclass
class TorrentResult:
    ok: bool
    torrent_hash: str
    magnet_url: str
    text: str
    payload: dict[str, Any]
    screenshot_urls: list[str]
    from_cache: bool
    image_path: Path | None = None


@dataclass
class AnalyzeBatch:
    results: list[TorrentResult]
    total_found: int
    max_items: int
    message: str = ""


def parse_args() -> argparse.Namespace:
    load_default_env()
    parser = argparse.ArgumentParser(
        description="查询磁链或种子 hash 信息，并可选生成截图拼图。"
    )
    parser.add_argument(
        "torrent_input",
        nargs="?",
        help="磁链、32/40 位种子 hash，或包含磁链/hash 的上下文文本；为空时读取 stdin",
    )
    parser.add_argument(
        "--cache-dir",
        default=env_str("TORRENT_ANALYZE_CACHE_DIR", ".torrent-analyze"),
        help="缓存与渲染输出目录；默认读取 TORRENT_ANALYZE_CACHE_DIR，未设置时为 .torrent-analyze",
    )
    parser.add_argument(
        "--retry-times",
        type=int,
        default=env_int("TORRENT_ANALYZE_RETRY_TIMES", 20),
        help="请求最大重试次数；默认读取 TORRENT_ANALYZE_RETRY_TIMES，未设置时为 20",
    )
    parser.add_argument(
        "--retry-interval",
        type=float,
        default=env_float("TORRENT_ANALYZE_RETRY_INTERVAL", 3.0),
        help="重试间隔秒数；默认读取 TORRENT_ANALYZE_RETRY_INTERVAL，未设置时为 3.0",
    )
    parser.add_argument(
        "--image",
        action="store_true",
        default=env_bool("TORRENT_ANALYZE_IMAGE", False),
        help="存在截图时生成文本头 + 最多 3 张截图的拼图；可用 TORRENT_ANALYZE_IMAGE=1 设为默认开启",
    )
    parser.add_argument(
        "--blur",
        type=int,
        default=env_int("TORRENT_ANALYZE_BLUR", 10),
        help="截图高斯模糊半径 0..10；默认读取 TORRENT_ANALYZE_BLUR",
    )
    parser.add_argument(
        "--font-file",
        default=env_str("TORRENT_ANALYZE_FONT_FILE", ""),
        help="字体文件绝对路径；默认读取 TORRENT_ANALYZE_FONT_FILE，优先级高于 --font-dir/--font-filename",
    )
    parser.add_argument(
        "--font-dir",
        default=env_str("TORRENT_ANALYZE_FONT_DIR", "/AstrBot/data/fonts"),
        help="字体查找目录；默认读取 TORRENT_ANALYZE_FONT_DIR，未设置时为 /AstrBot/data/fonts",
    )
    parser.add_argument(
        "--font-filename",
        default=env_str("TORRENT_ANALYZE_FONT_FILENAME", ""),
        help="优先字体文件名；默认读取 TORRENT_ANALYZE_FONT_FILENAME，未设置时优先查找 font.ttf",
    )
    parser.add_argument(
        "--auto-download-font",
        action=argparse.BooleanOptionalAction,
        default=env_bool("TORRENT_ANALYZE_AUTO_DOWNLOAD_FONT", True),
        help="找不到本地中文字体时自动下载；可用 TORRENT_ANALYZE_AUTO_DOWNLOAD_FONT=false 关闭",
    )
    parser.add_argument(
        "--font-url",
        default=env_str("TORRENT_ANALYZE_FONT_URL", DEFAULT_FONT_URL),
        help="自动下载字体 URL；默认读取 TORRENT_ANALYZE_FONT_URL",
    )
    parser.add_argument(
        "--font-cache-dir",
        default=env_str("TORRENT_ANALYZE_FONT_CACHE_DIR", ""),
        help="自动下载字体缓存目录；默认读取 TORRENT_ANALYZE_FONT_CACHE_DIR，未设置时为 <cache-dir>/fonts",
    )
    parser.add_argument(
        "--font-cache-filename",
        default=env_str("TORRENT_ANALYZE_FONT_CACHE_FILENAME", DEFAULT_FONT_FILENAME),
        help="自动下载字体缓存文件名；默认读取 TORRENT_ANALYZE_FONT_CACHE_FILENAME",
    )
    parser.add_argument(
        "--max-items",
        type=int,
        default=env_int("TORRENT_ANALYZE_MAX_ITEMS", MAX_BATCH_ITEMS),
        help="从上下文最多处理的磁链/hash数量；默认读取 TORRENT_ANALYZE_MAX_ITEMS，脚本裁剪到 1..20",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        default=env_bool("TORRENT_ANALYZE_JSON", False),
        help="输出机器可读 JSON；可用 TORRENT_ANALYZE_JSON=1 设为默认开启",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        default=env_bool("TORRENT_ANALYZE_NO_CACHE", False),
        help="不读取也不写入缓存；可用 TORRENT_ANALYZE_NO_CACHE=1 设为默认开启",
    )
    parser.add_argument(
        "--stdin",
        action="store_true",
        help="强制从 stdin 读取上下文文本，并从中自动抽取磁链或 hash",
    )
    return parser.parse_args()


def read_context(args: argparse.Namespace) -> str:
    if args.stdin:
        return sys.stdin.read()
    if args.torrent_input:
        return args.torrent_input
    if not sys.stdin.isatty():
        return sys.stdin.read()
    return ""


def spans_overlap(left: tuple[int, int], right: tuple[int, int]) -> bool:
    return left[0] < right[1] and right[0] < left[1]


def extract_torrent_inputs(context: str, max_items: int) -> tuple[list[TorrentInput], int]:
    text = context.strip()
    if not text:
        return [], 0

    candidates: list[tuple[int, TorrentInput]] = []
    magnet_spans: list[tuple[int, int]] = []
    for match in MAGNET_RE.finditer(text):
        magnet_url = match.group(0).strip().rstrip(".,;，。；、")
        candidates.append(
            (
                match.start(),
                TorrentInput(
                    magnet_url=magnet_url,
                    torrent_hash=match.group(1),
                    raw_text=magnet_url,
                ),
            )
        )
        magnet_spans.append(match.span())

    for match in HASH_SEARCH_RE.finditer(text):
        if any(spans_overlap(match.span(), magnet_span) for magnet_span in magnet_spans):
            continue
        torrent_hash = match.group(1)
        candidates.append(
            (
                match.start(),
                TorrentInput(
                    magnet_url=f"magnet:?xt=urn:btih:{torrent_hash}",
                    torrent_hash=torrent_hash,
                    raw_text=torrent_hash,
                ),
            )
        )

    deduped: list[TorrentInput] = []
    seen_hashes: set[str] = set()
    for _, torrent_input in sorted(candidates, key=lambda item: item[0]):
        dedupe_key = torrent_input.torrent_hash.upper()
        if dedupe_key in seen_hashes:
            continue
        seen_hashes.add(dedupe_key)
        deduped.append(torrent_input)

    return deduped[:max_items], len(deduped)


def clamp_int(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(int(value), max_value))


def clamp_float(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(float(value), max_value))


def ensure_json_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("{}", encoding="utf-8")


def read_cache(cache_file: Path) -> dict[str, Any]:
    ensure_json_file(cache_file)
    try:
        data = json.loads(cache_file.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def write_cache(cache_file: Path, data: dict[str, Any]) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


async def request_torrent_info(
    magnet_url: str, retry_times: int, retry_interval: float
) -> dict[str, Any] | None:
    if httpx is None:
        raise RuntimeError("缺少依赖 httpx，请先安装：python3 -m pip install httpx")

    retries = clamp_int(retry_times, 1, 60)
    interval = clamp_float(retry_interval, 0.5, 30.0)
    encoded = urllib.parse.quote(magnet_url, safe="")
    url = f"{API_URL}?url={encoded}"

    async with httpx.AsyncClient(timeout=10) as client:
        for idx in range(retries):
            try:
                response = await client.get(url, headers=REQUEST_HEADERS)
                response.raise_for_status()
                data = response.json()
            except Exception as exc:
                print(f"[torrent-analyze] 请求失败({idx + 1}/{retries}): {exc}", file=sys.stderr)
                if idx < retries - 1:
                    await asyncio.sleep(interval)
                continue

            if data.get("error") in ("", None):
                return data

            if data.get("error") == "quota_limited" and idx < retries - 1:
                print(
                    f"[torrent-analyze] whatslink 频率限制({idx + 1}/{retries})，等待重试",
                    file=sys.stderr,
                )
                await asyncio.sleep(interval)
                continue
            return data

    return None


def should_cache(payload: dict[str, Any]) -> bool:
    return payload.get("error") == "" and str(payload.get("type", "")).strip() != "UNKNOWN"


def human_size(value: Any) -> str:
    try:
        size = float(value)
    except Exception:
        return "未知"

    for unit in ["B", "KB", "MB", "GB", "TB", "PB"]:
        if size < 1024:
            return f"{size:.2f}{unit}"
        size /= 1024
    return f"{size:.2f}EB"


def extract_screenshot_urls(payload: dict[str, Any], limit: int = 3) -> list[str]:
    screenshots = payload.get("screenshots", [])
    if not isinstance(screenshots, list):
        return []

    urls: list[str] = []
    for item in screenshots[:limit]:
        if isinstance(item, dict):
            url = item.get("screenshot")
            if isinstance(url, str) and url:
                urls.append(url)
    return urls


def format_torrent_text(torrent_hash: str, payload: dict[str, Any]) -> str:
    if payload.get("error"):
        return f"分析失败: {payload.get('error')}"

    name = str(payload.get("name", "未知"))
    type_name = str(payload.get("type", "UNKNOWN"))
    file_type = str(payload.get("file_type", "UNKNOWN"))
    count = payload.get("count", "未知")
    size_value = payload.get("size", 0)

    lines = [
        f"种子哈希: {torrent_hash}",
        f"文件类型: {type_name}-{file_type}",
        f"种子名称: {name}",
        f"总大小: {human_size(size_value)}",
        f"文件总数: {count}",
    ]
    return "\n".join(lines)


def build_font_candidates(font_dir: Path, font_filename: str, font_file: str) -> list[Path]:
    candidates: list[Path] = []
    preferred_file = font_file.strip()
    if preferred_file:
        candidates.append(Path(preferred_file).expanduser())

    preferred = font_filename.strip()
    if preferred:
        candidates.append(font_dir / preferred)
    else:
        candidates.append(font_dir / "font.ttf")

    for font_name in DEFAULT_MAPLE_ORDER:
        candidates.append(font_dir / font_name)
    for font_path in SYSTEM_CJK_FONT_CANDIDATES:
        candidates.append(Path(font_path))
    return candidates


def load_truetype_font(font_path: Path, font_size: int):
    """加载 TrueType/OpenType 字体，失败时返回 None 供后续候选继续尝试。"""
    try:
        font = ImageFont.truetype(str(font_path), size=font_size)
    except Exception as exc:
        print(f"[torrent-analyze] 字体不可用: {font_path} {exc}", file=sys.stderr)
        return None

    print(f"[torrent-analyze] 使用字体: {font_path}", file=sys.stderr)
    return font


def validate_font_cache_name(font_cache_filename: str) -> str:
    """校验字体缓存文件名，避免配置值逃逸到缓存目录之外。"""
    filename = font_cache_filename.strip() or DEFAULT_FONT_FILENAME
    if "/" in filename or "\\" in filename or filename in {".", ".."}:
        print(
            "[torrent-analyze] 字体缓存文件名非法，已改用默认文件名。",
            file=sys.stderr,
        )
        return DEFAULT_FONT_FILENAME
    return filename


def download_font(
    font_url: str,
    font_cache_dir: Path,
    font_cache_filename: str,
) -> Path | None:
    """按配置下载中文字体到缓存目录，已存在时直接复用。"""
    url = font_url.strip()
    if not url:
        print("[torrent-analyze] 未配置字体下载 URL，跳过自动下载。", file=sys.stderr)
        return None

    filename = validate_font_cache_name(font_cache_filename)
    font_cache_dir.mkdir(parents=True, exist_ok=True)
    font_path = font_cache_dir / filename
    temp_path = font_path.with_suffix(font_path.suffix + ".download")

    if font_path.exists() and font_path.stat().st_size > 0:
        return font_path

    print(f"[torrent-analyze] 未找到本地中文字体，开始下载: {url}", file=sys.stderr)
    try:
        request = urllib.request.Request(url, headers=REQUEST_HEADERS)
        with urllib.request.urlopen(request, timeout=30) as response:
            temp_path.write_bytes(response.read())
        temp_path.replace(font_path)
    except Exception as exc:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        print(f"[torrent-analyze] 自动下载中文字体失败: {exc}", file=sys.stderr)
        return None

    return font_path


def pick_font(
    font_dir: Path,
    font_filename: str,
    font_file: str,
    font_size: int,
    auto_download_font: bool,
    font_url: str,
    font_cache_dir: Path,
    font_cache_filename: str,
):
    """按配置字体、本地候选、系统字体、自动下载字体的顺序选择渲染字体。"""
    if ImageFont is None:
        raise RuntimeError("缺少依赖 Pillow，请先安装：python3 -m pip install Pillow")

    for font_path in build_font_candidates(font_dir, font_filename, font_file):
        if font_path.exists():
            font = load_truetype_font(font_path, font_size)
            if font is not None:
                return font

    if auto_download_font:
        downloaded_font = download_font(font_url, font_cache_dir, font_cache_filename)
        if downloaded_font is not None:
            font = load_truetype_font(downloaded_font, font_size)
            if font is not None:
                return font
            downloaded_font.unlink(missing_ok=True)
            downloaded_font = download_font(font_url, font_cache_dir, font_cache_filename)
            if downloaded_font is not None:
                font = load_truetype_font(downloaded_font, font_size)
                if font is not None:
                    return font

    print(
        "[torrent-analyze] 未找到可用中文字体，已回退默认字体原样渲染，中文可能显示异常。",
        file=sys.stderr,
    )
    return ImageFont.load_default()


def create_text_image(
    text: str,
    font_dir: Path,
    font_filename: str,
    font_file: str,
    auto_download_font: bool,
    font_url: str,
    font_cache_dir: Path,
    font_cache_filename: str,
    font_size: int = 24,
    line_spacing: int = 10,
    margin: int = 20,
):
    if Image is None or ImageDraw is None:
        raise RuntimeError("缺少依赖 Pillow，请先安装：python3 -m pip install Pillow")

    font = pick_font(
        font_dir=font_dir,
        font_filename=font_filename,
        font_file=font_file,
        font_size=font_size,
        auto_download_font=auto_download_font,
        font_url=font_url,
        font_cache_dir=font_cache_dir,
        font_cache_filename=font_cache_filename,
    )
    lines = text.split("\n")

    temp_image = Image.new("RGB", (1, 1), color=(255, 255, 255))
    draw = ImageDraw.Draw(temp_image)

    max_width = 0
    total_height = margin * 2
    for line in lines:
        left, top, right, bottom = draw.textbbox((0, 0), line, font=font)
        max_width = max(max_width, right - left)
        total_height += (bottom - top) + line_spacing

    image = Image.new("RGB", (max_width + margin * 2, total_height), color=(255, 255, 255))
    draw = ImageDraw.Draw(image)
    y = margin
    for line in lines:
        left, top, right, bottom = draw.textbbox((margin, y), line, font=font)
        draw.text((margin, y), line, fill=(0, 0, 0), font=font)
        y += (bottom - top) + line_spacing
    return image


async def fetch_image(client, url: str, blur_radius: int):
    if Image is None or ImageFilter is None:
        raise RuntimeError("缺少依赖 Pillow，请先安装：python3 -m pip install Pillow")

    try:
        response = await client.get(url, headers=REQUEST_HEADERS)
        response.raise_for_status()
    except Exception as exc:
        print(f"[torrent-analyze] 获取截图失败: {url} {exc}", file=sys.stderr)
        return None

    content_type = response.headers.get("Content-Type", "")
    if "image" not in content_type:
        return None

    try:
        image = Image.open(BytesIO(response.content)).convert("RGB")
        if blur_radius > 0:
            return image.filter(ImageFilter.GaussianBlur(blur_radius))
        return image
    except Exception as exc:
        print(f"[torrent-analyze] 处理截图失败: {url} {exc}", file=sys.stderr)
        return None


async def fetch_images(image_urls: list[str], blur_radius: int) -> list[Any]:
    if httpx is None:
        raise RuntimeError("缺少依赖 httpx，请先安装：python3 -m pip install httpx")

    async with httpx.AsyncClient(timeout=15) as client:
        results = await asyncio.gather(
            *[fetch_image(client, url, blur_radius) for url in image_urls],
            return_exceptions=True,
        )

    images = []
    for result in results:
        if Image is not None and isinstance(result, Image.Image):
            images.append(result)
    return images


def concatenate_images(text_image: Any, images: list[Any], margin: int = 20):
    if Image is None:
        raise RuntimeError("缺少依赖 Pillow，请先安装：python3 -m pip install Pillow")

    text_width, text_height = text_image.size
    total_height = text_height + margin
    resized_images = []

    for image in images:
        ratio = image.height / image.width
        new_height = int(text_width * ratio)
        resized = image.resize((text_width, new_height))
        resized_images.append(resized)
        total_height += new_height + margin

    final_image = Image.new("RGB", (text_width, total_height), color=(255, 255, 255))
    final_image.paste(text_image, (0, 0))
    y = text_height + margin
    for image in resized_images:
        final_image.paste(image, (0, y))
        y += image.height + margin
    return final_image


async def render_torrent_image(
    text_message: str,
    image_urls: list[str],
    output_dir: Path,
    blur_radius: int,
    font_dir: Path,
    font_filename: str,
    font_file: str,
    auto_download_font: bool,
    font_url: str,
    font_cache_dir: Path,
    font_cache_filename: str,
) -> Path | None:
    if not image_urls:
        return None

    print(f"[torrent-analyze] 图片渲染配置: blur={blur_radius}", file=sys.stderr)
    text_image = create_text_image(
        text=text_message,
        font_dir=font_dir,
        font_filename=font_filename,
        font_file=font_file,
        auto_download_font=auto_download_font,
        font_url=font_url,
        font_cache_dir=font_cache_dir,
        font_cache_filename=font_cache_filename,
    )
    images = await fetch_images(image_urls, blur_radius)
    if not images:
        return None

    final_image = concatenate_images(text_image, images)
    digest = sha256((text_message + "\n".join(image_urls)).encode("utf-8")).hexdigest()[:16]
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"torrent_{digest}.jpg"
    final_image.save(output_path, format="JPEG", quality=90)
    return output_path


def resolve_font_cache_dir(args: argparse.Namespace, cache_dir: Path) -> Path:
    configured_font_cache_dir = str(args.font_cache_dir).strip()
    if configured_font_cache_dir:
        return Path(configured_font_cache_dir).expanduser()
    return cache_dir / "fonts"


async def analyze_one(
    args: argparse.Namespace,
    torrent_input: TorrentInput,
    cache_file: Path,
    render_dir: Path,
    font_cache_dir: Path,
) -> TorrentResult:
    magnet_url = torrent_input.magnet_url
    torrent_hash = torrent_input.torrent_hash
    payload = None
    from_cache = False

    if not args.no_cache:
        cache = read_cache(cache_file)
        cached = cache.get(torrent_hash)
        if isinstance(cached, dict):
            payload = cached
            from_cache = True

    if payload is None:
        payload = await request_torrent_info(
            magnet_url=magnet_url,
            retry_times=args.retry_times,
            retry_interval=args.retry_interval,
        )
        if payload is None:
            return TorrentResult(
                ok=False,
                torrent_hash=torrent_hash,
                magnet_url=magnet_url,
                text="分析失败，请稍后再试。",
                payload={},
                screenshot_urls=[],
                from_cache=False,
            )
        if not args.no_cache and should_cache(payload):
            cache = read_cache(cache_file)
            cache[torrent_hash] = payload
            cache[torrent_hash]["_cached_at"] = int(time.time())
            write_cache(cache_file, cache)

    text = format_torrent_text(torrent_hash, payload)
    screenshot_urls = extract_screenshot_urls(payload, limit=3)
    result = TorrentResult(
        ok=not bool(payload.get("error")),
        torrent_hash=torrent_hash,
        magnet_url=magnet_url,
        text=text,
        payload=payload,
        screenshot_urls=screenshot_urls,
        from_cache=from_cache,
    )

    if args.image and screenshot_urls:
        blur_radius = clamp_int(args.blur, 0, 10)
        result.image_path = await render_torrent_image(
            text_message=text,
            image_urls=screenshot_urls,
            output_dir=render_dir,
            blur_radius=blur_radius,
            font_dir=Path(args.font_dir).expanduser(),
            font_filename=args.font_filename,
            font_file=args.font_file,
            auto_download_font=args.auto_download_font,
            font_url=args.font_url,
            font_cache_dir=font_cache_dir,
            font_cache_filename=args.font_cache_filename,
        )
    return result


async def analyze(args: argparse.Namespace) -> AnalyzeBatch:
    context = read_context(args)
    max_items = clamp_int(args.max_items, 1, MAX_BATCH_ITEMS)
    torrent_inputs, total_found = extract_torrent_inputs(context, max_items)
    if not torrent_inputs:
        message = "没有在输入或上下文中找到磁链或 32/40 位种子 hash。"
        if context.strip():
            message = "这不是一个有效的磁链或种子hash。"
        return AnalyzeBatch(results=[], total_found=0, max_items=max_items, message=message)

    cache_dir = Path(args.cache_dir).expanduser()
    cache_file = cache_dir / "torrent_info_cache.json"
    render_dir = cache_dir / "rendered"
    font_cache_dir = resolve_font_cache_dir(args, cache_dir)

    results: list[TorrentResult] = []
    for torrent_input in torrent_inputs:
        result = await analyze_one(
            args=args,
            torrent_input=torrent_input,
            cache_file=cache_file,
            render_dir=render_dir,
            font_cache_dir=font_cache_dir,
        )
        results.append(result)

    return AnalyzeBatch(results=results, total_found=total_found, max_items=max_items)


def print_single_text(result: TorrentResult) -> None:
    print(result.text)
    print("")
    print(f"来源: {'缓存' if result.from_cache else 'whatslink.info'}")
    if result.screenshot_urls:
        print(f"截图: {len(result.screenshot_urls)} 张")
    else:
        print("截图: 无")
    if result.image_path is not None:
        print(f"图片: {result.image_path}")


def result_to_json(result: TorrentResult) -> dict[str, Any]:
    return {
        "ok": result.ok,
        "torrent_hash": result.torrent_hash,
        "magnet_url": result.magnet_url,
        "text": result.text,
        "screenshot_urls": result.screenshot_urls,
        "from_cache": result.from_cache,
        "image_path": str(result.image_path) if result.image_path is not None else None,
        "payload": result.payload,
    }


def print_text(batch: AnalyzeBatch) -> None:
    if batch.message:
        print(batch.message)
        return

    if len(batch.results) == 1 and batch.total_found == 1:
        print_single_text(batch.results[0])
        return

    print(f"共识别到 {batch.total_found} 条磁链/hash，已处理 {len(batch.results)} 条。")
    if batch.total_found > len(batch.results):
        print(f"已按上限 {batch.max_items} 条截断。")
    for index, result in enumerate(batch.results, start=1):
        print("")
        print(f"## {index}. {result.torrent_hash}")
        print(result.text)
        print(f"来源: {'缓存' if result.from_cache else 'whatslink.info'}")
        print(f"截图: {len(result.screenshot_urls)} 张" if result.screenshot_urls else "截图: 无")
        if result.image_path is not None:
            print(f"图片: {result.image_path}")


def print_json(batch: AnalyzeBatch) -> None:
    if len(batch.results) == 1 and batch.total_found == 1:
        print(json.dumps(result_to_json(batch.results[0]), ensure_ascii=False, indent=2))
        return

    data = {
        "ok": bool(batch.results) and all(result.ok for result in batch.results),
        "total_found": batch.total_found,
        "processed": len(batch.results),
        "max_items": batch.max_items,
        "message": batch.message,
        "results": [result_to_json(result) for result in batch.results],
    }
    print(json.dumps(data, ensure_ascii=False, indent=2))


async def main() -> int:
    args = parse_args()
    try:
        batch = await analyze(args)
    except RuntimeError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print_json(batch)
    else:
        print_text(batch)
    return 0 if batch.results and all(result.ok for result in batch.results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
