#!/usr/bin/env python3
"""
押し目・穴の深掘り探索（選手別得意コース本格活用）— 段階探索版

目標（保証ではない）: 検証ROI>=150% / 的中率10-20%
"""

from __future__ import annotations

import json
import itertools
from dataclasses import dataclass
from pathlib import Path

import backtest_innige as bi

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
SKILLS = json.loads((REPORTS / "course_skills.json").read_text(encoding="utf-8"))
HONMEI = json.loads((REPORTS / "locked_honmei_rule.json").read_text(encoding="utf-8"))


@dataclass
class RichRace:
    base: bi.RaceRow
    nat: dict[int, float]
    st: dict[int, float]
    motor2: dict[int, float]
    klass: dict[int, int]
    skill_win: dict[int, float]
    skill_top2: dict[int, float]
    skill_starts: dict[int, int]


def skill_pack(regno: int, course: int) -> tuple[float, float, int]:
    rec = SKILLS.get(str(regno)) or {}
    c = (rec.get("courses") or {}).get(str(course)) or {}
    return (
        float(c.get("win_rate") or 0),
        float(c.get("top2_rate") or 0),
        int(c.get("starts") or 0),
    )


def load_rich(years) -> list[RichRace]:
    year_set = set(years)
    rows: list[RichRace] = []
    data = ROOT / "data"
    for rp in sorted((data / "results").glob("*.json")):
        key = rp.stem
        year = int(key[:4])
        if year not in year_set:
            continue
        pp = data / "programs" / f"{key}.json"
        if not pp.exists():
            continue
        results = {(r["stadium_number"], r["number"]): r for r in json.loads(rp.read_text())["results"]}
        programs = {(p["stadium_number"], p["number"]): p for p in json.loads(pp.read_text())["programs"]}
        for key2, prog in programs.items():
            res = results.get(key2)
            if not res:
                continue
            boats_p = {b["racer_boat_number"]: b for b in prog["boats"]}
            if not all(i in boats_p for i in range(1, 7)):
                continue
            res_boats = res["boats"]
            by_course = {b["racer_course_number"]: b for b in res_boats}
            c1 = by_course.get(1)
            if not c1:
                continue
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
            assumed = boats_p[1]
            base = bi.RaceRow(
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
                c2_nat=float(boats_p[2].get("racer_national_top_1_percent") or 0),
                c3_nat=float(boats_p[3].get("racer_national_top_1_percent") or 0),
                wind=int(res.get("wind_speed") or 0),
                wave=int(res.get("wave_height") or 0),
                innige=innige,
                winner_courses=winners,
                trifecta_map=tri,
                exacta_map=exa,
            )
            nat = {}
            st = {}
            motor2 = {}
            klass = {}
            skill_win = {}
            skill_top2 = {}
            skill_starts = {}
            for i in range(1, 7):
                b = boats_p[i]
                regno = int(b.get("racer_number") or 0)
                nat[i] = float(b.get("racer_national_top_1_percent") or 0)
                st[i] = float(b.get("racer_average_start_timing") or 0.2)
                motor2[i] = float(b.get("racer_assigned_motor_top_2_percent") or 0)
                klass[i] = int(b.get("racer_class_number") or 4)
                w, t2, n = skill_pack(regno, i)
                skill_win[i] = w
                skill_top2[i] = t2
                skill_starts[i] = n
            rows.append(
                RichRace(
                    base=base,
                    nat=nat,
                    st=st,
                    motor2=motor2,
                    klass=klass,
                    skill_win=skill_win,
                    skill_top2=skill_top2,
                    skill_starts=skill_starts,
                )
            )
    return rows


TICKETS = {
    "exa_21": [("exacta", "2-1")],
    "exa_21_23": [("exacta", "2-1"), ("exacta", "2-3")],
    "exa_31": [("exacta", "3-1")],
    "tri_213": [("trifecta", "2-1-3")],
    "tri_213_214": [("trifecta", "2-1-3"), ("trifecta", "2-1-4")],
    "tri_oshi4": [("trifecta", x) for x in ["2-1-3", "2-1-4", "3-1-2", "3-1-4"]],
    "tri_2axis3": [("trifecta", x) for x in ["2-1-3", "2-1-4", "2-3-1"]],
    "exa_45": [("exacta", "4-5")],
    "exa_45_54": [("exacta", "4-5"), ("exacta", "5-4")],
    "exa_46": [("exacta", "4-6")],
    "tri_4_1_stream": [("trifecta", f"4-1-{x}") for x in (2, 3, 5, 6)],
    "tri_5_1_stream": [("trifecta", f"5-1-{x}") for x in (2, 3, 4, 6)],
    "tri_456_546": [("trifecta", "4-5-6"), ("trifecta", "5-4-6")],
    "tri_4axis": [("trifecta", x) for x in ["4-1-2", "4-1-3", "4-5-1", "4-5-6"]],
}


def is_honmei_race(r: RichRace, innige: dict[int, float]) -> bool:
    b = r.base
    if b.stadium not in HONMEI.get("stadium_whitelist", []):
        return False
    if b.grade not in HONMEI.get("grades", [4, 5]):
        return False
    if b.c1_class > HONMEI.get("max_c1_class", 1):
        return False
    if b.c1_nat < HONMEI.get("min_c1_nat", 7.0):
        return False
    if b.c1_st > HONMEI.get("max_c1_st", 0.14):
        return False
    if b.c1_motor2 < HONMEI.get("min_motor2", 35):
        return False
    if b.c1_nat - b.c2_nat < HONMEI.get("min_gap_c2", 1.0):
        return False
    if innige.get(b.stadium, 0) < HONMEI.get("min_stadium_innige", 0.6):
        return False
    return True


def passes_oshi(r: RichRace, cfg: dict, innige: dict[int, float]) -> bool:
    b = r.base
    if cfg.get("exclude_honmei") and is_honmei_race(r, innige):
        return False
    if b.grade not in cfg.get("grades", [4, 5]):
        return False
    wl = cfg.get("stadium_whitelist")
    if wl and b.stadium not in wl:
        return False
    rate = innige.get(b.stadium, 0)
    if rate < cfg["min_inn"]:
        return False
    if cfg.get("max_inn") is not None and rate > cfg["max_inn"]:
        return False
    if not (cfg["c1_nat_lo"] <= b.c1_nat <= cfg["c1_nat_hi"]):
        return False
    if b.c2_nat < cfg["min_c2_nat"]:
        return False
    if r.skill_win[2] < cfg["min_c2_skill"]:
        return False
    if r.skill_starts[2] < cfg.get("min_c2_skill_n", 40):
        return False
    if r.skill_top2[2] < cfg.get("min_c2_top2", 0.0):
        return False
    if b.c1_st > cfg.get("max_c1_st", 0.99):
        return False
    if cfg.get("require_c2_faster_st") and not (r.st[2] + 0.01 < b.c1_st):
        return False
    if cfg.get("min_c2_motor") is not None and r.motor2[2] < cfg["min_c2_motor"]:
        return False
    if cfg.get("min_skill_gap_21") is not None and (r.skill_win[2] - r.skill_win[1]) < cfg["min_skill_gap_21"]:
        return False
    if cfg.get("max_c1_skill") is not None and r.skill_win[1] > cfg["max_c1_skill"]:
        return False
    if cfg.get("min_c3_skill") is not None and r.skill_win[3] < cfg["min_c3_skill"]:
        return False
    return True


def passes_ana(r: RichRace, cfg: dict, innige: dict[int, float]) -> bool:
    b = r.base
    if cfg.get("exclude_honmei") and is_honmei_race(r, innige):
        return False
    if b.grade not in cfg.get("grades", [4, 5]):
        return False
    wl = cfg.get("stadium_whitelist")
    if wl and b.stadium not in wl:
        return False
    rate = innige.get(b.stadium, 1)
    if cfg.get("max_inn") is not None and rate > cfg["max_inn"]:
        return False
    if b.c1_nat > cfg["max_c1_nat"]:
        return False
    if r.skill_win[1] > cfg.get("max_c1_skill", 0.99):
        return False
    if b.c1_st < cfg.get("min_c1_st", 0.0):
        return False
    if b.wind < cfg.get("min_wind", 0):
        return False
    axis = cfg.get("axis", 4)
    if r.skill_win[axis] < cfg["min_axis_skill"]:
        return False
    if r.skill_starts[axis] < cfg.get("min_axis_n", 40):
        return False
    if r.nat[axis] < cfg.get("min_axis_nat", 0):
        return False
    if cfg.get("require_axis_faster_st") and not (r.st[axis] + 0.01 < b.c1_st):
        return False
    if cfg.get("min_axis_motor") is not None and r.motor2[axis] < cfg["min_axis_motor"]:
        return False
    if cfg.get("require_weak_c1_class") and b.c1_class < 2:
        return False
    return True


def evaluate(rows: list[RichRace], band: str, cfg: dict, innige: dict[int, float]) -> dict:
    tickets = TICKETS[cfg["ticket"]]
    stake_unit = 100 * len(tickets)
    bets = pay = hits = selected = 0
    pays_hit = []
    pred = passes_oshi if band == "oshi" else passes_ana
    for r in rows:
        if not pred(r, cfg, innige):
            continue
        selected += 1
        bets += stake_unit
        race_pay = 0
        hit = False
        for bet_type, combo in tickets:
            mp = r.base.trifecta_map if bet_type == "trifecta" else r.base.exacta_map
            amt = mp.get(combo)
            if amt:
                race_pay += amt
                hit = True
        pay += race_pay
        hits += int(hit)
        if hit:
            pays_hit.append(race_pay)
    return {
        "selected": selected,
        "bets": bets,
        "pay": pay,
        "roi": (pay / bets * 100) if bets else 0.0,
        "hit_rate": (hits / selected * 100) if selected else 0.0,
        "hit_races": hits,
        "avg_hit_pay": (sum(pays_hit) / len(pays_hit)) if pays_hit else 0,
        "tickets": len(tickets),
        "cfg": cfg,
        "band": band,
    }


def score_pair(x):
    te, tr = x["test"], x["train"]
    hit_ok = 10 <= te["hit_rate"] <= 20
    soft = 8 <= te["hit_rate"] <= 25
    target = te["roi"] >= 150 and soft and te["selected"] >= 30 and tr["roi"] >= 100
    return (
        1 if target else 0,
        1 if hit_ok else 0,
        1 if soft else 0,
        1 if tr["roi"] >= 100 else 0,
        te["roi"],
        tr["roi"],
        te["hit_rate"],
    )


def run_grid(train, test, innige, band: str, configs: list[dict], min_tr=40, min_te=20, min_tr_roi=80):
    out = []
    for i, cfg in enumerate(configs):
        tr = evaluate(train, band, cfg, innige)
        if tr["selected"] < min_tr or tr["roi"] < min_tr_roi:
            continue
        te = evaluate(test, band, cfg, innige)
        if te["selected"] < min_te:
            continue
        out.append({"train": tr, "test": te})
        if (i + 1) % 200 == 0:
            print(f"  {band} scanned {i+1}/{len(configs)} kept {len(out)}")
    out.sort(key=score_pair, reverse=True)
    good = [
        x
        for x in out
        if x["test"]["roi"] >= 150
        and 8 <= x["test"]["hit_rate"] <= 25
        and x["test"]["selected"] >= 30
        and x["train"]["roi"] >= 100
    ]
    return out, good


def oshi_stage1():
    configs = []
    for ticket in ["exa_21", "exa_21_23", "tri_213_214", "tri_oshi4", "tri_2axis3"]:
        for wl in [None, [18, 24], [12, 13, 18, 19, 21, 24]]:
            for min_inn in [0.45, 0.50, 0.55]:
                for c1_nat_lo, c1_nat_hi in [(4.5, 6.8), (5.0, 7.0), (5.5, 7.2)]:
                    for min_c2_nat in [5.5, 6.0, 6.5]:
                        for min_c2_skill in [0.12, 0.15, 0.18, 0.22]:
                            for max_c1_st in [0.16, 0.18, 0.22]:
                                configs.append(
                                    {
                                        "ticket": ticket,
                                        "min_inn": min_inn,
                                        "max_inn": None,
                                        "c1_nat_lo": c1_nat_lo,
                                        "c1_nat_hi": c1_nat_hi,
                                        "min_c2_nat": min_c2_nat,
                                        "min_c2_skill": min_c2_skill,
                                        "min_c2_skill_n": 40,
                                        "min_c2_top2": 0.30,
                                        "max_c1_st": max_c1_st,
                                        "require_c2_faster_st": False,
                                        "min_c2_motor": None,
                                        "min_skill_gap_21": None,
                                        "max_c1_skill": None,
                                        "exclude_honmei": True,
                                        "grades": [4, 5],
                                        "stadium_whitelist": wl,
                                    }
                                )
    return configs


def oshi_stage2(seeds: list[dict]):
    """Refine around promising seeds with ST/motor/skill-gap levers."""
    configs = []
    seen = set()
    for seed in seeds[:20]:
        base = dict(seed)
        for require_c2_faster_st in [False, True]:
            for min_c2_motor in [None, 35, 40]:
                for min_skill_gap_21 in [None, 0.03, 0.06]:
                    for max_c1_skill in [None, 0.40, 0.35]:
                        for min_c2_top2 in [0.30, 0.35, 0.40]:
                            cfg = {
                                **base,
                                "require_c2_faster_st": require_c2_faster_st,
                                "min_c2_motor": min_c2_motor,
                                "min_skill_gap_21": min_skill_gap_21,
                                "max_c1_skill": max_c1_skill,
                                "min_c2_top2": min_c2_top2,
                            }
                            key = json.dumps(cfg, sort_keys=True, default=str)
                            if key in seen:
                                continue
                            seen.add(key)
                            configs.append(cfg)
    return configs


def ana_stage1():
    configs = []
    for ticket, axis in [
        ("exa_45", 4),
        ("exa_45_54", 4),
        ("exa_46", 4),
        ("tri_4_1_stream", 4),
        ("tri_5_1_stream", 5),
        ("tri_456_546", 4),
        ("tri_4axis", 4),
    ]:
        for wl in [None, [2, 3, 4, 5], [3, 4, 14, 16, 17]]:
            for max_inn in [0.50, 0.55, 0.58]:
                for max_c1_nat in [4.8, 5.2, 5.8]:
                    for max_c1_skill in [0.30, 0.35, 0.42]:
                        for min_c1_st in [0.15, 0.17, 0.19]:
                            for min_axis_skill in [0.12, 0.15, 0.18, 0.22]:
                                for min_axis_nat in [5.0, 5.5, 6.0]:
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
                                            "min_wind": 0,
                                            "require_axis_faster_st": False,
                                            "min_axis_motor": None,
                                            "require_weak_c1_class": True,
                                            "exclude_honmei": True,
                                            "grades": [4, 5],
                                            "stadium_whitelist": wl,
                                        }
                                    )
    return configs


def ana_stage2(seeds: list[dict]):
    configs = []
    seen = set()
    for seed in seeds[:20]:
        base = dict(seed)
        for min_wind in [0, 3, 4]:
            for require_axis_faster_st in [False, True]:
                for min_axis_motor in [None, 35, 40]:
                    for require_weak_c1_class in [True, False]:
                        cfg = {
                            **base,
                            "min_wind": min_wind,
                            "require_axis_faster_st": require_axis_faster_st,
                            "min_axis_motor": min_axis_motor,
                            "require_weak_c1_class": require_weak_c1_class,
                        }
                        key = json.dumps(cfg, sort_keys=True, default=str)
                        if key in seen:
                            continue
                        seen.add(key)
                        configs.append(cfg)
    return configs


def pack(x):
    return {
        "train_roi": round(x["train"]["roi"], 2),
        "test_roi": round(x["test"]["roi"], 2),
        "test_hit": round(x["test"]["hit_rate"], 2),
        "test_n": x["test"]["selected"],
        "train_n": x["train"]["selected"],
        "avg_hit_pay": round(x["test"]["avg_hit_pay"], 1),
        "cfg": x["test"]["cfg"],
    }


def lock_from(best, band: str, meets: bool):
    return {
        **best["test"]["cfg"],
        "band": band,
        "validated_test_roi": best["test"]["roi"],
        "validated_test_hit_rate": best["test"]["hit_rate"],
        "validated_test_selected": best["test"]["selected"],
        "validated_train_roi": best["train"]["roi"],
        "meets_target": meets,
    }


def main():
    REPORTS.mkdir(parents=True, exist_ok=True)
    print("load train...")
    train = load_rich(range(2021, 2024))
    print("train", len(train))
    print("load test...")
    test = load_rich([2024, 2025])
    print("test", len(test))
    innige = bi.stadium_innige_rate([r.base for r in train])

    print("oshi stage1", flush=True)
    o1_cfgs = oshi_stage1()
    print("configs", len(o1_cfgs))
    oshi_s1, _ = run_grid(train, test, innige, "oshi", o1_cfgs, min_tr_roi=85)
    print("oshi s1 kept", len(oshi_s1))
    seeds = [x["test"]["cfg"] for x in oshi_s1[:25]]
    print("oshi stage2", flush=True)
    o2_cfgs = oshi_stage2(seeds) if seeds else []
    print("configs", len(o2_cfgs))
    oshi_s2, oshi_good = run_grid(train, test, innige, "oshi", o2_cfgs, min_tr_roi=90) if o2_cfgs else ([], [])
    oshi_all = sorted(oshi_s1 + oshi_s2, key=score_pair, reverse=True)
    oshi_good = [
        x
        for x in oshi_all
        if x["test"]["roi"] >= 150
        and 8 <= x["test"]["hit_rate"] <= 25
        and x["test"]["selected"] >= 30
        and x["train"]["roi"] >= 100
    ]
    print("oshi good", len(oshi_good), "best", pack(oshi_all[0]) if oshi_all else None)

    print("ana stage1", flush=True)
    a1_cfgs = ana_stage1()
    print("configs", len(a1_cfgs))
    ana_s1, _ = run_grid(train, test, innige, "ana", a1_cfgs, min_tr_roi=80)
    print("ana s1 kept", len(ana_s1))
    seeds = [x["test"]["cfg"] for x in ana_s1[:25]]
    print("ana stage2", flush=True)
    a2_cfgs = ana_stage2(seeds) if seeds else []
    print("configs", len(a2_cfgs))
    ana_s2, _ = run_grid(train, test, innige, "ana", a2_cfgs, min_tr_roi=85) if a2_cfgs else ([], [])
    ana_all = sorted(ana_s1 + ana_s2, key=score_pair, reverse=True)
    ana_good = [
        x
        for x in ana_all
        if x["test"]["roi"] >= 150
        and 8 <= x["test"]["hit_rate"] <= 25
        and x["test"]["selected"] >= 30
        and x["train"]["roi"] >= 100
    ]
    print("ana good", len(ana_good), "best", pack(ana_all[0]) if ana_all else None)

    locked = {
        "honmei": {**HONMEI, "band": "honmei", "meets_target": True},
        "oshi": lock_from(oshi_good[0], "oshi", True)
        if oshi_good
        else (lock_from(oshi_all[0], "oshi", False) if oshi_all else None),
        "ana": lock_from(ana_good[0], "ana", True)
        if ana_good
        else (lock_from(ana_all[0], "ana", False) if ana_all else None),
    }
    out = {
        "train_n": len(train),
        "test_n": len(test),
        "oshi": {
            "targets_met": len(oshi_good),
            "best": pack(oshi_all[0]) if oshi_all else None,
            "top12": [pack(x) for x in oshi_all[:12]],
            "good_top": [pack(x) for x in oshi_good[:8]],
        },
        "ana": {
            "targets_met": len(ana_good),
            "best": pack(ana_all[0]) if ana_all else None,
            "top12": [pack(x) for x in ana_all[:12]],
            "good_top": [pack(x) for x in ana_good[:8]],
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
    print("DONE targets", len(oshi_good), len(ana_good))


if __name__ == "__main__":
    main()
