#!/usr/bin/env python3
"""
Sync 艇国データバンク後継 = 艇愛ボートレースDB (boatrace-db.jp).
元サイト boatrace-db.net は2026年10月頃から不通のため後継APIを使用。
"""

from __future__ import annotations

import json
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "teikoku"
UA = {"User-Agent": "BoatYosoResearch/1.0"}


def fetch(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.loads(res.read())


def sync_day(d: date, stadiums: list[int] | None = None) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    key = d.strftime("%Y%m%d")
    day_dir = OUT / key
    day_dir.mkdir(exist_ok=True)
    count = 0
    targets = stadiums or list(range(1, 25))
    for pid in targets:
        for rno in range(1, 13):
            path = day_dir / f"{pid:02d}_{rno}.json"
            if path.exists():
                continue
            url = f"https://boatrace-db.jp/api/race/{key}/{pid:02d}/{rno}/"
            try:
                data = fetch(url)
            except Exception:
                continue
            if not data.get("race"):
                continue
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            count += 1
            time.sleep(0.25)
    meta = {
        "date": key,
        "source": "boatrace-db.jp",
        "note": "艇国データバンク後継（艇愛ボートレースDB）",
        "files": count,
        "synced_at": time.strftime("%Y-%m-%dT%H:%M:%S+09:00"),
    }
    (day_dir / "_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return count


def main() -> None:
    # default: yesterday JST-ish (UTC+9 approx by using local if set)
    d = date.today() - timedelta(days=1)
    n = sync_day(d)
    print(f"synced {d} files={n}")


if __name__ == "__main__":
    main()
