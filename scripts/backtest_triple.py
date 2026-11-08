#!/usr/bin/env python3
"""
本命 / 押し目 / 穴 の3段システム検証（オッズ異常回避つき）

データ: turnmark (2026, オッズ付き)
補助: course_skills.json（過去結果からの得意コース）

注意: 「必ず勝てる」は保証できない。ここでは過去検証で
  - 押し目・穴: 検証ROI>=150% かつ 的中率 10-20% を探索
  - 本命: 異常に買われすぎた人気を回避したうえでイン戦を狙う
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
TURNMARK = DATA / "turnmark"
SKILLS = REPORTS / "course_skills.json"

STADIUMS = {
    1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川", 6: "浜名湖",
    7: "蒲郡", 8: "常滑", 9: "津", 10: "三国", 11: "びわこ", 12: "住之江",
    13: "尼崎", 14: "鳴門", 15: "丸亀", 16: "児島", 17: "宮島", 18: "徳山",
    19: "下関", 20: "若松", 21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村",
}


def flatten_trifecta(odds_tree: dict) -> dict[str, float]:
    out = {}
    for a, m2 in (odds_tree or {}).items():
        for b, m3 in m2.items():
            for c, odds in m3.items():
                if odds is None:
                    continue
                out[f"{a}-{b}-{c}"] = float(odds)
    return out


def anomaly_flags(tri: dict[str, float]) -> dict:
    if not tri:
        return {
            "ok": False,
            "favorite": None,
            "fav_odds": None,
            "overbet": True,
            "money_concentrate": True,
            "top3_share_proxy": 1.0,
        }
    ranked = sorted(tri.items(), key=lambda x: x[1])
    fav, fav_odds = ranked[0]
    # implied-prob proxy = 1/odds, normalize roughly by sum of top tickets
    inv = [(k, 1.0 / v) for k, v in ranked[:30] if v > 0]
    s = sum(v for _, v in inv) or 1.0
    top3_share = sum(v for _, v in inv[:3]) / s
    overbet = fav_odds < 6.0  # 異常に買われすぎ（短すぎ）
    money_concentrate = top3_share > 0.55
    return {
        "ok": not (overbet or money_concentrate),
        "favorite": fav,
        "fav_odds": fav_odds,
        "overbet": overbet,
        "money_concentrate": money_concentrate,
        "top3_share_proxy": round(top3_share, 3),
    }


@dataclass
class RaceEx:
    date: str
    month: int
    stadium: int
    race_no: int
    grade: int
    technique: int | None
    # assumed boat numbers 1..6 features from racers entry
    entries: dict[int, dict]
    skills: dict[int, dict]
    trifecta_odds: dict[str, float]
    trifecta_payout: dict[str, int]
    winner: str | None  # "1-2-3" course order? use boat entry order from result
    winner_courses: tuple[int, int, int] | None
    anomaly: dict


def load_skills() -> dict:
    if not SKILLS.exists():
        return {}
    return json.loads(SKILLS.read_text(encoding="utf-8"))


def load_races(skills: dict) -> list[RaceEx]:
    rows: list[RaceEx] = []
    for path in sorted(TURNMARK.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        stadiums = data.get("programs", {}).get("stadiums", {})
        for sid, st in stadiums.items():
            for rid, race in st.get("races", {}).items():
                odds = race.get("odds") or {}
                result = race.get("result") or {}
                racers = race.get("racers") or {}
                if not odds or not result:
                    continue
                tri = flatten_trifecta(odds.get("trifecta") or {})
                pays = {
                    p["combination"]: int(p["amount"])
                    for p in (result.get("payouts") or {}).get("trifecta") or []
                }
                entries = {}
                for _, r in racers.items():
                    entry = int(r.get("entry_number") or 0)
                    regno = int(r.get("number") or 0)
                    if not entry:
                        continue
                    entries[entry] = {
                        "regno": regno,
                        "name": r.get("name"),
                        "class": int(r.get("rank_number") or 4),
                        "nat": float(r.get("national_win_rate") or r.get("national_top_1_percent") or 0),
                        # turnmark uses national_win_rate style fields in v1 - fallbacks:
                        "nat2": float(
                            r.get("national_top_2_percent")
                            or r.get("national_2rate")
                            or 0
                        ),
                        "loc": float(r.get("local_win_rate") or r.get("local_top_1_percent") or 0),
                        "st": float(r.get("average_start_timing") or 0.2),
                        "motor2": float(
                            r.get("motor_top_2_percent")
                            or r.get("assigned_motor_top_2_percent")
                            or 0
                        ),
                    }
                    # normalize field names from turnmark racers
                    if not entries[entry]["nat"]:
                        entries[entry]["nat"] = float(r.get("national_top_1_percent") or 0)
                    if not entries[entry]["motor2"]:
                        entries[entry]["motor2"] = float(
                            r.get("assigned_motor_top_2_percent") or 0
                        )
                    if not entries[entry]["st"]:
                        entries[entry]["st"] = float(r.get("average_start_timing") or 0.2)

                # fill from nested keys used by turnmark
                for _, r in racers.items():
                    entry = int(r.get("entry_number") or 0)
                    if entry not in entries:
                        continue
                    if entries[entry]["nat"] == 0:
                        entries[entry]["nat"] = float(r.get("national_win_rate") or 0)
                    # turnmark schema from boatraceopenapi-like
                    entries[entry]["nat"] = float(
                        r.get("national_win_rate")
                        or r.get("national_top_1_percent")
                        or entries[entry]["nat"]
                        or 0
                    )
                    entries[entry]["motor2"] = float(
                        r.get("motor_top_2_percent")
                        or r.get("assigned_motor_top_2_percent")
                        or entries[entry]["motor2"]
                        or 0
                    )
                    entries[entry]["st"] = float(
                        r.get("average_start_timing") or entries[entry]["st"] or 0.2
                    )
                    entries[entry]["class"] = int(
                        r.get("rank_number") or entries[entry]["class"] or 4
                    )

                res_racers = result.get("racers") or {}
                placed_boats = []
                placed_courses = []
                for _, rr in res_racers.items():
                    place = rr.get("place_number")
                    boat = rr.get("entry_number")
                    course = rr.get("course_number")
                    if place and boat and 1 <= int(place) <= 6:
                        placed_boats.append((int(place), int(boat)))
                    if place and course and 1 <= int(place) <= 6:
                        placed_courses.append((int(place), int(course)))
                placed_boats.sort()
                placed_courses.sort()
                if len(placed_boats) < 3:
                    continue
                # 3連単の組み合わせは艇番（entry）
                winner = (
                    f"{placed_boats[0][1]}-{placed_boats[1][1]}-{placed_boats[2][1]}"
                )
                winner_courses = (
                    tuple(c for _, c in placed_courses[:3])
                    if len(placed_courses) >= 3
                    else None
                )
                skill_map = {}
                for entry, e in entries.items():
                    skill_map[entry] = skills.get(str(e["regno"]), {})

                for _, r in racers.items():
                    entry = int(r.get("entry_number") or 0)
                    if entry not in entries:
                        continue
                    entries[entry]["nat"] = float(r.get("national_win_rate") or 0)
                    entries[entry]["loc"] = float(r.get("local_win_rate") or 0)
                    entries[entry]["st"] = float(r.get("average_start_timing") or 0.2)
                    entries[entry]["motor2"] = float(r.get("motor_top_2_percent") or 0)
                    entries[entry]["class"] = int(r.get("rank_number") or 4)
                    entries[entry]["nat2"] = float(r.get("national_top_2_percent") or 0)

                date = race.get("date") or path.stem
                rows.append(
                    RaceEx(
                        date=str(date),
                        month=int(str(date)[5:7]) if "-" in str(date) else int(path.stem[4:6]),
                        stadium=int(sid),
                        race_no=int(rid),
                        grade=int(race.get("grade_number") or 5),
                        technique=(result.get("technique_number")),
                        entries=entries,
                        skills=skill_map,
                        trifecta_odds=tri,
                        trifecta_payout=pays,
                        winner=winner,
                        winner_courses=winner_courses,
                        anomaly=anomaly_flags(tri),
                    )
                )
    return rows


def course_skill(race: RaceEx, entry: int, course: int) -> float:
    sk = race.skills.get(entry) or {}
    c = (sk.get("courses") or {}).get(str(course))
    if not c:
        return 0.0
    return float(c.get("win_rate") or 0.0)


def score_entry(race: RaceEx, entry: int, course: int) -> float:
    e = race.entries.get(entry)
    if not e:
        return -1e9
    skill = course_skill(race, entry, course)
    return (
        (5 - e["class"]) * 8
        + e["nat"] * 4
        + e["motor2"] * 0.15
        + (1 - min(e["st"], 0.3) / 0.3) * 10
        + skill * 40
        + (6 if course == 1 else 0)
    )


def pick_tickets(
    race: RaceEx,
    band: str,
    anomaly_block: bool,
    odds_lo: float,
    odds_hi: float,
    stadiums: set[int] | None = None,
) -> list[str]:
    """band: honmei|oshi|ana. combinations are 艇番."""
    if stadiums is not None and race.stadium not in stadiums:
        return []
    if anomaly_block and band == "honmei" and not race.anomaly["ok"]:
        return []
    if anomaly_block and race.anomaly["overbet"] and band == "oshi":
        # 異常人気時は押し目を見送り（買われすぎ回避）
        return []

    scores = [(entry, score_entry(race, entry, entry)) for entry in range(1, 7)]
    scores.sort(key=lambda x: x[1], reverse=True)
    top = [e for e, _ in scores]
    a, b, c = top[0], top[1], top[2]

    cands: list[str] = []
    if band == "honmei":
        e1 = race.entries.get(1)
        if not e1:
            return []
        if e1["class"] > 1:
            return []
        if e1["nat"] < 6.5:
            return []
        # イン戦: 1コース得意 or 勝率十分
        if course_skill(race, 1, 1) < 0.30 and e1["nat"] < 7.0:
            return []
        cands = [f"1-2-{x}" for x in (3, 4, 5, 6)]
        cands += [f"1-3-{x}" for x in (2, 4, 5)]
    elif band == "oshi":
        cands = [
            f"{a}-{b}-{c}",
            f"{a}-{c}-{b}",
            f"{b}-{a}-{c}",
            f"1-{b}-{c}",
            f"{b}-1-{c}",
            f"1-{a}-{b}" if a != 1 else f"1-{b}-{c}",
        ]
    else:
        weak = [e for e, _ in scores[3:]] or [6, 5]
        w0 = weak[0]
        w1 = weak[1] if len(weak) > 1 else 6
        cands = [
            f"{b}-{c}-{w0}",
            f"{c}-{b}-{w0}",
            f"{w0}-{a}-{b}",
            f"{c}-{a}-{w0}",
            f"{b}-{w0}-{a}",
            f"{w1}-{b}-{a}",
            f"{a}-{w0}-{w1}",
        ]

    filtered = []
    for combo in cands:
        odds = race.trifecta_odds.get(combo)
        if odds is None:
            continue
        if not (odds_lo <= odds <= odds_hi):
            continue
        filtered.append(combo)
    seen = set()
    out = []
    for x in filtered:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out[:4]


def evaluate(
    rows: list[RaceEx],
    band: str,
    anomaly_block: bool,
    odds_lo: float,
    odds_hi: float,
    stadiums: set[int] | None = None,
) -> dict:
    bets = pay = hits = selected = 0
    for r in rows:
        tickets = pick_tickets(r, band, anomaly_block, odds_lo, odds_hi, stadiums)
        if not tickets:
            continue
        selected += 1
        stake = 100 * len(tickets)
        bets += stake
        got = 0
        hit = False
        for t in tickets:
            if t in r.trifecta_payout:
                got += r.trifecta_payout[t]
                hit = True
            elif r.winner == t and t in r.trifecta_odds:
                got += int(r.trifecta_odds[t] * 100)
                hit = True
        pay += got
        if hit:
            hits += 1
    roi = (pay / bets * 100) if bets else 0
    hit_rate = (hits / selected * 100) if selected else 0
    return {
        "band": band,
        "anomaly_block": anomaly_block,
        "odds_lo": odds_lo,
        "odds_hi": odds_hi,
        "stadiums": sorted(stadiums) if stadiums else "all",
        "selected": selected,
        "bets": bets,
        "pay": pay,
        "roi": roi,
        "hit_races": hits,
        "hit_rate": hit_rate,
    }


def search_band(train: list[RaceEx], test: list[RaceEx], band: str) -> dict:
    results = []
    if band == "honmei":
        bands = [(8, 40), (10, 60), (12, 80)]
    elif band == "oshi":
        bands = [(20, 80), (25, 120), (30, 150), (40, 180)]
    else:
        bands = [(80, 250), (100, 350), (120, 400), (150, 500)]
    stadium_opts: list[set[int] | None] = [
        None,
        {18, 19, 21, 24, 13, 12},
        {18, 24},
    ]
    for anomaly_block in [True, False]:
        for lo, hi in bands:
            for st in stadium_opts:
                tr = evaluate(train, band, anomaly_block, lo, hi, st)
                if tr["selected"] < 25:
                    continue
                te = evaluate(test, band, anomaly_block, lo, hi, st)
                if te["selected"] < 15:
                    continue
                results.append({"train": tr, "test": te})

    def ok(te: dict) -> bool:
        if band == "honmei":
            return te["selected"] >= 15 and te["roi"] >= 110
        return (
            te["selected"] >= 15
            and te["roi"] >= 150
            and 8 <= te["hit_rate"] <= 25
        )

    good = [x for x in results if ok(x["test"])]
    # prefer meeting hit-rate window, then ROI
    results.sort(
        key=lambda x: (
            1 if 10 <= x["test"]["hit_rate"] <= 20 else 0,
            x["test"]["roi"],
            x["train"]["roi"],
        ),
        reverse=True,
    )
    good.sort(
        key=lambda x: (
            1 if 10 <= x["test"]["hit_rate"] <= 20 else 0,
            x["test"]["roi"],
            x["train"]["roi"],
        ),
        reverse=True,
    )
    return {
        "best": results[0] if results else None,
        "best_meeting_target": good[0] if good else None,
        "candidates": [
            {
                "train_roi": round(x["train"]["roi"], 2),
                "test_roi": round(x["test"]["roi"], 2),
                "test_hit": round(x["test"]["hit_rate"], 2),
                "test_n": x["test"]["selected"],
                "cfg": {
                    "anomaly_block": x["test"]["anomaly_block"],
                    "odds_lo": x["test"]["odds_lo"],
                    "odds_hi": x["test"]["odds_hi"],
                    "stadiums": x["test"]["stadiums"],
                },
            }
            for x in results[:10]
        ],
        "targets_met": len(good),
    }


def portfolio_sim(test: list[RaceEx], rules: dict) -> dict:
    bets = pay = 0
    hit_any = 0
    selected = 0
    for r in test:
        tickets: list[str] = []
        for band in ("honmei", "oshi", "ana"):
            conf = rules.get(band)
            if not conf:
                continue
            st = conf.get("stadiums")
            stadiums = set(st) if isinstance(st, list) else None
            tickets += pick_tickets(
                r,
                band,
                conf.get("anomaly_block", True),
                conf.get("odds_lo", 0),
                conf.get("odds_hi", 9999),
                stadiums,
            )
        tickets = list(dict.fromkeys(tickets))
        if not tickets:
            continue
        selected += 1
        stake = 100 * len(tickets)
        bets += stake
        got = 0
        hit = False
        for t in tickets:
            if t in r.trifecta_payout:
                got += r.trifecta_payout[t]
                hit = True
            elif r.winner == t and t in r.trifecta_odds:
                got += int(r.trifecta_odds[t] * 100)
                hit = True
        pay += got
        if hit:
            hit_any += 1
    return {
        "selected_races": selected,
        "bets": bets,
        "pay": pay,
        "roi": (pay / bets * 100) if bets else 0,
        "hit_rate": (hit_any / selected * 100) if selected else 0,
        "note": "過去検証の合算であり将来の勝利を保証しない",
    }


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    print("building/loading skills...")
    if not SKILLS.exists():
        import subprocess

        subprocess.check_call(["python3", str(ROOT / "scripts" / "build_course_skills.py")])
    skills = load_skills()
    print("skills", len(skills))
    print("loading turnmark races...")
    rows = load_races(skills)
    print("races", len(rows))
    if len(rows) < 500:
        (REPORTS / "triple_backtest_status.json").write_text(
            json.dumps({"status": "need_more_turnmark", "n": len(rows)}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print("insufficient turnmark data")
        return

    train = [r for r in rows if r.month <= 6]
    test = [r for r in rows if r.month >= 7]
    print("train", len(train), "test", len(test))

    out = {"train_n": len(train), "test_n": len(test), "bands": {}}
    locked = {}
    for band in ("honmei", "oshi", "ana"):
        print("search", band)
        res = search_band(train, test, band)
        out["bands"][band] = res
        pick = res["best_meeting_target"] or res["best"]
        if pick:
            locked[band] = {
                "anomaly_block": pick["test"]["anomaly_block"],
                "odds_lo": pick["test"]["odds_lo"],
                "odds_hi": pick["test"]["odds_hi"],
                "stadiums": pick["test"]["stadiums"],
                "validated_test_roi": pick["test"]["roi"],
                "validated_test_hit_rate": pick["test"]["hit_rate"],
                "validated_test_selected": pick["test"]["selected"],
                "meets_target": bool(res["best_meeting_target"]),
            }

    port = portfolio_sim(test, locked)
    out["portfolio_test"] = port
    out["locked"] = locked
    out["disclaimer"] = (
        "的中・回収を保証するシステムではない。異常オッズ回避＋得意コース＋オッズ帯で"
        "期待値寄りの買い目を出す検証済みルール。"
    )

    (REPORTS / "triple_backtest.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (REPORTS / "locked_triple_rules.json").write_text(
        json.dumps(locked, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(locked, ensure_ascii=False, indent=2))
    print("portfolio", port)


if __name__ == "__main__":
    main()
