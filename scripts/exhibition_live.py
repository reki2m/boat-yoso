#!/usr/bin/env python3
"""
展示・ライブ解析ヘルパー。

現状できること:
- 艇愛DBの展示タイム(exhibit)・STをレース単位で評価
- 公式/YouTubeライブのURLが渡されたらメタ情報を記録（映像そのものの自動解析は要追加）

できないこと（要・配信URLと映像パイプライン）:
- YouTube/公式ライブの映像から進入・展示をリアルタイムOCR/姿勢推定
  → `analyze_stream_url()` にフックを用意。URLが来たら拡張する。
"""

from __future__ import annotations

import json
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
        note = []
        score = 0.0
        if isinstance(exhibit, (int, float)) and median:
            delta = median - exhibit  # faster (lower) is better
            score += delta * 20
            if delta >= 0.05:
                note.append("展示が速い")
            elif delta <= -0.05:
                note.append("展示が遅い")
        if isinstance(st, (int, float)):
            if st <= 0.12:
                score += 1.5
                note.append("ST良い")
            elif st >= 0.20:
                score -= 1.0
                note.append("ST遅い")
        scored.append(
            {
                "boat": e.get("boat"),
                "name": e.get("name"),
                "exhibit": exhibit,
                "st": st,
                "course": e.get("course"),
                "motor_2rate": e.get("motor_2rate"),
                "score": round(score, 3),
                "notes": note,
            }
        )
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored


def analyze_stream_url(url: str) -> dict:
    """Placeholder for future live video analysis."""
    return {
        "url": url,
        "status": "queued",
        "message": "ライブ映像解析は配信URL連携後に拡張予定。現状は展示数値評価を使用。",
    }


def main() -> None:
    # Demo from latest teikoku file if any
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
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("wrote", OUT)


if __name__ == "__main__":
    main()
