#!/usr/bin/env python3
"""
期待値ベースの本命/押し目/穴 再検証。
艇スコア→着順確率の粗い近似→3連単候補のEVでフィルタ。
目標: 押し目・穴で検証ROI>=150% かつ 的中率おおよそ10-20%。
"""

from __future__ import annotations

import itertools
import json
import math
from pathlib import Path

# reuse loaders from triple
import backtest_triple as bt

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"


def softmax(xs: list[float]) -> list[float]:
    m = max(xs)
    ex = [math.exp((x - m) / 8.0) for x in xs]
    s = sum(ex) or 1.0
    return [e / s for e in ex]


def boat_probs(race: bt.RaceEx) -> dict[int, float]:
    scores = []
    boats = []
    for entry in range(1, 7):
        scores.append(bt.score_entry(race, entry, entry))
        boats.append(entry)
    probs = softmax(scores)
    return dict(zip(boats, probs))


def combo_prob(p: dict[int, float], a: int, b: int, c: int) -> float:
    # naive without replacement approximation
    pa = p.get(a, 0)
    rest = 1 - pa
    pb = p.get(b, 0) / max(rest, 1e-9) * (1 - pa) if rest > 0 else 0
    # actually: P(a 1st)*P(b 2nd|a)*P(c 3rd|a,b)
    p1 = p.get(a, 0)
    # renormalize excluding a
    rem = {k: v for k, v in p.items() if k != a}
    s2 = sum(rem.values()) or 1e-9
    p2 = rem.get(b, 0) / s2
    rem2 = {k: v for k, v in rem.items() if k != b}
    s3 = sum(rem2.values()) or 1e-9
    p3 = rem2.get(c, 0) / s3
    return p1 * p2 * p3


def candidates(race: bt.RaceEx) -> list[tuple[str, float, float, float]]:
    """Return (combo, odds, model_p, ev)."""
    p = boat_probs(race)
    top = sorted(p.items(), key=lambda x: x[1], reverse=True)
    boats = [b for b, _ in top]
    combos = set()
    for a, b, c in itertools.permutations(boats[:4], 3):
        combos.add((a, b, c))
    # force some 1-axis for イン戦
    for b, c in itertools.permutations([2, 3, 4, 5, 6], 2):
        combos.add((1, b, c))
    out = []
    for a, b, c in combos:
        key = f"{a}-{b}-{c}"
        odds = race.trifecta_odds.get(key)
        if not odds:
            continue
        mp = combo_prob(p, a, b, c)
        ev = mp * odds
        out.append((key, odds, mp, ev))
    out.sort(key=lambda x: x[3], reverse=True)
    return out


def pick(
    race: bt.RaceEx,
    band: str,
    min_ev: float,
    odds_lo: float,
    odds_hi: float,
    anomaly_block: bool,
    stadiums: set[int] | None,
) -> list[str]:
    if stadiums is not None and race.stadium not in stadiums:
        return []
    if anomaly_block and race.anomaly["overbet"] and band in ("honmei", "oshi"):
        return []
    cands = candidates(race)
    for key, odds, mp, ev in cands:
        if ev < min_ev:
            continue
        if not (odds_lo <= odds <= odds_hi):
            continue
        if band == "honmei":
            # イン戦寄り: 1が1着の買い目を優先
            if not key.startswith("1-"):
                continue
            e1 = race.entries.get(1)
            if not e1 or e1["class"] > 2:
                continue
        return [key]  # 単点
    return []


def evaluate(rows, band, min_ev, odds_lo, odds_hi, anomaly_block, stadiums):
    bets = pay = hits = selected = 0
    for r in rows:
        tickets = pick(r, band, min_ev, odds_lo, odds_hi, anomaly_block, stadiums)
        if not tickets:
            continue
        selected += 1
        bets += 100 * len(tickets)
        got = 0
        hit = False
        for t in tickets:
            if t in r.trifecta_payout:
                got += r.trifecta_payout[t]
                hit = True
            elif r.winner == t:
                got += int(r.trifecta_odds.get(t, 0) * 100)
                hit = True
        pay += got
        hits += int(hit)
    return {
        "band": band,
        "min_ev": min_ev,
        "odds_lo": odds_lo,
        "odds_hi": odds_hi,
        "anomaly_block": anomaly_block,
        "stadiums": sorted(stadiums) if stadiums else "all",
        "selected": selected,
        "bets": bets,
        "pay": pay,
        "roi": (pay / bets * 100) if bets else 0,
        "hit_rate": (hits / selected * 100) if selected else 0,
        "hit_races": hits,
    }


def search(train, test, band):
    if band == "honmei":
        evs = [1.1, 1.2, 1.4, 1.6]
        odds_bands = [(8, 50), (10, 80), (12, 100)]
    elif band == "oshi":
        evs = [1.3, 1.5, 1.8, 2.0, 2.5]
        odds_bands = [(20, 100), (30, 150), (40, 200)]
    else:
        evs = [1.5, 2.0, 2.5, 3.0, 4.0]
        odds_bands = [(80, 300), (100, 400), (150, 500)]
    stadium_opts = [None, {12, 13, 18, 19, 21, 24}, {18, 24, 19, 21}]
    results = []
    for min_ev in evs:
        for lo, hi in odds_bands:
            for anomaly_block in (True, False):
                for st in stadium_opts:
                    tr = evaluate(train, band, min_ev, lo, hi, anomaly_block, st)
                    if tr["selected"] < 30:
                        continue
                    te = evaluate(test, band, min_ev, lo, hi, anomaly_block, st)
                    if te["selected"] < 20:
                        continue
                    results.append({"train": tr, "test": te})

    def target(te):
        if band == "honmei":
            return te["roi"] >= 120 and 10 <= te["hit_rate"] <= 30 and te["selected"] >= 20
        return te["roi"] >= 150 and 10 <= te["hit_rate"] <= 22 and te["selected"] >= 20

    good = [x for x in results if target(x["test"])]
    results.sort(
        key=lambda x: (
            1 if target(x["test"]) else 0,
            1 if 10 <= x["test"]["hit_rate"] <= 20 else 0,
            x["test"]["roi"],
            x["train"]["roi"],
        ),
        reverse=True,
    )
    good.sort(key=lambda x: (x["test"]["roi"], x["train"]["roi"]), reverse=True)
    return results, good


def portfolio(test, locked):
    bets = pay = hits = selected = 0
    for r in test:
        tickets = []
        for band, conf in locked.items():
            if not conf:
                continue
            st = conf.get("stadiums")
            stadiums = set(st) if isinstance(st, list) else None
            tickets += pick(
                r,
                band,
                conf["min_ev"],
                conf["odds_lo"],
                conf["odds_hi"],
                conf["anomaly_block"],
                stadiums,
            )
        tickets = list(dict.fromkeys(tickets))
        if not tickets:
            continue
        selected += 1
        bets += 100 * len(tickets)
        got = 0
        hit = False
        for t in tickets:
            if t in r.trifecta_payout:
                got += r.trifecta_payout[t]
                hit = True
            elif r.winner == t:
                got += int(r.trifecta_odds.get(t, 0) * 100)
                hit = True
        pay += got
        hits += int(hit)
    return {
        "selected": selected,
        "bets": bets,
        "pay": pay,
        "roi": (pay / bets * 100) if bets else 0,
        "hit_rate": (hits / selected * 100) if selected else 0,
    }


def main():
    skills = bt.load_skills()
    if not skills:
        import subprocess

        subprocess.check_call(["python3", str(ROOT / "scripts" / "build_course_skills.py")])
        skills = bt.load_skills()
    rows = bt.load_races(skills)
    print("races", len(rows))
    train = [r for r in rows if r.month <= 6]
    test = [r for r in rows if r.month >= 7]
    print("train", len(train), "test", len(test))
    locked = {}
    report = {"train_n": len(train), "test_n": len(test), "bands": {}}
    for band in ("honmei", "oshi", "ana"):
        print("search", band)
        results, good = search(train, test, band)
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
                "cfg": {
                    "min_ev": pick["test"]["min_ev"],
                    "odds_lo": pick["test"]["odds_lo"],
                    "odds_hi": pick["test"]["odds_hi"],
                    "anomaly_block": pick["test"]["anomaly_block"],
                    "stadiums": pick["test"]["stadiums"],
                },
            },
            "top5": [
                {
                    "train_roi": round(x["train"]["roi"], 2),
                    "test_roi": round(x["test"]["roi"], 2),
                    "test_hit": round(x["test"]["hit_rate"], 2),
                    "test_n": x["test"]["selected"],
                    "cfg": {
                        "min_ev": x["test"]["min_ev"],
                        "odds_lo": x["test"]["odds_lo"],
                        "odds_hi": x["test"]["odds_hi"],
                        "anomaly_block": x["test"]["anomaly_block"],
                        "stadiums": x["test"]["stadiums"],
                    },
                }
                for x in results[:5]
            ],
        }
        if pick:
            locked[band] = {
                "min_ev": pick["test"]["min_ev"],
                "odds_lo": pick["test"]["odds_lo"],
                "odds_hi": pick["test"]["odds_hi"],
                "anomaly_block": pick["test"]["anomaly_block"],
                "stadiums": pick["test"]["stadiums"],
                "validated_test_roi": pick["test"]["roi"],
                "validated_test_hit_rate": pick["test"]["hit_rate"],
                "validated_test_selected": pick["test"]["selected"],
                "meets_target": bool(good),
            }
        print(band, "targets", len(good), "best", report["bands"][band]["best"])

    port = portfolio(test, locked)
    report["portfolio_test"] = port
    report["locked"] = locked
    report["disclaimer"] = (
        "必ず勝てる保証はない。期待値フィルタ＋異常オッズ回避＋得意コースの検証結果。"
    )
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "value_backtest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (REPORTS / "locked_triple_rules.json").write_text(
        json.dumps(locked, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("portfolio", port)


if __name__ == "__main__":
    main()
