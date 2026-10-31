export async function verifyCostume(costume: string): Promise<boolean> {
  const allowed = ["ghost", "witch", "vampire", "pumpkin"];
  await new Promise((r) => setTimeout(r, 5)); // pretend to call a costume API
  return allowed.includes(costume?.toLowerCase());
}

export async function saveCandyLog(entry: { total: number; perKid: number }): Promise<void> {
  // pretend to write to a database
}
