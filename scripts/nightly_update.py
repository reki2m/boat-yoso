#!/usr/bin/env python3
"""
Nightly / every-other-day updater for:
- ボートレース日和 (via OpenAPI today cache + optional kyotei sample)
- 艇国後継 艇愛DB (boatrace-db.jp)
- hot racers rebuild
- optional backtest refresh

Intended cron (JST): 2:30 AM every other day
  30 2 */2 * * cd /path/to/boat-yoso && python3 scripts/nightly_update.py
"""

from __future__ import annotations

import json
import subprocess
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
STATE = DATA / "update_state.json"
JST = timezone(timedelta(hours=9))


def jst_now() -> datetime:
    return datetime.now(JST)


def should_run(force: bool = False) -> bool:
    if force:
        return True
    if not STATE.exists():
        return True
    st = json.loads(STATE.read_text(encoding="utf-8"))
    last = st.get("last_success_date")
    if not last:
        return True
    last_d = date.fromisoformat(last)
    return (jst_now().date() - last_d).days >= 2


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoNightly/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def update_openapi_today() -> None:
    today = jst_now().date()
    key = today.strftime("%Y%m%d")
    year = today.year
    for kind, url in [
        ("results", f"https://boatraceopenapi.github.io/results/v3/{year}/{key}.json"),
        ("programs", f"https://boatraceopenapi.github.io/programs/v3/{year}/{key}.json"),
        ("api", f"https://boatraceopenapi.github.io/api/v1/{year}/{key}.json"),
    ]:
        try:
            data = fetch_json(url)
        except Exception as e:
            print("skip", kind, e)
            continue
        path = DATA / kind / f"{key}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print("saved", path)
        time.sleep(0.2)


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if not should_run(args.force):
        print("skip: last update within 1 day window")
        return

    DATA.mkdir(parents=True, exist_ok=True)
    update_openapi_today()
    subprocess.check_call(["python3", str(ROOT / "scripts" / "sync_teikoku.py")], cwd=ROOT)
    subprocess.check_call(["python3", str(ROOT / "scripts" / "hot_racers.py")], cwd=ROOT)
    # refresh stadium rates if enough history
    try:
        subprocess.check_call(["python3", str(ROOT / "scripts" / "backtest_innige.py")], cwd=ROOT)
    except subprocess.CalledProcessError as e:
        print("backtest deferred", e)

    STATE.write_text(
        json.dumps(
            {
                "last_success_date": jst_now().date().isoformat(),
                "last_success_at": jst_now().isoformat(),
                "sources": [
                    "boatraceopenapi results/programs/api",
                    "boatrace-db.jp (艇国後継)",
                    "kyoteibiyori via app runtime",
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("nightly update complete")


if __name__ == "__main__":
    main()
