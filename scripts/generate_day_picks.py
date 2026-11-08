#!/usr/bin/env python3
"""
本命専用の前日〜当日買い目生成。

- 押し目・穴は出さない
- 標準本命: 3連単 1-2-3 / 1-2-4
- 本命S(elite): 徳山・大村超厳選時のみ 1-2流し4点
- 1日スコア上位12レース
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


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoHonmei/3.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read())


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def skill_win(skills: dict, regno: int, course: int) -> float:
    rec = skills.get(str(regno)) or {}
    c = (rec.get("courses") or {}).get(str(course)) or {}
    return float(c.get("win_rate") or 0)


def innige_map(stadium_rates: dict) -> dict[int, float]:
    return {int(v["stadium"]): float(v["rate"]) for v in stadium_rates.values()}


def class_label(n: int) -> str:
    return CLASS_LABEL.get(int(n), f"級{n}")


def passes(rule: dict, place: int, e1: dict, e2: dict, inn: float) -> bool:
    wl = rule.get("stadium_whitelist")
    if isinstance(wl, list) and wl and place not in wl:
        return False
    return (
        float(e1.get("nat") or 0) >= float(rule.get("min_c1_nat") or 5.8)
        and float(e1.get("st") or 9) <= float(rule.get("max_c1_st") or 0.18)
        and inn >= float(rule.get("min_inn") or rule.get("min_stadium_innige") or 0.5)
        and int(e1.get("class") or 99) <= int(rule.get("max_c1_class") or 2)
        and float(e1.get("motor2") or 0) >= float(rule.get("min_motor2") or 28)
        and float(e1.get("nat") or 0) - float(e2.get("nat") or 0) >= float(rule.get("min_gap_c2") or 0.3)
        and int(e1.get("grade") or 5) in (rule.get("grades") or [4, 5])
    )


def explain(place: int, e1: dict, e2: dict, inn: float, tickets: list[str], elite: bool) -> dict:
    name = STADIUMS.get(place, f"場{place}")
    tier = "本命S" if elite else "本命"
    reasons = [
        f"{name}イン逃げ率 {(inn * 100):.1f}%（本命向き）",
        f"1号 {e1.get('name')} {class_label(e1.get('class'))} / 勝率 {float(e1.get('nat') or 0):.2f} / ST {float(e1.get('st') or 0):.2f}",
        f"モーター2連対 {float(e1.get('motor2') or 0):.1f}%、2号差 {float(e1.get('nat') or 0) - float(e2.get('nat') or 0):.2f}",
        f"{tier}買い目 {', '.join(tickets)}",
    ]
    why = (
        f"{name}はイン戦の本命形。1号の{e1.get('name')}が"
        f"{class_label(e1.get('class'))}・勝率{float(e1.get('nat') or 0):.2f}・ST{float(e1.get('st') or 0):.2f}のため、"
        f"{tier}として {', '.join(tickets)} を採用。"
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


def generate(date_key: str, phase: str) -> dict:
    rules = load_json(REPORTS / "honmei_rules.json", {}) or {}
    standard = rules.get("standard") or {}
    elite = rules.get("elite") or {}
    skills = load_json(REPORTS / "course_skills.json", {})
    innige = innige_map(load_json(REPORTS / "stadium_innige_rates.json", {}) or {})
    programs = load_programs_for(date_key)
    if not programs:
        return {
            "date": date_key,
            "phase": phase,
            "generated_at": datetime.now(JST).isoformat(),
            "picks": [],
            "status": "programs_unavailable",
            "mode": "honmei",
            "note": "番組未公開。夜中再取得待ち。",
        }

    daily_target = int(rules.get("daily_target") or 12)
    cands = []
    stadiums = (programs.get("programs") or {}).get("stadiums") or {}
    for sid, st in stadiums.items():
        place = int(sid)
        inn = innige.get(place, 0.5)
        for rid, race in (st.get("races") or {}).items():
            grade = int(race.get("grade_number") or 5)
            if grade not in (rules.get("grades") or [4, 5]):
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
            e1, e2 = entries[1], entries[2]
            is_elite = passes(elite, place, e1, e2, inn)
            is_standard = passes(standard, place, e1, e2, inn)
            if not (is_elite or is_standard):
                continue
            if is_elite:
                tickets = list(elite.get("tickets") or ["1-2-3", "1-2-4", "1-2-5", "1-2-6"])
                ticket = elite.get("ticket") or "trifecta_1_2_stream"
                label = elite.get("label") or "本命S"
            else:
                tickets = list(standard.get("tickets") or ["1-2-3", "1-2-4"])
                ticket = standard.get("ticket") or "tri_12_narrow"
                label = standard.get("label") or "本命"
            c1w = skill_win(skills, int(e1.get("regno") or 0), 1)
            score = (
                float(e1["nat"]) * 3
                + (0.2 - float(e1["st"])) * 50
                + float(e1.get("motor2") or 0) / 30
                + inn * 6
                + c1w * 10
                + (float(e1["nat"]) - float(e2["nat"]))
                + (120 if is_elite else 0)
            )
            expl = explain(place, e1, e2, inn, tickets, is_elite)
            cands.append(
                {
                    "date": date_key,
                    "stadium": place,
                    "stadium_name": STADIUMS.get(place, f"場{place}"),
                    "race": int(rid),
                    "title": race.get("title") or "",
                    "grade": grade,
                    "status": "provisional",
                    "skip_on": ["entry_change", "exhibition_missing", "unexpected_event"],
                    "mode": "honmei",
                    "band": "honmei",
                    "label": label,
                    "tickets": tickets,
                    "ticket": ticket,
                    "score": score,
                    "elite": is_elite,
                    "validated_roi": elite.get("validated_test_roi") if is_elite else None,
                    "innige": inn,
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

    cands.sort(key=lambda x: -x["score"])
    picks = cands[:daily_target]
    return {
        "date": date_key,
        "phase": phase,
        "generated_at": datetime.now(JST).isoformat(),
        "picks": picks,
        "count": len(picks),
        "status": "ok",
        "mode": "honmei",
        "daily_target": daily_target,
        "pool_size": len(cands),
        "elite_count": sum(1 for p in picks if p.get("elite")),
        "note": "本命専用。押し目・穴は出さない。展示確認後に確定し、進入変更・異常はスキップ。",
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
        print("  picks", out.get("count"), "elite", out.get("elite_count"), "pool", out.get("pool_size"))

    def usable(doc):
        return bool(doc) and doc.get("status") != "programs_unavailable"

    tomorrow_doc, today_doc = bundle["targets"].get(tomorrow), bundle["targets"].get(today)
    if args.date and args.date in bundle["targets"]:
        active = bundle["targets"][args.date]
    elif usable(tomorrow_doc):
        active = tomorrow_doc
    elif usable(today_doc):
        active = today_doc
    else:
        active = tomorrow_doc or today_doc or {}

    board = {
        "active_date": active.get("date"),
        "date": active.get("date"),
        "phase": active.get("phase"),
        "generated_at": active.get("generated_at"),
        "picks": active.get("picks") or [],
        "count": active.get("count") or 0,
        "status": active.get("status"),
        "note": active.get("note"),
        "mode": "honmei",
        "daily_target": active.get("daily_target"),
        "today": today_doc,
        "tomorrow": tomorrow_doc,
    }
    (REPORTS / "picks_board.json").write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    (SRC_DATA / "picks_board.json").write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    for name in ("honmei_rules.json", "volume_rules.json", "locked_triple_rules.json", "locked_honmei_rule.json"):
        src = REPORTS / name
        if src.exists():
            (SRC_DATA / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    print("board", board.get("date"), board.get("count"))


if __name__ == "__main__":
    main()
