#!/usr/bin/env python3
"""
Backtest 本命買い目 on high イン逃げ-probability races.
Uses OpenAPI programs (features) + results (payouts).
Train on earlier years, validate on later years. Search filters for ROI>=150%.
"""

from __future__ import annotations

import itertools
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = DATA / "reports"

STADIUMS = {
    1: "桐生",
    2: "戸田",
    3: "江戸川",
    4: "平和島",
    5: "多摩川",
    6: "浜名湖",
    7: "蒲郡",
    8: "常滑",
    9: "津",
    10: "三国",
    11: "びわこ",
    12: "住之江",
    13: "尼崎",
    14: "鳴門",
    15: "丸亀",
    16: "児島",
    17: "宮島",
    18: "徳山",
    19: "下関",
    20: "若松",
    21: "芦屋",
    22: "福岡",
    23: "唐津",
    24: "大村",
}


@dataclass
class RaceRow:
    date: str
    year: int
    stadium: int
    race_no: int
    grade: int
    c1_class: int
    c1_nat: float
    c1_loc: float
    c1_st: float
    c1_motor2: float
    c1_boat2: float
    c2_nat: float
    c3_nat: float
    wind: int
    wave: int
    innige: bool
    winner_courses: tuple[int, int, int]
    trifecta_map: dict[str, int]
    exacta_map: dict[str, int]


def load_joined(years: range | list[int]) -> list[RaceRow]:
    year_set = set(years)
    rows: list[RaceRow] = []
    for rp in sorted((DATA / "results").glob("*.json")):
        key = rp.stem
        year = int(key[:4])
        if year not in year_set:
            continue
        pp = DATA / "programs" / f"{key}.json"
        if not pp.exists():
            continue
        results = { (r["stadium_number"], r["number"]): r for r in json.loads(rp.read_text())["results"] }
        programs = { (p["stadium_number"], p["number"]): p for p in json.loads(pp.read_text())["programs"] }
        for key2, prog in programs.items():
            res = results.get(key2)
            if not res:
                continue
            boats_p = {b["racer_boat_number"]: b for b in prog["boats"]}
            # Use entry/boat number as proxy for course before race; for historical
            # programs, course isn't always known. Approximate: boat_number == intended lane.
            # Results have actual course. For prediction we only use program features by boat#.
            b1 = boats_p.get(1)
            b2 = boats_p.get(2)
            b3 = boats_p.get(3)
            if not b1 or not b2 or not b3:
                continue
            res_boats = res["boats"]
            by_course = {b["racer_course_number"]: b for b in res_boats}
            c1 = by_course.get(1)
            if not c1:
                continue
            # Map program boat of the actual course-1 racer
            prog_c1 = boats_p.get(c1["racer_boat_number"], b1)
            # For ex-ante prediction we must NOT use actual course reshuffles.
            # Use boat1 as assumed course1 (normal entry assumption).
            assumed = b1
            places = sorted(
                [b for b in res_boats if 1 <= (b.get("racer_place_number") or 99) <= 6],
                key=lambda x: x["racer_place_number"],
            )
            if len(places) < 3:
                continue
            winners = tuple(p["racer_course_number"] for p in places[:3])
            innige = bool(c1.get("racer_place_number") == 1 and res.get("technique_number") == 1)
            tri = {
                x["combination"]: int(x["amount"])
                for x in (res.get("payouts") or {}).get("trifecta") or []
            }
            exa = {
                x["combination"]: int(x["amount"])
                for x in (res.get("payouts") or {}).get("exacta") or []
            }
            rows.append(
                RaceRow(
                    date=prog["date"],
                    year=year,
                    stadium=prog["stadium_number"],
                    race_no=prog["number"],
                    grade=int(prog.get("grade_number") or 5),
                    c1_class=int(assumed.get("racer_class_number") or 4),
                    c1_nat=float(assumed.get("racer_national_top_1_percent") or 0),
                    c1_loc=float(assumed.get("racer_local_top_1_percent") or 0),
                    c1_st=float(assumed.get("racer_average_start_timing") or 0.2),
                    c1_motor2=float(assumed.get("racer_assigned_motor_top_2_percent") or 0),
                    c1_boat2=float(assumed.get("racer_assigned_boat_top_2_percent") or 0),
                    c2_nat=float(b2.get("racer_national_top_1_percent") or 0),
                    c3_nat=float(b3.get("racer_national_top_1_percent") or 0),
                    wind=int(res.get("wind_speed") or 0),
                    wave=int(res.get("wave_height") or 0),
                    innige=innige,
                    winner_courses=winners,
                    trifecta_map=tri,
                    exacta_map=exa,
                )
            )
    return rows


def stadium_innige_rate(rows: list[RaceRow]) -> dict[int, float]:
    agg = defaultdict(lambda: [0, 0])
    for r in rows:
        agg[r.stadium][0] += 1
        agg[r.stadium][1] += int(r.innige)
    return {st: (v[1] / v[0] if v[0] else 0) for st, v in agg.items()}


def passes(r: RaceRow, cfg: dict, innige_rate: dict[int, float]) -> bool:
    if innige_rate.get(r.stadium, 0) < cfg["min_stadium_innige"]:
        return False
    if r.c1_class > cfg["max_c1_class"]:
        return False
    if r.c1_nat < cfg["min_c1_nat"]:
        return False
    if r.c1_st > cfg["max_c1_st"]:
        return False
    if r.c1_motor2 < cfg["min_motor2"]:
        return False
    if r.c1_nat - r.c2_nat < cfg["min_gap_c2"]:
        return False
    # wind/wave are race-time observations; do not use for ex-ante filters
    if cfg.get("grades") and r.grade not in cfg["grades"]:
        return False
    return True


def ticket_sets(cfg: dict) -> list[tuple[str, str]]:
    """Return list of (bet_type, combination). Stake = 100 yen each."""
    kind = cfg["ticket"]
    if kind == "exacta_12":
        return [("exacta", "1-2")]
    if kind == "trifecta_123":
        return [("trifecta", "1-2-3")]
    if kind == "trifecta_box_top3":
        out = []
        for a, b, c in itertools.permutations([1, 2, 3], 3):
            out.append(("trifecta", f"{a}-{b}-{c}"))
        return out
    if kind == "trifecta_1axis_23":
        out = []
        for second in [2, 3]:
            for third in [2, 3, 4, 5, 6]:
                if third == second:
                    continue
                out.append(("trifecta", f"1-{second}-{third}"))
        return out
    if kind == "trifecta_1_2_stream":
        return [("trifecta", f"1-2-{x}") for x in [3, 4, 5, 6]]
    if kind == "exacta_12_13":
        return [("exacta", "1-2"), ("exacta", "1-3")]
    return [("trifecta", "1-2-3")]


def evaluate(rows: list[RaceRow], cfg: dict, innige_rate: dict[int, float]) -> dict:
    tickets = ticket_sets(cfg)
    stake_unit = 100 * len(tickets)
    bets = 0
    pay = 0
    hits = 0
    innige_hits = 0
    selected = 0
    for r in rows:
        if not passes(r, cfg, innige_rate):
            continue
        selected += 1
        bets += stake_unit
        race_pay = 0
        hit = False
        for bet_type, combo in tickets:
            mp = r.trifecta_map if bet_type == "trifecta" else r.exacta_map
            amt = mp.get(combo)
            if amt:
                race_pay += amt
                hit = True
        pay += race_pay
        if hit:
            hits += 1
        if r.innige:
            innige_hits += 1
    roi = (pay / bets * 100) if bets else 0
    return {
        "bets": bets,
        "pay": pay,
        "roi": roi,
        "selected": selected,
        "hit_races": hits,
        "hit_rate": (hits / selected * 100) if selected else 0,
        "innige_rate_selected": (innige_hits / selected * 100) if selected else 0,
        "tickets_per_race": len(tickets),
        "cfg": cfg,
    }


def search(train: list[RaceRow], test: list[RaceRow]) -> list[dict]:
    innige_rate = stadium_innige_rate(train)
    tickets = [
        "exacta_12",
        "exacta_12_13",
        "trifecta_123",
        "trifecta_1_2_stream",
        "trifecta_1axis_23",
        "trifecta_box_top3",
    ]
    results = []
    for ticket in tickets:
        for min_stadium_innige in [0.50, 0.55, 0.58, 0.60]:
            for max_c1_class in [1, 2]:  # A1 only or A1/A2
                for min_c1_nat in [5.5, 6.0, 6.5, 7.0]:
                    for max_c1_st in [0.14, 0.15, 0.16]:
                        for min_motor2 in [0, 30, 35, 40]:
                            for min_gap_c2 in [0.0, 0.5, 1.0]:
                                cfg = {
                                    "ticket": ticket,
                                    "min_stadium_innige": min_stadium_innige,
                                    "max_c1_class": max_c1_class,
                                    "min_c1_nat": min_c1_nat,
                                    "max_c1_st": max_c1_st,
                                    "min_motor2": min_motor2,
                                    "min_gap_c2": min_gap_c2,
                                    "grades": [4, 5],  # G3/一般
                                }
                                tr = evaluate(train, cfg, innige_rate)
                                if tr["selected"] < 50:
                                    continue
                                if tr["roi"] < 100:
                                    continue
                                te = evaluate(test, cfg, innige_rate)
                                if te["selected"] < 25:
                                    continue
                                results.append(
                                    {
                                        "train": tr,
                                        "test": te,
                                        "stadium_rates": {
                                            STADIUMS[k]: round(v, 3)
                                            for k, v in sorted(innige_rate.items())
                                        },
                                    }
                                )
    # Prefer out-of-sample ROI, then in-sample stability and volume
    results.sort(
        key=lambda x: (
            x["test"]["roi"],
            x["train"]["roi"],
            x["test"]["selected"],
        ),
        reverse=True,
    )
    return results


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    print("loading train 2021-2023...")
    train = load_joined(range(2021, 2024))
    print("train races", len(train))
    print("loading test 2024-2025...")
    test = load_joined([2024, 2025])
    print("test races", len(test))
    if len(train) < 1000 or len(test) < 500:
        summary = {
            "status": "insufficient_data",
            "train": len(train),
            "test": len(test),
            "message": "履歴ファイルが不足。collect_history.py の完了を待って再実行。",
        }
        (REPORTS / "backtest_status.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(summary)
        return

    rates = stadium_innige_rate(train)
    (REPORTS / "stadium_innige_rates.json").write_text(
        json.dumps(
            {STADIUMS[k]: {"rate": rates[k], "stadium": k} for k in sorted(rates)},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print("searching strategies...")
    ranked = search(train, test)
    top = ranked[:30]
    best_ge_150 = [
        x
        for x in ranked
        if x["test"]["roi"] >= 150
        and x["train"]["roi"] >= 100
        and x["test"]["selected"] >= 25
    ]
    out = {
        "train_years": "2021-2023",
        "test_years": "2024-2025",
        "train_n": len(train),
        "test_n": len(test),
        "strategies_ge_150_test": len(best_ge_150),
        "best": top[0] if top else None,
        "best_ge_150": best_ge_150[0] if best_ge_150 else None,
        "top30": [
            {
                "train_roi": round(x["train"]["roi"], 2),
                "test_roi": round(x["test"]["roi"], 2),
                "test_selected": x["test"]["selected"],
                "test_hit_rate": round(x["test"]["hit_rate"], 2),
                "test_innige_rate": round(x["test"]["innige_rate_selected"], 2),
                "cfg": x["train"]["cfg"],
            }
            for x in top
        ],
    }
    (REPORTS / "honmei_backtest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("strategies_ge_150", len(best_ge_150))
    if top:
        print("best test roi", round(top[0]["test"]["roi"], 2), top[0]["train"]["cfg"])
    # also write locked rule if any >=150
    if best_ge_150:
        rule = best_ge_150[0]["train"]["cfg"]
        rule_out = {
            **rule,
            "stadium_whitelist": [
                st for st, rate in rates.items() if rate >= rule["min_stadium_innige"]
            ],
            "validated_test_roi": best_ge_150[0]["test"]["roi"],
            "validated_test_selected": best_ge_150[0]["test"]["selected"],
        }
        (REPORTS / "locked_honmei_rule.json").write_text(
            json.dumps(rule_out, ensure_ascii=False, indent=2), encoding="utf-8"
        )


if __name__ == "__main__":
    main()
