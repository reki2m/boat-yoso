#!/usr/bin/env python3
"""
前日/当日に出した買い目の的中を結果で再計算する。
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "data" / "reports"
SRC_DATA = ROOT / "src" / "data"
JST = timezone(timedelta(hours=9))


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoNightly/2.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def load_results(date_key: str) -> dict[tuple[int, int], dict]:
    year = date_key[:4]
    local = ROOT / "data" / "results" / f"{date_key}.json"
    data = None
    if local.exists():
        data = json.loads(local.read_text(encoding="utf-8"))
    else:
        url = f"https://boatraceopenapi.github.io/results/v3/{year}/{date_key}.json"
        try:
            data = fetch_json(url)
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            print("results missing", date_key, e)
            return {}
    out = {}
    for r in data.get("results") or []:
        sid = int(r.get("stadium_number") or 0)
        rno = int(r.get("number") or 0)
        tri = {
            x["combination"]: int(x["amount"])
            for x in ((r.get("payouts") or {}).get("trifecta") or [])
        }
        exa = {
            x["combination"]: int(x["amount"])
            for x in ((r.get("payouts") or {}).get("exacta") or [])
        }
        # actual courses
        courses = {}
        for b in r.get("boats") or []:
            courses[int(b.get("racer_boat_number") or 0)] = int(b.get("racer_course_number") or 0)
        out[(sid, rno)] = {"trifecta": tri, "exacta": exa, "courses": courses, "raw": r}
    return out


def score_date(date_key: str) -> dict:
    picks_path = REPORTS / f"picks_{date_key}.json"
    if not picks_path.exists():
        return {"date": date_key, "status": "no_picks"}
    picks_doc = json.loads(picks_path.read_text(encoding="utf-8"))
    results = load_results(date_key)
    rows = []
    bets = pay = hits = selected = skipped = 0
    for p in picks_doc.get("picks") or []:
        key = (int(p["stadium"]), int(p["race"]))
        res = results.get(key)
        if not res:
            rows.append({**p, "result": "no_result"})
            continue
        # 進入変更チェック: 枠!=コースが1艇でもあればスキップ扱い（再計算方針）
        changed = any(
            boat and course and boat != course for boat, course in res["courses"].items()
        )
        if changed or p.get("status") == "skipped" or p.get("skip_reason") in {
            "entry_change",
            "unexpected",
        }:
            skipped += 1
            rows.append(
                {
                    **p,
                    "result": "skipped_entry_change" if changed else "skipped",
                    "hit": False,
                }
            )
            continue
        # 展示未確認のまま結果が出た場合も再計算対象外（スルー）
        if p.get("status") == "provisional":
            skipped += 1
            rows.append({**p, "result": "skipped_no_exhibition", "hit": False})
            continue
        selected += 1
        tickets = p.get("tickets") or []
        stake = 100 * len(tickets)
        bets += stake
        got = 0
        hit = False
        hit_tickets = []
        for t in tickets:
            mp = res["trifecta"] if t.count("-") == 2 else res["exacta"]
            if t in mp:
                got += mp[t]
                hit = True
                hit_tickets.append(t)
        pay += got
        hits += int(hit)
        rows.append(
            {
                **p,
                "result": "hit" if hit else "miss",
                "pay": got,
                "stake": stake,
                "hit": hit,
                "hit_tickets": hit_tickets,
            }
        )

    out = {
        "date": date_key,
        "scored_at": datetime.now(JST).isoformat(),
        "selected": selected,
        "skipped": skipped,
        "hits": hits,
        "hit_rate": (hits / selected * 100) if selected else 0,
        "bets": bets,
        "pay": pay,
        "pnl": pay - bets,
        "roi": (pay / bets * 100) if bets else 0,
        "rows": rows,
        "note": "進入変更レースはスキップとして再計算。保証ではない。",
    }
    return out


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYYMMDD")
    ap.add_argument("--days", type=int, default=3, help="score last N days if --date omitted")
    args = ap.parse_args()

    now = datetime.now(JST)
    dates = []
    if args.date:
        dates = [args.date]
    else:
        for i in range(1, args.days + 1):
            dates.append((now - timedelta(days=i)).strftime("%Y%m%d"))

    reports = []
    for d in dates:
        print("score", d)
        rep = score_date(d)
        reports.append(rep)
        (REPORTS / f"accuracy_{d}.json").write_text(
            json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(" ", rep.get("status") or f"n={rep.get('selected')} hit={rep.get('hit_rate'):.1f} roi={rep.get('roi'):.1f}")

    summary = {
        "scored_at": now.isoformat(),
        "days": reports,
        "aggregate": {
            "selected": sum(r.get("selected") or 0 for r in reports),
            "hits": sum(r.get("hits") or 0 for r in reports),
            "bets": sum(r.get("bets") or 0 for r in reports),
            "pay": sum(r.get("pay") or 0 for r in reports),
            "skipped": sum(r.get("skipped") or 0 for r in reports),
        },
    }
    agg = summary["aggregate"]
    agg["hit_rate"] = (agg["hits"] / agg["selected"] * 100) if agg["selected"] else 0
    agg["roi"] = (agg["pay"] / agg["bets"] * 100) if agg["bets"] else 0
    agg["pnl"] = agg["pay"] - agg["bets"]
    (REPORTS / "accuracy_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (SRC_DATA / "accuracy_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("aggregate", agg)


if __name__ == "__main__":
    main()
