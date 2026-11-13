#!/usr/bin/env python3
"""
展示・ライブ解析ヘルパー。

できること:
- 展示タイム / ST から「周回が早い」「スリットが伸びた」を即時判定
- BoatraceCSV 直前情報の進入変更フラグをメモ
- 公式/場ライブURLの到達確認フック

映像OCR/姿勢推定は段階導入（URL到達確認まで実装済み）。
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "reports" / "exhibition_notes.json"


def score_exhibition(entries: list[dict]) -> list[dict]:
    scored = []
    exhibits = [e.get("exhibit") for e in entries if isinstance(e.get("exhibit"), (int, float))]
    median = sorted(exhibits)[len(exhibits) // 2] if exhibits else None
    for e in entries:
        exhibit = e.get("exhibit")
        st = e.get("st")
        course = e.get("course")
        entry = e.get("entry") or e.get("boat")
        note = []
        score = 0.0
        if isinstance(exhibit, (int, float)) and median is not None:
            delta = median - exhibit  # faster (lower) is better
            score += delta * 20
            if delta >= 0.05:
                note.append("周回ペースが早い")
            elif delta <= -0.05:
                note.append("周回が遅い")
        if isinstance(st, (int, float)):
            if st <= 0.1:
                score += 2.0
                note.append("スリットがよく伸びた")
            elif st <= 0.12:
                score += 1.5
                note.append("ST良い")
            elif st >= 0.20:
                score -= 1.0
                note.append("ST遅い")
        if isinstance(course, int) and isinstance(entry, int) and course != entry:
            note.append(f"進入変更 {entry}→{course}")
            score -= 3.0
        scored.append(
            {
                "boat": e.get("boat"),
                "name": e.get("name"),
                "exhibit": exhibit,
                "st": st,
                "course": course,
                "motor_2rate": e.get("motor_2rate"),
                "score": round(score, 3),
                "notes": note,
            }
        )
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored


def analyze_stream_url(url: str) -> dict:
    if not url:
        return {
            "url": "",
            "status": "unavailable",
            "message": "配信URLなし。直前CSVの進入・スリット・周回で判定。",
        }
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "BoatYosoLive/1.0"})
        with urllib.request.urlopen(req, timeout=6) as res:
            status = getattr(res, "status", 200)
            return {
                "url": url,
                "status": "reachable" if status < 400 else "unreachable",
                "message": f"配信応答 {status}。映像OCRは段階導入中。数値展示を主判定。",
            }
    except Exception as e:
        return {
            "url": url,
            "status": "unreachable",
            "message": f"配信到達不可 ({e})。直前CSVで進入・スリット・周回を継続判定。",
        }


def main() -> None:
    tei = ROOT / "data" / "teikoku"
    sample = None
    if tei.exists():
        for day in sorted(tei.glob("*"))[::-1]:
            files = list(day.glob("*_*.json"))
            if files:
                sample = json.loads(files[0].read_text(encoding="utf-8"))
                break
    if not sample:
        print("no teikoku sample yet")
        return
    scored = score_exhibition(sample.get("entries") or [])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "race": sample.get("race"),
                "exhibition_ranking": scored,
                "stream": analyze_stream_url(""),
                "policy": "morning tickets fixed; exhibition only confirms or skips",
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("wrote", OUT)


if __name__ == "__main__":
    main()
