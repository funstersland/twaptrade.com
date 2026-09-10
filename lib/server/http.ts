import { z } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const privateHeaders = { "Cache-Control": "private, no-store" };
export function json(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: { ...privateHeaders, ...extra },
  });
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new HttpError(403, "This request could not be verified.");
}
export async function body<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  sameOrigin(request);
  if (Number(request.headers.get("content-length") || 0) > 20000)
    throw new HttpError(413, "Request too large.");
  const raw = await request.text();
  if (raw.length > 20000) throw new HttpError(413, "Request too large.");
  let parsed;
  try {
    parsed = schema.safeParse(JSON.parse(raw));
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
  if (!parsed.success)
    throw new HttpError(
      400,
      parsed.error.issues[0]?.message || "Check the supplied details.",
    );
  return parsed.data;
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message, message: error.message }, error.status);
  console.error(
    "TwapTrade request failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return json(
    {
      error: "This service is temporarily unavailable. Please try again.",
      message: "This service is temporarily unavailable. Please try again.",
    },
    503,
  );
}
