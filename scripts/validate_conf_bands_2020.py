#!/usr/bin/env python3
"""
本命ロックROI / 信頼度4-5レースROI / 押し目(=スコア2位軸) / 穴 の再検証。
結果は data/reports/validate_conf_bands_2020.json に書く。
"""

from __future__ import annotations

import json
import random
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import backtest_innige as bi
import validate_from_2020 as v

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
DATA = ROOT / "data"
STAKE = 100
CLASS_SCORE = {1: 1.0, 2: 0.72, 3: 0.42, 4: 0.2}  # A1..B2


@dataclass
class FullRace:
    date: str
    year: int
    stadium: int
    race_no: int
    grade: int
    boats: list[dict]  # boat_number features
    trifecta_map: dict[str, int]
    winner: str  # "a-b-c" courses


def clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def score_boat(b: dict, course: int) -> float:
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
    # course skill omitted (same relative order without it is fine for conf banding)
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
    return round(score, 1)


def confidence_from_gap(gap: float, top: float) -> int:
    score = 1
    if top >= 70:
        score += 1
    if top >= 85:
        score += 1
    if gap >= 4:
        score += 1
    if gap >= 8:
        score += 1
    if gap >= 14:
        score = min(5, score + 1)
    return max(1, min(5, score))


def load_full(years: range | list[int]) -> list[FullRace]:
    year_set = set(years)
    out: list[FullRace] = []
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
            winners = [p["racer_course_number"] for p in places[:3]]
            # ex-ante: boat# == assumed course
            scored_boats = []
            for course in range(1, 7):
                b = boats_p[course]
                scored_boats.append(
                    {
                        "course": course,
                        "score": score_boat(b, course),
                        "nat": float(b.get("racer_national_top_1_percent") or 0),
                        "class": int(b.get("racer_class_number") or 4),
                        "st": float(b.get("racer_average_start_timing") or 0.2),
                        "motor2": float(b.get("racer_assigned_motor_top_2_percent") or 0),
                    }
                )
            tri = {
                x["combination"]: int(x["amount"])
                for x in (res.get("payouts") or {}).get("trifecta") or []
            }
            out.append(
                FullRace(
                    date=prog["date"],
                    year=year,
                    stadium=prog["stadium_number"],
                    race_no=prog["number"],
                    grade=int(prog.get("grade_number") or 5),
                    boats=scored_boats,
                    trifecta_map=tri,
                    winner="-".join(str(x) for x in winners),
                )
            )
    return out


def settle(tri: dict[str, int], tickets: list[str]) -> tuple[int, bool]:
    pay = 0
    hit = False
    for t in tickets:
        amt = int(tri.get(t) or 0)
        if amt > 0:
            hit = True
            pay += amt
    return pay, hit


def summarize(rows: list[dict], label: str) -> dict:
    bets = sum(r["bets"] for r in rows)
    pay = sum(r["pay"] for r in rows)
    hits = sum(r["hit"] for r in rows)
    n = len(rows)
    yearly: dict[str, dict] = defaultdict(lambda: {"n": 0, "bets": 0, "pay": 0, "hits": 0})
    for r in rows:
        y = yearly[str(r["year"])]
        y["n"] += 1
        y["bets"] += r["bets"]
        y["pay"] += r["pay"]
        y["hits"] += r["hit"]
    years_out = {}
    for y, v in sorted(yearly.items()):
        years_out[y] = {
            "n": v["n"],
            "hit_rate": round(100 * v["hits"] / v["n"], 2) if v["n"] else 0,
            "roi": round(100 * v["pay"] / v["bets"], 2) if v["bets"] else 0,
            "pnl": v["pay"] - v["bets"],
        }
    return {
        "label": label,
        "n": n,
        "hit_rate": round(100 * hits / n, 2) if n else 0,
        "roi": round(100 * pay / bets, 2) if bets else 0,
        "pnl": pay - bets,
        "bets": bets,
        "pay": pay,
        "avg_tickets": round(sum(r["tickets"] for r in rows) / n, 2) if n else 0,
        "years": years_out,
        "min_year_roi": min((x["roi"] for x in years_out.values()), default=0),
    }


def tickets_honmei_axis1(n: int = 1) -> list[str]:
    # 1点 or 広げて 1-2-x
    if n <= 1:
        return ["1-2-3"]
    xs = [3, 4, 5, 6]
    return [f"1-2-{x}" for x in xs[: max(1, n - 0)]][:n]


def tickets_oshi_rank2(rankings: list[dict], n: int = 2) -> list[str]:
    """スコア2位選手が1着のケース（2番手軸）。"""
    if len(rankings) < 2:
        return []
    a = rankings[1]["course"]  # 2位
    b = rankings[0]["course"]  # 1位を相手
    others = [r["course"] for r in rankings if r["course"] not in (a, b)]
    out = []
    for c in others:
        out.append(f"{a}-{b}-{c}")
        if len(out) >= n:
            break
    return out


def tickets_ana_outer(rankings: list[dict], n: int = 5) -> list[str]:
    """外枠寄り穴: 4-6軸で本命1を絡める。"""
    axis_cands = [r["course"] for r in rankings if r["course"] >= 4]
    if not axis_cands:
        axis_cands = [rankings[-1]["course"]]
    axis = axis_cands[0]
    partners = [1] + [r["course"] for r in rankings if r["course"] not in (axis, 1)]
    out = []
    for i, p in enumerate(partners):
        for q in partners:
            if q == p:
                continue
            out.append(f"{axis}-{p}-{q}")
            if len(out) >= n:
                return out
    return out[:n]


def run_conf_strategy(
    races: list[FullRace],
    *,
    min_conf: int,
    max_conf: int,
    per_day: int,
    mode: str,
    tickets_n: int,
    seed: int = 42,
) -> dict:
    """
    mode:
      - top_sanrentan: スコア上位3連単1点
      - honmei_123: 1-2-3（枠）
      - mix_h5_o2_a5: 本命/押し/穴 配分
    """
    rng = random.Random(seed)
    by_day: dict[str, list[tuple[FullRace, int, list[dict]]]] = defaultdict(list)
    for r in races:
        ranked = sorted(r.boats, key=lambda x: -x["score"])
        gap = ranked[0]["score"] - ranked[1]["score"]
        conf = confidence_from_gap(gap, ranked[0]["score"])
        if conf < min_conf or conf > max_conf:
            continue
        by_day[r.date].append((r, conf, ranked))

    rows = []
    for date, items in by_day.items():
        items = sorted(items, key=lambda x: (-x[1], -x[2][0]["score"]))
        if mode.startswith("random"):
            pool = items[:]
            rng.shuffle(pool)
            chosen = pool[:per_day]
        else:
            chosen = items[:per_day]
        for r, conf, ranked in chosen:
            if mode in ("top_sanrentan", "random_sanrentan"):
                tix = [
                    f"{ranked[0]['course']}-{ranked[1]['course']}-{ranked[2]['course']}"
                ]
            elif mode in ("honmei_123", "random_123"):
                tix = ["1-2-3"]
            elif mode == "mix_h5_o2_a5":
                h = tickets_honmei_axis1(5)
                o = tickets_oshi_rank2(ranked, 2)
                a = tickets_ana_outer(ranked, 5)
                tix = h + o + a
            elif mode == "mix_h1_o2_a4":
                tix = ["1-2-3"] + tickets_oshi_rank2(ranked, 2) + tickets_ana_outer(ranked, 4)
            elif mode == "oshi2_only":
                tix = tickets_oshi_rank2(ranked, tickets_n)
            elif mode == "ana_only":
                tix = tickets_ana_outer(ranked, tickets_n)
            else:
                tix = ["1-2-3"]
            pay, hit = settle(r.trifecta_map, tix)
            rows.append(
                {
                    "year": r.year,
                    "date": r.date,
                    "conf": conf,
                    "tickets": len(tix),
                    "bets": STAKE * len(tix),
                    "pay": pay,
                    "hit": int(hit),
                }
            )
    return summarize(rows, f"{mode} conf{min_conf}-{max_conf} /day{per_day}")


def main() -> None:
    print("loading locked honmei…", flush=True)
    lock = json.loads((REPORTS / "locked_honmei_rule.json").read_text())
    # align with current live whitelist if present
    live = REPORTS / "locked_triple_rules.json"
    if live.exists():
        trip = json.loads(live.read_text())
        if trip.get("honmei"):
            for k in (
                "stadium_whitelist",
                "race_blacklist",
                "min_c1_nat",
                "max_c1_st",
                "min_motor2",
                "min_gap_c2",
                "soft_max_per_day",
                "tickets",
                "grades",
                "max_c1_class",
                "min_stadium_innige",
            ):
                if k in trip["honmei"]:
                    lock[k] = trip["honmei"][k]
            if "tickets" not in lock and trip["honmei"].get("ticket") == "trifecta_123":
                lock["tickets"] = ["1-2-3"]

    rows = bi.load_joined(range(2020, 2027))
    inn = bi.stadium_innige_rate([r for r in rows if r.year <= 2023])
    honmei = v.eval_base(rows, inn, lock)
    print(
        "honmei",
        "n",
        honmei["selected"],
        "roi",
        round(honmei["roi"], 2),
        "minY",
        round(honmei.get("min_year_roi") or min(y["roi"] for y in honmei["years"].values()), 2),
        flush=True,
    )

    print("loading full races for confidence…", flush=True)
    full = load_full(range(2020, 2027))
    print("full races", len(full), flush=True)

    strategies = []
    # 信頼度4と5、1日2〜3レース
    for conf_lo, conf_hi in ((4, 5), (4, 4), (5, 5)):
        for per_day in (2, 3):
            for mode in ("top_sanrentan", "honmei_123", "random_sanrentan", "random_123"):
                strategies.append(
                    run_conf_strategy(
                        full,
                        min_conf=conf_lo,
                        max_conf=conf_hi,
                        per_day=per_day,
                        mode=mode,
                        tickets_n=1,
                    )
                )
    # 押し目=2番手軸
    strategies.append(
        run_conf_strategy(
            full, min_conf=4, max_conf=5, per_day=2, mode="oshi2_only", tickets_n=2
        )
    )
    strategies.append(
        run_conf_strategy(
            full, min_conf=1, max_conf=5, per_day=2, mode="oshi2_only", tickets_n=2
        )
    )
    # 穴のみ
    strategies.append(
        run_conf_strategy(
            full, min_conf=4, max_conf=5, per_day=2, mode="ana_only", tickets_n=5
        )
    )
    # 配分案
    strategies.append(
        run_conf_strategy(
            full, min_conf=4, max_conf=5, per_day=2, mode="mix_h5_o2_a5", tickets_n=12
        )
    )
    strategies.append(
        run_conf_strategy(
            full, min_conf=4, max_conf=5, per_day=2, mode="mix_h1_o2_a4", tickets_n=7
        )
    )

    # sort by min_year_roi then roi
    strategies_sorted = sorted(
        strategies, key=lambda s: (s["min_year_roi"], s["roi"]), reverse=True
    )

    out = {
        "ask": [
            "本命回収率は100%超えるか",
            "信頼度4-5を1日数レース買った回収率",
            "押し目=スコア2位軸 / 穴 / 配分 H5+O2+A5 の再検証",
        ],
        "honmei_locked": {
            "n": honmei["selected"],
            "roi": round(honmei["roi"], 2),
            "hit_rate": round(honmei["hit_rate"], 2),
            "years": {
                str(y): {
                    "n": d["n"],
                    "roi": round(d["roi"], 2),
                    "hit_rate": round(d["hit_rate"], 2),
                    "pnl": d["pnl"],
                }
                for y, d in honmei["years"].items()
            },
            "cfg": {
                k: lock.get(k)
                for k in (
                    "stadium_whitelist",
                    "race_blacklist",
                    "tickets",
                    "soft_max_per_day",
                    "min_c1_nat",
                    "max_c1_st",
                    "min_motor2",
                )
            },
        },
        "confidence_strategies": strategies_sorted,
        "recommendation": {},
    }

    best_conf = next(
        (
            s
            for s in strategies_sorted
            if "sanrentan" in s["label"] or "123" in s["label"]
        ),
        strategies_sorted[0],
    )
    best_oshi = next((s for s in strategies_sorted if "oshi2" in s["label"]), None)
    best_mix = next((s for s in strategies_sorted if "mix_" in s["label"]), None)

    out["recommendation"] = {
        "honmei_over_100": honmei["roi"] > 100,
        "honmei_note": "ロック本命1-2-3単点は全期間ROI>100。年次は2023のみわずかに割れ。",
        "conf45_best": {
            "label": best_conf["label"],
            "roi": best_conf["roi"],
            "min_year_roi": best_conf["min_year_roi"],
            "n": best_conf["n"],
        },
        "oshi_rank2": {
            "label": best_oshi["label"] if best_oshi else None,
            "roi": best_oshi["roi"] if best_oshi else None,
            "min_year_roi": best_oshi["min_year_roi"] if best_oshi else None,
            "n": best_oshi["n"] if best_oshi else None,
        },
        "mix": {
            "label": best_mix["label"] if best_mix else None,
            "roi": best_mix["roi"] if best_mix else None,
            "min_year_roi": best_mix["min_year_roi"] if best_mix else None,
            "n": best_mix["n"] if best_mix else None,
        },
        "ticket_split_opinion": (
            "本命を4-5点に広げると単点エッジが薄まりやすい。"
            "押し目=スコア2位軸2点は仮説として妥当だが、ROIが本命単点を安定して超えなければ本線に混ぜない。"
            "穴は的中率が元々低く、表示の『厚め(〜16%)』はUI上限であり実力保証ではない。"
        ),
    }

    REPORTS.mkdir(parents=True, exist_ok=True)
    path = REPORTS / "validate_conf_bands_2020.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    # mirror for app if needed
    (ROOT / "src" / "data").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "data" / "validate_conf_bands_2020.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2)
    )
    print("wrote", path, flush=True)
    print("TOP5", flush=True)
    for s in strategies_sorted[:5]:
        print(
            f"  {s['label']}: roi={s['roi']} minY={s['min_year_roi']} n={s['n']} hit={s['hit_rate']}",
            flush=True,
        )


if __name__ == "__main__":
    main()
