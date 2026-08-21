"use client"
// components/blog/BlogPostForm.tsx
// Shared form used by both /admin/blog/new and /admin/blog/[id]/edit
// Also used by moderator equivalents.
//
// Enriched with: SEO checklist, featured-post toggle, word count / reading time,
// keyboard-shortcuts reminder, and a 3-mode (Rich/Markdown/HTML) content editor —
// mirroring the Homverax admin blog editor while keeping Zamorax's dark theme,
// flat BlogPost type, and Storage-backed cover image upload.

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Save, Eye, ArrowLeft, Loader2, X, Upload, Star,
  CheckCircle2, Hash, Image as ImageIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { BlogEditor } from "@/components/blog/BlogEditor"
import { MediaLibraryPicker } from "@/components/media/MediaLibraryPicker"
import { BlogService } from "@/src/services/blog"
import { StorageService } from "@/src/services"
import { recordMediaUpload } from "@/lib/mediaLibrary"
import { cn, generateSlug } from "@/lib/utils"
import type { BlogPost, BlogStatus } from "@/src/types/blog"
import { BLOG_FALLBACK_COVER, blogCoverImage } from "@/constants/blog"

const CATEGORIES = [
  "News", "Tips & Guides", "Safety", "Seller Stories",
  "Product Updates", "Market Trends", "How It Works", "Announcements",
]

interface BlogPostFormProps {
  initial?: Partial<BlogPost>
  authorId: string
  authorName: string
  authorRole: "admin" | "moderator"
  backHref: string
}

export function BlogPostForm({
  initial, authorId, authorName, authorRole, backHref,
}: BlogPostFormProps) {
  const router    = useRouter()
  const { toast } = useToast()
  // authorId doubles as the uid that owns rows in media_library (the
  // staff media picker table) — same shape as Step4Media's useAuth().user.uid.
  const uid = authorId

  const [title,         setTitle]         = useState(initial?.title         ?? "")
  const [excerpt,       setExcerpt]       = useState(initial?.excerpt       ?? "")
  const [content,       setContent]       = useState(initial?.content       ?? "")
  const [coverImage, setCoverImageUrl] = useState(initial?.coverImage ?? "")
  const [category,      setCategory]      = useState(initial?.category      ?? CATEGORIES[0])
  const [tags,          setTags]          = useState<string[]>(initial?.tags ?? [])
  const [tagInput,      setTagInput]      = useState("")
  const [status,        setStatus]        = useState<BlogStatus>(initial?.status ?? "draft")
  const [featured,      setFeatured]      = useState(initial?.featured ?? false)
  const [saving,        setSaving]        = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [coverImgError, setCoverImgError]   = useState(false)
  const [pickerOpen, setPickerOpen]         = useState(false)

  const isEditing = !!initial?.id
  const slug = initial?.slug || generateSlug(title)

  // ── Reading time / word count (drives toolbar hint + SEO checklist) ──────
  const wordCount = content.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length
  const readingTime = Math.max(1, Math.ceil(wordCount / 200))

  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, "-")
    if (t && !tags.includes(t) && tags.length < 10) {
      setTags([...tags, t])
    }
    setTagInput("")
  }

  function removeTag(tag: string) {
    setTags(tags.filter(t => t !== tag))
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingCover(true)
    try {
      const path = `blog/covers/${Date.now()}_${file.name}`
      const { url } = await StorageService.uploadFile(file, path)
      setCoverImageUrl(url)
      setCoverImgError(false)
      recordMediaUpload({ userId: uid, url, path, fileName: file.name, context: "blog_cover" })
      toast({ title: "Cover image uploaded ✅" })
    } catch (err: any) {
      console.error("Cover image upload failed:", err)
      toast({ title: "Upload failed", description: err?.message, variant: "destructive" })
    } finally {
      setUploadingCover(false)
      e.target.value = ""
    }
  }

  async function handleSave(publishStatus: BlogStatus) {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" })
      return
    }
    if (!excerpt.trim()) {
      toast({ title: "Add an excerpt / summary", variant: "destructive" })
      return
    }
    if (!content.trim() || content === "<br>") {
      toast({ title: "Content cannot be empty", variant: "destructive" })
      return
    }

    setSaving(true)
    try {
      const payload = {
        slug: title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        title:         title.trim(),
        excerpt:       excerpt.trim(),
        content,
        coverImage: coverImage.trim(),
        category,
        tags,
        status:        publishStatus,
        featured,
        authorId,
        authorName,
        authorRole,
        publishedAt: publishStatus === "published" ? new Date().toISOString() : null,
      }

      if (isEditing && initial?.id) {
        await BlogService.updatePost(initial.id, payload)
        toast({ title: publishStatus === "published" ? "Post updated & published ✅" : "Draft saved ✅" })
      } else {
        const { id } = await BlogService.createPost(payload)
        toast({ title: publishStatus === "published" ? "Post published ✅" : "Draft saved ✅" })
        router.replace(`${backHref.replace("/blog", "/blog")}/${id}/edit`)
        return
      }
      setStatus(publishStatus)
    } catch (err: any) {
      toast({
        title: "Failed to save post",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  // ── SEO checklist ─────────────────────────────────────────────────────
  const seoChecks = [
    { done: title.length >= 30 && title.length <= 70, label: "Title 30–70 characters" },
    { done: excerpt.length >= 100 && excerpt.length <= 160, label: "Excerpt 100–160 chars" },
    { done: wordCount >= 300, label: "Content 300+ words" },
    { done: tags.length >= 2, label: "At least 2 tags" },
    { done: !!coverImage.trim(), label: "Custom cover image set (optional — Zamorax default used otherwise)" },
    { done: !!category, label: "Category selected" },
  ]

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-6 min-h-screen">
      {/* Main content area */}
      <div className="flex-1 space-y-5">
        {/* Back + title bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => router.push(backHref)}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-bold text-white">
            {isEditing ? "Edit Post" : "New Post"}
          </h1>
          {status === "published" && (
            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded-full">
              PUBLISHED
            </span>
          )}
          {status === "draft" && (
            <span className="text-[10px] bg-yellow-500/20 text-yellow-400 font-bold px-2 py-0.5 rounded-full">
              DRAFT
            </span>
          )}
          {title && (
            <span className="text-[11px] text-white/30 font-mono">/blog/{slug}</span>
          )}
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <Label className="text-white/60 text-xs">Post Title *</Label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Enter a compelling title…"
            className="bg-secondary border-white/10 text-white placeholder:text-white/30 text-lg font-semibold rounded-xl h-12"
          />
        </div>

        {/* Excerpt */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-white/60 text-xs">Excerpt / Summary *</Label>
            <span className="text-[10px] text-white/30">{excerpt.length}/300</span>
          </div>
          <textarea
            value={excerpt}
            onChange={e => setExcerpt(e.target.value.slice(0, 300))}
            placeholder="A short summary shown on the blog list and SEO description…"
            rows={2}
            maxLength={300}
            className="w-full px-3 py-2.5 bg-secondary border border-white/10 text-white text-sm placeholder:text-white/30 rounded-xl outline-none focus:border-primary/50 resize-none transition-colors"
          />
        </div>

        {/* Editor */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-white/60 text-xs">Content *</Label>
            <span className="text-[10px] text-white/30">~{wordCount} words · {readingTime} min read</span>
          </div>
          <BlogEditor value={content} onChange={setContent} minHeight={500} />
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-full lg:w-72 space-y-5 lg:pt-14">

        {/* Publish actions */}
        <div className="rounded-xl border border-white/10 bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-white font-semibold text-sm">Publish</p>
          </div>
          <div className="p-4 space-y-3">
            <Button
              onClick={() => handleSave("published")}
              disabled={saving}
              className="w-full bg-primary hover:bg-primary/90 text-white font-bold rounded-xl"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {status === "published" ? "Update Published Post" : "Publish Now"}
            </Button>
            <Button
              onClick={() => handleSave("draft")}
              disabled={saving}
              className="w-full bg-white/5 border border-white/20 text-white hover:bg-white/10 rounded-xl"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Save as Draft
            </Button>
            {isEditing && initial?.slug && (
              <a
                href={`/blog/${initial.slug}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 text-white/40 hover:text-white text-xs transition-colors"
              >
                <Eye className="h-3.5 w-3.5" /> Preview post
              </a>
            )}
          </div>

          {/* Featured toggle */}
          <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white flex items-center gap-1.5">
                <Star className={cn("h-4 w-4", featured ? "fill-yellow-400 text-yellow-400" : "text-white/30")} />
                Featured post
              </p>
              <p className="text-[11px] text-white/30 mt-0.5">Shown in the featured section</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={featured}
              onClick={() => setFeatured(!featured)}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                featured ? "bg-primary" : "bg-white/10"
              )}
            >
              <span className={cn(
                "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                featured ? "translate-x-4" : "translate-x-1"
              )} />
            </button>
          </div>
        </div>

        {/* Cover Image */}
        <div className="rounded-xl border border-white/10 bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-white font-semibold text-sm flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-white/40" /> Cover Image
            </p>
            <p className="text-white/30 text-xs mt-0.5">Paste a URL, upload an image, or pick from your uploads</p>
          </div>
          <div className="p-4 space-y-3">
            <Input
              value={coverImage}
              onChange={e => { setCoverImageUrl(e.target.value); setCoverImgError(false) }}
              placeholder="https://images.unsplash.com/…"
              className="bg-white/5 border-white/10 text-white text-xs placeholder:text-white/30 rounded-lg"
            />
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/30 text-[10px] uppercase tracking-wide">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-center gap-2 h-9 rounded-lg border border-dashed border-white/20 text-white/60 text-xs cursor-pointer hover:border-primary/50 hover:text-white transition-colors data-[uploading=true]:opacity-50 data-[uploading=true]:pointer-events-none" data-uploading={uploadingCover}>
                {uploadingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {uploadingCover ? "Uploading…" : "Upload image"}
                <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} disabled={uploadingCover} />
              </label>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex items-center justify-center gap-2 h-9 rounded-lg border border-dashed border-white/20 text-white/60 text-xs hover:border-primary/50 hover:text-white transition-colors"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                My uploads
              </button>
            </div>
            <div className="rounded-lg overflow-hidden h-32 bg-white/5 relative">
              {/* Only attempt to render if it looks like a real URL; otherwise show the branded fallback */}
              {(!coverImage || coverImgError) ? (
                <img src={BLOG_FALLBACK_COVER} alt="Zamorax fallback cover" className="w-full h-full object-cover" />
              ) : coverImage.startsWith("http") ? (
                <img
                  key={coverImage}
                  src={coverImage}
                  alt="Cover preview"
                  className="w-full h-full object-cover"
                  onError={() => setCoverImgError(true)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-1.5 px-4 text-center">
                  <ImageIcon className="h-6 w-6 text-white/20" />
                  <p className="text-[11px] text-red-400/80 leading-snug">
                    URL must start with https:// — local file paths can't be previewed
                  </p>
                </div>
              )}
            </div>
            <p className="text-[10px] text-white/20">
              Recommended: 1200×630px for best social-share previews. Leave blank to use the default Zamorax cover.
            </p>
          </div>
        </div>

        <MediaLibraryPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={url => { setCoverImageUrl(url); setCoverImgError(false); setPickerOpen(false) }}
        />

        {/* Category */}
        <div className="rounded-xl border border-white/10 bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-white font-semibold text-sm">Category *</p>
          </div>
          <div className="p-4">
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none"
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c} className="bg-[#1a1a2e]">{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tags */}
        <div className="rounded-xl border border-white/10 bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-white font-semibold text-sm flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5 text-white/40" /> Tags
              <span className="text-[10px] font-normal text-white/30 ml-auto">{tags.length}/10</span>
            </p>
          </div>
          <div className="p-4 space-y-3">
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 bg-primary/20 text-primary text-xs px-2 py-0.5 rounded-full"
                  >
                    #{tag}
                    <button onClick={() => removeTag(tag)} className="hover:text-white">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag() } }}
                placeholder="Add tag…"
                disabled={tags.length >= 10}
                className="bg-white/5 border-white/10 text-white text-xs placeholder:text-white/30 rounded-lg h-8 flex-1"
              />
              <Button
                onClick={addTag}
                size="sm"
                variant="outline"
                disabled={tags.length >= 10}
                className="h-8 text-xs border-white/10 text-white hover:bg-white/5"
              >
                Add
              </Button>
            </div>
            {tags.length === 0 && (
              <p className="text-[10px] text-white/20">No tags yet — press Enter to add</p>
            )}
          </div>
        </div>

        {/* Author */}
        <div className="rounded-xl border border-white/10 bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-white font-semibold text-sm">Author</p>
          </div>
          <div className="p-4">
            <p className="text-sm font-medium text-white">{authorName}</p>
            <p className="text-[11px] text-white/30 capitalize mt-0.5">{authorRole}</p>
          </div>
        </div>

        {/* SEO Checklist */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-white/70 font-semibold text-xs">SEO Checklist</p>
          </div>
          <ul className="p-4 space-y-2">
            {seoChecks.map((check) => (
              <li
                key={check.label}
                className={cn(
                  "flex items-center gap-2 text-xs",
                  check.done ? "text-emerald-400" : "text-white/30"
                )}
              >
                <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0", check.done ? "text-emerald-400" : "text-white/15")} />
                {check.label}
              </li>
            ))}
          </ul>
        </div>

        {/* Keyboard shortcuts reminder */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-white/70 font-semibold text-xs">Keyboard shortcuts</p>
          </div>
          <div className="p-4 space-y-1.5 text-[11px] text-white/40">
            <p><kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-white/60">Ctrl+B</kbd> Bold</p>
            <p><kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-white/60">Ctrl+I</kbd> Italic</p>
            <p><kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[10px] text-white/60">Ctrl+Z</kbd> Undo</p>
            <p className="pt-1 text-white/25">In Markdown/HTML mode: select text first, then click a toolbar button to wrap it.</p>
          </div>
        </div>

      </div>
    </div>
  )
}
