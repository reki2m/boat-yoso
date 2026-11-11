export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMorningHonmeiScheduler } = await import("@/lib/chatMorningPicks");
  const { startMainAppDailyScheduler } = await import("@/lib/mainAppDaily");
  startMorningHonmeiScheduler();
  // 本体アプリ: 毎日の最新データ更新＋回収率自動学習＋日中の展示確定
  startMainAppDailyScheduler();
}
