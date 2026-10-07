export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function classifyError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const code = (error as { code?: string })?.code || "";
  if (code === "23505")
    return new DomainError(
      409,
      "CONFLICT",
      "Conflicting document or active location count",
    );
  if (["23503", "23514", "22003", "22P02"].includes(code))
    return new DomainError(
      400,
      "INVALID_DATA",
      "Invalid referenced data or quantity",
    );
  if (code === "P0001")
    return new DomainError(
      409,
      "INTEGRITY_CONFLICT",
      "Operation conflicts with immutable history, stock, or document state",
    );
  if (
    [
      "40001",
      "40P01",
      "55P03",
      "57014",
      "53300",
      "57P01",
      "57P02",
      "57P03",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
    ].includes(code) ||
    code.startsWith("08")
  )
    return new DomainError(
      503,
      "DATABASE_UNAVAILABLE",
      "Database temporarily unavailable; retry with the same idempotency key",
    );
  return new DomainError(500, "INTERNAL_ERROR", "Internal server error");
}
