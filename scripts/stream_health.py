import concurrent.futures
import json
import re
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FILES = ["data/playlist.m3u", "data/india-working.m3u"]
CANDIDATES = "data/india-candidates.m3u"
HEALTH = ROOT / "data/stream-health.json"
QUARANTINE = ROOT / "data/stream-quarantine.json"
WORKERS = 48
TIMEOUT = 10
MAX_FAILURES = 3

def read_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default

def parse_playlist(path):
    if not path.exists():
        return [], []
    lines = path.read_text(errors="replace").splitlines()
    starts = [i for i, line in enumerate(lines)
              if line.startswith("#EXTINF")]
    if not starts:
        return lines, []

    header = lines[:starts[0]]
    entries = []

    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(lines)
        block = lines[start:end]
        url = next((x.strip() for x in block
                    if x.strip().startswith(("http://", "https://"))), "")
        if url:
            entries.append({"url": url, "lines": block})
        else:
            header.extend(block)

    return header, entries

def write_playlist(path, header, entries):
    output = list(header)
    if not any(x.strip() == "#EXTM3U" for x in output):
        output.insert(0, "#EXTM3U")
    for entry in entries:
        output.extend(entry["lines"])
    path.write_text("\n".join(output).rstrip() + "\n")

def request(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; AKSHAY-TV-Health-Checker/1.0)",
            "Range": "bytes=0-65535"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            return response.status, response.read(65536), response.geturl(), \
                   response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, b"", url, e.headers.get("Content-Type", "")
    except Exception as e:
        return 0, b"", url, type(e).__name__

def inspect_stream(url):
    current = url

    for depth in range(4):
        status, body, final_url, content_type = request(current)

        if status in (401, 403, 407, 429, 451):
            return "restricted", f"HTTP_{status}"

        if status == 0:
            return "fail", f"NETWORK_{content_type}"

        if status not in (200, 206):
            return "fail", f"HTTP_{status}"

        if not body:
            return "fail", "EMPTY_RESPONSE"

        sample = body.lstrip().lower()
        if sample.startswith((b"<!doctype html", b"<html", b"{")):
            return "fail", "HTML_OR_JSON_RESPONSE"

        text = body.decode("utf-8", errors="ignore")
        is_hls = (
            urlsplit(current).path.lower().endswith(".m3u8")
            or text.lstrip().startswith("#EXTM3U")
        )

        if is_hls:
            lines = [x.strip() for x in text.splitlines() if x.strip()]
            child = None

            for i, line in enumerate(lines):
                if line.startswith("#EXT-X-STREAM-INF"):
                    child = next(
                        (x for x in lines[i+1:] if not x.startswith("#")),
                        None
                    )
                    break

            if child is None:
                child = next(
                    (x for x in lines if not x.startswith("#")),
                    None
                )

            if not child:
                return "fail", "HLS_NO_PLAYLIST_OR_SEGMENT"

            current = urljoin(final_url, child)
            continue

        if len(body) < 256:
            return "fail", "RESPONSE_TOO_SMALL"

        if "text/html" in content_type.lower():
            return "fail", "HTML_CONTENT_TYPE"

        return "pass", "STREAM_DATA_REACHABLE"

    return "fail", "HLS_NESTING_LIMIT"

def main():
    history = read_json(HEALTH, {})
    quarantine_data = read_json(QUARANTINE, [])
    if not isinstance(history, dict):
        history = {}
    if not isinstance(quarantine_data, list):
        quarantine_data = []

    active = {}
    headers = {}

    for filename in FILES:
        path = ROOT / filename
        header, entries = parse_playlist(path)
        headers[filename] = header
        active[filename] = entries

    _, candidate_entries = parse_playlist(ROOT / CANDIDATES)

    urls = {
        e["url"]
        for entries in active.values()
        for e in entries
    }
    urls.update(
        e["url"] for e in quarantine_data
        if isinstance(e, dict) and e.get("url")
    )
    urls.update(e["url"] for e in candidate_entries)

    print("Candidate India entries:", len(candidate_entries))
    print("Unique stream URLs to test:", len(urls))
    print("Concurrent workers:", WORKERS)

    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(inspect_stream, u): u for u in urls}
        for future in concurrent.futures.as_completed(futures):
            url = futures[future]
            try:
                results[url] = future.result()
            except Exception as e:
                results[url] = ("fail", type(e).__name__)

    removed = 0
    restored = 0
    restricted = 0
    passed = 0
    new_quarantine = []

    # Evaluate each unique active URL only once per scan.
    processed_active_urls = set()
    for filename, entries in active.items():
        keep = []
        for entry in entries:
            url = entry["url"]
            status, reason = results[url]

            if url not in processed_active_urls:
                processed_active_urls.add(url)

                if status == "pass":
                    passed += 1
                    history.pop(url, None)

                elif status == "restricted":
                    restricted += 1

                else:
                    failures = int(history.get(url, {}).get("failures", 0)) + 1
                    history[url] = {
                        "failures": failures,
                        "last_reason": reason
                    }

            if status == "pass" or status == "restricted":
                keep.append(entry)
            else:
                failures = int(history.get(url, {}).get("failures", 0))

                if failures >= MAX_FAILURES:
                    new_quarantine.append({
                        "source": filename,
                        "url": url,
                        "lines": entry["lines"],
                        "failures": failures,
                        "reason": reason
                    })
                    removed += 1
                    print("QUARANTINED:", entry["lines"][0][-90:], reason)
                else:
                    keep.append(entry)

        active[filename] = keep

    # Recheck quarantined URLs; count each unique URL only once per scan.
    still_quarantined = []
    processed_quarantine_urls = set()
    for entry in quarantine_data:
        if not isinstance(entry, dict) or not entry.get("url"):
            continue

        url = entry["url"]
        status, reason = results[url]

        if status == "pass":
            filename = entry.get("source", FILES[0])
            if filename not in active:
                filename = FILES[0]
            active[filename].append({
                "url": url,
                "lines": entry.get("lines", [])
            })
            history.pop(url, None)
            restored += 1
            print("RESTORED:", url)

        elif status == "restricted":
            if url not in processed_quarantine_urls:
                restricted += 1
                processed_quarantine_urls.add(url)
            still_quarantined.append(entry)

        else:
            if url not in processed_quarantine_urls:
                previous = int(history.get(url, {}).get(
                    "failures", entry.get("failures", 0)
                ))
                failures = previous + 1
                history[url] = {
                    "failures": failures,
                    "last_reason": reason
                }
                processed_quarantine_urls.add(url)
            else:
                failures = int(history.get(url, {}).get(
                    "failures", entry.get("failures", 0)
                ))

            entry["failures"] = failures
            entry["reason"] = reason
            still_quarantined.append(entry)

    quarantine_data = still_quarantined + new_quarantine

    promoted = 0
    india_filename = "data/india-working.m3u"
    india_urls = {entry["url"] for entry in active[india_filename]}

    for entry in candidate_entries:
        url = entry["url"]
        status, reason = results[url]

        if status == "pass" and url not in india_urls:
            active[india_filename].append(entry)
            india_urls.add(url)
            promoted += 1
            print("INDIA CHANNEL ADDED:", entry["lines"][0][-90:])

    for filename in FILES:
        write_playlist(ROOT / filename, headers[filename], active[filename])

    HEALTH.write_text(json.dumps(history, indent=2) + "\n")
    QUARANTINE.write_text(json.dumps(quarantine_data, indent=2) + "\n")

    print("\n===== AKSHAY TV HEALTH REPORT =====")
    print("Reachable feed checks:", passed)
    print("Restricted / not judged:", restricted)
    print("Newly quarantined entries:", removed)
    print("Recovered entries restored:", restored)
    print("New India candidates promoted:", promoted)
    print("India working entries:",
          len(active["data/india-working.m3u"]))
    print("Currently quarantined:", len(quarantine_data))
    print("Remaining worldwide entries:",
          sum(len(x) for x in active.values()))
    print("Health scan completed.")

if __name__ == "__main__":
    main()
