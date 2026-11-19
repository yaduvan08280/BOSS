/**
 * The routes the access test lets through, each with the reason. Adding a route here is a decision:
 * everything else must refuse a visitor, a member with no rights and another company.
 */

/** No sign-in at all: these answer a visitor (each protects itself — a token, a key, a signature, a limit). */
export const PUBLIC: RegExp[] = [
  /^\/api\/health(\/ready)?$/, // is the server up, and is everything doing its job: one word, no company's data
  /^\/api\/auth\/(login|logout|refresh)$/, // signing in and out; limited per address and per login ID
  /^\/api\/public\//, // a guest's link: the token in the address is the key (forms, bookings, rooms, pulse)
  /^\/api\/hooks\//, // a provider calling back: the token names the connection, the signature proves the sender
  /^\/api\/integrations\/google-drive\/callback$/, // Google sends the browser back; it signs in inside
  /^\/api\/v1\/openapi\.json$/, // the description of the public API (no data)
];

/** Read by every signed-in person whatever their role (names, their own things, the shell of the app). */
export const OPEN_TO_EVERYONE: RegExp[] = [
  /^\/api\/org\/support$/, // whom to call for help: the company's contacts and admins
  /^\/api\/org\/(users|departments|branches)$/, // names on every task and slip; no mobile or email without org.view (decision 248)
  // Record types say for themselves who may see them; a type that names nobody is open to the company (decision 110).
  /^\/api\/records\/(menu|types)$/,
  /^\/api\/records\/types\/:id(\/records)?$/,
];

/** Changes every signed-in person may make to their own things, as `METHOD /address`. */
export const OWN_ACTIONS: RegExp[] = [
  /^PATCH \/api\/auth\/me\/preferences$/, // my language and light / dark
  /^POST \/api\/notify\/telegram\/unlink$/, // my own Telegram link
  /^POST \/api\/notifications\/read-all$/, // my own notifications
  /^PUT \/api\/auth\/me\/favourites$/, // my starred screens
  /^POST \/api\/notify\/push\/unsubscribe$/, // this device's push subscription
  /^POST \/api\/errors$/, // the browser reporting its own error (limited per person)
  /^POST \/api\/masters\/links$/, // a look-up, not a change: the current name of rows whose id the caller already holds
  /^POST \/api\/records\/types\/:id\/views$/, // my own saved view of a list I may see
];
