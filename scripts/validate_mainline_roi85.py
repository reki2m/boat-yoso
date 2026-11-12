#!/usr/bin/env python3
"""Validate locked mainline (考察本線) all-buy ROI for 2021-2026."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RULE_PATH = ROOT / "src" / "data" / "locked_mainline_rule.json"
OUT = ROOT / "data" / "reports" / "validate_mainline_roi85.json"
STAKE = 100
CLASS_SCORE = {1: 1.0, 2: 0.72, 3: 0.42, 4: 0.2}


def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def score_boat(b: dict, course: int) -> dict:
    class_n = int(b.get("racer_class_number") or 4)
    nat = float(b.get("racer_national_top_1_percent") or 0)
    loc = float(b.get("racer_local_top_1_percent") or 0)
    motor = float(b.get("racer_assigned_motor_top_2_percent") or 0)
    boat = float(b.get("racer_assigned_boat_top_2_percent") or 0)
    st = float(b.get("racer_average_start_timing") or 0.2)
    class_score = CLASS_SCORE.get(class_n, 0.3)
    course_bias = 0.18 if course == 1 else 0.08 if course == 2 else 0.05 if course == 3 else 0
    score = (
        class_score * 20
        + clamp(nat / 8, 0, 1) * 20
        + clamp(loc / 8, 0, 1) * 10
        + clamp(motor / 60, 0, 1) * 14
        + clamp(boat / 60, 0, 1) * 8
        + clamp(1 - (st - 0.1) / 0.2, 0, 1) * 10
        + course_bias * 16
        + 9
    )
    return {
        "course": course,
        "nat": nat,
        "st": st,
        "motor": motor,
        "class": class_n,
        "score": round(score, 1),
    }


def conf(gap: float, top: float) -> int:
    s = 1
    if top >= 70:
        s += 1
    if top >= 85:
        s += 1
    if gap >= 4:
        s += 1
    if gap >= 8:
        s += 1
    if gap >= 14:
        s = min(5, s + 1)
    return max(1, min(5, s))


def is_finals(sub: str) -> bool:
    return ("優勝" in sub) or ("準優" in sub)


def main() -> None:
    rule = json.loads(RULE_PATH.read_text())
    tickets = list(rule["tickets"])
    wl = set(rule.get("stadium_whitelist") or [])
    bl = set(rule.get("stadium_blacklist") or [])
    rbl = set(rule.get("race_blacklist") or [])
    grades = set(rule.get("grades") or [4, 5])

    bets = pay = hits = n = 0
    yearly: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])

    for rp in sorted((DATA / "results").glob("*.json")):
        y = int(rp.stem[:4])
        if y < 2021:
            continue
        pp = DATA / "programs" / f"{rp.stem}.json"
        if not pp.exists():
            continue
        results = {
            (r["stadium_number"], r["number"]): r for r in json.loads(rp.read_text())["results"]
        }
        programs = {
            (p["stadium_number"], p["number"]): p for p in json.loads(pp.read_text())["programs"]
        }
        for key, prog in programs.items():
            res = results.get(key)
            if not res:
                continue
            boats = {b["racer_boat_number"]: b for b in prog["boats"]}
            if any(i not in boats for i in range(1, 7)):
                continue
            places = sorted(
                [b for b in res["boats"] if 1 <= (b.get("racer_place_number") or 99) <= 6],
                key=lambda x: x["racer_place_number"],
            )
            if len(places) < 3:
                continue

            stadium = prog["stadium_number"]
            race_no = prog["number"]
            grade = int(prog.get("grade_number") or 5)
            sub = prog.get("subtitle") or ""
            if bl and stadium in bl:
                continue
            if wl and stadium not in wl:
                continue
            if race_no in rbl:
                continue
            if grade not in grades:
                continue
            if rule.get("exclude_finals") and is_finals(sub):
                continue

            # entry-change skip (result-course proxy)
            entry_changed = False
            for b in res.get("boats") or []:
                entry = b.get("racer_boat_number")
                course = b.get("racer_course_number") or b.get("course_number")
                try:
                    if entry is not None and course is not None and int(entry) != int(course):
                        entry_changed = True
                        break
                except Exception:
                    pass
            if entry_changed:
                continue

            views = [score_boat(boats[c], c) for c in range(1, 7)]
            ranked = sorted(views, key=lambda x: -x["score"])
            gap = ranked[0]["score"] - ranked[1]["score"]
            top = ranked[0]["score"]
            c1 = next(v for v in views if v["course"] == 1)
            c2 = next(v for v in views if v["course"] == 2)
            if ranked[0]["course"] != 1:
                continue
            if c1["class"] > rule["max_c1_class"]:
                continue
            if c1["nat"] < rule["min_c1_nat"]:
                continue
            if c1["st"] > rule["max_c1_st"]:
                continue
            if c1["motor"] < rule["min_motor2"]:
                continue
            if (c1["nat"] - c2["nat"]) < float(rule.get("min_nat_gap_c2") or 0):
                continue
            if gap < rule["min_score_gap"]:
                continue
            if conf(gap, top) < rule["min_confidence"]:
                continue

            tri = {
                x["combination"]: int(x["amount"])
                for x in (res.get("payouts") or {}).get("trifecta") or []
            }
            stake = STAKE * len(tickets)
            rp_amt = sum(int(tri.get(t) or 0) for t in tickets)
            hit = any(int(tri.get(t) or 0) > 0 for t in tickets)
            n += 1
            bets += stake
            pay += rp_amt
            hits += int(hit)
            yv = yearly[y]
            yv[0] += stake
            yv[1] += rp_amt
            yv[2] += 1

    roi = (100 * pay / bets) if bets else 0
    min_y = min((100 * v[1] / v[0]) for v in yearly.values()) if yearly else 0
    out = {
        "rule": rule,
        "period": "2021-2026",
        "selected": n,
        "hit_rate": round(100 * hits / n, 2) if n else 0,
        "roi": round(roi, 2),
        "min_year_roi": round(min_y, 2),
        "pnl": pay - bets,
        "tickets": tickets,
        "meets_target_roi_85": roi >= 85 and min_y >= 85,
        "yearly": {
            str(y): {"n": v[2], "roi": round(100 * v[1] / v[0], 2)}
            for y, v in sorted(yearly.items())
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
