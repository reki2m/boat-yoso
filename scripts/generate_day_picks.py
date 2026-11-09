#!/usr/bin/env python3
"""
本命ボリューム単点の買い目生成。

- 3連単 1-2-3 のみ（1点）
- A1 / 勝率6.5 / ST0.15 / モーター35 以上
- 1日最大2R（平均約1.7、閾値選抜）
- 芦屋など blacklist 除外
- 資金は均一100円
- オッズ回避・展示厳格・押し目穴無効
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

STADIUMS = {
    1: "桐生", 2: "戸田", 3: "江戸川", 4: "平和島", 5: "多摩川", 6: "浜名湖",
    7: "蒲郡", 8: "常滑", 9: "津", 10: "三国", 11: "びわこ", 12: "住之江",
    13: "尼崎", 14: "鳴門", 15: "丸亀", 16: "児島", 17: "宮島", 18: "徳山",
    19: "下関", 20: "若松", 21: "芦屋", 22: "福岡", 23: "唐津", 24: "大村",
}
CLASS_LABEL = {1: "A1", 2: "A2", 3: "B1", 4: "B2"}
DEFAULT_TICKETS = ["1-2-3"]


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoHonmeiRoi/5.0"})
    with urllib.request.urlopen(req, timeout=45) as res:
        return json.loads(res.read())


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def skill_rates(skills: dict, regno: int, course: int) -> tuple[float, float]:
    rec = skills.get(str(regno)) or {}
    c = (rec.get("courses") or {}).get(str(course)) or {}
    return float(c.get("win_rate") or 0), float(c.get("top2_rate") or 0)


def innige_map(stadium_rates: dict) -> dict[int, float]:
    return {int(v["stadium"]): float(v["rate"]) for v in stadium_rates.values()}


def class_label(n: int) -> str:
    return CLASS_LABEL.get(int(n), f"級{n}")


def parse_closed_at(value) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    if " " in text and "T" not in text:
        text = text.replace(" ", "T")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    return dt


def is_race_closed(race: dict, now: datetime | None = None) -> bool:
    now = now or datetime.now(JST)
    closed = parse_closed_at(race.get("closed_at"))
    if closed is not None and now >= closed:
        return True
    result = race.get("result")
    if isinstance(result, dict):
        racers = result.get("racers") or {}
        if any((r or {}).get("place_number") not in (None, "", 0) for r in racers.values()):
            return True
        payouts = result.get("payouts") or {}
        if any(payouts.get(k) for k in ("trifecta", "exacta", "win")):
            return True
    return False


def boat_strength(entry: dict, course: int, skills: dict) -> float:
    cw, _ = skill_rates(skills, int(entry.get("regno") or 0), course)
    return (
        float(entry.get("nat") or 0) * 3
        + (0.2 - float(entry.get("st") or 0.2)) * 40
        + float(entry.get("motor2") or 0) / 25
        + cw * 12
        - (int(entry.get("class") or 4) - 1) * 2
    )


def passes(rule: dict, place: int, e1: dict, e2: dict, inn: float, score_gap: float, race_no: int | None = None) -> bool:
    if not rule:
        return False
    wl = rule.get("stadium_whitelist")
    if isinstance(wl, list) and wl and place not in wl:
        return False
    rbl = rule.get("race_blacklist")
    if race_no is not None and isinstance(rbl, list) and rbl and int(race_no) in {int(x) for x in rbl}:
        return False
    if rule.get("require_leading_score", True) and score_gap < float(rule.get("min_score_gap") or 0):
        return False
    return (
        float(e1.get("nat") or 0) >= float(rule.get("min_c1_nat") or 5.8)
        and float(e1.get("st") or 9) <= float(rule.get("max_c1_st") or 0.18)
        and inn >= float(rule.get("min_inn") or rule.get("min_stadium_innige") or 0.55)
        and int(e1.get("class") or 99) <= int(rule.get("max_c1_class") or 2)
        and float(e1.get("motor2") or 0) >= float(rule.get("min_motor2") or 28)
        and float(e1.get("nat") or 0) - float(e2.get("nat") or 0) >= float(rule.get("min_gap_c2") or 0.8)
        and int(e1.get("grade") or 5) in (rule.get("grades") or [4, 5])
    )


def flatten_trifecta_tree(tree) -> dict[str, float]:
    out: dict[str, float] = {}
    if not isinstance(tree, dict):
        return out
    for a, m2 in tree.items():
        if not isinstance(m2, dict):
            continue
        for b, m3 in m2.items():
            if not isinstance(m3, dict):
                continue
            for c, odds in m3.items():
                if odds is None:
                    continue
                try:
                    v = float(odds)
                except (TypeError, ValueError):
                    continue
                if v > 0:
                    out[f"{a}-{b}-{c}"] = v
    return out


def extract_odds_from_programs(programs: dict, stadium: int, race: int) -> dict[str, float]:
    stadiums = (programs.get("programs") or {}).get("stadiums") or {}
    race_doc = ((stadiums.get(str(stadium)) or {}).get("races") or {}).get(str(race)) or {}
    odds = ((race_doc.get("odds") or {}).get("trifecta"))
    return flatten_trifecta_tree(odds)


_CHRONOLOGY_CACHE: dict[str, dict] = {}


def load_chronology(date_key: str) -> dict | None:
    if date_key in _CHRONOLOGY_CACHE:
        return _CHRONOLOGY_CACHE[date_key]
    iso = f"{date_key[:4]}-{date_key[4:6]}-{date_key[6:8]}"
    local = ROOT / "data" / "chronology" / f"{date_key}.json"
    if local.exists():
        data = json.loads(local.read_text(encoding="utf-8"))
        _CHRONOLOGY_CACHE[date_key] = data
        return data
    for url in [
        f"https://boatraceopenapi.github.io/chronology/v2/{iso}.json",
        f"https://boatraceopenapi.github.io/api/v2/{iso}.json",
    ]:
        try:
            data = fetch_json(url)
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            _CHRONOLOGY_CACHE[date_key] = data
            return data
        except Exception:
            continue
    _CHRONOLOGY_CACHE[date_key] = {}
    return None


def fetch_race_odds(date_key: str, stadium: int, race: int, programs: dict) -> tuple[dict[str, float], str]:
    local = extract_odds_from_programs(programs, stadium, race)
    if local:
        return local, "programs"
    chrono = load_chronology(date_key) or {}
    stadiums = (chrono.get("programs") or {}).get("stadiums") or {}
    race_doc = ((stadiums.get(str(stadium)) or {}).get("races") or {}).get(str(race)) or {}
    odds = flatten_trifecta_tree(((race_doc.get("odds") or {}).get("trifecta")))
    if odds:
        return odds, "chronology"
    return {}, "missing"


def evaluate_odds(odds: dict[str, float], cfg: dict, tickets: list[str]) -> dict:
    if not odds:
        return {
            "ok": None,
            "missing": True,
            "overbet": False,
            "money_concentrate": False,
            "favorite": None,
            "fav_odds": None,
            "top3_share": None,
            "tickets": tickets,
            "filtered_tickets": tickets,
            "reason": "オッズ未取得（展示後に再判定）",
        }
    ranked = sorted(((k, v) for k, v in odds.items() if v and v > 0), key=lambda x: x[1])
    favorite, fav = ranked[0]
    inv = [(k, 1.0 / v) for k, v in ranked[:30]]
    s = sum(v for _, v in inv) or 1.0
    top3 = sum(v for _, v in inv[:3]) / s
    overbet = fav < float(cfg.get("min_favorite_odds") or 6)
    concentrate = top3 > float(cfg.get("max_top3_share") or 0.55)
    lo = float(cfg.get("ticket_odds_lo") or 6)
    hi = float(cfg.get("ticket_odds_hi") or 120)
    filtered = [t for t in tickets if lo <= float(odds.get(t) or 0) <= hi]
    blocked = False
    reasons = []
    if cfg.get("block_overbet", True) and overbet:
        blocked = True
        reasons.append(f"1番人気が買われすぎ ({favorite} {fav:.1f}倍)")
    if cfg.get("block_money_concentrate", True) and concentrate:
        blocked = True
        reasons.append(f"上位資金集中 (top3占有 {top3:.1%})")
    if not filtered:
        blocked = True
        reasons.append("買い目がオッズ帯外")
    return {
        "ok": not blocked,
        "missing": False,
        "overbet": overbet,
        "money_concentrate": concentrate,
        "favorite": favorite,
        "fav_odds": fav,
        "top3_share": round(top3, 3),
        "tickets": tickets,
        "filtered_tickets": filtered if filtered else tickets,
        "reason": " / ".join(reasons) if reasons else "オッズ妥当",
    }


def explain(place, e1, e2, inn, tickets, elite, score_gap, stake, odds_info) -> dict:
    name = STADIUMS.get(place, f"場{place}")
    tier = "本命S" if elite else "本命"
    reasons = [
        f"{name}イン逃げ率 {(inn * 100):.1f}%（本命向き）",
        f"1号 {e1.get('name')} {class_label(e1.get('class'))} / 勝率 {float(e1.get('nat') or 0):.2f} / ST {float(e1.get('st') or 0):.2f}",
        f"モーター2連対 {float(e1.get('motor2') or 0):.1f}% / 1号相対最強（差 {score_gap:.2f}）",
        f"ボリューム単点 {', '.join(tickets)}（1点{stake}円）",
    ]
    if odds_info and not odds_info.get("missing"):
        reasons.append(f"オッズ判定: {odds_info.get('reason')}")
    why = (
        f"{name}はボリューム単点の本命形。1号の{e1.get('name')}が相対最強"
        f"（{class_label(e1.get('class'))}・勝率{float(e1.get('nat') or 0):.2f}・ST{float(e1.get('st') or 0):.2f}・"
        f"モーター{float(e1.get('motor2') or 0):.1f}%）のため、"
        f"{tier}として3連単{len(tickets)}点（{', '.join(tickets)}）を採用。"
    )
    return {"why": why, "reasons": reasons}


def load_programs_for(date_key: str) -> dict | None:
    year = date_key[:4]
    local = ROOT / "data" / "api" / f"{date_key}.json"
    if local.exists():
        return json.loads(local.read_text(encoding="utf-8"))
    for url in [
        f"https://boatraceopenapi.github.io/api/v1/{year}/{date_key}.json",
        "https://boatraceopenapi.github.io/api/v1/today.json",
    ]:
        try:
            data = fetch_json(url)
            if url.endswith("today.json") and date_key != datetime.now(JST).strftime("%Y%m%d"):
                continue
            (ROOT / "data" / "api").mkdir(parents=True, exist_ok=True)
            local.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return data
        except Exception as e:
            print("fetch fail", url, e)
    return None


def select_picks(cands: list[dict], rules: dict) -> list[dict]:
    sel = rules.get("selection") or {}
    mode = sel.get("mode") or "threshold"
    soft_max = int(sel.get("soft_max_per_day") or sel.get("hard_max_per_day") or 10)
    cands = sorted(cands, key=lambda x: -x["score"])
    if mode != "threshold":
        # legacy fixed top-N disabled unless explicitly requested
        target = int(rules.get("daily_target") or soft_max)
        return cands[:target]
    min_score = float(sel.get("min_score") or 48)
    min_gap = float(sel.get("min_score_gap") or 0)
    out = []
    for p in cands:
        if float(p.get("score") or 0) < float(p.get("min_pick_score") or min_score):
            continue
        if float(p.get("score_gap") or 0) < min_gap:
            continue
        out.append(p)
        if len(out) >= soft_max:
            break
    return out


def generate(date_key: str, phase: str) -> dict:
    rules = load_json(REPORTS / "honmei_rules.json", {}) or {}
    standard = rules.get("standard") or {}
    elite = rules.get("elite") or {}
    odds_cfg = rules.get("odds") or {}
    skills = load_json(REPORTS / "course_skills.json", {}) or {}
    innige = innige_map(load_json(REPORTS / "stadium_innige_rates.json", {}) or {})
    programs = load_programs_for(date_key)
    if not programs:
        return {
            "date": date_key,
            "phase": phase,
            "generated_at": datetime.now(JST).isoformat(),
            "picks": [],
            "status": "programs_unavailable",
            "mode": "honmei_fix_race_filter",
            "note": "番組未公開。夜中再取得待ち。",
            "disabled_systems": rules.get("disabled_systems") or ["oshi", "ana"],
        }

    now = datetime.now(JST)
    blacklist = set(int(x) for x in (rules.get("stadium_blacklist") or []))
    cands = []
    closed_skipped = 0
    odds_blocked = 0
    blacklisted = 0
    stadiums = (programs.get("programs") or {}).get("stadiums") or {}
    for sid, st in stadiums.items():
        place = int(sid)
        if place in blacklist:
            blacklisted += 1
            continue
        inn = innige.get(place, 0.5)
        for rid, race in (st.get("races") or {}).items():
            grade = int(race.get("grade_number") or 5)
            if grade not in (rules.get("grades") or [4, 5]):
                continue
            if is_race_closed(race, now):
                closed_skipped += 1
                continue
            entries = {}
            for _, r in (race.get("racers") or {}).items():
                entry = int(r.get("entry_number") or 0)
                if not entry:
                    continue
                entries[entry] = {
                    "regno": int(r.get("number") or 0),
                    "name": r.get("name"),
                    "class": int(r.get("rank_number") or 4),
                    "nat": float(r.get("national_win_rate") or 0),
                    "st": float(r.get("average_start_timing") or 0.2),
                    "motor2": float(r.get("motor_top_2_percent") or 0),
                    "grade": grade,
                }
            if len(entries) < 6 or 1 not in entries or 2 not in entries:
                continue

            strengths = {e: boat_strength(v, e, skills) for e, v in entries.items()}
            score_gap = strengths[1] - max(strengths[e] for e in strengths if e != 1)
            e1, e2 = entries[1], entries[2]
            race_no = int(rid)
            is_elite = passes(elite, place, e1, e2, inn, score_gap, race_no)
            is_standard = passes(standard, place, e1, e2, inn, score_gap, race_no)
            if not (is_elite or is_standard):
                continue

            rule = elite if is_elite else standard
            tickets = list(rule.get("tickets") or DEFAULT_TICKETS)
            ticket = rule.get("ticket") or "tri_12_narrow"
            label = rule.get("label") or ("本命S" if is_elite else "本命")
            stake = int(rule.get("stake_per_ticket") or 100)
            c1w, c1t2 = skill_rates(skills, int(e1.get("regno") or 0), 1)
            score = (
                float(e1["nat"]) * 3
                + (0.2 - float(e1["st"])) * 50
                + float(e1.get("motor2") or 0) / 30
                + inn * 6
                + c1w * 10
                + (float(e1["nat"]) - float(e2["nat"]))
                + c1t2 * 5
                + max(0.0, score_gap)
                + (40 if is_elite else 0)
            )
            min_pick_score = float(rule.get("min_pick_score") or (rules.get("selection") or {}).get("min_score") or 48)
            if score < min_pick_score:
                continue

            odds_map, odds_source = ({}, "disabled")
            odds_info = {"ok": None, "missing": True, "reason": "オッズ判定オフ", "filtered_tickets": tickets}
            if odds_cfg.get("enabled", True):
                odds_map, odds_source = fetch_race_odds(date_key, place, int(rid), programs)
                odds_info = evaluate_odds(odds_map, odds_cfg, tickets)
                if odds_info.get("ok") is False:
                    odds_blocked += 1
                    continue
                if odds_info.get("filtered_tickets"):
                    tickets = list(odds_info["filtered_tickets"])

            expl = explain(place, e1, e2, inn, tickets, is_elite, score_gap, stake, odds_info)
            cands.append(
                {
                    "date": date_key,
                    "stadium": place,
                    "stadium_name": STADIUMS.get(place, f"場{place}"),
                    "race": int(rid),
                    "title": race.get("title") or "",
                    "grade": grade,
                    "status": "provisional",
                    "closed_at": race.get("closed_at"),
                    "skip_on": [
                        "entry_change",
                        "exhibition_fail",
                        "unexpected_event",
                        "race_closed",
                        "odds_overbet",
                        "odds_missing_near_close",
                    ],
                    "mode": "honmei_fix_race_filter",
                    "band": "honmei_s" if is_elite else "honmei",
                    "label": label,
                    "tickets": tickets,
                    "ticket": ticket,
                    "points": len(tickets),
                    "stake_per_ticket": stake,
                    "stake_total": stake * len(tickets),
                    "score": score,
                    "score_gap": round(score_gap, 3),
                    "min_pick_score": min_pick_score,
                    "elite": is_elite,
                    "validated_roi": rule.get("validated_test_roi"),
                    "innige": inn,
                    "motor2": float(e1.get("motor2") or 0),
                    "odds": {
                        "source": odds_source,
                        "missing": odds_info.get("missing"),
                        "ok": odds_info.get("ok"),
                        "favorite": odds_info.get("favorite"),
                        "fav_odds": odds_info.get("fav_odds"),
                        "top3_share": odds_info.get("top3_share"),
                        "reason": odds_info.get("reason"),
                    },
                    "entries": {
                        str(k): {
                            "name": v["name"],
                            "regno": v["regno"],
                            "nat": v["nat"],
                            "st": v["st"],
                            "class": v["class"],
                            "motor2": v["motor2"],
                        }
                        for k, v in entries.items()
                    },
                    **expl,
                }
            )

    picks = select_picks(cands, rules)
    return {
        "date": date_key,
        "phase": phase,
        "generated_at": datetime.now(JST).isoformat(),
        "picks": picks,
        "count": len(picks),
        "status": "ok",
        "mode": "honmei_fix_race_filter",
        "selection": rules.get("selection"),
        "disabled_systems": rules.get("disabled_systems") or ["oshi", "ana"],
        "stadium_blacklist": sorted(blacklist),
        "pool_size": len(cands),
        "elite_count": sum(1 for p in picks if p.get("elite")),
        "standard_count": sum(1 for p in picks if not p.get("elite")),
        "points_per_race": 2,
        "closed_skipped": closed_skipped,
        "odds_blocked": odds_blocked,
        "blacklisted_stadiums_seen": blacklisted,
        "stake_s": int((elite or {}).get("stake_per_ticket") or 100),
        "stake_standard": int((standard or {}).get("stake_per_ticket") or 100),
        "feasibility": rules.get("feasibility"),
        "note": "本命ボリューム単点。1日最大2R（平均約1.7）。A1/勝率6.5/ST0.15/モーター35。1-2-3のみ。芦屋除外。",
    }


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--phase", default="nightly", choices=["nightly", "morning", "manual"])
    args = ap.parse_args()

    now = datetime.now(JST)
    today = now.strftime("%Y%m%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y%m%d")
    targets = [(args.date, args.phase)] if args.date else [(today, "today"), (tomorrow, "tomorrow")]

    REPORTS.mkdir(parents=True, exist_ok=True)
    SRC_DATA.mkdir(parents=True, exist_ok=True)
    bundle = {"generated_at": now.isoformat(), "targets": {}}
    for date_key, phase in targets:
        print("generate", date_key, phase)
        out = generate(date_key, phase)
        bundle["targets"][date_key] = out
        (REPORTS / f"picks_{date_key}.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            "  picks",
            out.get("count"),
            "elite",
            out.get("elite_count"),
            "pool",
            out.get("pool_size"),
            "odds_blocked",
            out.get("odds_blocked"),
        )

    def usable(doc):
        return bool(doc) and doc.get("status") != "programs_unavailable"

    tomorrow_doc, today_doc = bundle["targets"].get(tomorrow), bundle["targets"].get(today)
    if args.date and args.date in bundle["targets"]:
        active = bundle["targets"][args.date]
    elif usable(today_doc):
        # 当日優先（終了レース除外後の最新）
        active = today_doc
    elif usable(tomorrow_doc):
        active = tomorrow_doc
    else:
        active = today_doc or tomorrow_doc or {}

    board = {
        "active_date": active.get("date"),
        "date": active.get("date"),
        "phase": active.get("phase"),
        "generated_at": active.get("generated_at"),
        "picks": active.get("picks") or [],
        "count": active.get("count") or 0,
        "status": active.get("status"),
        "note": active.get("note"),
        "mode": "honmei_fix_race_filter",
        "selection": active.get("selection"),
        "disabled_systems": active.get("disabled_systems") or ["oshi", "ana"],
        "stadium_blacklist": active.get("stadium_blacklist") or [21],
        "points_per_race": active.get("points_per_race") or 2,
        "elite_count": active.get("elite_count"),
        "odds_blocked": active.get("odds_blocked"),
        "feasibility": active.get("feasibility"),
        "today": today_doc,
        "tomorrow": tomorrow_doc,
    }
    (REPORTS / "picks_board.json").write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    (SRC_DATA / "picks_board.json").write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    for name in ("honmei_rules.json", "locked_triple_rules.json", "locked_honmei_rule.json"):
        src = REPORTS / name
        if src.exists():
            (SRC_DATA / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    # mark volume rules disabled if present
    vol = REPORTS / "volume_rules.json"
    if vol.exists():
        try:
            v = json.loads(vol.read_text(encoding="utf-8"))
            v["enabled"] = False
            v["disabled_reason"] = "honmei_roi replaces fixed-volume system"
            vol.write_text(json.dumps(v, ensure_ascii=False, indent=2), encoding="utf-8")
            (SRC_DATA / "volume_rules.json").write_text(vol.read_text(encoding="utf-8"), encoding="utf-8")
        except Exception:
            pass
    print("board", board.get("date"), board.get("count"), "mode", board.get("mode"))


if __name__ == "__main__":
    main()
