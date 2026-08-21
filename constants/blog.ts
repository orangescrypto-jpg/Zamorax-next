// constants/blog.ts
// Single source of truth for blog-wide constants.

// Zamorax-branded placeholder shown wherever a blog post has no cover image
// (post cards, post detail, "related posts", homepage preview, etc.) instead
// of leaving a blank/broken image area. Lives in /public so it works with a
// plain <img> tag with no upload or external URL required.
export const BLOG_FALLBACK_COVER = "/blog-fallback-cover.svg"

// Returns a usable cover image URL for a post — the post's own coverImage
// if set, otherwise the branded fallback.
export function blogCoverImage(coverImage?: string | null): string {
  return coverImage && coverImage.trim() ? coverImage : BLOG_FALLBACK_COVER
}
