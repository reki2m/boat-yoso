#!/usr/bin/env python3
"""
前日〜当日の番組から、場×レースの買い目を生成する。

volume モード:
  全場ソフト条件でスコアし、1日あたり目標件数（既定12）を出す。
  旧elite（徳山・大村超厳選）は該当時に elite=true を付与。
"""

from __future__ import annotations

import json
import urllib.request
from collections import defaultdict
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
    req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoNightly/2.0"})
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
    out = {}
    for _, v in stadium_rates.items():
        out[int(v["stadium"])] = float(v["rate"])
    return out


def class_label(n: int) -> str:
    return CLASS_LABEL.get(int(n), f"級{n}")


def explain_row(band: str, place: int, entries: dict, inn: float, skills: dict, tickets: list[str]) -> dict:
    stadium_name = STADIUMS.get(place, f"場{place}")
    e1, e2, e4 = entries.get(1), entries.get(2), entries.get(4)
    if band == "honmei" and e1 and e2:
        reasons = [
            f"{stadium_name}のイン逃げ率 {(inn * 100):.1f}%",
            f"1号 {e1.get('name')} は{class_label(e1.get('class'))}・勝率 {float(e1.get('nat') or 0):.2f}・ST {float(e1.get('st') or 0):.2f}",
            f"モーター2連対 {float(e1.get('motor2') or 0):.1f}%、2号との勝率差 {float(e1.get('nat') or 0) - float(e2.get('nat') or 0):.2f}",
            f"買い目 {', '.join(tickets)}",
        ]
        why = (
            f"{stadium_name}はイン寄り。1号の{e1.get('name')}が"
            f"{class_label(e1.get('class'))}・勝率{float(e1.get('nat') or 0):.2f}・ST{float(e1.get('st') or 0):.2f}のため"
            f"本命の {', '.join(tickets)} を採用。"
        )
        return {"why": why, "reasons": reasons}
    if band == "oshi" and e1 and e2:
        c2s = skill_win(skills, int(e2.get("regno") or 0), 2)
        reasons = [
            f"1号勝率 {float(e1.get('nat') or 0):.2f} は押し目レンジ",
            f"2号 {e2.get('name')} 勝率 {float(e2.get('nat') or 0):.2f} / 2コース {(c2s * 100):.1f}%",
            f"買い目 {', '.join(tickets)}",
        ]
        why = (
            f"{stadium_name}で1号が強すぎず、2号の{e2.get('name')}が反撃できる形のため"
            f"押し目の {', '.join(tickets)} を採用。"
        )
        return {"why": why, "reasons": reasons}
    if band == "ana" and e1 and e4:
        c4s = skill_win(skills, int(e4.get("regno") or 0), 4)
        reasons = [
            f"イン逃げ率 {(inn * 100):.1f}%（穴向き）",
            f"1号 {e1.get('name')} 勝率 {float(e1.get('nat') or 0):.2f} / ST {float(e1.get('st') or 0):.2f}",
            f"4号 {e4.get('name')} 勝率 {float(e4.get('nat') or 0):.2f} / 4コース {(c4s * 100):.1f}%",
            f"買い目 {', '.join(tickets)}",
        ]
        why = (
            f"{stadium_name}はイン絶対ではなく、1号が弱め・4号の{e4.get('name')}が軸になれるため"
            f"穴目の {', '.join(tickets)} を採用。"
        )
        return {"why": why, "reasons": reasons}
    return {"why": f"{stadium_name}はvolume条件に該当。", "reasons": ["volumeルール該当"]}


def elite_match(place: int, entries: dict, elite: dict, skills: dict, inn: float) -> bool:
    """旧超厳選ルールに同時該当するか（バッジ用）。"""
    h = elite.get("honmei") or {}
    e1, e2 = entries.get(1), entries.get(2)
    if not e1 or not e2:
        return False
    if place in (h.get("stadium_whitelist") or []):
        if (
            int(e1.get("class") or 99) <= int(h.get("max_c1_class") or 1)
            and float(e1.get("nat") or 0) >= float(h.get("min_c1_nat") or 7)
            and float(e1.get("st") or 9) <= float(h.get("max_c1_st") or 0.14)
            and float(e1.get("motor2") or 0) >= float(h.get("min_motor2") or 35)
            and float(e1.get("nat") or 0) - float(e2.get("nat") or 0) >= float(h.get("min_gap_c2") or 1)
            and inn >= float(h.get("min_stadium_innige") or 0.6)
        ):
            return True
    return False


def volume_shapes(place: int, entries: dict, volume: dict, skills: dict, inn: float) -> list[dict]:
    e1, e2, e4 = entries.get(1), entries.get(2), entries.get(4)
    if not e1 or not e2:
        return []
    grades = volume.get("grades") or [4, 5]
    if int(e1.get("grade") or 5) not in grades:
        return []
    out = []
    h = volume.get("honmei") or {}
    o = volume.get("oshi") or {}
    a = volume.get("ana") or {}

    if (
        float(e1.get("nat") or 0) >= float(h.get("min_c1_nat") or 5.6)
        and float(e1.get("st") or 9) <= float(h.get("max_c1_st") or 0.19)
        and inn >= float(h.get("min_inn") or 0.45)
        and int(e1.get("class") or 99) <= int(h.get("max_c1_class") or 2)
        and float(e1.get("motor2") or 0) >= float(h.get("min_motor2") or 25)
    ):
        score = (
            float(e1["nat"]) * 2
            + (float(h.get("max_c1_st") or 0.19) - float(e1["st"])) * 30
            + inn * 4
            + float(e1.get("motor2") or 0) / 50
            + max(0.0, float(e1["nat"]) - float(e2["nat"]))
        )
        tickets = list(h.get("tickets") or ["1-2-3", "1-2-4"])
        out.append(
            {
                "band": "honmei",
                "label": h.get("label") or "本命",
                "score": score,
                "tickets": tickets,
                "ticket": h.get("ticket") or "tri_12_narrow",
            }
        )

    c2s = skill_win(skills, int(e2.get("regno") or 0), 2)
    if (
        float(o.get("c1_nat_lo") or 4) <= float(e1.get("nat") or 0) <= float(o.get("c1_nat_hi") or 7.2)
        and float(e2.get("nat") or 0) >= float(o.get("min_c2_nat") or 4.8)
        and c2s >= float(o.get("min_c2_skill") or 0.08)
    ):
        score = float(e2["nat"]) * 2 + c2s * 15 + max(0.0, 7.0 - float(e1["nat"]))
        if float(e2.get("st") or 9) + 0.01 < float(e1.get("st") or 0):
            score += 2
        tickets = list(o.get("tickets") or ["2-1", "3-1"])
        out.append(
            {
                "band": "oshi",
                "label": o.get("label") or "押し目",
                "score": score,
                "tickets": tickets,
                "ticket": o.get("ticket") or "exa_oshi2",
            }
        )

    axis = int(a.get("axis") or 4)
    ex = entries.get(axis)
    if ex:
        axs = skill_win(skills, int(ex.get("regno") or 0), axis)
        if (
            inn <= float(a.get("max_inn") or 0.6)
            and float(e1.get("nat") or 0) <= float(a.get("max_c1_nat") or 6.5)
            and float(ex.get("nat") or 0) >= float(a.get("min_axis_nat") or 5.0)
            and axs >= float(a.get("min_axis_skill") or 0.06)
        ):
            score = (
                (float(a.get("max_c1_nat") or 6.5) - float(e1["nat"])) * 2
                + float(ex["nat"]) * 1.5
                + axs * 15
                + (1 - inn) * 3
            )
            tickets = list(a.get("tickets") or ["4-1", "5-1"])
            out.append(
                {
                    "band": "ana",
                    "label": a.get("label") or "穴目",
                    "score": score,
                    "tickets": tickets,
                    "ticket": a.get("ticket") or "exa_ana2",
                }
            )
    return out


def select_volume_picks(pools: dict[str, list], quotas: dict, daily_target: int) -> list[dict]:
    picked = []
    used = set()
    for band in ("honmei", "oshi", "ana"):
        need = int((quotas or {}).get(band) or 0)
        got = 0
        for row in pools.get(band) or []:
            key = (row["stadium"], row["race"])
            if key in used:
                continue
            picked.append(row)
            used.add(key)
            got += 1
            if got >= need:
                break
    # fill to daily_target from remaining best scores
    rest = []
    for band in ("honmei", "oshi", "ana"):
        rest.extend(pools.get(band) or [])
    rest.sort(key=lambda x: -x["score"])
    for row in rest:
        if len(picked) >= daily_target:
            break
        key = (row["stadium"], row["race"])
        if key in used:
            continue
        picked.append(row)
        used.add(key)
    picked.sort(key=lambda x: -x["score"])
    return picked[:daily_target]


def load_programs_for(date_key: str) -> dict | None:
    year = date_key[:4]
    local = ROOT / "data" / "api" / f"{date_key}.json"
    urls = [
        f"https://boatraceopenapi.github.io/api/v1/{year}/{date_key}.json",
        "https://boatraceopenapi.github.io/api/v1/today.json",
    ]
    if local.exists():
        return json.loads(local.read_text(encoding="utf-8"))
    for url in urls:
        try:
            data = fetch_json(url)
            if url.endswith("today.json"):
                today = datetime.now(JST).strftime("%Y%m%d")
                if date_key != today:
                    continue
            (ROOT / "data" / "api").mkdir(parents=True, exist_ok=True)
            local.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return data
        except Exception as e:
            print("fetch fail", url, e)
    return None


def generate(date_key: str, phase: str) -> dict:
    volume = load_json(REPORTS / "volume_rules.json", {}) or {}
    elite = load_json(REPORTS / "elite_locked_triple_rules.json", {}) or {}
    skills = load_json(REPORTS / "course_skills.json", {})
    stadium_rates = load_json(REPORTS / "stadium_innige_rates.json", {})
    innige = innige_map(stadium_rates)
    programs = load_programs_for(date_key)
    if not programs:
        return {
            "date": date_key,
            "phase": phase,
            "generated_at": datetime.now(JST).isoformat(),
            "picks": [],
            "status": "programs_unavailable",
            "note": "番組未公開。夜中再取得待ち。",
            "mode": "volume",
        }

    daily_target = int(volume.get("daily_target") or 12)
    quotas = volume.get("quotas") or {"honmei": 7, "oshi": 4, "ana": 1}
    pools: dict[str, list] = defaultdict(list)

    stadiums = (programs.get("programs") or {}).get("stadiums") or {}
    for sid, st in stadiums.items():
        place = int(sid)
        inn = innige.get(place, 0.5)
        for rid, race in (st.get("races") or {}).items():
            race_no = int(rid)
            grade = int(race.get("grade_number") or 5)
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
            if len(entries) < 6:
                continue
            shapes = volume_shapes(place, entries, volume, skills, inn)
            for shape in shapes:
                expl = explain_row(shape["band"], place, entries, inn, skills, shape["tickets"])
                pools[shape["band"]].append(
                    {
                        "date": date_key,
                        "stadium": place,
                        "stadium_name": STADIUMS.get(place, f"場{place}"),
                        "race": race_no,
                        "title": race.get("title") or "",
                        "grade": grade,
                        "status": "provisional",
                        "skip_on": ["entry_change", "exhibition_missing", "unexpected_event"],
                        "mode": "volume",
                        "elite": elite_match(place, entries, elite, skills, inn),
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
                        "innige": inn,
                        **shape,
                        **expl,
                    }
                )

    for band in pools:
        pools[band].sort(key=lambda x: -x["score"])

    picks = select_volume_picks(pools, quotas, daily_target)
    return {
        "date": date_key,
        "phase": phase,
        "generated_at": datetime.now(JST).isoformat(),
        "picks": picks,
        "count": len(picks),
        "status": "ok",
        "mode": "volume",
        "daily_target": daily_target,
        "quotas": quotas,
        "pool_sizes": {k: len(v) for k, v in pools.items()},
        "note": (
            f"volumeモード: 1日目標{daily_target}レース。"
            "スタート展示確認後に確定。進入変更・異常はスキップ。"
            "旧elite超厳選は該当時のみelite表示。"
        ),
    }


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYYMMDD target date")
    ap.add_argument("--phase", default="nightly", choices=["nightly", "morning", "manual"])
    args = ap.parse_args()

    now = datetime.now(JST)
    today = now.strftime("%Y%m%d")
    tomorrow = (now + timedelta(days=1)).strftime("%Y%m%d")
    targets = []
    if args.date:
        targets.append((args.date, args.phase))
    else:
        targets.append((today, "today"))
        targets.append((tomorrow, "tomorrow"))

    REPORTS.mkdir(parents=True, exist_ok=True)
    SRC_DATA.mkdir(parents=True, exist_ok=True)
    bundle = {"generated_at": now.isoformat(), "targets": {}}
    for date_key, phase in targets:
        print("generate", date_key, phase)
        out = generate(date_key, phase)
        bundle["targets"][date_key] = out
        path = REPORTS / f"picks_{date_key}.json"
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print("  picks", out.get("count"), out.get("status"), out.get("pool_sizes"))

    def usable(doc: dict | None) -> bool:
        if not doc:
            return False
        return doc.get("status") != "programs_unavailable"

    tomorrow_doc = bundle["targets"].get(tomorrow)
    today_doc = bundle["targets"].get(today)
    if args.date and args.date in bundle["targets"]:
        active = bundle["targets"][args.date]
    elif usable(tomorrow_doc):
        active = tomorrow_doc
    elif usable(today_doc):
        active = today_doc
    else:
        active = tomorrow_doc or today_doc or next(iter(bundle["targets"].values()), {})

    board = {
        "active_date": active.get("date"),
        "date": active.get("date"),
        "phase": active.get("phase"),
        "generated_at": active.get("generated_at"),
        "picks": active.get("picks") or [],
        "count": active.get("count") or 0,
        "status": active.get("status"),
        "note": active.get("note"),
        "mode": active.get("mode"),
        "daily_target": active.get("daily_target"),
        "today": today_doc,
        "tomorrow": tomorrow_doc,
        "all": bundle,
    }
    (REPORTS / "picks_board.json").write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
    (SRC_DATA / "picks_board.json").write_text(
        json.dumps({k: v for k, v in board.items() if k != "all"}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # also expose volume rules to the app
    vol = load_json(REPORTS / "volume_rules.json", {})
    if vol:
        (SRC_DATA / "volume_rules.json").write_text(json.dumps(vol, ensure_ascii=False, indent=2), encoding="utf-8")
    print("board", active.get("date"), active.get("count"), active.get("status"))


if __name__ == "__main__":
    main()
