// lib/refunds.js — pure refund attribution for the /results report. No Stripe
// or network access (same reasoning as lib/results.js): api/results.js fetches
// the refunds and passes a plain payment_intent → cents map in here.
//
// PRIVACY: paymentIntentId is used ONLY here, to join a refund to its session,
// and is stripped from the returned objects. buildReport and every render
// downstream receive `refundedCents` — a number — never an identifier. The
// module's aggregate-only-by-construction guarantee is preserved.

// Match each session's refund by payment intent (the only clean, testable join
// in Stripe's dahlia API — see the spec's scope decision). Subscription-mode
// refunds do not match here by design; the orphan guard in the report catches
// them. Returns new session objects with `refundedCents` and no `paymentIntentId`.
export function annotateRefunds(sessions, byPaymentIntent = new Map()) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.map((session) => {
    const { paymentIntentId, ...rest } = session;
    const refundedCents =
      paymentIntentId && byPaymentIntent.has(paymentIntentId)
        ? byPaymentIntent.get(paymentIntentId)
        : 0;
    return { ...rest, refundedCents };
  });
}
