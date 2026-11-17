/** Apply pending migrations in `dir` (default: packages/db/migrations) to the database. */
export function migrate(connectionString: string, dir?: string): Promise<{ applied: string[]; total: number }>;
