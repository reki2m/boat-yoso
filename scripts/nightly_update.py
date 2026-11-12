#!/usr/bin/env python3
"""
毎晩の最新データ取得パイプライン（JST 想定）

1. 昨日〜今日の OpenAPI programs/results を取得
2. 艇愛DB同期・得意コース・ホット選手を更新
3. 翌日（なければ当日）の場×レース買い目を生成
4. 直近買い目の的中を再計算

cron 例（毎日 2:15 JST）:
  15 2 * * * cd /path/to/boat-yoso && python3 scripts/nightly_update.py --force
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


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoNightly/2.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def save_kind(kind: str, key: str, url: str) -> bool:
    try:
        data = fetch_json(url)
    except Exception as e:
        print("skip", kind, key, e)
        return False
    path = DATA / kind / f"{key}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print("saved", path)
    time.sleep(0.15)
    return True


def update_openapi_range(days_back: int = 2, days_forward: int = 1) -> dict:
    today = jst_now().date()
    stats = {"ok": 0, "fail": 0}
    for delta in range(-days_back, days_forward + 1):
        d = today + timedelta(days=delta)
        key = d.strftime("%Y%m%d")
        year = d.year
        pairs = [
            ("results", f"https://boatraceopenapi.github.io/results/v3/{year}/{key}.json"),
            ("programs", f"https://boatraceopenapi.github.io/programs/v3/{year}/{key}.json"),
            ("api", f"https://boatraceopenapi.github.io/api/v1/{year}/{key}.json"),
        ]
        for kind, url in pairs:
            ok = save_kind(kind, key, url)
            stats["ok" if ok else "fail"] += 1
    # always refresh today.json alias
    try:
        data = fetch_json("https://boatraceopenapi.github.io/api/v1/today.json")
        path = DATA / "api" / "today.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        print("saved", path)
    except Exception as e:
        print("today.json fail", e)
        stats["fail"] += 1
    return stats


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.check_call(cmd, cwd=ROOT)


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="毎回実行（既定も毎日実行）")
    args = ap.parse_args()
    _ = args  # daily by default now

    DATA.mkdir(parents=True, exist_ok=True)
    print("nightly start", jst_now().isoformat())

    stats = update_openapi_range(days_back=2, days_forward=1)

    # 艇愛DB（失敗しても継続）
    try:
        run(["python3", str(ROOT / "scripts" / "sync_teikoku.py")])
    except subprocess.CalledProcessError as e:
        print("teikoku deferred", e)

    try:
        run(["python3", str(ROOT / "scripts" / "build_course_skills.py")])
    except subprocess.CalledProcessError as e:
        print("course skills deferred", e)

    try:
        run(["python3", str(ROOT / "scripts" / "hot_racers.py")])
    except subprocess.CalledProcessError as e:
        print("hot racers deferred", e)

    # 前日〜翌日買い目
    run(["python3", str(ROOT / "scripts" / "generate_day_picks.py")])

    # スタート展示確認（進入変更・異常はスキップ）
    try:
        run(["python3", str(ROOT / "scripts" / "confirm_exhibition.py")])
    except subprocess.CalledProcessError as e:
        print("exhibition confirm deferred", e)

    # Discord へ買い目送信（Webhook未設定ならスキップ）
    try:
        run(["python3", str(ROOT / "scripts" / "send_discord_picks.py")])
    except subprocess.CalledProcessError as e:
        print("discord notify deferred", e)

    # 的中再計算
    run(["python3", str(ROOT / "scripts" / "score_picks.py"), "--days", "14"])

    # 回収率モニタ＋閾値の自動学習（改善時のみ適用）
    learning = {"ok": False}
    try:
        run(["python3", str(ROOT / "scripts" / "learn_roi_daily.py")])
        learning = {"ok": True}
    except subprocess.CalledProcessError as e:
        print("roi learning deferred", e)
        learning = {"ok": False, "error": str(e)}

    # 展示事故（進入変更など）の学習集計
    try:
        run(["python3", str(ROOT / "scripts" / "learn_exhibition_incidents.py")])
    except subprocess.CalledProcessError as e:
        print("exhibition incident learning deferred", e)

    # 学習で閾値が変わった場合に当日ボードを再生成
    if learning.get("ok"):
        try:
            run(["python3", str(ROOT / "scripts" / "generate_day_picks.py")])
            run(["python3", str(ROOT / "scripts" / "confirm_exhibition.py")])
        except subprocess.CalledProcessError as e:
            print("post-learn regenerate deferred", e)

    state = {
        "last_success_date": jst_now().date().isoformat(),
        "last_success_at": jst_now().isoformat(),
        "openapi_stats": stats,
        "cadence": "nightly_daily",
        "learning": learning,
        "sources": [
            "boatraceopenapi results/programs/api",
            "boatrace-db.jp",
            "course_skills / hot_racers / day_picks / accuracy / roi_learning",
        ],
        "policy": {
            "day_before_picks": True,
            "skip_on_entry_change": True,
            "require_start_exhibition": True,
            "auto_learn_roi": True,
        },
    }
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "src" / "data" / "update_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("nightly update complete")


if __name__ == "__main__":
    main()
