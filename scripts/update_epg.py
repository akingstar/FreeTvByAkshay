#!/usr/bin/env python3
import gzip
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://iptv-epg.org/files/epg-in.xml.gz"
OUTPUT = ROOT / "data" / "epg.json"
PLAYLISTS = [
    ROOT / "data" / "india-working.m3u",
    ROOT / "data" / "india-candidates.m3u",
    ROOT / "data" / "playlist.m3u",
]

def get_target_ids():
    result = set()
    pattern = re.compile(r'tvg-id="([^"]+)"')
    for path in PLAYLISTS:
        if not path.exists():
            continue
        for line in path.read_text(errors="ignore").splitlines():
            if line.startswith("#EXTINF:"):
                match = pattern.search(line)
                if match:
                    result.add(match.group(1).split("@", 1)[0])
    return result

def parse_xmltv_time(value):
    value = (value or "").strip()
    match = re.match(r"^(\d{14}|\d{12})(?:\s*([+-]\d{4}))?", value)
    if not match:
        return None
    raw, offset = match.groups()
    fmt = "%Y%m%d%H%M%S" if len(raw) == 14 else "%Y%m%d%H%M"
    dt = datetime.strptime(raw, fmt)
    if offset:
        sign = 1 if offset[0] == "+" else -1
        hours = int(offset[1:3])
        minutes = int(offset[3:5])
        tz = timezone(sign * timedelta(hours=hours, minutes=minutes))
    else:
        tz = timezone.utc
    return int(dt.replace(tzinfo=tz).timestamp())

def main():
    target_ids = get_target_ids()
    if not target_ids:
        raise SystemExit("No playlist tvg-id values found.")

    now = int(datetime.now(timezone.utc).timestamp())
    cutoff = now - 24 * 3600
    horizon = now + 36 * 3600
    programmes = defaultdict(list)
    seen = set()

    request = urllib.request.Request(
        SOURCE,
        headers={"User-Agent": "AKSHAY-TV-EPG/1.0"}
    )

    print("Downloading India XMLTV guide...")
    with urllib.request.urlopen(request, timeout=180) as response:
        with gzip.GzipFile(fileobj=response) as stream:
            context = ET.iterparse(stream, events=("start", "end"))
            _, root = next(context)

            for event, elem in context:
                if event != "end":
                    continue

                if elem.tag == "programme":
                    channel = elem.get("channel", "")
                    if channel in target_ids:
                        start = parse_xmltv_time(elem.get("start"))
                        stop = parse_xmltv_time(elem.get("stop"))

                        if start is not None and stop is not None:
                            if stop > now and start >= cutoff and start < horizon and stop > start:
                                title = (elem.findtext("title") or "").strip()
                                desc = (elem.findtext("desc") or "").strip()
                                key = (channel, start, stop, title)

                                if title and key not in seen:
                                    seen.add(key)
                                    item = {
                                        "start": start,
                                        "stop": stop,
                                        "title": title
                                    }
                                    if desc:
                                        item["desc"] = desc[:400]
                                    programmes[channel].append(item)

                    elem.clear()
                    root.clear()

                elif elem.tag == "channel":
                    elem.clear()

    for channel in programmes:
        programmes[channel].sort(key=lambda item: item["start"])

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated": now,
        "source": "iptv-epg.org",
        "channels": dict(programmes)
    }

    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8"
    )

    print("Playlist base IDs:", len(target_ids))
    print("EPG matched channels:", len(programmes))
    print("Programme records:", sum(map(len, programmes.values())))
    print("JSON size:", OUTPUT.stat().st_size, "bytes")
    print("Saved:", OUTPUT)

if __name__ == "__main__":
    main()
