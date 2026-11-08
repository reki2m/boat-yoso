#!/usr/bin/env python3
"""Collect daily programs+results for all stadiums (OpenAPI) with polite concurrency."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UA = {"User-Agent": "BoatYosoResearch/1.0 (+local research; polite)"}


def fetch(url: str) -> dict | None:
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=40) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def day_paths(d: date) -> tuple[Path, Path]:
    key = d.strftime("%Y%m%d")
    return (
        DATA / "results" / f"{key}.json",
        DATA / "programs" / f"{key}.json",
    )


def collect_one(d: date, force: bool = False) -> str:
    rp, pp = day_paths(d)
    key = d.strftime("%Y%m%d")
    year = d.year
    if not force and rp.exists() and pp.exists():
        return f"skip {key}"
    if force or not rp.exists():
        results = fetch(
            f"https://boatraceopenapi.github.io/results/v3/{year}/{key}.json"
        )
        if results is None:
            return f"empty {key}"
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
        time.sleep(0.12)
    if force or not pp.exists():
        programs = fetch(
            f"https://boatraceopenapi.github.io/programs/v3/{year}/{key}.json"
        )
        if programs is None:
            return f"no-program {key}"
        pp.parent.mkdir(parents=True, exist_ok=True)
        pp.write_text(json.dumps(programs, ensure_ascii=False), encoding="utf-8")
        time.sleep(0.12)
    return f"ok {key}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2021-01-01")
    ap.add_argument("--end", default="2025-12-31")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    days = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur += timedelta(days=1)

    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "results").mkdir(exist_ok=True)
    (DATA / "programs").mkdir(exist_ok=True)

    ok = skip = empty = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(collect_one, d, args.force): d for d in days}
        for i, fut in enumerate(as_completed(futs), 1):
            msg = fut.result()
            if msg.startswith("ok"):
                ok += 1
            elif msg.startswith("skip"):
                skip += 1
            else:
                empty += 1
            if i % 100 == 0:
                print(f"progress {i}/{len(days)} ok={ok} skip={skip} empty={empty}")
    print(f"done ok={ok} skip={skip} empty={empty} total_days={len(days)}")


if __name__ == "__main__":
    main()
