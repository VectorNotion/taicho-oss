export type SignupPolicy = "open" | "waitlist";

export function signupPolicy(): SignupPolicy {
  const configured = process.env.AUTH_SIGNUP_POLICY?.trim();
  if (configured === "waitlist") return configured;
  if (configured === "open") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Open signup is not approved for production; AUTH_SIGNUP_POLICY must be 'waitlist'.",
      );
    }
    return configured;
  }
  if (configured) {
    throw new Error("AUTH_SIGNUP_POLICY must be either 'open' or 'waitlist'.");
  }
  return process.env.NODE_ENV === "production" ? "waitlist" : "open";
}
