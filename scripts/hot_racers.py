#!/usr/bin/env python3
"""Pick racers on a roll over the last 1-3 months from collected results."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = DATA / "reports" / "hot_racers.json"

STADIUMS = {
    1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川", 6: "浜名湖",
    7: "蒲郡", 8: "常滑", 9: "津", 10: "三国", 11: "びわこ", 12: "住之江",
    13: "尼崎", 14: "鳴門", 15: "丸亀", 16: "児島", 17: "宮島", 18: "徳山",
    19: "下関", 20: "若松", 21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村",
}


def latest_result_date() -> date:
    files = sorted((DATA / "results").glob("*.json"))
    if not files:
        return date.today()
    stem = files[-1].stem
    return date(int(stem[:4]), int(stem[4:6]), int(stem[6:8]))


def main() -> None:
    today = latest_result_date()
    windows = {
        "1m": today - timedelta(days=30),
        "3m": today - timedelta(days=90),
    }
    stats = {
        w: defaultdict(lambda: {"starts": 0, "wins": 0, "top2": 0, "top3": 0, "name": "", "by_course": defaultdict(lambda: [0, 0])})
        for w in windows
    }

    for rp in (DATA / "results").glob("*.json"):
        d = date(int(rp.stem[:4]), int(rp.stem[4:6]), int(rp.stem[6:8]))
        payload = json.loads(rp.read_text(encoding="utf-8"))
        for race in payload.get("results", []):
            for boat in race.get("boats", []):
                regno = boat.get("racer_number")
                place = boat.get("racer_place_number")
                course = boat.get("racer_course_number")
                if not regno or not place or place > 6:
                    continue
                for w, start in windows.items():
                    if d < start:
                        continue
                    s = stats[w][regno]
                    s["name"] = boat.get("racer_name") or s["name"]
                    s["starts"] += 1
                    s["wins"] += int(place == 1)
                    s["top2"] += int(place <= 2)
                    s["top3"] += int(place <= 3)
                    if course:
                        s["by_course"][course][0] += 1
                        s["by_course"][course][1] += int(place == 1)

    report = {}
    for w, table in stats.items():
        ranked = []
        for regno, s in table.items():
            if s["starts"] < (8 if w == "1m" else 20):
                continue
            win_rate = s["wins"] / s["starts"]
            top2 = s["top2"] / s["starts"]
            score = win_rate * 0.6 + top2 * 0.4
            best_course = None
            best_rate = -1
            for c, (n, wins) in s["by_course"].items():
                if n >= 3:
                    rate = wins / n
                    if rate > best_rate:
                        best_rate = rate
                        best_course = c
            ranked.append(
                {
                    "regno": regno,
                    "name": s["name"],
                    "starts": s["starts"],
                    "wins": s["wins"],
                    "win_rate": round(win_rate, 4),
                    "top2_rate": round(top2, 4),
                    "top3_rate": round(s["top3"] / s["starts"], 4),
                    "score": round(score, 4),
                    "best_course": best_course,
                    "best_course_win_rate": round(best_rate, 4) if best_course else None,
                }
            )
        ranked.sort(key=lambda x: x["score"], reverse=True)
        report[w] = ranked[:40]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "as_of": today.isoformat(),
                "note": "直近1〜3ヶ月の結果からノリ好調選手を抽出（全場）",
                "windows": report,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("wrote", OUT, "1m", len(report["1m"]), "3m", len(report["3m"]))


if __name__ == "__main__":
    main()
