# Engineering Learnings

This file is a running record of problems we hit while building TaskFlow, what caused them, how we fixed them, and what we want to remember next time.

The goal is simple:

- keep useful lessons from getting lost in chat history
- make future debugging faster
- improve product quality and engineering judgment over time

## Entry Template

Copy this structure for new entries:

```md
## Short Title

### What happened
- Short description of the bug, UX issue, or engineering problem.

### Root cause
- What actually caused it.

### Fix
- What we changed.

### How to avoid it next time
- What to check earlier or design differently.

### General lesson
- The broader principle we want to remember.
```

## Google Calendar Reload Felt Slow

### What happened
- Google Calendar connected successfully and no longer showed the auth popup on every reload.
- But the Calendar page still felt slow after refresh.
- The calendar shell appeared first, then calendar lists and events showed up a second or two later.

### Root cause
- The reload path was doing too much work from scratch.
- Even when the user was already connected, the app still had to rebuild the calendar state through a network waterfall:
  - refresh token/access token work
  - fetch Google calendar list
  - fetch Google events
- The page also showed a disconnected or partially empty intermediate state instead of keeping useful content visible during reconnect.

### Fix
- Reworked the Google Calendar integration to use a durable server-side refresh-token flow instead of relying only on browser-side short-lived access tokens.
- Added a Supabase Edge Function to exchange Google OAuth codes, refresh access tokens, and disconnect safely.
- Stored Google refresh tokens server-side in `google_calendar_connections`.
- Improved the UI so the Calendar page can keep its connected surface visible during silent reconnect/loading instead of flashing back to the disconnected placeholder.

### How to avoid it next time
- For any external integration, test both:
  - first-time connect flow
  - reload/return flow
- If data is safe to reuse briefly, prefer:
  - show cached or existing UI immediately
  - refresh in the background
- Watch for network waterfalls during page load.
- Treat reload performance as part of the feature, not a later polish step.

### General lesson
- A feature is not fully done when the happy path works once.
- We should always ask:
  - what happens on refresh?
  - what happens when the user comes back later?
  - can we keep the UI stable while fresh data loads?

## Google Calendar JWT Rejection At The Edge Function

### What happened
- The Google Calendar popup opened, but the request to the Supabase Edge Function failed.
- The browser showed:
  - `{"code":401,"message":"Invalid JWT"}`

### Root cause
- The error format came from the Supabase gateway, not from our function code.
- That meant the request was being rejected before `google-calendar-oauth/index.ts` even ran.
- Gateway-level JWT verification was blocking the request, even though the function already performed its own auth check internally.

### Fix
- Deployed the `google-calendar-oauth` function with `--no-verify-jwt`.
- Kept auth verification inside the function using the bearer token and Supabase admin auth lookup.

### How to avoid it next time
- When debugging Edge Function auth, look closely at the error shape.
- If the error format does not match the function’s own JSON response format, the request may be failing before your function executes.
- Always verify whether the failure is:
  - browser-side
  - gateway-side
  - function-side

### General lesson
- The exact error format matters.
- Before changing app code repeatedly, confirm which layer is actually rejecting the request.

## UX Rule: Keep Useful UI Visible During Background Refresh

### What happened
- During reconnect/loading, parts of the app could briefly fall back to empty or disconnected placeholder states.

### Root cause
- Rendering logic was tied too tightly to “fully loaded” instead of “still has a meaningful connected state.”

### Fix
- Adjusted the UI so existing useful surfaces stay visible while background refresh happens.

### How to avoid it next time
- Prefer transitions like:
  - loaded -> refreshing
- Avoid transitions like:
  - loaded -> empty -> loaded

### General lesson
- Perceived performance matters just as much as raw network speed.
- If the user already had meaningful data on screen, keep it there unless we truly need to remove it.
