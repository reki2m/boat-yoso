#!/usr/bin/env python3
"""Build per-racer course win rates from historical results (all stadiums)."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = DATA / "reports" / "course_skills.json"


def main() -> None:
    # regno -> course -> [starts, wins, top2, top3]
    stats: dict[int, dict[int, list[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0, 0, 0])
    )
    names: dict[int, str] = {}
    for rp in (DATA / "results").glob("*.json"):
        payload = json.loads(rp.read_text(encoding="utf-8"))
        for race in payload.get("results", []):
            for boat in race.get("boats", []):
                regno = boat.get("racer_number")
                course = boat.get("racer_course_number")
                place = boat.get("racer_place_number")
                if not regno or not course or not place or place > 6:
                    continue
                names[regno] = boat.get("racer_name") or names.get(regno, "")
                s = stats[regno][course]
                s[0] += 1
                s[1] += int(place == 1)
                s[2] += int(place <= 2)
                s[3] += int(place <= 3)

    out = {}
    for regno, courses in stats.items():
        by_c = {}
        best = None
        best_rate = -1.0
        for c, (n, w, t2, t3) in courses.items():
            if n < 5:
                continue
            wr = w / n
            by_c[str(c)] = {
                "starts": n,
                "wins": w,
                "win_rate": round(wr, 4),
                "top2_rate": round(t2 / n, 4),
                "top3_rate": round(t3 / n, 4),
            }
            if wr > best_rate:
                best_rate = wr
                best = c
        if by_c:
            out[str(regno)] = {
                "name": names.get(regno, ""),
                "best_course": best,
                "courses": by_c,
            }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print("racers", len(out), "->", OUT)


if __name__ == "__main__":
    main()
