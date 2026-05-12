// We don't import any telemetry-emitting code from vercel-labs/skills today
// — only the catalog, sanitizer, and frontmatter parser are vendored, and
// none of those call telemetry. This guard is defense-in-depth: if a future
// vendored update accidentally introduces a telemetry call, DO_NOT_TRACK
// (honored by skills' telemetry.ts as of 1.5.6) suppresses it.
if (!process.env.DO_NOT_TRACK) {
  process.env.DO_NOT_TRACK = '1'
}
