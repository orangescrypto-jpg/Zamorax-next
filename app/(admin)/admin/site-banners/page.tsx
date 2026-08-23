"use client"

import { AdminService, where, orderBy, query, onSnapshot, serverTimestamp } from "@/src/services"
// app/(admin)/admin/site-banners/page.tsx
// Manage the long header strip banner and the normal-sized footer banner
// shown across the storefront. Separate from /admin/banners, which manages
// the homepage "Featured Deals" cards inside PromoStrip.

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/hooks/useAuth"
import { StorageService } from "@/src/services"
import imageCompression from "browser-image-compression"
import { Loader2, Plus, Trash2, Save, Eye, EyeOff, ChevronUp, ChevronDown, Upload, ImageIcon, X } from "lucide-react"

interface SiteBanner {
  id: string
  placement: "header" | "header_slider" | "footer"
  title: string
  subtitle: string
  ctaLabel: string
  href: string
  imageUrl: string
  mediaType: "image" | "video"
  bgColor: string
  textColor: string
  active: boolean
  order: number
}

const EMPTY = (placement: "header" | "header_slider" | "footer"): Omit<SiteBanner, "id"> => ({
  placement,
  title: "",
  subtitle: "",
  ctaLabel: "",
  href: "",
  imageUrl: "",
  mediaType: "image",
  bgColor: "#FF6B00",
  textColor: "#FFFFFF",
  active: true,
  order: 0,
})

export default function AdminSiteBannersPage() {
  const { toast } = useToast()
  const [tab, setTab] = useState<"header" | "header_slider" | "footer">("header")
  const [banners, setBanners] = useState<SiteBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY("header"))

  useEffect(() => {
    const q = AdminService._ref_("siteBanners", [orderBy("order", "asc")])
    const unsub = onSnapshot(q, snap => {
      setBanners(snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({ id: d.id, ...d.data() } as SiteBanner)))
      setLoading(false)
    })
    return unsub
  }, [])

  useEffect(() => { setAdding(false); setDraft(EMPTY(tab)) }, [tab])

  const filtered = banners.filter(b => b.placement === tab)

  async function handleAdd() {
    setSaving("new")
    try {
      await AdminService.addDoc("siteBanners", {
        ...draft,
        placement: tab,
        order: filtered.length,
        createdAt: serverTimestamp(),
      })
      setDraft(EMPTY(tab))
      setAdding(false)
      toast({ title: "Banner added ✅" })
    } catch (err: any) {
      toast({ title: "Failed to add banner", description: err?.message, variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  async function handleUpdate(id: string, fields: Partial<SiteBanner>) {
    setSaving(id)
    try {
      await AdminService.updateDoc("siteBanners", id, { ...fields, updatedAt: serverTimestamp() })
      toast({ title: "Saved ✅" })
    } catch (err: any) {
      toast({ title: "Failed to save", description: err?.message, variant: "destructive" })
    } finally {
      setSaving(null)
    }
  }

  async function handleDelete(id: string, imageUrl?: string) {
    if (!confirm("Delete this banner?")) return
    await AdminService.deleteDoc("siteBanners", id)
    // Also remove the uploaded image from storage, not just the DB row —
    // otherwise the file sits orphaned in R2 forever with nothing pointing
    // to it. Non-fatal if this fails (e.g. banner had no image, or it was
    // already removed) — the banner itself is already gone either way.
    if (imageUrl) {
      try { await StorageService.deleteFile(imageUrl) } catch { /* orphaned file, not worth blocking on */ }
    }
    toast({ title: "Banner deleted" })
  }

  async function handleMove(id: string, direction: "up" | "down") {
    const idx = filtered.findIndex(b => b.id === id)
    if (direction === "up" && idx === 0) return
    if (direction === "down" && idx === filtered.length - 1) return
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    const a = filtered[idx]
    const b = filtered[swapIdx]
    await Promise.all([
      AdminService.updateDoc("siteBanners", a.id, { order: b.order }),
      AdminService.updateDoc("siteBanners", b.id, { order: a.order }),
    ])
  }

  if (loading) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  )

  return (
    <div className="container py-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Site Banners</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          The header banner is a long strip shown at the very top of the homepage.
          The header slider is a large rotating banner (like a Jumia-style
          slideshow) shown at the very top of the homepage — add multiple
          active banners here and they'll auto-rotate with dots. The footer
          banner is a normal-sized promo card shown above the footer on every
          page. Turn a banner off, or leave none active, and it simply won't
          appear — no empty space is left behind.
        </p>
      </div>

      <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 text-sm text-accent font-medium">
        ✅ Changes go live instantly — no redeploy needed.
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "header" | "header_slider" | "footer")}>
        <TabsList>
          <TabsTrigger value="header">Header Strip</TabsTrigger>
          <TabsTrigger value="header_slider">Header Slider</TabsTrigger>
          <TabsTrigger value="footer">Footer Banner</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={() => setAdding(true)} className="bg-primary text-white gap-2">
              <Plus className="h-4 w-4" /> Add {tab === "header" ? "Header" : tab === "header_slider" ? "Slider" : "Footer"} Banner
            </Button>
          </div>

          {adding && (
            <Card className="border-primary/30 shadow-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">New {tab === "header" ? "Header Strip" : tab === "header_slider" ? "Header Slider" : "Footer"} Banner</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <BannerForm banner={draft} onChange={setDraft} placement={tab} />
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleAdd} disabled={saving === "new"} className="bg-primary text-white">
                    {saving === "new" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                    Add Banner
                  </Button>
                  <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {filtered.length === 0 && !adding && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No {tab} banner active. Nothing will show on the site until you add one.
            </div>
          )}

          <div className="space-y-4">
            {filtered.map((banner, idx) => (
              <BannerCard
                key={banner.id}
                banner={banner}
                placement={tab}
                isFirst={idx === 0}
                isLast={idx === filtered.length - 1}
                saving={saving === banner.id}
                onSave={(fields) => handleUpdate(banner.id, fields)}
                onDelete={() => handleDelete(banner.id, banner.imageUrl)}
                onMove={(dir) => handleMove(banner.id, dir)}
                onToggle={(active) => handleUpdate(banner.id, { active })}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function BannerForm({
  banner, onChange, placement }: {
  banner: Omit<SiteBanner, "id">
  onChange: (b: Omit<SiteBanner, "id">) => void
  placement: "header" | "header_slider" | "footer"
}) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [uploading, setUploading] = useState(false)
  const set = (k: keyof Omit<SiteBanner, "id">) => (v: unknown) => onChange({ ...banner, [k]: v })

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || !user?.uid) return
    setUploading(true)
    try {
      const raw = e.target.files[0]
      const isVideo = raw.type.startsWith("video/")

      if (isVideo) {
        // Videos are uploaded as-is — no client-side re-encoding available,
        // so just enforce a sane size cap so the homepage doesn't choke on
        // a huge file.
        if (raw.size > 25 * 1024 * 1024) {
          toast({ title: "Video too large", description: "Please keep banner videos under 25MB.", variant: "destructive" })
          setUploading(false)
          e.target.value = ""
          return
        }
        const ext  = raw.name.split(".").pop() || "mp4"
        const path = `site-banners/${placement}/${user.uid}/${Date.now()}_${raw.name.replace(/\.[^/.]+$/, "")}.${ext}`
        const result = await StorageService.uploadFile(raw, path)
        onChange({ ...banner, imageUrl: result.url, mediaType: "video" })
        toast({ title: "Video uploaded ✅" })
        return
      }

      // GIFs must skip compression entirely — imageCompression() always
      // re-encodes to a static webp, which silently strips the animation.
      // Upload the original GIF bytes as-is so it stays animated.
      const isGif = raw.type === "image/gif" || /\.gif$/i.test(raw.name)
      const file = isGif
        ? raw
        : await imageCompression(raw, {
            // Compress before upload — header strips are wide/short, footer
            // banners wider still; cap at 1920px so the source stays sharp
            // on large screens without ballooning file size.
            maxSizeMB:        1,
            maxWidthOrHeight: 1920,
            useWebWorker:     true,
            fileType:         "image/webp",
          })
      const ext  = isGif ? "gif" : "webp"
      const path = `site-banners/${placement}/${user.uid}/${Date.now()}_${raw.name.replace(/\.[^/.]+$/, "")}.${ext}`
      const result = await StorageService.uploadFile(file, path)
      onChange({ ...banner, imageUrl: result.url, mediaType: "image" })
      toast({ title: "Image uploaded ✅" })
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message, variant: "destructive" })
    } finally {
      setUploading(false)
      e.target.value = ""
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Image upload: if set, the banner renders as this image (linked to
          Link URL below) instead of the title/subtitle/color card. Everything
          else in this form still gets saved, but is ignored while an image
          is attached — remove the image to go back to the text/color banner. ── */}
      <div className="space-y-1.5">
        <Label>Banner image or video (optional)</Label>
        <p className="text-xs text-muted-foreground">
          {placement === "header"
            ? "Upload a pre-made wide strip image or video (recommended ~1500×120px) instead of building a text banner. If you upload one, it replaces the title/subtitle/colors below — only the Link URL still applies. GIFs and videos are supported and play automatically."
            : placement === "header_slider"
              ? "Upload a pre-made wide slide image or video (recommended ~1600×500px). Add several active slides here and they'll auto-rotate with dots, like a Jumia-style homepage slider. If you upload one, it replaces the title/subtitle/colors below — only the Link URL still applies. GIFs and videos are supported and play automatically. Keep videos under 25MB."
              : "Upload a pre-made banner image or video (recommended ~1200×400px) instead of building a text banner. If you upload one, it replaces the title/subtitle/colors below — only the Link URL still applies. GIFs and videos are supported and play automatically."}
        </p>

        {banner.imageUrl ? (
          <div className="relative rounded-lg border overflow-hidden">
            {banner.mediaType === "video" ? (
              <video
                src={banner.imageUrl}
                className="w-full h-auto max-h-40 object-contain bg-muted"
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <img src={banner.imageUrl} alt="Banner preview" className="w-full h-auto max-h-40 object-contain bg-muted" />
            )}
            <button
              type="button"
              onClick={() => {
                // Remove the file from storage too, not just the form field —
                // otherwise clicking X (whether swapping images or backing out
                // of an unsaved draft) leaves the upload orphaned in R2.
                const url = banner.imageUrl
                onChange({ ...banner, imageUrl: "", mediaType: "image" })
                if (url) StorageService.deleteFile(url).catch(() => { /* orphaned file, not worth blocking on */ })
              }}
              className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              aria-label="Remove media"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg py-6 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Click to upload an image or video</span>
              </>
            )}
            <input type="file" accept="image/*,video/*" className="hidden" disabled={uploading} onChange={handleImageUpload} />
          </label>
        )}
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${banner.imageUrl ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Title</Label>
          <Input
            placeholder={placement === "header" ? "e.g. Free delivery on orders over ₦20,000" : placement === "header_slider" ? "e.g. Big Phone Sale" : "e.g. Become a Zamorax Seller Today"}
            value={banner.title}
            onChange={e => set("title")(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Subtitle {placement === "header" && "(optional — keep short, it's a single line)"}</Label>
          <Input
            placeholder={placement === "header" ? "Ends this weekend" : placement === "header_slider" ? "Up to 30% off this week" : "Reach thousands of buyers across Nigeria"}
            value={banner.subtitle}
            onChange={e => set("subtitle")(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>CTA button text</Label>
          <Input placeholder="e.g. Shop Now" value={banner.ctaLabel} onChange={e => set("ctaLabel")(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Background color</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={banner.bgColor} onChange={e => set("bgColor")(e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
            <Input value={banner.bgColor} onChange={e => set("bgColor")(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Text color</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={banner.textColor} onChange={e => set("textColor")(e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
            <Input value={banner.textColor} onChange={e => set("textColor")(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Link URL {banner.imageUrl && "(still applies — the image will be clickable)"}</Label>
        <Input placeholder="/search or https://..." value={banner.href} onChange={e => set("href")(e.target.value)} />
      </div>
    </div>
  )
}

function BannerCard({
  banner, placement, isFirst, isLast, saving,
  onSave, onDelete, onMove, onToggle }: {
  banner: SiteBanner
  placement: "header" | "header_slider" | "footer"
  isFirst: boolean
  isLast: boolean
  saving: boolean
  onSave: (fields: Partial<SiteBanner>) => void
  onDelete: () => void
  onMove: (dir: "up" | "down") => void
  onToggle: (active: boolean) => void
}) {
  const [draft, setDraft] = useState(banner)
  const isDirty = JSON.stringify(draft) !== JSON.stringify(banner)

  useEffect(() => { setDraft(banner) }, [banner])

  return (
    <Card className={`transition-all ${!banner.active ? "opacity-60" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => onMove("up")} disabled={isFirst} className="p-0.5 rounded hover:bg-muted disabled:opacity-20">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => onMove("down")} disabled={isLast} className="p-0.5 rounded hover:bg-muted disabled:opacity-20">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="font-semibold text-sm">{banner.title || "Untitled"}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              {banner.active ? <Eye className="h-3.5 w-3.5 text-accent" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
              <Switch checked={banner.active} onCheckedChange={onToggle} className="scale-90" />
            </div>
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <BannerForm banner={draft} onChange={(b) => setDraft(b as SiteBanner)} placement={placement} />
        {isDirty && (
          <Button onClick={() => onSave(draft)} disabled={saving} className="bg-primary text-white gap-2" size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save changes
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
