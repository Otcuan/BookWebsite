export type D1Value = string | number | null;

export type D1Meta = {
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  duration?: number;
};

export type D1Result<T = Record<string, unknown>> = {
  success: boolean;
  results: T[];
  meta: D1Meta;
};

type D1Query = { sql: string; params: D1Value[] };

type D1Envelope = {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: Array<{
    success?: boolean;
    results?: Array<Record<string, unknown>>;
    meta?: D1Meta;
  }>;
};

export interface D1PreparedStatementLike {
  bind(...values: D1Value[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
  toQuery(): D1Query;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<D1Result[]>;
}

export class D1HttpDatabase implements D1DatabaseLike {
  constructor(
    private readonly accountId: string,
    private readonly databaseId: string,
    private readonly apiToken: string,
  ) {}

  prepare(sql: string): D1PreparedStatementLike {
    return new D1HttpPreparedStatement(this, sql, []);
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<D1Result[]> {
    return this.execute({ batch: statements.map((statement) => statement.toQuery()) });
  }

  async query<T = Record<string, unknown>>(query: D1Query): Promise<D1Result<T>> {
    const results = await this.execute(query);
    const first = results[0];
    if (!first) throw new Error("D1 returned no query result.");
    return first as D1Result<T>;
  }

  private async execute(body: D1Query | { batch: D1Query[] }): Promise<D1Result[]> {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/d1/database/${encodeURIComponent(this.databaseId)}/query`;
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });

    const payload = (await response.json().catch(() => null)) as D1Envelope | null;
    if (!response.ok || !payload?.success || !payload.result) {
      const message = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ");
      throw new Error(message || `D1 request failed with status ${response.status}.`);
    }

    return payload.result.map((result) => {
      if (result.success === false) throw new Error("D1 query failed.");
      return {
        success: result.success ?? true,
        results: result.results ?? [],
        meta: result.meta ?? {},
      };
    });
  }
}

class D1HttpPreparedStatement implements D1PreparedStatementLike {
  constructor(
    private readonly database: D1HttpDatabase,
    private readonly sql: string,
    private readonly params: D1Value[],
  ) {}

  bind(...values: D1Value[]): D1PreparedStatementLike {
    return new D1HttpPreparedStatement(this.database, this.sql, values);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.database.query<T>(this.toQuery());
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.all<T>();
    return result.results[0] ?? null;
  }

  async run(): Promise<D1Result> {
    return this.database.query(this.toQuery());
  }

  toQuery(): D1Query {
    return { sql: this.sql, params: this.params };
  }
}
