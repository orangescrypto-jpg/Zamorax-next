"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Clock, Eye, Tag, User } from "lucide-react"
import type { BlogPost } from "@/src/types/blog"
import { blogCoverImage } from "@/constants/blog"

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric", month: "long", year: "numeric",
  })
}

export default function BlogPostPage() {
  const { slug }        = useParams<{ slug: string }>()
  const router          = useRouter()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [related, setRelated] = useState<BlogPost[]>([])
  // FIX: Track fetch error separately so we don't silently redirect
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return

    setLoading(true)
    setFetchError(null)

    fetch(`/api/blog?slug=${encodeURIComponent(slug)}`)
      .then(res => res.json())
      .then(async data => {
        const p: BlogPost | null = data.post ?? null

        if (!p) {
          setFetchError("Post not found. The slug may not match any published post.")
          setLoading(false)
          return
        }

        setPost(p)
        // Increment views silently
        fetch(`/api/blog/${p.id}/views`, { method: "POST" }).catch(() => {})

        const relData = await fetch(`/api/blog?limit=6`).then(r => r.json()).catch(() => ({ posts: [] }))
        setRelated((relData.posts ?? []).filter((r: BlogPost) => r.id !== p.id && r.category === p.category).slice(0, 3))
      })
      .catch(err => {
        console.error("[BlogPostPage] error:", err)
        setFetchError(err?.message ?? "Failed to load post.")
      })
      .finally(() => setLoading(false))
  }, [slug])

  // ── Loading skeleton ──────────────────────────────────────────
  if (loading) {
    return (
      <main className="container py-8 max-w-3xl mx-auto space-y-6">
        <div className="h-6 w-24 bg-gray-100 rounded animate-pulse" />
        <div className="h-10 w-3/4 bg-gray-100 rounded animate-pulse" />
        <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className={`h-4 bg-gray-100 rounded animate-pulse ${i === 3 ? "w-3/4" : "w-full"}`} />
          ))}
        </div>
      </main>
    )
  }

  // ── Error / not found ─────────────────────────────────────────
  if (fetchError) {
    return (
      <main className="container py-8 max-w-3xl mx-auto space-y-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-900 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Blog
        </Link>
        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-8 text-center space-y-3">
          <p className="text-gray-500 text-sm">{fetchError}</p>
          <Link href="/blog" className="text-primary text-sm hover:underline">
            Browse all posts →
          </Link>
        </div>
      </main>
    )
  }

  if (!post) return null

  return (
    <main className="container py-8 max-w-3xl mx-auto space-y-8">
      {/* Back */}
      <Link
        href="/blog"
        className="inline-flex items-center gap-1.5 text-gray-400 hover:text-gray-900 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Blog
      </Link>

      <article className="space-y-6">
        {/* Category */}
        {post.category && (
          <span className="inline-block bg-primary/20 text-primary text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
            {post.category}
          </span>
        )}

        {/* Title */}
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 leading-tight">
          {post.title || <span className="text-gray-300 italic">Untitled</span>}
        </h1>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-gray-400 text-xs border-b border-gray-100 pb-5">
          {post.authorName && (
            <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{post.authorName}</span>
          )}
          {post.publishedAt && (
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{formatDate(post.publishedAt)}</span>
          )}
          <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" />{(post.views ?? 0).toLocaleString()} views</span>
        </div>

        {/* Cover image */}
        <div className="rounded-2xl overflow-hidden h-64 md:h-80 bg-gray-100">
          <img
            src={blogCoverImage(post.coverImage)}
            alt={post.title}
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).src = blogCoverImage(null) }}
          />
        </div>

        {/* Excerpt */}
        {post.excerpt && (
          <p className="text-gray-500 text-base leading-relaxed italic border-l-2 border-primary pl-4">
            {post.excerpt}
          </p>
        )}

        {/* HTML Content */}
        {post.content ? (
          <div
            className="blog-content text-gray-700 leading-relaxed"
            style={{ fontSize: "15px", lineHeight: "1.8" }}
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        ) : (
          <p className="text-gray-300 italic text-sm">No content available.</p>
        )}

        {/* Tags */}
        {post.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
            <Tag className="h-4 w-4 text-gray-300 mt-0.5" />
            {post.tags.map(tag => (
              <Link
                key={tag}
                href={`/blog?tag=${encodeURIComponent(tag)}`}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 px-3 py-1 rounded-full transition-colors"
              >
                #{tag}
              </Link>
            ))}
          </div>
        )}
      </article>

      {/* Related posts */}
      {related.length > 0 && (
        <section className="space-y-4 pt-4 border-t border-gray-100">
          <h3 className="text-gray-900 font-bold">Related Articles</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {related.map(r => (
              <Link
                key={r.id}
                href={`/blog/${r.slug}`}
                className="group block rounded-xl overflow-hidden bg-gray-50 border border-gray-200 hover:border-primary/30 transition-all"
              >
                <div className="h-32 overflow-hidden bg-gray-100">
                  <img src={blogCoverImage(r.coverImage)} alt={r.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={e => { (e.target as HTMLImageElement).src = blogCoverImage(null) }} />
                </div>
                <div className="p-3">
                  <p className="text-gray-900 text-xs font-semibold line-clamp-2 group-hover:text-primary transition-colors">{r.title}</p>
                  <p className="text-gray-400 text-xs mt-1">{formatDate(r.publishedAt)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
