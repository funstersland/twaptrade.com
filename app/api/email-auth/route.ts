// Email credentials deliberately fail closed until the production identity service is chosen.
// Passwords are never stored, logged, or passed to an unconfigured service.
export async function POST() {
  return Response.json(
    {
      message:
        "Email accounts are not connected yet. Use Continue with ChatGPT to access your workspace. No password reset email has been sent.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
