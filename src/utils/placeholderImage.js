// Small neutral placeholder shown for an optional/empty image slot in the
// editor (e.g. a new Image+Text section, a Navbar/Footer logo not set yet,
// or About/Contact's optional content image) — a clean dark box instead of
// a broken image icon before the admin uploads something real. There's no
// bundled asset that makes sense as a generic fallback the way Hero has one.
export const BLANK_IMAGE_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="%231a1a1a"/></svg>'
)
