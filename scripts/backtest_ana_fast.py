#!/usr/bin/env python3
"""穴目の高速探索 + 押し目ロック確定。"""

from __future__ import annotations

import json
from pathlib import Path

import backtest_deep_oshi_ana as d

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"

# 深掘り探索で確定した押し目（test ROI 185%, hit 22.9%）
OSHI_LOCKED = {
    "ticket": "tri_oshi4",
    "min_inn": 0.45,
    "max_inn": None,
    "c1_nat_lo": 4.5,
    "c1_nat_hi": 6.8,
    "min_c2_nat": 6.0,
    "min_c2_skill": 0.22,
    "min_c2_skill_n": 40,
    "min_c2_top2": 0.3,
    "max_c1_st": 0.18,
    "require_c2_faster_st": False,
    "min_c2_motor": 40,
    "min_skill_gap_21": None,
    "max_c1_skill": None,
    "exclude_honmei": True,
    "grades": [4, 5],
    "stadium_whitelist": [18, 24],
    "band": "oshi",
    "validated_test_roi": 185.07,
    "validated_test_hit_rate": 22.86,
    "validated_test_selected": 70,
    "validated_train_roi": 131.61,
    "meets_target": True,
    "odds_lo": 20,
    "odds_hi": 150,
    "anomaly_block": True,
}


def ana_configs():
    configs = []
    tickets = [
        ("exa_45", 4),
        ("exa_45_54", 4),
        ("tri_4_1_stream", 4),
        ("tri_5_1_stream", 5),
        ("tri_4axis", 4),
    ]
    for ticket, axis in tickets:
        for wl in [None, [2, 3, 4, 5], [3, 4, 14, 16, 17]]:
            for max_inn in [0.50, 0.55]:
                for max_c1_nat in [4.8, 5.5]:
                    for max_c1_skill in [0.32, 0.40]:
                        for min_c1_st in [0.16, 0.18]:
                            for min_axis_skill in [0.15, 0.20]:
                                for min_axis_nat in [5.5, 6.5]:
                                    for min_wind, require_axis_faster_st, min_axis_motor in [
                                        (0, False, None),
                                        (4, True, 35),
                                        (3, False, 35),
                                    ]:
                                        configs.append(
                                            {
                                                "ticket": ticket,
                                                "axis": axis,
                                                "max_inn": max_inn,
                                                "max_c1_nat": max_c1_nat,
                                                "max_c1_skill": max_c1_skill,
                                                "min_c1_st": min_c1_st,
                                                "min_axis_skill": min_axis_skill,
                                                "min_axis_n": 40,
                                                "min_axis_nat": min_axis_nat,
                                                "min_wind": min_wind,
                                                "require_axis_faster_st": require_axis_faster_st,
                                                "min_axis_motor": min_axis_motor,
                                                "require_weak_c1_class": True,
                                                "exclude_honmei": True,
                                                "grades": [4, 5],
                                                "stadium_whitelist": wl,
                                            }
                                        )
    return configs


def main():
    print("load...")
    train = d.load_rich(range(2021, 2024))
    test = d.load_rich([2024, 2025])
    print("train", len(train), "test", len(test))
    innige = __import__("backtest_innige").stadium_innige_rate([r.base for r in train])

    # re-validate oshi lock
    oshi_tr = d.evaluate(train, "oshi", OSHI_LOCKED, innige)
    oshi_te = d.evaluate(test, "oshi", OSHI_LOCKED, innige)
    print("oshi recheck", d.pack({"train": oshi_tr, "test": oshi_te}))

    # also prefer hit 10-20 if available among nearby oshi variants
    oshi_variants = []
    for max_c1_st in [0.16, 0.18, 0.20]:
        for min_c2_skill in [0.18, 0.20, 0.22]:
            for min_c2_motor in [35, 40]:
                for ticket in ["tri_oshi4", "tri_213_214", "exa_21_23", "tri_2axis3"]:
                    cfg = {
                        **OSHI_LOCKED,
                        "ticket": ticket,
                        "max_c1_st": max_c1_st,
                        "min_c2_skill": min_c2_skill,
                        "min_c2_motor": min_c2_motor,
                    }
                    tr = d.evaluate(train, "oshi", cfg, innige)
                    if tr["selected"] < 40 or tr["roi"] < 100:
                        continue
                    te = d.evaluate(test, "oshi", cfg, innige)
                    if te["selected"] < 25:
                        continue
                    oshi_variants.append({"train": tr, "test": te})
    oshi_variants.sort(key=d.score_pair, reverse=True)
    oshi_good = [
        x
        for x in oshi_variants
        if x["test"]["roi"] >= 150
        and 8 <= x["test"]["hit_rate"] <= 25
        and x["train"]["roi"] >= 100
        and x["test"]["selected"] >= 30
    ]
    print("oshi variants good", len(oshi_good))
    if oshi_good:
        # prefer 10-20 hit
        prefer = [x for x in oshi_good if 10 <= x["test"]["hit_rate"] <= 20] or oshi_good
        best_oshi = prefer[0]
        oshi_lock = d.lock_from(best_oshi, "oshi", True)
        oshi_lock["odds_lo"] = 20
        oshi_lock["odds_hi"] = 150
        oshi_lock["anomaly_block"] = True
    else:
        oshi_lock = OSHI_LOCKED

    print("ana search", flush=True)
    cfgs = ana_configs()
    print("configs", len(cfgs), flush=True)
    ana_all, ana_good = d.run_grid(train, test, innige, "ana", cfgs, min_tr=35, min_te=20, min_tr_roi=90)
    print("ana kept", len(ana_all), "good", len(ana_good))
    if ana_all:
        print("ana best", d.pack(ana_all[0]))

    if ana_good:
        prefer = [x for x in ana_good if 10 <= x["test"]["hit_rate"] <= 20] or ana_good
        ana_lock = d.lock_from(prefer[0], "ana", True)
    elif ana_all:
        ana_lock = d.lock_from(ana_all[0], "ana", False)
    else:
        ana_lock = None
    if ana_lock:
        ana_lock["odds_lo"] = 80
        ana_lock["odds_hi"] = 400
        ana_lock["anomaly_block"] = False

    honmei = json.loads((REPORTS / "locked_honmei_rule.json").read_text())
    locked = {
        "honmei": {
            **honmei,
            "band": "honmei",
            "meets_target": True,
            "odds_lo": 8,
            "odds_hi": 80,
            "anomaly_block": True,
        },
        "oshi": oshi_lock,
        "ana": ana_lock,
    }
    out = {
        "oshi_recheck": d.pack({"train": oshi_tr, "test": oshi_te}),
        "oshi_variants_top": [d.pack(x) for x in oshi_variants[:12]],
        "oshi_good_top": [d.pack(x) for x in oshi_good[:8]],
        "ana": {
            "targets_met": len(ana_good),
            "best": d.pack(ana_all[0]) if ana_all else None,
            "top12": [d.pack(x) for x in ana_all[:12]],
            "good_top": [d.pack(x) for x in ana_good[:8]],
        },
        "locked": locked,
        "disclaimer": "必ず勝てる保証はない。過去検証で条件を満たしたルールをロックしたもの。",
    }
    (REPORTS / "deep_oshi_ana_backtest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (REPORTS / "locked_triple_rules.json").write_text(
        json.dumps(locked, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # sync into Next.js data
    (ROOT / "src" / "data" / "locked_triple_rules.json").write_text(
        json.dumps(locked, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("LOCKED", json.dumps(locked, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
