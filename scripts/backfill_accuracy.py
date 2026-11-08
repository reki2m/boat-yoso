#!/usr/bin/env python3
"""過去日の買い目を retrospectively 生成し、展示確認＋的中再計算する。"""

from __future__ import annotations

import json
import subprocess
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JST = timezone(timedelta(hours=9))


def fetch(date_key: str) -> bool:
    year = date_key[:4]
    path = ROOT / "data" / "api" / f"{date_key}.json"
    if path.exists():
        return True
    url = f"https://boatraceopenapi.github.io/api/v1/{year}/{date_key}.json"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoNightly/2.0"})
        with urllib.request.urlopen(req, timeout=45) as res:
            data = json.loads(res.read())
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return True
    except Exception as e:
        print("skip fetch", date_key, e)
        return False


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=70)
    args = ap.parse_args()
    now = datetime.now(JST)
    dates = [(now - timedelta(days=i)).strftime("%Y%m%d") for i in range(1, args.days + 1)]

    for d in dates:
        if not fetch(d):
            continue
        subprocess.check_call(
            ["python3", str(ROOT / "scripts" / "generate_day_picks.py"), "--date", d, "--phase", "manual"],
            cwd=ROOT,
        )
        subprocess.check_call(
            ["python3", str(ROOT / "scripts" / "confirm_exhibition.py"), "--date", d],
            cwd=ROOT,
        )

    subprocess.check_call(
        ["python3", str(ROOT / "scripts" / "score_picks.py"), "--days", str(args.days)],
        cwd=ROOT,
    )
    # restore today's board after backfill overwrote active board
    subprocess.check_call(["python3", str(ROOT / "scripts" / "generate_day_picks.py")], cwd=ROOT)
    subprocess.check_call(["python3", str(ROOT / "scripts" / "confirm_exhibition.py")], cwd=ROOT)
    print("backfill accuracy complete")


if __name__ == "__main__":
    main()
