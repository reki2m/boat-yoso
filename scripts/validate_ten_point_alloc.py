#!/usr/bin/env python3
"""
本命 / 押し目 / 穴 を合計10点に抑える配分を、信頼度1-5別に2020-2026で検証する。

信頼度が高いほど本命を厚く、低いほど押し・穴を厚くする案を比較し、
ROI・年次下限・的中率でベストを選ぶ。
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "data" / "reports"
STAKE = 100
UA = {"User-Agent": "BoatYosoResearch/1.0 (+ten-point alloc validate)"}
CLASS_SCORE = {1: 1.0, 2: 0.72, 3: 0.42, 4: 0.2}


@dataclass
class Race:
    date: str
    year: int
    stadium: int
    race_no: int
    boats: list[dict]
    trifecta_map: dict[str, int]
    winner: str


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
    course_bias = 0.18 if course == 1 else 0.08 if course == 2 else 0.05 if course == 3 else 0.02
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


def unique_tickets(raw: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for t in raw:
        parts = t.split("-")
        if len(parts) != 3:
            continue
        try:
            a, b, c = (int(x) for x in parts)
        except ValueError:
            continue
        if not (1 <= a <= 6 and 1 <= b <= 6 and 1 <= c <= 6):
            continue
        if len({a, b, c}) != 3:
            continue
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def tickets_honmei(ranked: list[dict], n: int) -> list[str]:
    if n <= 0 or not ranked:
        return []
    axis = ranked[0]["course"]
    partners = [r["course"] for r in ranked if r["course"] != axis][:5]
    for x in range(1, 7):
        if len(partners) >= 5:
            break
        if x != axis and x not in partners:
            partners.append(x)
    raw: list[str] = []
    if axis == 1:
        for13 = [p for p in partners if p not in (2, 3)]
        for14 = [p for p in partners if p not in (2, 4)]
        raw.extend(
            [
                "1-2-3",
                "1-2-4",
                "1-2-5",
                "1-2-6",
                f"1-3-{for13[0] if for13 else 4}",
                f"1-3-{for13[1] if len(for13) > 1 else 5}",
                f"1-4-{for14[0] if for14 else 2}",
                f"1-4-{for14[1] if len(for14) > 1 else 3}",
            ]
        )
    else:
        for i in range(min(4, len(partners))):
            for j in range(min(4, len(partners))):
                if i == j:
                    continue
                raw.append(f"{axis}-{partners[i]}-{partners[j]}")
    return unique_tickets(raw)[:n]


def tickets_oshi(ranked: list[dict], exclude: set[str], n: int) -> list[str]:
    if n <= 0 or len(ranked) < 2:
        return []
    by = {r["course"]: r for r in ranked}
    c2, c3 = by.get(2), by.get(3)
    if c2 and c3:
        axis = 2 if c2["score"] >= c3["score"] else 3
    elif c2:
        axis = 2
    elif c3:
        axis = 3
    else:
        axis = next((r["course"] for r in ranked if r["course"] in (2, 3)), ranked[1]["course"])
    partners = [r["course"] for r in ranked if r["course"] != axis][:4]
    for x in range(1, 7):
        if len(partners) >= 4:
            break
        if x != axis and x not in partners:
            partners.append(x)
    raw: list[str] = []
    for i in range(min(3, len(partners))):
        for j in range(min(3, len(partners))):
            if i == j:
                continue
            raw.append(f"{axis}-{partners[i]}-{partners[j]}")
    if axis != 1 and 1 in partners:
        for c in [p for p in partners if p != 1][:3]:
            raw.append(f"{axis}-1-{c}")
    if c2 and by.get(1):
        raw.extend(["2-1-3", "2-1-4", "2-1-5"])
    if c3 and by.get(1):
        raw.extend(["3-1-2", "3-1-4", "3-1-5"])
    return [t for t in unique_tickets(raw) if t not in exclude][:n]


def tickets_ana(ranked: list[dict], exclude: set[str], n: int) -> list[str]:
    if n <= 0 or not ranked:
        return []
    outer = [r for r in ranked if r["course"] >= 4]
    if not outer:
        return []
    # upside proxy: lower score rank among outer still prefer higher score
    axis = outer[0]["course"]
    partners = [r["course"] for r in ranked if r["course"] != axis]
    raw: list[str] = []
    for i, b in enumerate(partners[:4]):
        for j, c in enumerate(partners[:4]):
            if i == j:
                continue
            raw.append(f"{axis}-{b}-{c}")
    if 1 in partners:
        for c in [p for p in partners if p != 1][:3]:
            raw.append(f"{axis}-1-{c}")
    return [t for t in unique_tickets(raw) if t not in exclude][:n]


# (H, O, A) — always sum to 10
ALLOC_SCHEMES: dict[str, dict[int, tuple[int, int, int]]] = {
    # ユーザー案: 信頼度5は本命厚め、1-3は押し・穴増
    "adaptive_user": {
        5: (7, 2, 1),
        4: (5, 3, 2),
        3: (4, 3, 3),
        2: (3, 4, 3),
        1: (2, 4, 4),
    },
    "adaptive_moderate": {
        5: (6, 3, 1),
        4: (5, 3, 2),
        3: (4, 3, 3),
        2: (3, 4, 3),
        1: (3, 3, 4),
    },
    "adaptive_soft": {
        5: (6, 2, 2),
        4: (5, 3, 2),
        3: (4, 4, 2),
        2: (3, 4, 3),
        1: (2, 5, 3),
    },
    "adaptive_sharp": {
        5: (8, 1, 1),
        4: (6, 3, 1),
        3: (4, 3, 3),
        2: (2, 4, 4),
        1: (2, 3, 5),
    },
    "flat_532": {c: (5, 3, 2) for c in range(1, 6)},
    "flat_433": {c: (4, 3, 3) for c in range(1, 6)},
    "flat_640": {c: (6, 4, 0) for c in range(1, 6)},
    "flat_721": {c: (7, 2, 1) for c in range(1, 6)},
    # 現行相当（点数多め）比較用: 本命5+押し4+穴4=13
    "baseline_544": {c: (5, 4, 4) for c in range(1, 6)},
}


def allocate(scheme: str, conf: int) -> tuple[int, int, int]:
    return ALLOC_SCHEMES[scheme][conf]


def settle(tri: dict[str, int], tickets: list[str]) -> tuple[int, bool, str | None]:
    pay = 0
    hit = False
    band = None
    for t, b in tickets:
        amt = int(tri.get(t) or 0)
        if amt > 0:
            hit = True
            pay += amt
            if band is None:
                band = b
    return pay, hit, band


def build_tickets(ranked: list[dict], h: int, o: int, a: int) -> list[tuple[str, str]]:
    ht = tickets_honmei(ranked, h)
    ex: set[str] = set(ht)
    ot = tickets_oshi(ranked, ex, o)
    ex.update(ot)
    at = tickets_ana(ranked, ex, a)
    return [(t, "H") for t in ht] + [(t, "O") for t in ot] + [(t, "A") for t in at]


def fetch_json(url: str) -> dict | None:
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=45) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except Exception:
        return None


def ensure_day(d: date, force: bool = False) -> str:
    key = d.strftime("%Y%m%d")
    rp = DATA / "results" / f"{key}.json"
    pp = DATA / "programs" / f"{key}.json"
    year = d.year
    if not force and rp.exists() and pp.exists():
        return "skip"
    (DATA / "results").mkdir(parents=True, exist_ok=True)
    (DATA / "programs").mkdir(parents=True, exist_ok=True)
    if force or not rp.exists():
        results = fetch_json(f"https://boatraceopenapi.github.io/results/v3/{year}/{key}.json")
        if results is None:
            return "empty"
        rp.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
    if force or not pp.exists():
        programs = fetch_json(f"https://boatraceopenapi.github.io/programs/v3/{year}/{key}.json")
        if programs is None:
            return "no-program"
        pp.write_text(json.dumps(programs, ensure_ascii=False), encoding="utf-8")
    return "ok"


def load_races(years: range) -> list[Race]:
    year_set = set(years)
    out: list[Race] = []
    for rp in sorted((DATA / "results").glob("*.json")):
        key = rp.stem
        year = int(key[:4])
        if year not in year_set:
            continue
        pp = DATA / "programs" / f"{key}.json"
        if not pp.exists():
            continue
        try:
            results = {
                (r["stadium_number"], r["number"]): r
                for r in json.loads(rp.read_text())["results"]
            }
            programs = {
                (p["stadium_number"], p["number"]): p
                for p in json.loads(pp.read_text())["programs"]
            }
        except Exception:
            continue
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
            scored = []
            for course in range(1, 7):
                b = boats_p[course]
                scored.append(
                    {
                        "course": course,
                        "score": score_boat(b, course),
                        "nat": float(b.get("racer_national_top_1_percent") or 0),
                        "st": float(b.get("racer_average_start_timing") or 0.2),
                        "motor2": float(b.get("racer_assigned_motor_top_2_percent") or 0),
                    }
                )
            tri = {
                x["combination"]: int(x["amount"])
                for x in (res.get("payouts") or {}).get("trifecta") or []
            }
            out.append(
                Race(
                    date=prog["date"],
                    year=year,
                    stadium=prog["stadium_number"],
                    race_no=prog["number"],
                    boats=scored,
                    trifecta_map=tri,
                    winner="-".join(str(x) for x in winners),
                )
            )
    return out


def summarize(rows: list[dict], label: str) -> dict:
    bets = sum(r["bets"] for r in rows)
    pay = sum(r["pay"] for r in rows)
    hits = sum(r["hit"] for r in rows)
    n = len(rows)
    yearly: dict[str, dict] = defaultdict(lambda: {"n": 0, "bets": 0, "pay": 0, "hits": 0})
    by_conf: dict[str, dict] = defaultdict(lambda: {"n": 0, "bets": 0, "pay": 0, "hits": 0})
    band_hits = {"H": 0, "O": 0, "A": 0}
    for r in rows:
        y = yearly[str(r["year"])]
        y["n"] += 1
        y["bets"] += r["bets"]
        y["pay"] += r["pay"]
        y["hits"] += r["hit"]
        c = by_conf[str(r["conf"])]
        c["n"] += 1
        c["bets"] += r["bets"]
        c["pay"] += r["pay"]
        c["hits"] += r["hit"]
        if r.get("hit_band") in band_hits:
            band_hits[r["hit_band"]] += 1
    years_out = {}
    for y, v in sorted(yearly.items()):
        years_out[y] = {
            "n": v["n"],
            "hit_rate": round(100 * v["hits"] / v["n"], 2) if v["n"] else 0,
            "roi": round(100 * v["pay"] / v["bets"], 2) if v["bets"] else 0,
            "pnl": v["pay"] - v["bets"],
        }
    conf_out = {}
    for c, v in sorted(by_conf.items(), key=lambda x: int(x[0])):
        conf_out[c] = {
            "n": v["n"],
            "hit_rate": round(100 * v["hits"] / v["n"], 2) if v["n"] else 0,
            "roi": round(100 * v["pay"] / v["bets"], 2) if v["bets"] else 0,
            "avg_tickets": round(
                sum(r["tickets"] for r in rows if str(r["conf"]) == c) / v["n"], 2
            )
            if v["n"]
            else 0,
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
        "by_conf": conf_out,
        "hit_band_counts": band_hits,
        "min_year_roi": min((x["roi"] for x in years_out.values()), default=0),
    }


def eval_scheme(races: list[Race], scheme: str) -> dict:
    rows = []
    for r in races:
        ranked = sorted(r.boats, key=lambda x: -x["score"])
        gap = ranked[0]["score"] - ranked[1]["score"]
        conf = confidence_from_gap(gap, ranked[0]["score"])
        h, o, a = allocate(scheme, conf)
        tix = build_tickets(ranked, h, o, a)
        pay, hit, band = settle(r.trifecta_map, tix)
        rows.append(
            {
                "year": r.year,
                "date": r.date,
                "conf": conf,
                "tickets": len(tix),
                "bets": STAKE * len(tix),
                "pay": pay,
                "hit": int(hit),
                "hit_band": band,
                "alloc": f"{h}/{o}/{a}",
            }
        )
    return summarize(rows, scheme)


def collect_range(start: date, end: date, workers: int = 24) -> None:
    days = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur += timedelta(days=1)
    print(f"collect {len(days)} days workers={workers}", flush=True)
    ok = skip = empty = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(ensure_day, d): d for d in days}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                msg = fut.result()
            except Exception:
                empty += 1
                msg = "err"
            if msg == "ok":
                ok += 1
            elif msg == "skip":
                skip += 1
            else:
                empty += 1
            if i % 200 == 0 or i == len(days):
                print(f"  progress {i}/{len(days)} ok={ok} skip={skip} other={empty}", flush=True)
    print(f"collect done ok={ok} skip={skip} other={empty}", flush=True)


def main() -> None:
    t0 = time.time()
    # 2020-01-01 .. today(2026) — OpenAPI has data through recent days
    start = date(2020, 1, 1)
    end = date(2026, 11, 12)
    collect_range(start, end, workers=28)

    print("loading races…", flush=True)
    races = load_races(range(2020, 2027))
    print(f"races={len(races)} elapsed={time.time()-t0:.1f}s", flush=True)
    if not races:
        raise SystemExit("no races loaded")

    conf_dist: dict[int, int] = defaultdict(int)
    for r in races:
        ranked = sorted(r.boats, key=lambda x: -x["score"])
        gap = ranked[0]["score"] - ranked[1]["score"]
        conf_dist[confidence_from_gap(gap, ranked[0]["score"])] += 1

    results = []
    for name in ALLOC_SCHEMES:
        print(f"eval {name}…", flush=True)
        s = eval_scheme(races, name)
        results.append(s)
        print(
            f"  {name}: roi={s['roi']} minY={s['min_year_roi']} hit={s['hit_rate']} avgT={s['avg_tickets']} n={s['n']}",
            flush=True,
        )

    # Prefer 10-point schemes (exclude baseline from winner unless all worse)
    ten_point = [s for s in results if s["label"] != "baseline_544"]
    ranked = sorted(
        ten_point,
        key=lambda s: (s["min_year_roi"], s["roi"], s["hit_rate"]),
        reverse=True,
    )
    # Stability score: min_year_roi primary, then overall roi
    best = ranked[0]
    best_name = best["label"]

    out = {
        "ask": [
            "本命・押し目・穴を合計10点に調整",
            "信頼度5は本命厚め、信頼度1-3は押し・穴増",
            "2020-2026で検証しベストを採用",
        ],
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "races": len(races),
        "confidence_dist": {str(k): conf_dist[k] for k in sorted(conf_dist)},
        "schemes": {s["label"]: ALLOC_SCHEMES[s["label"]] for s in results},
        "results": ranked + [s for s in results if s["label"] == "baseline_544"],
        "best": {
            "scheme": best_name,
            "alloc_by_conf": {
                str(k): {"honmei": v[0], "oshi": v[1], "ana": v[2]}
                for k, v in ALLOC_SCHEMES[best_name].items()
            },
            "roi": best["roi"],
            "min_year_roi": best["min_year_roi"],
            "hit_rate": best["hit_rate"],
            "avg_tickets": best["avg_tickets"],
            "n": best["n"],
            "by_conf": best["by_conf"],
            "years": best["years"],
            "reason": (
                f"{best_name} が年次下限ROIと全体ROIのバランスで最良。"
                "信頼度が高いほど本命、低いほど押し・穴を厚くする。"
            ),
        },
        "baseline_compare": next((s for s in results if s["label"] == "baseline_544"), None),
        "elapsed_sec": round(time.time() - t0, 1),
    }

    REPORTS.mkdir(parents=True, exist_ok=True)
    path = REPORTS / "validate_ten_point_alloc_2020.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "src" / "data").mkdir(parents=True, exist_ok=True)
    (ROOT / "src" / "data" / "validate_ten_point_alloc_2020.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("wrote", path, flush=True)
    print("BEST", best_name, "roi", best["roi"], "minY", best["min_year_roi"], flush=True)


if __name__ == "__main__":
    main()
