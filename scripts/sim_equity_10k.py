#!/usr/bin/env python3
"""
ロック済み本命/押し目/穴について、検証期間を
「的中レースあたり 1レース投資=1万円（点割れ）」で再計算し、収支推移を出す。
"""

from __future__ import annotations

import json
from pathlib import Path

import backtest_deep_oshi_ana as d
import backtest_innige as bi

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
STAKE_PER_RACE = 10_000


def tickets_for(cfg: dict) -> list[tuple[str, str]]:
    return d.TICKETS[cfg["ticket"]]


def eval_band_equity(rows, band: str, cfg: dict, innige: dict) -> dict:
    tickets = tickets_for(cfg)
    n_t = len(tickets)
    unit = STAKE_PER_RACE // n_t  # 点割れ（端数は最後の点に寄せない簡易）
    rem = STAKE_PER_RACE - unit * n_t
    stakes = [unit] * n_t
    if rem:
        stakes[-1] += rem

    pred = d.passes_oshi if band == "oshi" else d.passes_ana
    equity = 0
    curve = []
    bets = pay = hits = selected = 0
    for i, r in enumerate(rows):
        if not pred(r, cfg, innige):
            continue
        selected += 1
        race_stake = STAKE_PER_RACE
        bets += race_stake
        race_pay = 0
        hit = False
        for (bet_type, combo), st in zip(tickets, stakes):
            mp = r.base.trifecta_map if bet_type == "trifecta" else r.base.exacta_map
            amt100 = mp.get(combo)  # 100円あたり配当
            if amt100:
                # 100円配当 → 実際のステーク比例
                race_pay += int(amt100 * (st / 100))
                hit = True
        equity += race_pay - race_stake
        pay += race_pay
        hits += int(hit)
        if selected <= 200 or selected % 5 == 0:
            curve.append(
                {
                    "n": selected,
                    "date": r.base.date,
                    "stadium": r.base.stadium,
                    "race": r.base.race_no,
                    "hit": hit,
                    "stake": race_stake,
                    "pay": race_pay,
                    "pnl": race_pay - race_stake,
                    "equity": equity,
                }
            )
    return {
        "band": band,
        "stake_per_race": STAKE_PER_RACE,
        "tickets": n_t,
        "selected": selected,
        "hits": hits,
        "hit_rate": (hits / selected * 100) if selected else 0,
        "bets": bets,
        "pay": pay,
        "pnl": pay - bets,
        "roi": (pay / bets * 100) if bets else 0,
        "final_equity": equity,
        "curve": curve,
        "cfg": {k: cfg[k] for k in cfg if k in (
            "ticket", "stadium_whitelist", "min_inn", "max_inn", "axis",
            "validated_test_roi", "validated_test_hit_rate", "meets_target"
        ) or True},
    }


def eval_honmei(rows, innige):
    locked = json.loads((REPORTS / "locked_honmei_rule.json").read_text())
    tickets = [("trifecta", f"1-2-{x}") for x in (3, 4, 5, 6)]
    n_t = len(tickets)
    unit = STAKE_PER_RACE // n_t
    rem = STAKE_PER_RACE - unit * n_t
    stakes = [unit] * n_t
    if rem:
        stakes[-1] += rem

    equity = 0
    curve = []
    bets = pay = hits = selected = 0
    for r in rows:
        b = r.base
        if b.stadium not in locked["stadium_whitelist"]:
            continue
        if b.grade not in locked["grades"]:
            continue
        if b.c1_class > locked["max_c1_class"]:
            continue
        if b.c1_nat < locked["min_c1_nat"]:
            continue
        if b.c1_st > locked["max_c1_st"]:
            continue
        if b.c1_motor2 < locked["min_motor2"]:
            continue
        if b.c1_nat - b.c2_nat < locked["min_gap_c2"]:
            continue
        if innige.get(b.stadium, 0) < locked["min_stadium_innige"]:
            continue
        selected += 1
        bets += STAKE_PER_RACE
        race_pay = 0
        hit = False
        for (bt, combo), st in zip(tickets, stakes):
            amt100 = b.trifecta_map.get(combo)
            if amt100:
                race_pay += int(amt100 * (st / 100))
                hit = True
        equity += race_pay - STAKE_PER_RACE
        pay += race_pay
        hits += int(hit)
        curve.append(
            {
                "n": selected,
                "date": b.date,
                "stadium": b.stadium,
                "race": b.race_no,
                "hit": hit,
                "stake": STAKE_PER_RACE,
                "pay": race_pay,
                "pnl": race_pay - STAKE_PER_RACE,
                "equity": equity,
            }
        )
    return {
        "band": "honmei",
        "stake_per_race": STAKE_PER_RACE,
        "tickets": n_t,
        "selected": selected,
        "hits": hits,
        "hit_rate": (hits / selected * 100) if selected else 0,
        "bets": bets,
        "pay": pay,
        "pnl": pay - bets,
        "roi": (pay / bets * 100) if bets else 0,
        "final_equity": equity,
        "curve": curve,
        "cfg": locked,
    }


def main():
    locked = json.loads((REPORTS / "locked_triple_rules.json").read_text())
    print("load test...")
    test = d.load_rich([2024, 2025])
    train = d.load_rich(range(2021, 2024))
    innige = bi.stadium_innige_rate([r.base for r in train])
    print("test", len(test))

    out = {
        "stake_per_race": STAKE_PER_RACE,
        "period": "2024-2025 test",
        "note": "的中した買い目だけに投資。1レース1万円を点数で等分。将来の利益を保証しない。",
        "bands": {},
    }
    out["bands"]["honmei"] = eval_honmei(test, innige)
    print("honmei", out["bands"]["honmei"]["selected"], out["bands"]["honmei"]["pnl"], out["bands"]["honmei"]["roi"])

    for band in ("oshi", "ana"):
        cfg = locked.get(band)
        if not cfg:
            continue
        # strip runtime-only keys that confuse passes_*
        cfg2 = {k: v for k, v in cfg.items() if k not in ("band", "validated_test_roi", "validated_test_hit_rate", "validated_test_selected", "validated_train_roi", "meets_target", "odds_lo", "odds_hi", "anomaly_block")}
        res = eval_band_equity(test, band, cfg2, innige)
        out["bands"][band] = res
        print(band, res["selected"], res["pnl"], res["roi"])

    # portfolio: when multiple bands fire same race, take first priority honmei>oshi>ana
    # approximate by scanning all and picking one band per race key
    # (simpler: sum of independent band PnLs shown separately; portfolio optional)
    portfolio_equity = 0
    portfolio_curve = []
    # rebuild chronological selection events
    events = []
    for band, res in out["bands"].items():
        for pt in res["curve"]:
            events.append({**pt, "band": band})
    events.sort(key=lambda x: (x["date"], x["stadium"], x["race"], {"honmei": 0, "oshi": 1, "ana": 2}[x["band"]]))
    seen = set()
    bets = pay = hits = selected = 0
    for e in events:
        key = (e["date"], e["stadium"], e["race"])
        if key in seen:
            continue
        seen.add(key)
        selected += 1
        bets += e["stake"]
        pay += e["pay"]
        hits += int(e["hit"])
        portfolio_equity += e["pnl"]
        portfolio_curve.append(
            {
                "n": selected,
                "date": e["date"],
                "stadium": e["stadium"],
                "race": e["race"],
                "band": e["band"],
                "hit": e["hit"],
                "stake": e["stake"],
                "pay": e["pay"],
                "pnl": e["pnl"],
                "equity": portfolio_equity,
            }
        )
    out["portfolio"] = {
        "rule": "同一レースは本命>押し目>穴の優先で1帯のみ",
        "stake_per_race": STAKE_PER_RACE,
        "selected": selected,
        "hits": hits,
        "hit_rate": (hits / selected * 100) if selected else 0,
        "bets": bets,
        "pay": pay,
        "pnl": pay - bets,
        "roi": (pay / bets * 100) if bets else 0,
        "final_equity": portfolio_equity,
        "curve": portfolio_curve,
    }
    print("portfolio", selected, portfolio_equity)

    path = REPORTS / "equity_10k.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "src" / "data" / "equity_10k.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("wrote", path)


if __name__ == "__main__":
    main()
