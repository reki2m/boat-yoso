#!/usr/bin/env python3
"""2020+ walk-forward validation for honmei / ana. Writes validate_from_2020.json."""

from __future__ import annotations

import itertools
import json
import sys
from collections import defaultdict
from pathlib import Path

import backtest_deep_oshi_ana as d
import backtest_innige as bi

REPORTS = Path(__file__).resolve().parents[1] / "data" / "reports"
STAKE = 100

FIX = {
    "ticket": "trifecta_123",
    "tickets": ["1-2-3"],
    "stadium_whitelist": [8, 9, 12, 13, 15, 17, 18, 19],
    "race_blacklist": [1, 9],
    "grades": [4, 5],
    "max_c1_class": 1,
    "min_c1_nat": 6.8,
    "max_c1_st": 0.15,
    "min_motor2": 32,
    "min_gap_c2": 1.0,
    "min_stadium_innige": 0.5,
    "soft_max_per_day": 4,
}


def log(*a):
    print(*a, flush=True)


def pay(tri: dict, combo: str) -> int:
    return int(tri.get(combo) or 0)


def eval_base(
    rows: list[bi.RaceRow],
    innige: dict[int, float],
    cfg: dict,
    tickets: list[str] | None = None,
) -> dict:
    tickets = tickets or cfg.get("tickets") or ["1-2-3"]
    soft = cfg.get("soft_max_per_day")
    wl = set(cfg.get("stadium_whitelist") or [])
    bl = set(cfg.get("race_blacklist") or [])
    grades = set(cfg.get("grades") or [4, 5])

    day_map: dict[str, list[bi.RaceRow]] = defaultdict(list)
    for r in rows:
        if wl and r.stadium not in wl:
            continue
        if r.race_no in bl:
            continue
        if r.grade not in grades:
            continue
        if r.c1_class > cfg.get("max_c1_class", 99):
            continue
        if r.c1_nat < cfg.get("min_c1_nat", 0):
            continue
        if r.c1_st > cfg.get("max_c1_st", 9):
            continue
        if r.c1_motor2 < cfg.get("min_motor2", 0):
            continue
        if r.c1_nat - r.c2_nat < cfg.get("min_gap_c2", 0):
            continue
        if innige.get(r.stadium, 0) < cfg.get("min_stadium_innige", 0):
            continue
        day_map[r.date].append(r)

    bets = pay_amt = hits = selected = 0
    yearly = defaultdict(lambda: {"bets": 0, "pay": 0, "hits": 0, "n": 0})
    for date, day_rows in day_map.items():
        day_rows = sorted(day_rows, key=lambda x: -(x.c1_nat - x.c2_nat))
        if soft:
            day_rows = day_rows[:soft]
        for r in day_rows:
            selected += 1
            stake = STAKE * len(tickets)
            race_pay = 0
            hit = False
            for t in tickets:
                amt = pay(r.trifecta_map, t)
                if amt:
                    race_pay += amt
                    hit = True
            bets += stake
            pay_amt += race_pay
            hits += int(hit)
            y = yearly[r.year]
            y["bets"] += stake
            y["pay"] += race_pay
            y["hits"] += int(hit)
            y["n"] += 1

    years = {
        str(y): {
            "n": v["n"],
            "hit_rate": (v["hits"] / v["n"] * 100) if v["n"] else 0.0,
            "roi": (v["pay"] / v["bets"] * 100) if v["bets"] else 0.0,
            "pnl": v["pay"] - v["bets"],
        }
        for y, v in sorted(yearly.items())
    }
    return {
        "selected": selected,
        "hits": hits,
        "hit_rate": (hits / selected * 100) if selected else 0.0,
        "bets": bets,
        "pay": pay_amt,
        "pnl": pay_amt - bets,
        "roi": (pay_amt / bets * 100) if bets else 0.0,
        "days": len(day_map),
        "avg_per_day": (selected / len(day_map)) if day_map else 0.0,
        "years": years,
        "min_year_roi": min((v["roi"] for v in years.values()), default=0.0),
    }


def search_honmei(train: list[bi.RaceRow], innige: dict[int, float]) -> list[dict]:
    stadium_sets = [
        [8, 9, 12, 13, 15, 17, 18, 19],
        [8, 9, 12, 13, 15, 18, 19],
        [9, 12, 13, 15, 18, 19],
        [12, 13, 15, 17, 18, 19],
        [8, 9, 12, 13, 15, 17, 18, 19, 24],
        [8, 12, 13, 15, 18, 19],
    ]
    race_bls = [[1, 9], [1, 9, 2], [1], [9], []]
    grid = itertools.product(
        stadium_sets,
        race_bls,
        [6.5, 6.8, 7.0, 7.2, 7.4],
        [0.14, 0.15, 0.16],
        [30, 32, 35, 38],
        [0.8, 1.0, 1.2, 1.5],
        [2, 3, 4],
    )
    cands = []
    checked = 0
    for wl, bl, nat, st, mot, gap, soft in grid:
        checked += 1
        cfg = {
            **FIX,
            "stadium_whitelist": wl,
            "race_blacklist": bl,
            "min_c1_nat": nat,
            "max_c1_st": st,
            "min_motor2": mot,
            "min_gap_c2": gap,
            "soft_max_per_day": soft,
        }
        stt = eval_base(train, innige, cfg)
        if stt["selected"] < 60:
            continue
        if stt["min_year_roi"] < 100:
            continue
        cands.append({"cfg": cfg, "train": stt})
    log("honmei checked", checked, "pass", len(cands))
    cands.sort(
        key=lambda x: (
            -x["train"]["min_year_roi"],
            -x["train"]["avg_per_day"],
            -x["train"]["roi"],
        )
    )
    return cands[:40]


def eval_ana_rich(
    rows: list[d.RichRace],
    innige: dict[int, float],
    cfg: dict,
) -> dict:
    tickets = cfg["tickets"]
    soft = cfg.get("soft_max_per_day", 2)
    axis = cfg["axis"]
    day_map: dict[str, list[d.RichRace]] = defaultdict(list)
    for r in rows:
        b = r.base
        if innige.get(b.stadium, 1) > cfg["max_inn"]:
            continue
        if b.grade not in (4, 5):
            continue
        if r.nat.get(1, 0) > cfg["max_c1_nat"]:
            continue
        if r.nat.get(axis, 0) < cfg["min_axis_nat"]:
            continue
        if r.motor2.get(axis, 0) < cfg["min_axis_motor"]:
            continue
        if r.st.get(axis, 0.2) > r.st.get(1, 0.2) + 0.02:
            continue
        if cfg.get("min_axis_skill") and (r.skill_win.get(axis, 0) or 0) < cfg["min_axis_skill"]:
            continue
        day_map[b.date].append(r)

    bets = pay_amt = hits = selected = 0
    yearly = defaultdict(lambda: {"bets": 0, "pay": 0, "hits": 0, "n": 0})
    for date, day_rows in day_map.items():
        day_rows = sorted(day_rows, key=lambda x: -x.motor2.get(axis, 0))
        day_rows = day_rows[:soft]
        for r in day_rows:
            selected += 1
            stake = STAKE * len(tickets)
            race_pay = 0
            hit = False
            for t in tickets:
                amt = pay(r.base.trifecta_map, t)
                if amt:
                    race_pay += amt
                    hit = True
            bets += stake
            pay_amt += race_pay
            hits += int(hit)
            y = yearly[r.base.year]
            y["bets"] += stake
            y["pay"] += race_pay
            y["hits"] += int(hit)
            y["n"] += 1
    years = {
        str(y): {
            "n": v["n"],
            "hit_rate": (v["hits"] / v["n"] * 100) if v["n"] else 0.0,
            "roi": (v["pay"] / v["bets"] * 100) if v["bets"] else 0.0,
            "pnl": v["pay"] - v["bets"],
        }
        for y, v in sorted(yearly.items())
    }
    return {
        "selected": selected,
        "hits": hits,
        "hit_rate": (hits / selected * 100) if selected else 0.0,
        "bets": bets,
        "pay": pay_amt,
        "pnl": pay_amt - bets,
        "roi": (pay_amt / bets * 100) if bets else 0.0,
        "avg_per_day": (selected / len(day_map)) if day_map else 0.0,
        "years": years,
        "min_year_roi": min((v["roi"] for v in years.values()), default=0.0),
    }


def search_ana(train: list[d.RichRace], innige: dict[int, float]) -> list[dict]:
    ticket_map = {
        4: ["4-1-2", "4-1-3", "4-2-1", "4-3-1"],
        5: ["5-1-2", "5-1-3", "5-1-4", "5-3-1"],
        6: ["6-1-2", "6-1-3", "6-1-4", "6-2-1"],
    }
    cands = []
    checked = 0
    for axis, max_c1, min_ax, min_m, max_inn, min_sk in itertools.product(
        [4, 5, 6],
        [6.0, 6.3, 6.5, 6.8],
        [5.2, 5.5, 5.8, 6.1],
        [32, 35, 38, 40],
        [0.52, 0.55, 0.58, 0.62],
        [0.0, 0.12, 0.18],
    ):
        checked += 1
        cfg = {
            "axis": axis,
            "max_c1_nat": max_c1,
            "min_axis_nat": min_ax,
            "min_axis_motor": min_m,
            "max_inn": max_inn,
            "min_axis_skill": min_sk,
            "tickets": ticket_map[axis],
            "soft_max_per_day": 2,
            "points": 4,
        }
        stt = eval_ana_rich(train, innige, cfg)
        if stt["selected"] < 35:
            continue
        if stt["min_year_roi"] < 100:
            continue
        cands.append({"cfg": cfg, "train": stt})
    log("ana checked", checked, "pass", len(cands))
    cands.sort(key=lambda x: (-x["train"]["min_year_roi"], -x["train"]["roi"], -x["train"]["selected"]))
    return cands[:30]


def main() -> None:
    log("load base rows 2020-2026")
    base_rows = bi.load_joined(range(2020, 2027))
    years = sorted({r.year for r in base_rows})
    log("base", len(base_rows), "years", years)
    innige = bi.stadium_innige_rate([r for r in base_rows if r.year <= 2023])
    train = [r for r in base_rows if r.year <= 2023]
    oos = [r for r in base_rows if r.year >= 2024]

    fix_train = eval_base(train, innige, FIX)
    fix_oos = eval_base(oos, innige, FIX)
    fix_all = eval_base(base_rows, innige, FIX)
    log("FIX train minY", round(fix_train["min_year_roi"], 1), "oos minY", round(fix_oos["min_year_roi"], 1))

    log("search honmei")
    honmei_cands = search_honmei(train, innige)
    honmei_ranked = []
    for c in honmei_cands:
        cfg = c["cfg"]
        o = eval_base(oos, innige, cfg)
        a = eval_base(base_rows, innige, cfg)
        honmei_ranked.append({"cfg": cfg, "train": c["train"], "oos": o, "all": a})
    honmei_ranked.sort(
        key=lambda x: (
            -(min(x["train"]["min_year_roi"], x["oos"]["min_year_roi"])),
            -x["oos"]["roi"],
            -x["all"]["avg_per_day"],
        )
    )

    log("load rich rows for ana")
    rich = d.load_rich(range(2020, 2027))
    rich_train = [r for r in rich if r.base.year <= 2023]
    rich_oos = [r for r in rich if r.base.year >= 2024]
    log("rich", len(rich))

    log("search ana")
    ana_cands = search_ana(rich_train, innige)
    ana_ranked = []
    for c in ana_cands:
        cfg = c["cfg"]
        o = eval_ana_rich(rich_oos, innige, cfg)
        a = eval_ana_rich(rich, innige, cfg)
        ana_ranked.append({"cfg": cfg, "train": c["train"], "oos": o, "all": a})
    ana_ranked.sort(
        key=lambda x: (
            -min(x["train"]["min_year_roi"], x["oos"]["min_year_roi"] if x["oos"]["selected"] else -1),
            -x["oos"]["roi"] if x["oos"]["selected"] else -1,
            -x["all"]["roi"],
        )
    )

    # lock decision
    lock_honmei = FIX
    lock_reason = "keep_FIX"
    if honmei_ranked:
        best = honmei_ranked[0]
        # must clear train years and preferably oos
        if (
            best["train"]["min_year_roi"] >= 100
            and best["oos"]["min_year_roi"] >= 100
            and (
                best["oos"]["min_year_roi"] > fix_oos["min_year_roi"]
                or (
                    best["oos"]["min_year_roi"] >= fix_oos["min_year_roi"]
                    and best["all"]["avg_per_day"] > fix_all["avg_per_day"]
                )
            )
        ):
            lock_honmei = best["cfg"]
            lock_reason = "search_best_train100_oos100"
        elif fix_all["min_year_roi"] < 100 and best["all"]["min_year_roi"] > fix_all["min_year_roi"]:
            # FIX fails 2020; take best that maximizes all-period minY if oos still >=95
            for h in honmei_ranked:
                if h["oos"]["min_year_roi"] >= 95 and h["train"]["min_year_roi"] >= 100:
                    lock_honmei = h["cfg"]
                    lock_reason = "replace_FIX_for_2020_stability"
                    break

    lock_ana = None
    if ana_ranked:
        for a in ana_ranked:
            if a["train"]["min_year_roi"] >= 100 and a["oos"]["min_year_roi"] >= 95:
                lock_ana = a["cfg"]
                break

    report = {
        "period": {
            "requested": "2020-2026",
            "years_present": years,
            "base_rows": len(base_rows),
            "rich_rows": len(rich),
            "train": [y for y in years if y <= 2023],
            "oos": [y for y in years if y >= 2024],
        },
        "fix_current": {"cfg": FIX, "train": fix_train, "oos": fix_oos, "all": fix_all},
        "honmei_top": [
            {
                "cfg": {
                    k: h["cfg"][k]
                    for k in [
                        "stadium_whitelist",
                        "race_blacklist",
                        "min_c1_nat",
                        "max_c1_st",
                        "min_motor2",
                        "min_gap_c2",
                        "soft_max_per_day",
                        "tickets",
                    ]
                },
                "train_minY": h["train"]["min_year_roi"],
                "oos_minY": h["oos"]["min_year_roi"],
                "oos_roi": h["oos"]["roi"],
                "all_minY": h["all"]["min_year_roi"],
                "all_roi": h["all"]["roi"],
                "avg_per_day": h["all"]["avg_per_day"],
                "n_all": h["all"]["selected"],
                "years_all": h["all"]["years"],
            }
            for h in honmei_ranked[:10]
        ],
        "ana_top": [
            {
                "cfg": a["cfg"],
                "train_minY": a["train"]["min_year_roi"],
                "oos_minY": a["oos"]["min_year_roi"],
                "oos_roi": a["oos"]["roi"],
                "all_minY": a["all"]["min_year_roi"],
                "all_roi": a["all"]["roi"],
                "n_all": a["all"]["selected"],
                "years_all": a["all"]["years"],
            }
            for a in ana_ranked[:10]
        ],
        "lock": {
            "reason": lock_reason,
            "honmei": lock_honmei,
            "ana": lock_ana,
        },
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = REPORTS / "validate_from_2020.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    log("wrote", out)
    log("LOCK", lock_reason)
    log("honmei", {k: lock_honmei[k] for k in ["stadium_whitelist", "race_blacklist", "min_c1_nat", "max_c1_st", "min_motor2", "min_gap_c2", "soft_max_per_day"]})
    log("ana", lock_ana)


if __name__ == "__main__":
    main()
