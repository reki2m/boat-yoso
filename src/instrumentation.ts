export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMorningHonmeiScheduler } = await import("@/lib/chatMorningPicks");
  startMorningHonmeiScheduler();
}
