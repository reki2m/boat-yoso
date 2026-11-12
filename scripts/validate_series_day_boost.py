#!/usr/bin/env python3
"""
仮説検証:
1) 今節3日目以降なら考察買い目(本線4-6点)の精度が上がるか
2) 準優勝戦・優勝戦なら固くなるか
3) それらで絞る「ブースト」は回収を改善するか
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = DATA / "reports"
STAKE = 100
CLASS_SCORE = {1: 1.0, 2: 0.72, 3: 0.42, 4: 0.2}

DAY_MAP = {
    "初日": 1,
    "１日目": 1,
    "1日目": 1,
    "２日目": 2,
    "2日目": 2,
    "３日目": 3,
    "3日目": 3,
    "４日目": 4,
    "4日目": 4,
    "５日目": 5,
    "5日目": 5,
    "６日目": 6,
    "6日目": 6,
    "７日目": 7,
    "7日目": 7,
    "最終日": 99,  # late special
}


def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def parse_day(label: str | None) -> int | None:
    if not label:
        return None
    if label in DAY_MAP:
        return DAY_MAP[label]
    m = re.search(r"([0-9０-９]+)日目", label)
    if m:
        s = m.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789"))
        return int(s)
    return None


def race_phase(subtitle: str | None, title: str | None) -> str:
    blob = f"{subtitle or ''}|{title or ''}"
    if "優勝戦" in blob and "準" not in blob.split("優勝戦")[0][-2:]:
        # 優勝戦 (not 準優勝戦)
        if "準優勝戦" in blob:
            return "junyusho"  # both rare; prefer jun if present separately
        return "yusho"
    if "準優勝戦" in blob or "準優" in blob:
        return "junyusho"
    if "予選" in blob:
        return "yosen"
    return "other"


def score_boat(b: dict, course: int) -> dict:
    class_n = int(b.get("racer_class_number") or 4)
    class_score = CLASS_SCORE.get(class_n, 0.3)
    nat = float(b.get("racer_national_top_1_percent") or 0)
    loc = float(b.get("racer_local_top_1_percent") or 0)
    motor = float(b.get("racer_assigned_motor_top_2_percent") or 0)
    boat = float(b.get("racer_assigned_boat_top_2_percent") or 0)
    st = float(b.get("racer_average_start_timing") or 0.2)
    national = clamp(nat / 8, 0, 1)
    local = clamp(loc / 8, 0, 1)
    motor_s = clamp(motor / 60, 0, 1)
    boat_s = clamp(boat / 60, 0, 1)
    start = clamp(1 - (st - 0.1) / 0.2, 0, 1)
    course_bias = 0.18 if course == 1 else 0.08 if course == 2 else 0.05 if course == 3 else 0
    score = (
        class_score * 20
        + national * 20
        + local * 10
        + motor_s * 14
        + boat_s * 8
        + start * 10
        + course_bias * 16
        + 0.5 * 18
    )
    return {
        "course": course,
        "nationalWin": nat,
        "motorTop2": motor,
        "avgStart": st,
        "score": round(score, 1),
    }


def unique(tickets: list[str]) -> list[str]:
    out, seen = [], set()
    for t in tickets:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def build_main_tickets(ranked: list[dict]) -> list[str]:
    axis = ranked[0]["course"]
    partners = [r["course"] for r in ranked[1:4]]
    second_pool = partners[:2] or [2, 3]
    third_pool = unique(partners + [r["course"] for r in ranked[1:6]])
    raw: list[str] = []
    for b in second_pool:
        for c in third_pool:
            if b == c or b == axis or c == axis:
                continue
            raw.append(f"{axis}-{b}-{c}")
    gap = ranked[0]["score"] - ranked[1]["score"]
    if gap < 8 and second_pool:
        alt = second_pool[0]
        for c in third_pool:
            if c == alt or c == axis:
                continue
            raw.append(f"{alt}-{axis}-{c}")
            if len(raw) > 10:
                break
    tickets = unique(raw)
    if len(tickets) < 4:
        fillers = [
            f"{axis}-{partners[0] if partners else 2}-{partners[1] if len(partners) > 1 else 3}",
            f"{axis}-{partners[0] if partners else 2}-{partners[2] if len(partners) > 2 else 4}",
            f"{axis}-{partners[1] if len(partners) > 1 else 3}-{partners[0] if partners else 2}",
            f"{axis}-{partners[1] if len(partners) > 1 else 3}-{partners[2] if len(partners) > 2 else 4}",
            f"{axis}-{partners[2] if len(partners) > 2 else 4}-{partners[0] if partners else 2}",
            f"{axis}-{partners[0] if partners else 2}-{partners[3] if len(partners) > 3 else 5}",
        ]
        tickets = unique(tickets + fillers)[:6]
    elif len(tickets) > 6:
        keep = 4 if gap >= 10 else 5 if gap >= 6 else 6
        tickets = tickets[:keep]
    if len(tickets) < 4:
        tickets = unique(tickets + ["1-2-3", "1-2-4", "1-3-2", "1-3-4"])[:4]
    return tickets


def settle(tri: dict[str, int], tickets: list[str]) -> tuple[int, bool]:
    pay = 0
    hit = False
    for t in tickets:
        amt = int(tri.get(t) or 0)
        if amt:
            pay += amt
            hit = True
    return pay, hit


def summarize(rows: list[dict], label: str) -> dict:
    n = len(rows)
    bets = sum(r["bets"] for r in rows)
    pay = sum(r["pay"] for r in rows)
    hits = sum(r["hit"] for r in rows)
    yearly: dict[str, dict] = defaultdict(lambda: {"n": 0, "bets": 0, "pay": 0, "hits": 0})
    for r in rows:
        y = yearly[str(r["year"])]
        y["n"] += 1
        y["bets"] += r["bets"]
        y["pay"] += r["pay"]
        y["hits"] += r["hit"]
    years = {
        y: {
            "n": v["n"],
            "hit_rate": round(100 * v["hits"] / v["n"], 2) if v["n"] else 0,
            "roi": round(100 * v["pay"] / v["bets"], 2) if v["bets"] else 0,
            "pnl": v["pay"] - v["bets"],
        }
        for y, v in sorted(yearly.items())
    }
    return {
        "label": label,
        "n": n,
        "avg_tickets": round(sum(r["tickets"] for r in rows) / n, 2) if n else 0,
        "hit_rate": round(100 * hits / n, 2) if n else 0,
        "bets": bets,
        "pay": pay,
        "pnl": pay - bets,
        "roi": round(100 * pay / bets, 2) if bets else 0,
        "min_year_roi": min((x["roi"] for x in years.values()), default=0),
        "years": years,
    }


def load_rows(years: range) -> list[dict]:
    year_set = set(years)
    out: list[dict] = []
    for rp in sorted((DATA / "results").glob("*.json")):
        key = rp.stem
        year = int(key[:4])
        if year not in year_set:
            continue
        pp = DATA / "programs" / f"{key}.json"
        if not pp.exists():
            continue
        results = {
            (r["stadium_number"], r["number"]): r for r in json.loads(rp.read_text())["results"]
        }
        programs = {
            (p["stadium_number"], p["number"]): p for p in json.loads(pp.read_text())["programs"]
        }
        for k2, prog in programs.items():
            res = results.get(k2)
            if not res:
                continue
            boats_p = {b["racer_boat_number"]: b for b in prog["boats"]}
            if any(i not in boats_p for i in range(1, 7)):
                continue
            places = sorted(
                [b for b in res["boats"] if 1 <= (b.get("racer_place_number") or 99) <= 6],
                key=lambda x: x["racer_place_number"],
            )
            if len(places) < 3:
                continue
            views = [score_boat(boats_p[c], c) for c in range(1, 7)]
            ranked = sorted(views, key=lambda x: -x["score"])
            tickets = build_main_tickets(ranked)
            tri = {
                x["combination"]: int(x["amount"])
                for x in (res.get("payouts") or {}).get("trifecta") or []
            }
            pay, hit = settle(tri, tickets)
            day = parse_day(prog.get("day_label"))
            phase = race_phase(prog.get("subtitle"), prog.get("title"))
            out.append(
                {
                    "year": year,
                    "date": prog["date"],
                    "stadium": prog["stadium_number"],
                    "race": prog["number"],
                    "day": day,
                    "day_label": prog.get("day_label"),
                    "phase": phase,
                    "subtitle": prog.get("subtitle"),
                    "tickets": len(tickets),
                    "bets": STAKE * len(tickets),
                    "pay": pay,
                    "hit": int(hit),
                }
            )
    return out


def main() -> None:
    print("loading 2021-2026…", flush=True)
    rows = load_rows(range(2021, 2027))
    print("races", len(rows), flush=True)

    buckets = {
        "all": rows,
        "day_1_2": [r for r in rows if r["day"] in (1, 2)],
        "day_ge3": [r for r in rows if r["day"] is not None and (r["day"] >= 3)],
        "day_final_label": [r for r in rows if r["day"] == 99],
        "day_3_to_6": [r for r in rows if r["day"] in (3, 4, 5, 6, 7)],
        "yosen": [r for r in rows if r["phase"] == "yosen"],
        "junyusho": [r for r in rows if r["phase"] == "junyusho"],
        "yusho": [r for r in rows if r["phase"] == "yusho"],
        "finals_both": [r for r in rows if r["phase"] in ("junyusho", "yusho")],
        "boost_day3_or_finals": [
            r
            for r in rows
            if (r["day"] is not None and r["day"] >= 3) or r["phase"] in ("junyusho", "yusho")
        ],
        "boost_day3_and_not_day1_2": [
            r for r in rows if r["day"] is not None and r["day"] >= 3 and r["day"] != 99
        ],
        "boost_finals_only": [r for r in rows if r["phase"] in ("junyusho", "yusho")],
        "boost_day3plus_finals": [
            r
            for r in rows
            if (r["day"] is not None and r["day"] >= 3) and r["phase"] in ("junyusho", "yusho")
        ],
    }

    summaries = {k: summarize(v, k) for k, v in buckets.items()}
    # sort boost candidates by min_year then roi
    ranked = sorted(
        [summaries[k] for k in summaries if k.startswith("boost_") or k in ("all", "day_ge3", "finals_both", "junyusho", "yusho", "day_1_2")],
        key=lambda s: (s["min_year_roi"], s["roi"]),
        reverse=True,
    )

    # hypothesis checks
    all_s = summaries["all"]
    d12 = summaries["day_1_2"]
    d3 = summaries["day_ge3"]
    finals = summaries["finals_both"]
    yusho = summaries["yusho"]
    jun = summaries["junyusho"]

    hyp = {
        "series_day3_better_than_day12": {
            "claim": "3日目以降の方が精度が高い",
            "day12_roi": d12["roi"],
            "day12_hit": d12["hit_rate"],
            "day_ge3_roi": d3["roi"],
            "day_ge3_hit": d3["hit_rate"],
            "supported_by_roi": d3["roi"] > d12["roi"],
            "supported_by_hit": d3["hit_rate"] > d12["hit_rate"],
            "beats_all_roi": d3["roi"] > all_s["roi"],
        },
        "finals_more_solid": {
            "claim": "準優勝戦・優勝戦の方が固い",
            "all_roi": all_s["roi"],
            "all_hit": all_s["hit_rate"],
            "junyusho_roi": jun["roi"],
            "junyusho_hit": jun["hit_rate"],
            "yusho_roi": yusho["roi"],
            "yusho_hit": yusho["hit_rate"],
            "finals_roi": finals["roi"],
            "finals_hit": finals["hit_rate"],
            "supported_by_hit": finals["hit_rate"] > all_s["hit_rate"],
            "supported_by_roi": finals["roi"] > all_s["roi"],
        },
        "boost_worth_enabling": {
            "best_boost": ranked[0]["label"] if ranked else None,
            "best_boost_roi": ranked[0]["roi"] if ranked else None,
            "best_boost_minY": ranked[0]["min_year_roi"] if ranked else None,
            "note": "ROI>100かつminYが全レースより改善ならブースト採用候補",
        },
    }

    out = {
        "ask": [
            "今節3日目から精度が上がるか",
            "準優勝戦・優勝戦は固くなるか",
            "それで予想をブーストすべきか",
        ],
        "method": "アプリ考察買い目(本線4-6点)をprograms特徴で再現し、2021-2026で条件別ROI",
        "summaries": summaries,
        "ranked": [
            {
                "label": s["label"],
                "n": s["n"],
                "hit_rate": s["hit_rate"],
                "roi": s["roi"],
                "min_year_roi": s["min_year_roi"],
                "pnl": s["pnl"],
            }
            for s in ranked
        ],
        "hypotheses": hyp,
        "verdict": {
            "day3": (
                "支持"
                if hyp["series_day3_better_than_day12"]["supported_by_roi"]
                or hyp["series_day3_better_than_day12"]["supported_by_hit"]
                else "非支持"
            ),
            "finals": (
                "支持"
                if hyp["finals_more_solid"]["supported_by_hit"]
                or hyp["finals_more_solid"]["supported_by_roi"]
                else "非支持"
            ),
            "boost_now": "ROIが本命ロック(約104%)や100%を安定して超えなければ、考察買い目のブースト採用は見送り",
        },
    }

    REPORTS.mkdir(parents=True, exist_ok=True)
    path = REPORTS / "validate_series_day_boost.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    (ROOT / "src" / "data" / "validate_series_day_boost.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2)
    )
    print("wrote", path, flush=True)
    for s in ranked[:8]:
        print(
            f"{s['label']}: n={s['n']} hit={s['hit_rate']} roi={s['roi']} minY={s['min_year_roi']}",
            flush=True,
        )
    print("hypotheses", json.dumps(hyp, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
