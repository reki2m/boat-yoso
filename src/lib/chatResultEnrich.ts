import type { ChatBandTicket, ChatMessage, ChatRaceChip } from "@/lib/chatStore";
import { fetchDayResults, resultKey } from "@/lib/raceResults";
import { STADIUMS } from "@/lib/stadiums";

function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

function withTicketResult(
  ticket: ChatBandTicket,
  trifecta: Record<string, number>,
): ChatBandTicket {
  const payout = Number(trifecta[ticket.combo] || 0);
  return {
    ...ticket,
    result: payout > 0 ? "hit" : "miss",
    payout,
  };
}

function enrichChip(
  chip: ChatRaceChip,
  trifecta: Record<string, number>,
  finishCombo: string | null,
): ChatRaceChip {
  const tickets = (chip.tickets || []).map(String).filter(Boolean);
  const bands = chip.bands
    ? {
        honmei: (chip.bands.honmei || []).map((t) => withTicketResult(t, trifecta)),
        honmeiS: (chip.bands.honmeiS || []).map((t) => withTicketResult(t, trifecta)),
        oshi: (chip.bands.oshi || []).map((t) => withTicketResult(t, trifecta)),
        ana: (chip.bands.ana || []).map((t) => withTicketResult(t, trifecta)),
      }
    : undefined;

  const settledTickets = tickets.map((combo) => {
    const payout = Number(trifecta[combo] || 0);
    return {
      combo,
      result: (payout > 0 ? "hit" : "miss") as "hit" | "miss",
      payout,
    };
  });

  const hitCount = settledTickets.filter((t) => t.result === "hit").length;
  const hitPay = settledTickets.reduce((s, t) => s + (t.payout || 0), 0);
  const whyBits = [
    finishCombo ? `着順 ${finishCombo}` : null,
    hitCount
      ? `的中 ${hitCount}点 / 払戻合計 ${yen(hitPay)}`
      : tickets.length
        ? "的中なし"
        : null,
  ].filter(Boolean);

  return {
    ...chip,
    tickets,
    bands,
    settled: true,
    finishCombo: finishCombo || undefined,
    ticketResults: settledTickets,
    status: "settled",
    exhibition: "after",
    why: whyBits.length ? whyBits.join(" / ") : chip.why,
  };
}

/**
 * レース結果が出ている買い目カードへ 的中/不的中と払戻を重ねる。
 * DBのメッセージ自体は更新せず、配信レスポンス上で展示待ちを結果表示へ置き換える。
 */
export async function enrichChatMessagesWithResults(
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const dates = new Set<string>();
  for (const m of messages) {
    const date = String(m.meta?.date || "");
    if (/^\d{8}$/.test(date)) dates.add(date);
  }
  if (!dates.size) return messages;

  const byDate = new Map<string, Awaited<ReturnType<typeof fetchDayResults>>>();
  await Promise.all(
    [...dates].map(async (date) => {
      byDate.set(date, await fetchDayResults(date));
    }),
  );

  return messages.map((m) => {
    const date = String(m.meta?.date || "");
    if (!/^\d{8}$/.test(date)) return m;
    const day = byDate.get(date);
    if (!day?.size) return m;

    const races = Array.isArray(m.meta?.races) ? m.meta!.races! : [];
    if (races.length) {
      let changed = false;
      const nextRaces = races.map((chip) => {
        const res = day.get(resultKey(chip.placeNo, chip.raceNo));
        if (!res?.finishCombo) return chip;
        changed = true;
        return enrichChip(chip, res.trifecta, res.finishCombo);
      });
      if (!changed) return m;
      return {
        ...m,
        meta: {
          ...m.meta,
          races: nextRaces,
        },
      };
    }

    // races 無しの単レース投稿
    const placeNo = Number(m.meta?.placeNo || 0);
    const raceNo = Number(m.meta?.raceNo || 0);
    if (!placeNo || !raceNo) return m;
    const res = day.get(resultKey(placeNo, raceNo));
    if (!res?.finishCombo) return m;

    const tickets = (m.meta?.tickets || []).map(String).filter(Boolean);
    const bands = m.meta?.bands
      ? {
          honmei: (m.meta.bands.honmei || []).map((t) => withTicketResult(t, res.trifecta)),
          honmeiS: (m.meta.bands.honmeiS || []).map((t) => withTicketResult(t, res.trifecta)),
          oshi: (m.meta.bands.oshi || []).map((t) => withTicketResult(t, res.trifecta)),
          ana: (m.meta.bands.ana || []).map((t) => withTicketResult(t, res.trifecta)),
        }
      : undefined;
    const ticketResults = tickets.map((combo) => {
      const payout = Number(res.trifecta[combo] || 0);
      return {
        combo,
        result: (payout > 0 ? "hit" : "miss") as "hit" | "miss",
        payout,
      };
    });

    return {
      ...m,
      meta: {
        ...m.meta,
        bands,
        tickets,
        races: [
          enrichChip(
            {
              placeNo,
              placeName: STADIUMS[placeNo] || `場${placeNo}`,
              raceNo,
              label: m.meta?.race_label || `${STADIUMS[placeNo] || placeNo} ${raceNo}R`,
              tickets,
              bands: m.meta?.bands,
              status: "provisional",
              exhibition: "waiting",
              why: undefined,
              confidence: m.meta?.confidence,
              confidenceLabel: m.meta?.confidenceLabel,
            },
            res.trifecta,
            res.finishCombo,
          ),
        ],
      },
    };
  });
}
