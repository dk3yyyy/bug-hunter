// Fake database wrapper for the haunted-candy-shop demo.
//
// This is not a real database — `query` returns made-up rows so the demo needs no
// connection string, credentials, or running server. The data below is fake.

export async function query(
  sql: string,
  params?: unknown[],
): Promise<unknown[]> {
  // Pretend to run the query; the inputs are ignored.
  void sql;
  void params;
  return [{ id: 1, name: "Casper", candies: 3 }];
}

// `db` is what the rest of the app imports (see pr/src/candy.ts).
export const db = { query };
