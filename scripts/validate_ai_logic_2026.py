#!/usr/bin/env python3
"""
今年(2026)のAI予想買い目ロジック再検証。

現行 flat_532（毎回10点）と、信頼度ゲート／本命寄せ／単点など複数案を
2024-2025学習 → 2026テストで比較し、最良を採用候補にする。
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import validate_ten_point_alloc as base

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
STAKE = 100

# stadium innige approx from historical (fallback flat)
DEFAULT_INNIGE = 0.5


@dataclass
class RichRace(base.Race):
    c1_class: int = 4
    c1_nat: float = 0.0
    c1_st: float = 0.2
    c1_motor2: float = 0.0
    c2_nat: float = 0.0
    grade: int = 5


def load_rich(years) -> list[RichRace]:
    year_set = set(years)
    out: list[RichRace] = []
    data = ROOT / "data"
    for rp in sorted((data / "results").glob("*.json")):
        key = rp.stem
        year = int(key[:4])
        if year not in year_set:
            continue
        pp = data / "programs" / f"{key}.json"
        if not pp.exists():
            continue
        try:
            results = {
                (r["stadium_number"], r["number"]): r
                for r in json.loads(rp.read_text())["results"]
            }
            programs = {
                (p["stadium_number"], p["number"]): p
                for p in json.loads(pp.read_text())["programs"]
            }
        except Exception:
            continue
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
            winners = [p["racer_course_number"] for p in places[:3]]
            scored = []
            for course in range(1, 7):
                b = boats_p[course]
                scored.append(
                    {
                        "course": course,
                        "score": base.score_boat(b, course),
                        "nat": float(b.get("racer_national_top_1_percent") or 0),
                        "st": float(b.get("racer_average_start_timing") or 0.2),
                        "motor2": float(b.get("racer_assigned_motor_top_2_percent") or 0),
                        "class": int(b.get("racer_class_number") or 4),
                    }
                )
            tri = {
                x["combination"]: int(x["amount"])
                for x in (res.get("payouts") or {}).get("trifecta") or []
            }
            c1 = boats_p[1]
            c2 = boats_p[2]
            out.append(
                RichRace(
                    date=prog["date"],
                    year=year,
                    stadium=prog["stadium_number"],
                    race_no=prog["number"],
                    boats=scored,
                    trifecta_map=tri,
                    winner="-".join(str(x) for x in winners),
                    c1_class=int(c1.get("racer_class_number") or 4),
                    c1_nat=float(c1.get("racer_national_top_1_percent") or 0),
                    c1_st=float(c1.get("racer_average_start_timing") or 0.2),
                    c1_motor2=float(c1.get("racer_assigned_motor_top_2_percent") or 0),
                    c2_nat=float(c2.get("racer_national_top_1_percent") or 0),
                    grade=int(prog.get("grade_number") or 5),
                )
            )
    return out


def conf_of(r: RichRace) -> int:
    ranked = sorted(r.boats, key=lambda x: -x["score"])
    gap = ranked[0]["score"] - ranked[1]["score"]
    return base.confidence_from_gap(gap, ranked[0]["score"])


def ranked_boats(r: RichRace) -> list[dict]:
    return sorted(r.boats, key=lambda x: -x["score"])


def settle(tri: dict[str, int], tickets: list[str]) -> tuple[int, bool]:
    pay = 0
    hit = False
    for t in tickets:
        amt = int(tri.get(t) or 0)
        if amt > 0:
            hit = True
            pay += amt
    return pay, hit


def is_strong_innige(r: RichRace) -> bool:
    return (
        r.c1_class <= 1
        and r.c1_nat >= 6.8
        and r.c1_st <= 0.15
        and r.c1_motor2 >= 32
        and (r.c1_nat - r.c2_nat) >= 0.8
        and r.grade in (4, 5)
    )


def is_elite_innige(r: RichRace) -> bool:
    return (
        r.c1_class <= 1
        and r.c1_nat >= 7.0
        and r.c1_st <= 0.14
        and r.c1_motor2 >= 35
        and (r.c1_nat - r.c2_nat) >= 1.0
        and r.grade in (4, 5)
    )


def tickets_for(strategy: str, r: RichRace) -> list[str] | None:
    """None = skip race (no bet)."""
    ranked = ranked_boats(r)
    conf = conf_of(r)
    axis = ranked[0]["course"]

    if strategy == "current_flat532":
        h, o, a = 5, 3, 2
        tix = base.build_tickets(ranked, h, o, a)
        return [t for t, _ in tix]

    if strategy == "flat_640":
        tix = base.build_tickets(ranked, 6, 4, 0)
        return [t for t, _ in tix]

    if strategy == "honmei5_only":
        return base.tickets_honmei(ranked, 5)

    if strategy == "honmei3_only":
        return base.tickets_honmei(ranked, 3)

    if strategy == "top1_only":
        return [f"{ranked[0]['course']}-{ranked[1]['course']}-{ranked[2]['course']}"]

    if strategy == "123_only":
        return ["1-2-3"]

    if strategy == "conf45_h5":
        if conf < 4:
            return None
        return base.tickets_honmei(ranked, 5)

    if strategy == "conf45_h5o3a2":
        if conf < 4:
            return None
        return [t for t, _ in base.build_tickets(ranked, 5, 3, 2)]

    if strategy == "conf5_h5":
        if conf < 5:
            return None
        return base.tickets_honmei(ranked, 5)

    if strategy == "conf5_top1":
        if conf < 5:
            return None
        return [f"{ranked[0]['course']}-{ranked[1]['course']}-{ranked[2]['course']}"]

    if strategy == "adaptive_conf":
        # ユーザー案寄り: 高信頼は本命厚、低信頼は押し穴
        alloc = {
            5: (7, 2, 1),
            4: (5, 3, 2),
            3: (4, 3, 3),
            2: (3, 4, 3),
            1: (2, 4, 4),
        }[conf]
        return [t for t, _ in base.build_tickets(ranked, *alloc)]

    if strategy == "skip_low_conf":
        # conf1-2見送り、3は本命3、4-5は本命5
        if conf <= 2:
            return None
        n = 5 if conf >= 4 else 3
        return base.tickets_honmei(ranked, n)

    if strategy == "axis1_conf45_stream":
        if conf < 4 or axis != 1:
            return None
        return ["1-2-3", "1-2-4", "1-2-5", "1-2-6"][:4]

    if strategy == "strong_123":
        if not is_strong_innige(r):
            return None
        return ["1-2-3"]

    if strategy == "elite_123":
        if not is_elite_innige(r):
            return None
        return ["1-2-3"]

    if strategy == "elite_12_stream":
        if not is_elite_innige(r):
            return None
        return ["1-2-3", "1-2-4", "1-2-5", "1-2-6"]

    if strategy == "strong_h5":
        if not is_strong_innige(r):
            return None
        return base.tickets_honmei(ranked, 5)

    if strategy == "conf45_or_strong":
        if conf >= 4:
            return base.tickets_honmei(ranked, 5)
        if is_strong_innige(r):
            return ["1-2-3"]
        return None

    if strategy == "hybrid_best_guess":
        # 高信頼本命3 + 強イン逃げは1-2-3優先。低信頼見送り。
        if is_elite_innige(r):
            return ["1-2-3"]
        if conf >= 4 and axis == 1:
            return ["1-2-3", "1-2-4", "1-2-5"]
        if conf >= 4:
            return base.tickets_honmei(ranked, 3)
        return None

    if strategy == "conf45_h3o2a0":
        if conf < 4:
            return None
        return [t for t, _ in base.build_tickets(ranked, 3, 2, 0)]

    if strategy == "thin10_conf3plus":
        if conf < 3:
            return None
        return [t for t, _ in base.build_tickets(ranked, 5, 3, 2)]

    raise KeyError(strategy)


STRATEGIES = [
    "current_flat532",
    "flat_640",
    "honmei5_only",
    "honmei3_only",
    "top1_only",
    "123_only",
    "conf45_h5",
    "conf45_h5o3a2",
    "conf5_h5",
    "conf5_top1",
    "adaptive_conf",
    "skip_low_conf",
    "axis1_conf45_stream",
    "strong_123",
    "elite_123",
    "elite_12_stream",
    "strong_h5",
    "conf45_or_strong",
    "hybrid_best_guess",
    "conf45_h3o2a0",
    "thin10_conf3plus",
]


def eval_year(races: list[RichRace], strategy: str) -> dict:
    rows = []
    skipped = 0
    for r in races:
        tix = tickets_for(strategy, r)
        if not tix:
            skipped += 1
            continue
        pay, hit = settle(r.trifecta_map, tix)
        rows.append(
            {
                "year": r.year,
                "date": r.date,
                "conf": conf_of(r),
                "tickets": len(tix),
                "bets": STAKE * len(tix),
                "pay": pay,
                "hit": int(hit),
            }
        )
    bets = sum(x["bets"] for x in rows)
    pay = sum(x["pay"] for x in rows)
    hits = sum(x["hit"] for x in rows)
    n = len(rows)
    by_month: dict[str, dict] = defaultdict(lambda: {"n": 0, "bets": 0, "pay": 0, "hits": 0})
    for x in rows:
        m = str(x["date"])[4:6]
        b = by_month[m]
        b["n"] += 1
        b["bets"] += x["bets"]
        b["pay"] += x["pay"]
        b["hits"] += x["hit"]
    months = {
        m: {
            "n": v["n"],
            "roi": round(100 * v["pay"] / v["bets"], 2) if v["bets"] else 0,
            "hit_rate": round(100 * v["hits"] / v["n"], 2) if v["n"] else 0,
        }
        for m, v in sorted(by_month.items())
    }
    return {
        "strategy": strategy,
        "n": n,
        "skipped": skipped,
        "hit_rate": round(100 * hits / n, 2) if n else 0,
        "roi": round(100 * pay / bets, 2) if bets else 0,
        "pnl": pay - bets,
        "bets": bets,
        "pay": pay,
        "avg_tickets": round(sum(x["tickets"] for x in rows) / n, 2) if n else 0,
        "months": months,
        "min_month_roi": min((x["roi"] for x in months.values()), default=0) if months else 0,
    }


def score_row(train: dict, test: dict) -> tuple:
    """Prefer test ROI, then train ROI, require enough test samples."""
    return (
        1 if test["n"] >= 30 else 0,
        test["roi"],
        test["min_month_roi"],
        train["roi"],
        test["hit_rate"],
    )


def main() -> None:
    t0 = time.time()
    # ensure 2026 days present (reuse collector)
    from datetime import date

    base.collect_range(date(2026, 1, 1), date(2026, 11, 12), workers=28)
    # also ensure train years cached
    base.collect_range(date(2024, 1, 1), date(2025, 12, 31), workers=28)

    print("loading…", flush=True)
    train_races = load_rich([2024, 2025])
    test_races = load_rich([2026])
    print(f"train={len(train_races)} test={len(test_races)}", flush=True)

    results = []
    for s in STRATEGIES:
        tr = eval_year(train_races, s)
        te = eval_year(test_races, s)
        results.append({"train": tr, "test": te, "strategy": s})
        print(
            f"{s:24s} trainROI={tr['roi']:7.2f} n={tr['n']:6d} | "
            f"2026ROI={te['roi']:7.2f} n={te['n']:6d} hit={te['hit_rate']:5.2f} avgT={te['avg_tickets']}",
            flush=True,
        )

    ranked = sorted(results, key=lambda r: score_row(r["train"], r["test"]), reverse=True)
    best = ranked[0]

    # Also report what current AI would do if bought all 2026
    current = next(r for r in results if r["strategy"] == "current_flat532")

    out = {
        "ask": [
            "今年AI予想を買ったらどうなるか",
            "一番いいロジックを再検証して採用",
        ],
        "train_years": [2024, 2025],
        "test_year": 2026,
        "train_races": len(train_races),
        "test_races": len(test_races),
        "current_2026_if_bought_all": current["test"],
        "ranked": [
            {
                "strategy": r["strategy"],
                "train_roi": r["train"]["roi"],
                "train_n": r["train"]["n"],
                "test_roi": r["test"]["roi"],
                "test_n": r["test"]["n"],
                "test_hit": r["test"]["hit_rate"],
                "test_avg_tickets": r["test"]["avg_tickets"],
                "test_min_month_roi": r["test"]["min_month_roi"],
                "test_pnl": r["test"]["pnl"],
            }
            for r in ranked
        ],
        "best": {
            "strategy": best["strategy"],
            "train": best["train"],
            "test": best["test"],
            "reason": (
                f"{best['strategy']} が2026テストROIで最良"
                f"（ROI {best['test']['roi']}% / n={best['test']['n']} / "
                f"的中 {best['test']['hit_rate']}%）。"
            ),
        },
        "elapsed_sec": round(time.time() - t0, 1),
    }

    REPORTS.mkdir(parents=True, exist_ok=True)
    path = REPORTS / "validate_ai_logic_2026.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "src" / "data").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "data" / "validate_ai_logic_2026.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("wrote", path, flush=True)
    print("BEST", best["strategy"], "2026ROI", best["test"]["roi"], flush=True)
    print("CURRENT 2026", current["test"]["roi"], flush=True)


if __name__ == "__main__":
    main()
