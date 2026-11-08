#!/usr/bin/env python3
"""Collect turnmark daily JSON (programs+preview+odds+results) for odds-aware backtests."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "turnmark"
UA = {"User-Agent": "BoatYosoResearch/1.0"}


def fetch(d: date) -> str:
    key = d.strftime("%Y%m%d")
    path = OUT / f"{key}.json"
    if path.exists():
        return f"skip {key}"
    url = f"https://turnmark.github.io/api/v1/{d.year}/{key}.json"
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            data = json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return f"empty {key}"
        raise
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    time.sleep(0.08)
    return f"ok {key}"


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-01-01")
    ap.add_argument("--end", default="2026-11-07")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    days = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur += timedelta(days=1)
    ok = skip = empty = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(fetch, d) for d in days]
        for i, fut in enumerate(as_completed(futs), 1):
            msg = fut.result()
            if msg.startswith("ok"):
                ok += 1
            elif msg.startswith("skip"):
                skip += 1
            else:
                empty += 1
            if i % 50 == 0:
                print(f"progress {i}/{len(days)} ok={ok} skip={skip} empty={empty}")
    print(f"done ok={ok} skip={skip} empty={empty}")


if __name__ == "__main__":
    main()
