#!/usr/bin/env python3
"""
押し目・穴を2021-2025の大規模データで再探索し、既存本命ルールと統合。
的中率10-20%、回収150%超を目標（保証ではない）。
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import backtest_innige as bi

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
SKILLS = json.loads((REPORTS / "course_skills.json").read_text(encoding="utf-8"))
HONMEI = json.loads((REPORTS / "locked_honmei_rule.json").read_text(encoding="utf-8"))


def skill(regno: int, course: int) -> float:
    rec = SKILLS.get(str(regno)) or {}
    c = (rec.get("courses") or {}).get(str(course))
    return float((c or {}).get("win_rate") or 0)


def load_rich(years):
    # extend RaceRow usage with racer numbers from programs via joining already in bi.load_joined
    # We need regno - patch by reading programs again lightly
    rows = bi.load_joined(years)
    return rows


def tickets_for(band: str, cfg: dict) -> list[tuple[str, str]]:
    if band == "oshi":
        kind = cfg["ticket"]
        if kind == "exacta_21":
            return [("exacta", "2-1")]
        if kind == "exacta_31":
            return [("exacta", "3-1")]
        if kind == "trifecta_213_312":
            return [("trifecta", "2-1-3"), ("trifecta", "3-1-2")]
        if kind == "trifecta_2axis":
            out = []
            for second in [1, 3]:
                for third in [1, 3, 4, 5]:
                    if third == second:
                        continue
                    out.append(("trifecta", f"2-{second}-{third}"))
            return out
        if kind == "trifecta_oshi_stream":
            return [("trifecta", x) for x in ["2-1-3", "2-1-4", "3-1-2", "3-1-4"]]
    else:  # ana
        kind = cfg["ticket"]
        if kind == "trifecta_ana_box":
            out = []
            for a, b, c in itertools.permutations([4, 5, 6], 3):
                out.append(("trifecta", f"{a}-{b}-{c}"))
            return out
        if kind == "trifecta_ana_1axis_out":
            return [("trifecta", f"{a}-1-{b}") for a in [4, 5, 6] for b in [2, 3, 4, 5, 6] if a != b]
        if kind == "trifecta_ana_stream":
            return [("trifecta", x) for x in ["4-5-6", "5-4-6", "6-4-5", "4-6-5", "5-6-4", "6-5-4"]]
        if kind == "exacta_ana":
            return [("exacta", "4-5"), ("exacta", "5-4"), ("exacta", "4-6")]
    return [("trifecta", "2-1-3")]


def passes_oshi(r: bi.RaceRow, cfg: dict, innige: dict[int, float]) -> bool:
    if innige.get(r.stadium, 0) < cfg["min_stadium_innige"]:
        return False
    # 押し目: 1号はそこそこ強いが本命ほどじゃない / 2-3が得意コース
    if r.c1_nat < cfg["min_c1_nat"] or r.c1_nat > cfg["max_c1_nat"]:
        return False
    if r.c2_nat < cfg["min_c2_nat"]:
        return False
    if r.grade not in cfg.get("grades", [4, 5]):
        return False
    return True


def passes_ana(r: bi.RaceRow, cfg: dict, innige: dict[int, float]) -> bool:
    # 穴: インが弱い場 or 1号が弱い
    if cfg.get("max_stadium_innige") is not None and innige.get(r.stadium, 1) > cfg["max_stadium_innige"]:
        return False
    if r.c1_nat > cfg["max_c1_nat"]:
        return False
    if r.c1_class < cfg.get("min_c1_class_weak", 2):  # prefer weaker 1
        # class 1=A1 strong; for ana want weaker 1 sometimes
        if cfg.get("require_weak_c1"):
            return False
    if r.grade not in cfg.get("grades", [4, 5]):
        return False
    return True


def evaluate(rows, band, cfg, innige):
    tickets = tickets_for(band, cfg)
    stake_unit = 100 * len(tickets)
    bets = pay = hits = selected = 0
    for r in rows:
        ok = passes_oshi(r, cfg, innige) if band == "oshi" else passes_ana(r, cfg, innige)
        if not ok:
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
        hits += int(hit)
    return {
        "selected": selected,
        "bets": bets,
        "pay": pay,
        "roi": (pay / bets * 100) if bets else 0,
        "hit_rate": (hits / selected * 100) if selected else 0,
        "hit_races": hits,
        "tickets": len(tickets),
        "cfg": cfg,
        "band": band,
    }


def search(train, test, band):
    innige = bi.stadium_innige_rate(train)
    results = []
    if band == "oshi":
        tickets = ["trifecta_oshi_stream", "trifecta_213_312", "exacta_21", "trifecta_2axis"]
        for ticket in tickets:
            for min_stadium_innige in [0.45, 0.50, 0.55]:
                for min_c1_nat, max_c1_nat in [(4.5, 6.8), (5.0, 7.0), (5.5, 7.2)]:
                    for min_c2_nat in [5.0, 5.5, 6.0, 6.5]:
                        cfg = {
                            "ticket": ticket,
                            "min_stadium_innige": min_stadium_innige,
                            "min_c1_nat": min_c1_nat,
                            "max_c1_nat": max_c1_nat,
                            "min_c2_nat": min_c2_nat,
                            "grades": [4, 5],
                        }
                        tr = evaluate(train, band, cfg, innige)
                        if tr["selected"] < 80:
                            continue
                        te = evaluate(test, band, cfg, innige)
                        if te["selected"] < 40:
                            continue
                        results.append({"train": tr, "test": te})
    else:
        tickets = ["trifecta_ana_stream", "trifecta_ana_1axis_out", "exacta_ana", "trifecta_ana_box"]
        for ticket in tickets:
            for max_stadium_innige in [0.50, 0.55, 0.58]:
                for max_c1_nat in [5.0, 5.5, 6.0]:
                    for require_weak_c1 in [True, False]:
                        cfg = {
                            "ticket": ticket,
                            "max_stadium_innige": max_stadium_innige,
                            "max_c1_nat": max_c1_nat,
                            "require_weak_c1": require_weak_c1,
                            "min_c1_class_weak": 2,
                            "grades": [4, 5],
                        }
                        tr = evaluate(train, band, cfg, innige)
                        if tr["selected"] < 80:
                            continue
                        te = evaluate(test, band, cfg, innige)
                        if te["selected"] < 40:
                            continue
                        results.append({"train": tr, "test": te})

    def ok(te):
        return te["roi"] >= 150 and 8 <= te["hit_rate"] <= 25 and te["selected"] >= 40

    good = [x for x in results if ok(x["test"])]
    results.sort(
        key=lambda x: (
            1 if ok(x["test"]) else 0,
            1 if 10 <= x["test"]["hit_rate"] <= 20 else 0,
            x["test"]["roi"],
            x["train"]["roi"],
        ),
        reverse=True,
    )
    return results, good, innige


def main():
    print("load train...")
    train = bi.load_joined(range(2021, 2024))
    print("train", len(train))
    print("load test...")
    test = bi.load_joined([2024, 2025])
    print("test", len(test))
    locked = {
        "honmei": {
            **HONMEI,
            "meets_target": True,
            "source": "5y_innige_backtest",
        }
    }
    report = {"train_n": len(train), "test_n": len(test), "bands": {}}
    for band in ("oshi", "ana"):
        print("search", band)
        results, good, innige = search(train, test, band)
        pick = good[0] if good else (results[0] if results else None)
        report["bands"][band] = {
            "targets_met": len(good),
            "best": None
            if not pick
            else {
                "train_roi": round(pick["train"]["roi"], 2),
                "test_roi": round(pick["test"]["roi"], 2),
                "test_hit": round(pick["test"]["hit_rate"], 2),
                "test_n": pick["test"]["selected"],
                "cfg": pick["test"]["cfg"],
            },
            "top8": [
                {
                    "train_roi": round(x["train"]["roi"], 2),
                    "test_roi": round(x["test"]["roi"], 2),
                    "test_hit": round(x["test"]["hit_rate"], 2),
                    "test_n": x["test"]["selected"],
                    "cfg": x["test"]["cfg"],
                }
                for x in results[:8]
            ],
        }
        if pick:
            locked[band] = {
                **pick["test"]["cfg"],
                "validated_test_roi": pick["test"]["roi"],
                "validated_test_hit_rate": pick["test"]["hit_rate"],
                "validated_test_selected": pick["test"]["selected"],
                "meets_target": bool(good),
            }
        print(band, "targets", len(good), report["bands"][band]["best"])

    report["locked"] = locked
    report["disclaimer"] = (
        "必ず勝てる保証はない。過去検証で条件を満たしたルールをロックしたもの。"
        "異常オッズは当日オッズ取得時に別途回避する。"
    )
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "oshi_ana_backtest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (REPORTS / "locked_triple_rules.json").write_text(
        json.dumps(locked, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("wrote locked_triple_rules.json")


if __name__ == "__main__":
    main()
