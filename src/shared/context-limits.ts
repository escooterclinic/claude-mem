//: ONE ceiling for POST /v1/context, imported by BOTH route families.
//:
//: The two families register the same path, so a bound written twice is a bound
//: that will drift: the SQLite route and the Postgres route would answer the same
//: request differently and only one deployment would ever show it.
//:
//: It was 50, and the session-start preload was capped BY it rather than by
//: choice -- asking for 75 was a ValidationError whatever the client was
//: configured to want. It is a SAFETY BOUND on one response, not a tuning knob:
//: how many observations a session actually preloads is
//: CLAUDE_MEM_CONTEXT_OBSERVATIONS, which is the operator's to set.
export const CONTEXT_LIMIT_MAX = 200;
